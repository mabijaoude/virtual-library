import { useVirtualizer } from "@tanstack/react-virtual";
import DOMPurify from "dompurify";
import edition from "@edition";
import { ChevronDown, ChevronUp, ListTree, Loader2, MapPin, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { formatHeadingTitle } from "../library";
import { markPerformance } from "../performance";
import { useDialogFocus } from "./useDialogFocus";
import type { Book, BookDetail, ResolvedBook, SearchMatch } from "../types";

export type ReaderLoadRequest = {
  id: number;
  book: Book;
  detail: Promise<BookDetail>;
  content: Promise<string>;
  signal: AbortSignal;
};

type ReaderProps = {
  request: ReaderLoadRequest;
  targetMatch?: SearchMatch;
  initialFind?: string;
  onClose: () => void;
  onRetry: () => void;
  onShowShelf: (book: ResolvedBook) => void;
};

type SectionInfo = {
  id: string;
  title: string;
  headingOrder?: number;
  sourceStart: number;
  estimatedSize: number;
};

type ReaderPosition = {
  version?: 2;
  sectionIndex?: number;
  offset?: number;
  progress: number;
  headingOrder?: number;
};

type FindMatch = { sectionIndex: number; occurrence: number };
type FindResult = { query: string; matches: FindMatch[] };

export default function Reader({ request, targetMatch, initialFind = "", onClose, onRetry, onShowShelf }: ReaderProps) {
  const [resolvedBook, setResolvedBook] = useState<ResolvedBook>();
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [sectionHtml, setSectionHtml] = useState<Record<number, string>>({});
  const [stage, setStage] = useState<"loading" | "preparing" | "ready">("loading");
  const [error, setError] = useState<string>();
  const [find, setFind] = useState(initialFind);
  const [activeHit, setActiveHit] = useState(0);
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState<number>();
  const [findResult, setFindResult] = useState<FindResult>({ query: "", matches: [] });
  const [tocOpen, setTocOpen] = useState(() => Boolean(request.book.headingCount) && !window.matchMedia("(max-width: 820px)").matches);
  const dialogRef = useRef<HTMLElement>(null);
  const contentsButtonRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialogRef, '[data-reader-return], [title="Browse books"]');
  const articleRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const requestedSectionsRef = useRef(new Set<number>());
  const targetSectionRef = useRef(0);
  const restoredRef = useRef(false);
  const findRequestRef = useRef(0);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const persistHandleRef = useRef<number | undefined>(undefined);
  const latestPositionRef = useRef<ReaderPosition>({ progress: 0 });
  const storageKey = `${edition.storageNamespace}:reader-v2:${request.book.id}`;

  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => articleRef.current,
    estimateSize: (index) => sections[index]?.estimatedSize || 700,
    overscan: 3
  });
  const virtualItems = virtualizer.getVirtualItems();
  const headings = resolvedBook?.headings || request.book.headings || [];

  useEffect(() => {
    let cancelled = false;
    setResolvedBook(undefined);
    setSections([]);
    setSectionHtml({});
    setStage("loading");
    setError(undefined);
    setFind(initialFind);
    setActiveHit(0);
    setProgress(0);
    setFindResult({ query: "", matches: [] });
    setTocOpen(Boolean(request.book.headingCount) && !window.matchMedia("(max-width: 820px)").matches);
    requestedSectionsRef.current.clear();
    restoredRef.current = false;

    Promise.all([request.detail, request.content])
      .then(([detail, markdown]) => {
        if (cancelled || request.signal.aborted) return;
        const nextBook = { ...request.book, ...detail } as ResolvedBook;
        setResolvedBook(nextBook);
        setTocOpen(nextBook.headings.length > 0 && !window.matchMedia("(max-width: 820px)").matches);
        setStage("preparing");
        const worker = new Worker(new URL("../workers/reader-content.worker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;
        worker.addEventListener("message", (event: MessageEvent<{
          type: "ready" | "section" | "search-result";
          targetIndex?: number;
          sections?: SectionInfo[];
          index?: number;
          html?: string;
          id?: number;
          query?: string;
          matches?: FindMatch[];
        }>) => {
          if (cancelled) return;
          const message = event.data;
          if (message.type === "ready" && message.sections) {
            targetSectionRef.current = message.targetIndex || 0;
            setSections(message.sections);
          } else if (message.type === "section" && typeof message.index === "number" && message.html !== undefined) {
            setSectionHtml((current) => ({ ...current, [message.index!]: DOMPurify.sanitize(message.html!, { USE_PROFILES: { html: true } }) }));
            if (message.index === targetSectionRef.current) {
              setStage("ready");
              markPerformance(`library:reader-first-section:${request.id}`);
            }
          } else if (message.type === "search-result" && message.id === findRequestRef.current) {
            const matches = message.matches || [];
            setFindResult({ query: message.query || "", matches });
            const requestedIndex = targetMatch?.findIndex;
            setActiveHit(typeof requestedIndex === "number" ? Math.min(requestedIndex, Math.max(0, matches.length - 1)) : 0);
          }
        });
        worker.postMessage({
          type: "init",
          markdown,
          headings: nextBook.headings,
          targetHeadingOrder: targetMatch?.headingOrder,
          targetPosition: targetMatch?.position
        });
      })
      .catch((reason) => {
        if (!cancelled && !request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      cancelled = true;
      workerRef.current?.terminate();
      workerRef.current = undefined;
      clearReaderHighlight();
    };
  }, [request.id]);

  useEffect(() => {
    if (!sections.length) return;
    const saved = readPosition(storageKey);
    let index = targetMatch ? targetSectionRef.current : saved.sectionIndex || 0;
    if (!targetMatch && typeof saved.headingOrder === "number") {
      const headingIndex = sections.findIndex((section) => section.headingOrder === saved.headingOrder);
      if (headingIndex >= 0) index = headingIndex;
    }
    targetSectionRef.current = Math.min(index, sections.length - 1);
    const frame = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(targetSectionRef.current, { align: "start" });
      restoredRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sections.length, storageKey]);

  useEffect(() => {
    const indexes = virtualItems.map((item) => item.index);
    if (!indexes.length && sections.length) indexes.push(targetSectionRef.current);
    const missing = indexes.filter((index) => !requestedSectionsRef.current.has(index));
    if (!missing.length) return;
    missing.forEach((index) => requestedSectionsRef.current.add(index));
    workerRef.current?.postMessage({ type: "render", indexes: missing });
  }, [sections.length, virtualItems.map((item) => item.index).join(",")]);

  useEffect(() => {
    const normalized = find.trim();
    if (!workerRef.current || !sections.length) return;
    if (!normalized) {
      findRequestRef.current += 1;
      setFindResult({ query: "", matches: [] });
      clearReaderHighlight();
      return;
    }
    const requestId = ++findRequestRef.current;
    const timer = window.setTimeout(() => workerRef.current?.postMessage({ type: "search", id: requestId, query: normalized }), 140);
    return () => window.clearTimeout(timer);
  }, [find, sections.length]);

  useEffect(() => {
    const match = findResult.matches[activeHit];
    if (!match) {
      clearReaderHighlight();
      return;
    }
    const selector = `[data-reader-section="${match.sectionIndex}"]`;
    if (!articleRef.current?.querySelector(selector)) {
      virtualizer.scrollToIndex(match.sectionIndex, { align: "center" });
    }
    const frame = window.requestAnimationFrame(() => {
      const section = articleRef.current?.querySelector<HTMLElement>(selector);
      if (!section) return;
      const range = rangeForQuery(section, findResult.query, match.occurrence);
      if (!range) return;
      showReaderHighlight(range);
      range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeHit, findResult, sectionHtml]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== undefined) window.cancelAnimationFrame(scrollFrameRef.current);
    persistPosition(storageKey, latestPositionRef.current);
  }, [storageKey]);

  function updateProgress() {
    if (scrollFrameRef.current !== undefined) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      const article = articleRef.current;
      if (!article) return;
      const max = article.scrollHeight - article.clientHeight;
      const nextProgress = max <= 0 ? 1 : Math.min(1, article.scrollTop / max);
      const first = virtualizer.getVirtualItems()[0];
      const nextHeading = first ? sections[first.index]?.headingOrder : activeHeading;
      const nextPosition = { version: 2 as const, progress: nextProgress, sectionIndex: first?.index || 0, offset: first ? Math.max(0, article.scrollTop - first.start) : 0, headingOrder: nextHeading };
      latestPositionRef.current = nextPosition;
      setProgress(nextProgress);
      setActiveHeading(nextHeading);
      schedulePersist(storageKey, nextPosition, persistHandleRef);
    });
  }

  function moveHit(direction: number) {
    if (!findResult.matches.length) return;
    setActiveHit((current) => (current + direction + findResult.matches.length) % findResult.matches.length);
  }

  function jumpToHeading(order: number) {
    const index = sections.findIndex((section) => section.headingOrder === order);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "start" });
    setActiveHeading(order);
    if (window.matchMedia("(max-width: 820px)").matches) {
      setTocOpen(false);
      contentsButtonRef.current?.focus({ preventScroll: true });
    }
  }

  const identity = resolvedBook || request.book;
  const busyLabel = stage === "loading" ? "Loading text…" : "Preparing the first section…";

  return (
    <section ref={dialogRef} className="reader-overlay" role="dialog" aria-modal="true" tabIndex={-1} data-reader-dialog aria-label={`Reading ${identity.title}`} aria-busy={stage !== "ready" && !error}>
      <div className={tocOpen ? "reader-shell" : "reader-shell toc-collapsed"}>
        <header className="reader-toolbar">
          <button ref={contentsButtonRef} className="icon-button" type="button" title={tocOpen ? "Hide contents" : "Show contents"} aria-expanded={tocOpen} aria-controls="reader-contents" onClick={() => setTocOpen((value) => !value)}>
            {tocOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          </button>
          <div className="reader-identity">
            <span>{identity.author}</span>
            <strong>{identity.title}</strong>
          </div>
          <div className="reader-find">
            <Search size={15} />
            <input value={find} onChange={(event) => (setFind(event.target.value), setActiveHit(0))} placeholder="Find in this book" aria-label="Find in this book" />
            <span>{find.trim() ? (findResult.query === find.trim() ? `${findResult.matches.length} found` : "Searching…") : "Find"}</span>
            <button type="button" title="Previous match" disabled={!findResult.matches.length} onClick={() => moveHit(-1)}><ChevronUp size={15} /></button>
            <button type="button" title="Next match" disabled={!findResult.matches.length} onClick={() => moveHit(1)}><ChevronDown size={15} /></button>
          </div>
          <button className="reader-shelf-action" type="button" disabled={!resolvedBook} onClick={() => resolvedBook && onShowShelf(resolvedBook)}><MapPin size={16} /><span>Shelf</span></button>
          <button className="icon-button" type="button" title="Close reader" onClick={onClose}><X size={20} /></button>
          <div className="reader-progress" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        </header>

        <div className="reader-body">
          {tocOpen && <button className="reader-contents-scrim" type="button" aria-label="Close contents" onClick={() => (setTocOpen(false), contentsButtonRef.current?.focus())} />}
          <nav id="reader-contents" aria-label="Book contents" inert={!tocOpen}>
            <div className="reader-nav-heading"><span><ListTree size={14} /> Contents</span><strong>{headings.length}</strong></div>
            {!headings.length && <p className="reader-no-headings">This volume has no section headings.</p>}
            {headings.slice(0, 240).map((heading) => (
              <button key={`${heading.order}-${heading.id}`} className={activeHeading === heading.order ? "active" : ""} style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 10 + 10}px` }} onClick={() => jumpToHeading(heading.order)}>
                {formatHeadingTitle(heading.title)}
              </button>
            ))}
          </nav>
          <div className="reader-article" ref={articleRef} onScroll={updateProgress}>
            {error && (
              <div className="reader-state reader-error" role="alert">
                <strong>This volume could not be opened.</strong>
                <span>{error}</span>
                <div><button type="button" onClick={onRetry}>Retry</button><button type="button" onClick={onClose}>Back to catalogue</button></div>
              </div>
            )}
            {!error && !sections.length && (
              <div className="reader-state" role="status" aria-live="polite"><Loader2 className="spin delayed-spinner" size={22} /><strong>{busyLabel}</strong><button type="button" onClick={onClose}>Cancel</button></div>
            )}
            {!error && sections.length > 0 && (
              <div className="reader-virtual-space" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                {virtualItems.map((item) => (
                  <section
                    key={sections[item.index].id}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    data-reader-section={item.index}
                    className="reader-section"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {sectionHtml[item.index]
                      ? <div dangerouslySetInnerHTML={{ __html: sectionHtml[item.index] }} />
                      : <div className="reader-section-skeleton" role="status"><span>Preparing section…</span></div>}
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function rangeForQuery(root: HTMLElement, query: string, occurrence: number) {
  const text = root.textContent || "";
  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  let start = -1;
  let cursor = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = normalizedText.indexOf(normalizedQuery, cursor);
    if (start < 0) return undefined;
    cursor = start + Math.max(1, normalizedQuery.length);
  }
  return rangeForTextOffset(root, start, query.length);
}

function rangeForTextOffset(root: HTMLElement, start: number, length: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let startNode: Text | undefined;
  let startOffset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const end = offset + node.data.length;
    if (!startNode && start >= offset && start <= end) {
      startNode = node;
      startOffset = Math.min(node.data.length, start - offset);
    }
    if (startNode && start + length <= end) {
      range.setStart(startNode, startOffset);
      range.setEnd(node, Math.max(0, start + length - offset));
      return range;
    }
    offset = end;
    node = walker.nextNode() as Text | null;
  }
  return undefined;
}

function showReaderHighlight(range: Range) {
  const registry = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void } }).highlights;
  const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (registry && HighlightConstructor) {
    registry.set("reader-find-active", new HighlightConstructor(range));
    return;
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function clearReaderHighlight() {
  const registry = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights;
  registry?.delete("reader-find-active");
}

function readPosition(key: string): ReaderPosition {
  try {
    return JSON.parse(localStorage.getItem(key) || localStorage.getItem(key.replace("reader-v2", "reader")) || "{}") as ReaderPosition;
  } catch {
    return { progress: 0 };
  }
}

function schedulePersist(key: string, position: ReaderPosition, handle: MutableRefObject<number | undefined>) {
  if (handle.current !== undefined) {
    if (window.cancelIdleCallback) window.cancelIdleCallback(handle.current);
    else window.clearTimeout(handle.current);
  }
  const persist = () => persistPosition(key, position);
  handle.current = window.requestIdleCallback ? window.requestIdleCallback(persist, { timeout: 900 }) : window.setTimeout(persist, 500);
}

function persistPosition(key: string, position: ReaderPosition) {
  try {
    localStorage.setItem(key, JSON.stringify(position));
  } catch {
    // Reading remains available when storage is unavailable.
  }
}
