import {
  ArrowRight,
  ArrowRightLeft,
  BookCopy,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Database,
  ExternalLink,
  FileText,
  Landmark,
  Layers,
  Library,
  ListTree,
  Loader2,
  MapPin,
  PanelLeftClose,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import edition from "@edition";
import AsyncBoundary from "./components/AsyncBoundary";
import MobileJoystick from "./components/MobileJoystick";
import NavigationGuide from "./components/NavigationGuide";
import RoomNotes from "./components/RoomNotes";
import { useDialogFocus } from "./components/useDialogFocus";
import { setAmbienceVolume, startWorldAmbience } from "./ambient";
import { bookFacetValues, facetGroups, formatCount, formatHeadingTitle, loadBookContent, loadBookDetail, loadManifest, passageHitsToGroups, quickSearchGroups, visibleFacetDefinitions } from "./library";
import { getWorld, WORLDS, worldCssVariables, type WorldId } from "./worlds/registry";
import type { Book, BookDetail, LibraryManifest, ResolvedBook, SceneMode, SearchCapabilities, SearchGroup, SearchMatch, SearchPassageHit, SnippetPart } from "./types";
import type { ReaderLoadRequest } from "./components/Reader";
import { beginRoomPerformance, finishRoomPerformance, markPerformance, measurePerformance, observeRoomWork, PERFORMANCE_MARKS } from "./performance";
import type { QualityPreference, SceneLoadProgress } from "./worlds/types";
import {
  browserSearchDocuments,
  clearBrowserBooks,
  importBrowserFiles,
  listBrowserBooks,
  MAX_SHELF_TITLE_LENGTH,
  mergeBrowserBooks,
  parseShelfOrganization,
  removeBrowserBook,
  sanitizeShelfTitle,
  type BrowserBookRecord,
  type ShelfOrganization
} from "./browserLibrary";

const loadReader = () => import("./components/Reader");
const Reader = lazy(loadReader);
const loadLibraryScene = () => import("./components/LibraryScene");
const LibraryScene = lazy(loadLibraryScene);

type InspectorTab = "overview" | "toc" | "source";
type ReaderState = { request: ReaderLoadRequest; match?: SearchMatch; find?: string };
type SceneLoadPhase = "preview" | "loading-code" | "loading-model" | "finishing" | "ready" | "error";
const EMPTY_SCENE_PROGRESS: SceneLoadProgress = { stage: "code", completed: 0, total: 8, ratio: 0 };
const COMPLETE_ROOM_LOAD_BUDGET_MS = 15_000;

const GENERIC_HEADING = /^(contents|index|copyright|dedication|acknowledgments?|notes?|bibliography|about the author|cover art)$/i;
const REQUESTED_WORLD = new URLSearchParams(window.location.search).get("world");
const PREVIEW_MODE = new URLSearchParams(window.location.search).has("preview");
const PDF_TO_MARKDOWN_URL = "https://pdftomd.im/";
const DEFAULT_SCENE_BRIGHTNESS = 100;
const MIN_SCENE_BRIGHTNESS = 60;
const MAX_SCENE_BRIGHTNESS = 140;
const STARTER_BOOKS_HIDDEN_KEY = `${edition.storageNamespace}:starter-books-hidden`;
const SHELF_ORGANIZATION_KEY = `${edition.storageNamespace}:shelf-organization-v1`;

function releaseCursor() {
  if (document.pointerLockElement) document.exitPointerLock?.();
}

export default function App() {
  const [manifest, setManifest] = useState<LibraryManifest>();
  const [error, setError] = useState<string>();
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [scopeId, setScopeId] = useState(() => {
    const stored = localStorage.getItem(`${edition.storageNamespace}:scope`);
    return edition.scopes.some((scope) => scope.id === stored) ? stored! : edition.defaultScopeId;
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [bookDetails, setBookDetails] = useState<Record<string, BookDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string>();
  const [detailError, setDetailError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  const [hoveredBook, setHoveredBook] = useState<Book>();
  const [sceneMode, setSceneMode] = useState<SceneMode>("browse");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showSearchBusy, setShowSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [searchCapabilities, setSearchCapabilities] = useState<SearchCapabilities>(edition.searchProvider.capabilities);
  const [passageResults, setPassageResults] = useState<SearchGroup[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<SearchMatch>();
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [reader, setReader] = useState<ReaderState>();
  const [worldId, setWorldId] = useState<WorldId>(() => getWorld(REQUESTED_WORLD || localStorage.getItem(`${edition.storageNamespace}:world`)).id);
  const [sceneRequested, setSceneRequested] = useState(false);
  const [scenePhase, setScenePhase] = useState<SceneLoadPhase>("preview");
  const [sceneProgress, setSceneProgress] = useState<SceneLoadProgress>(EMPTY_SCENE_PROGRESS);
  const [sceneError, setSceneError] = useState<string>();
  const [sceneRetry, setSceneRetry] = useState(0);
  const [sceneEnabled, setSceneEnabled] = useState(() => localStorage.getItem(`${edition.storageNamespace}:scene-mode`) !== "preview");
  const [qualityPreference, setQualityPreference] = useState<QualityPreference>(() => {
    const saved = localStorage.getItem(`${edition.storageNamespace}:quality`);
    return saved === "lite" || saved === "balanced" || saved === "cinematic" ? saved : "auto";
  });
  const [atlasOpen, setAtlasOpen] = useState(false);
  const atlasRef = useRef<HTMLElement>(null);
  useDialogFocus(atlasRef, '[aria-controls="world-atlas"]', atlasOpen);
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const displaySettingsRef = useRef<HTMLElement>(null);
  useDialogFocus(displaySettingsRef, '[aria-controls="display-settings"]', displaySettingsOpen);
  const [sceneBrightness, setSceneBrightness] = useState(() => {
    const stored = localStorage.getItem(`${edition.storageNamespace}:scene-brightness`);
    const parsed = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(parsed) && parsed >= MIN_SCENE_BRIGHTNESS && parsed <= MAX_SCENE_BRIGHTNESS
      ? parsed
      : DEFAULT_SCENE_BRIGHTNESS;
  });
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [browserLibraryOpen, setBrowserLibraryOpen] = useState(false);
  const browserLibraryRef = useRef<HTMLElement>(null);
  useDialogFocus(browserLibraryRef, '[aria-controls="display-settings"]', browserLibraryOpen);
  const [browserBooks, setBrowserBooks] = useState<BrowserBookRecord[]>([]);
  const [starterBooksHidden, setStarterBooksHidden] = useState(() => localStorage.getItem(STARTER_BOOKS_HIDDEN_KEY) === "true");
  const [shelfOrganization, setShelfOrganization] = useState(() => parseShelfOrganization(localStorage.getItem(SHELF_ORGANIZATION_KEY)));
  const [shelfOrganizerOpen, setShelfOrganizerOpen] = useState(false);
  const [organizerBookId, setOrganizerBookId] = useState<string>();
  const [browserLibraryBusy, setBrowserLibraryBusy] = useState(false);
  const [browserLibraryMessage, setBrowserLibraryMessage] = useState<string>();
  const [emptyLibraryDismissed, setEmptyLibraryDismissed] = useState(false);
  const [markdownDragActive, setMarkdownDragActive] = useState(false);
  const [controlsExpanded, setControlsExpanded] = useState(() => localStorage.getItem(`${edition.storageNamespace}:controls-guide-seen`) !== "true");
  const [activeFacetId, setActiveFacetId] = useState<string>();
  const [activeFacetValue, setActiveFacetValue] = useState<string>();
  const [ambienceEnabled, setAmbienceEnabled] = useState(false);
  const [ambienceVolume, setAmbienceVolumePreference] = useState(() => {
    const saved = Number(localStorage.getItem(`${edition.storageNamespace}:volume`) ?? 50);
    return Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : 50;
  });
  const [motionPaused, setMotionPaused] = useState(() => localStorage.getItem(`${edition.storageNamespace}:motion-paused`) === "true");
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [quietMode, setQuietMode] = useState(false);
  const [roomNotesOpen, setRoomNotesOpen] = useState(false);
  const [bookCueDismissed, setBookCueDismissed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPaletteRef = useRef<HTMLDivElement>(null);
  const browserFileInputRef = useRef<HTMLInputElement>(null);
  const markdownDragDepthRef = useRef(0);
  const readerRequestRef = useRef<AbortController | undefined>(undefined);
  const readerRequestIdRef = useRef(0);
  const manifestCacheRef = useRef(new Map<string, LibraryManifest>());
  const roomLoadStartedAtRef = useRef(performance.now());

  useEffect(() => {
    document.title = edition.brand.name;
    markPerformance(PERFORMANCE_MARKS.shellReady);
    return observeRoomWork();
  }, []);

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!ambienceEnabled || reader || !pageVisible || scenePhase !== "ready") return;
    return startWorldAmbience(worldId, ambienceVolume / 100);
  }, [ambienceEnabled, worldId, reader, pageVisible, scenePhase]);
  useEffect(() => {
    setAmbienceVolume(ambienceVolume / 100);
    localStorage.setItem(`${edition.storageNamespace}:volume`, String(ambienceVolume));
  }, [ambienceVolume]);
  useEffect(() => {
    localStorage.setItem(`${edition.storageNamespace}:motion-paused`, String(motionPaused));
  }, [motionPaused]);

  useEffect(() => {
    localStorage.setItem(`${edition.storageNamespace}:scene-brightness`, String(sceneBrightness));
  }, [sceneBrightness]);
  useEffect(() => {
    localStorage.setItem(`${edition.storageNamespace}:quality`, qualityPreference);
  }, [qualityPreference]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setError(undefined);
    const cached = manifestCacheRef.current.get(scopeId);
    const catalogRequest = cached ? Promise.resolve(cached) : loadManifest(scopeId, controller.signal);
    catalogRequest
      .then(async (nextManifest) => {
        markPerformance(PERFORMANCE_MARKS.catalogReady);
        measurePerformance("library:shell-to-catalog", PERFORMANCE_MARKS.shellReady, PERFORMANCE_MARKS.catalogReady);
        manifestCacheRef.current.set(scopeId, nextManifest);
        const installedManifest = await installBrowserLibrary(nextManifest);
        if (controller.signal.aborted) return;
        const booksById = new Map(installedManifest.books.map((book) => [book.id, book]));
        setSelectedId((current) => current && booksById.has(current) ? current : undefined);
        setFocusId((current) => current && booksById.has(current) ? current : undefined);
        setReader((current) => {
          if (!current) return undefined;
          const nextBook = booksById.get(current.request.book.id);
          if (!nextBook) return undefined;
          return {
            ...current,
            request: { ...current.request, book: { ...nextBook, ...current.request.book } },
            match: current.match ? { ...current.match, book: nextBook } : undefined
          };
        });
        localStorage.setItem(`${edition.storageNamespace}:scope`, scopeId);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [catalogRetry, scopeId, starterBooksHidden]);

  useEffect(() => {
    if (!manifest || !sceneEnabled || sceneRequested) return;
    const frame = window.requestAnimationFrame(() => beginSceneLoad());
    return () => window.cancelAnimationFrame(frame);
  }, [manifest, sceneEnabled, sceneRequested]);


  useEffect(() => {
    if (!searching) {
      setShowSearchBusy(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSearchBusy(true), 250);
    return () => window.clearTimeout(timer);
  }, [searching]);

  useEffect(() => {
    if (!searchOpen || !manifest) return;
    const requestIdle = window.requestIdleCallback || ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 16 }), 200));
    const handle = requestIdle(() => void edition.searchProvider.preload?.(manifest.scopeId).catch(() => undefined), { timeout: 900 });
    return () => (window.cancelIdleCallback || window.clearTimeout)(handle);
  }, [manifest, searchOpen]);

  useEffect(() => {
    if (!manifest || query.trim().length < 2) {
      setPassageResults([]);
      setSearching(false);
      setSearchError(undefined);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setSearching(true);
    setSearchError(undefined);
    setSearchCapabilities(edition.searchProvider.capabilities);
    const timer = window.setTimeout(() => {
      const modes = edition.searchProvider.capabilities.semantic ? (["phrase", "semantic"] as const) : (["combined"] as const);
      const hits = new Map<string, SearchPassageHit>();
      let completed = 0;
      let succeeded = 0;
      const failures: string[] = [];
      for (const mode of modes) {
        edition.searchProvider.search({ scopeId: manifest.scopeId, query, limit: 32, mode }, controller.signal)
          .then((response) => {
            if (cancelled) return;
            succeeded += 1;
            response.hits.forEach((hit) => hits.set(hit.id, hit));
            setSearchCapabilities(response.capabilities);
            setPassageResults(passageHitsToGroups(manifest.books, [...hits.values()], query));
          })
          .catch((reason) => {
            if (!cancelled && !controller.signal.aborted) failures.push(reason instanceof Error ? reason.message : String(reason));
          })
          .finally(() => {
            completed += 1;
            if (!cancelled && completed === modes.length) {
              setSearching(false);
              if (!succeeded && failures.length) setSearchError(failures[0]);
            }
          });
      }
    }, 150);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [manifest, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (reader) {
          document.querySelector<HTMLInputElement>('[aria-label="Find in this book"]')?.focus();
          return;
        }
        releaseCursor();
        setQuietMode(false);
        setAtlasOpen(false);
        setDisplaySettingsOpen(false);
        setBrowserLibraryOpen(false);
        setRoomNotesOpen(false);
        setShelfOrganizerOpen(false);
        setCollectionOpen(false);
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
      if (event.key === "Escape") {
        setQuietMode(false);
        if (reader) closeReader();
        else if (roomNotesOpen) setRoomNotesOpen(false);
        else if (shelfOrganizerOpen) setShelfOrganizerOpen(false);
        else if (browserLibraryOpen) setBrowserLibraryOpen(false);
        else if (atlasOpen) setAtlasOpen(false);
        else if (displaySettingsOpen) setDisplaySettingsOpen(false);
        else if (searchOpen) setSearchOpen(false);
        else if (collectionOpen) setCollectionOpen(false);
        else {
          releaseCursor();
          setSceneMode("browse");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [atlasOpen, browserLibraryOpen, collectionOpen, displaySettingsOpen, reader, roomNotesOpen, searchOpen, shelfOrganizerOpen]);

  useEffect(() => {
    if (sceneMode === "focus" && !focusId) setSceneMode("browse");
  }, [focusId, sceneMode]);

  const world = useMemo(() => getWorld(worldId), [worldId]);
  const selectedCatalogBook = useMemo(() => manifest?.books.find((book) => book.id === selectedId), [manifest, selectedId]);
  const selectedBook = useMemo(() => selectedCatalogBook
    ? { ...selectedCatalogBook, ...(bookDetails[selectedCatalogBook.id] || {}) }
    : undefined, [bookDetails, selectedCatalogBook]);
  const quickResults = useMemo(() => (manifest && query.trim() ? quickSearchGroups(manifest.books, query) : []), [manifest, query]);
  const visibleResults = passageResults.length ? passageResults : quickResults;
  const browseFacets = useMemo(() => manifest ? visibleFacetDefinitions(manifest) : [], [manifest]);
  const activeFacet = browseFacets.find((facet) => facet.id === activeFacetId) || browseFacets[0];
  const activeGroups = useMemo(() => manifest && activeFacet ? facetGroups(manifest.books, activeFacet.id) : [], [activeFacet, manifest]);
  const activeCollection = activeGroups.find((group) => group.label === activeFacetValue) || activeGroups[0];
  const collectionBooks = useMemo(() => {
    if (!manifest || !activeCollection) return [];
    return [...activeCollection.books]
      .sort((a, b) => a.author.localeCompare(b.author) || (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title));
  }, [activeCollection, manifest]);
  const highlights = useMemo(() => {
    const groups = visibleResults.slice(0, 12);
    const max = Math.max(1, ...groups.map((group) => group.score));
    return new Map(groups.map((group) => [group.book.id, group.score / max]));
  }, [visibleResults]);
  const relatedBooks = useMemo(() => (selectedBook && manifest ? getRelatedBooks(selectedBook, manifest.books, 4) : []), [manifest, selectedBook]);
  const startHeadings = useMemo(() => (selectedBook ? getStartHeadings(selectedBook, 6) : []), [selectedBook]);
  const starterBookCount = manifestCacheRef.current.get(scopeId)?.books.filter((book) => book.origin === "bundled").length || 0;
  const starterBookNoun = starterBookCount === 1 ? "book" : "books";

  useEffect(() => {
    if (!manifest || !selectedCatalogBook || bookDetails[selectedCatalogBook.id]) return;
    const controller = new AbortController();
    setDetailLoadingId(selectedCatalogBook.id);
    setDetailError(undefined);
    loadBookDetail(selectedCatalogBook, manifest.version, controller.signal)
      .then((detail) => setBookDetails((current) => ({ ...current, [selectedCatalogBook.id]: detail })))
      .catch((reason) => {
        if (!controller.signal.aborted) setDetailError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoadingId((current) => current === selectedCatalogBook.id ? undefined : current);
      });
    return () => controller.abort();
  }, [bookDetails, manifest, selectedCatalogBook]);

  async function installBrowserLibrary(baseManifest: LibraryManifest) {
    let records: BrowserBookRecord[] = [];
    try {
      records = await listBrowserBooks();
      await edition.searchProvider.replaceBrowserDocuments?.(browserSearchDocuments(records));
    } catch (reason) {
      setBrowserLibraryMessage(`Browser storage is unavailable: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    const nextManifest = mergeBrowserBooks(baseManifest, records, { hideBundledBooks: starterBooksHidden, organization: shelfOrganization });
    setBrowserBooks(records);
    setManifest(nextManifest);
    return nextManifest;
  }

  async function refreshBrowserLibrary(message?: string) {
    const baseManifest = manifestCacheRef.current.get(scopeId);
    if (!baseManifest) return;
    const nextManifest = await installBrowserLibrary(baseManifest);
    const availableIds = new Set(nextManifest.books.map((book) => book.id));
    setSelectedId((current) => current && availableIds.has(current) ? current : undefined);
    setFocusId((current) => current && availableIds.has(current) ? current : undefined);
    setBookDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => availableIds.has(id))));
    if (message) setBrowserLibraryMessage(message);
  }

  async function importBrowserSelection(files: File[]) {
    if (!files.length || browserLibraryBusy) return;
    setBrowserLibraryBusy(true);
    setBrowserLibraryMessage(undefined);
    try {
      const result = await importBrowserFiles(files);
      const summary = [
        result.added ? `${result.added} added` : "",
        result.replaced ? `${result.replaced} updated` : "",
        result.skipped ? `${result.skipped} unchanged` : "",
        result.rejected ? `${result.rejected} rejected` : ""
      ].filter(Boolean).join(", ") || "No changes";
      const nextStep = result.added || result.replaced ? "Choose a book below to view it on a shelf." : "";
      await refreshBrowserLibrary([summary, nextStep, ...result.warnings].filter(Boolean).join(" · "));
      setBrowserLibraryOpen(true);
    } catch (reason) {
      setBrowserLibraryMessage(`Nothing was changed: ${reason instanceof Error ? reason.message : String(reason)}`);
      setBrowserLibraryOpen(true);
    } finally {
      setBrowserLibraryBusy(false);
    }
  }

  function handleBrowserFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    void importBrowserSelection(files);
  }

  function handleLibraryDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    markdownDragDepthRef.current += 1;
    setMarkdownDragActive(true);
  }

  function handleLibraryDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleLibraryDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!markdownDragDepthRef.current) return;
    event.preventDefault();
    markdownDragDepthRef.current = Math.max(0, markdownDragDepthRef.current - 1);
    if (!markdownDragDepthRef.current) setMarkdownDragActive(false);
  }

  function handleLibraryDrop(event: ReactDragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    markdownDragDepthRef.current = 0;
    setMarkdownDragActive(false);
    void importBrowserSelection([...event.dataTransfer.files]);
  }

  function setNavigationGuideExpanded(expanded: boolean) {
    setControlsExpanded(expanded);
    if (!expanded) localStorage.setItem(`${edition.storageNamespace}:controls-guide-seen`, "true");
  }

  async function removeBrowserBookFromLibrary(bookId: string) {
    setBrowserLibraryBusy(true);
    try {
      await removeBrowserBook(bookId);
      await refreshBrowserLibrary("Book removed from this browser.");
    } catch (reason) {
      setBrowserLibraryMessage(`Could not remove the book: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBrowserLibraryBusy(false);
    }
  }

  async function removeAllBrowserBooks() {
    setBrowserLibraryBusy(true);
    try {
      await clearBrowserBooks();
      await refreshBrowserLibrary("All browser books were removed.");
    } catch (reason) {
      setBrowserLibraryMessage(`Could not clear browser books: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBrowserLibraryBusy(false);
    }
  }

  function setStarterBooksRemoved(removed: boolean) {
    localStorage.setItem(STARTER_BOOKS_HIDDEN_KEY, String(removed));
    setStarterBooksHidden(removed);
    setBrowserLibraryMessage(removed
      ? `Starter ${starterBookNoun} ${starterBookCount === 1 ? "was" : "were"} removed from this browser. Add your own Markdown books whenever you are ready.`
      : `Starter ${starterBookNoun} ${starterBookCount === 1 ? "was" : "were"} restored to the ${starterBookCount === 1 ? "shelf" : "shelves"}.`);
  }

  function applyShelfOrganization(next: ShelfOrganization) {
    const hasPreferences = Object.keys(next.shelfLabels).length > 0 || Object.keys(next.bookShelfIds).length > 0;
    if (hasPreferences) localStorage.setItem(SHELF_ORGANIZATION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SHELF_ORGANIZATION_KEY);
    setShelfOrganization(next);
    const baseManifest = manifestCacheRef.current.get(scopeId);
    if (baseManifest) {
      setManifest(mergeBrowserBooks(baseManifest, browserBooks, {
        hideBundledBooks: starterBooksHidden,
        organization: next
      }));
    }
  }

  function saveShelfTitle(shelfId: string, title: string) {
    const label = sanitizeShelfTitle(title);
    if (!label) return;
    applyShelfOrganization({
      ...shelfOrganization,
      shelfLabels: { ...shelfOrganization.shelfLabels, [shelfId]: label }
    });
  }

  function resetShelfTitle(shelfId: string) {
    const shelfLabels = { ...shelfOrganization.shelfLabels };
    delete shelfLabels[shelfId];
    applyShelfOrganization({ ...shelfOrganization, shelfLabels });
  }

  function moveBookToShelf(bookId: string, shelfId: string) {
    applyShelfOrganization({
      ...shelfOrganization,
      bookShelfIds: { ...shelfOrganization.bookShelfIds, [bookId]: shelfId }
    });
  }

  function resetBookPlacement(bookId: string) {
    const bookShelfIds = { ...shelfOrganization.bookShelfIds };
    delete bookShelfIds[bookId];
    applyShelfOrganization({ ...shelfOrganization, bookShelfIds });
  }

  function openShelfOrganizer(bookId?: string) {
    releaseCursor();
    setBrowserLibraryOpen(false);
    setCollectionOpen(false);
    setSearchOpen(false);
    setAtlasOpen(false);
    setDisplaySettingsOpen(false);
    setOrganizerBookId(bookId);
    setShelfOrganizerOpen(true);
  }

  function selectBook(book: Book, nextTab: InspectorTab = "overview") {
    releaseCursor();
    setSelectedId(book.id);
    setFocusId(book.id);
    setSceneMode("focus");
    setTab(nextTab);
    if (selectedMatch?.book.id !== book.id) setSelectedMatch(undefined);
  }

  function openCollections() {
    releaseCursor();
    setSearchOpen(false);
    setAtlasOpen(false);
    const nextFacet = activeFacet || browseFacets[0];
    if (nextFacet) {
      setActiveFacetId(nextFacet.id);
      const selectedValue = selectedBook ? bookFacetValues(selectedBook, nextFacet.id)[0] : undefined;
      if (selectedValue) setActiveFacetValue(selectedValue);
      else if (!activeFacetValue) setActiveFacetValue(facetGroups(manifest?.books || [], nextFacet.id)[0]?.label);
    }
    setCollectionOpen(true);
  }

  function openPassage(match: SearchMatch) {
    setSelectedMatch(match);
    setSearchOpen(false);
    void openReader(match.book, match, query);
  }

  function openReader(book: Book, match?: SearchMatch, find = "") {
    releaseCursor();
    setSelectedId(book.id);
    setSceneMode("reader");
    readerRequestRef.current?.abort();
    const controller = new AbortController();
    readerRequestRef.current = controller;
    const id = ++readerRequestIdRef.current;
    const detail = bookDetails[book.id]
      ? Promise.resolve(bookDetails[book.id])
      : loadBookDetail(book, manifest!.version, controller.signal).then((nextDetail) => {
        if (!controller.signal.aborted) setBookDetails((current) => current[book.id] ? current : { ...current, [book.id]: nextDetail });
        return nextDetail;
      });
    const content = loadBookContent(book, controller.signal);
    void detail.catch(() => undefined);
    void content.catch(() => undefined);
    void loadReader();
    setReader({ request: { id, book, detail, content, signal: controller.signal }, match, find });
    markPerformance(`library:reader-request:${id}`);
  }

  function retryReader() {
    if (!reader) return;
    openReader(reader.request.book, reader.match, reader.find);
  }

  function closeReader() {
    readerRequestRef.current?.abort();
    setReader(undefined);
    setSceneMode("browse");
  }

  function closeBookDetails() {
    releaseCursor();
    setSelectedId(undefined);
    setFocusId(undefined);
    setSelectedMatch(undefined);
    setSceneMode("browse");
  }

  function centerRoom() {
    closeBookDetails();
    window.dispatchEvent(new Event("library:center-room"));
  }

  function showReaderBookOnShelf(book: ResolvedBook) {
    readerRequestRef.current?.abort();
    setReader(undefined);
    selectBook(book);
  }

  function chooseWorld(nextWorld: WorldId) {
    if (nextWorld === worldId) {
      setAtlasOpen(false);
      return;
    }
    releaseCursor();
    if (sceneEnabled) beginSceneLoad();
    else setScenePhase("preview");
    setWorldId(nextWorld);
    if (selectedId) {
      setFocusId(selectedId);
      setSceneMode("focus");
    } else setSceneMode("browse");
    localStorage.setItem(`${edition.storageNamespace}:world`, nextWorld);
    setAtlasOpen(false);
  }

  function beginSceneLoad() {
    beginRoomPerformance();
    roomLoadStartedAtRef.current = performance.now();
    setSceneError(undefined);
    setSceneProgress(EMPTY_SCENE_PROGRESS);
    setScenePhase("loading-code");
    setSceneEnabled(true);
    setSceneRequested(true);
    localStorage.setItem(`${edition.storageNamespace}:scene-mode`, "3d");
  }

  function handleSceneArchitectureReady() {
    setScenePhase("finishing");
    markPerformance(PERFORMANCE_MARKS.sceneArchitectureReady);
    measurePerformance("library:shell-to-scene-architecture", PERFORMANCE_MARKS.shellReady, PERFORMANCE_MARKS.sceneArchitectureReady);
  }

  function handleSceneProgress(progress: SceneLoadProgress) {
    setSceneProgress(progress);
    setScenePhase((current) => {
      if (["preview", "ready", "error"].includes(current)) return current;
      if (progress.stage === "code") return "loading-code";
      if (progress.stage === "architecture") return "loading-model";
      return "finishing";
    });
  }

  function handleSceneReady() {
    finishRoomPerformance(world.id);
    const duration = Math.round(performance.now() - roomLoadStartedAtRef.current);
    document.documentElement.dataset.roomLoadMs = String(duration);
    document.documentElement.dataset.roomReadyWorld = world.id;
    document.documentElement.dataset.roomLoadBudgetMs = String(COMPLETE_ROOM_LOAD_BUDGET_MS);
    document.documentElement.dataset.roomLoadExceededThreshold = String(duration > COMPLETE_ROOM_LOAD_BUDGET_MS);
    markPerformance(PERFORMANCE_MARKS.sceneReady);
    measurePerformance("library:shell-to-scene-ready", PERFORMANCE_MARKS.shellReady, PERFORMANCE_MARKS.sceneReady);
    // Navigation opens on the first complete frame, without an extra reveal delay.
    setScenePhase("ready");
  }

  function keepPreview() {
    setSceneEnabled(false);
    setSceneRequested(false);
    setScenePhase("preview");
    localStorage.setItem(`${edition.storageNamespace}:scene-mode`, "preview");
  }

  function clearSearch() {
    setQuery("");
    setPassageResults([]);
    setSearchError(undefined);
    setSelectedMatch(undefined);
    searchInputRef.current?.focus();
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearchOpen(true);
    if (visibleResults[0] && !searching) selectBook(visibleResults[0].book, "overview");
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      searchPaletteRef.current?.querySelector<HTMLButtonElement>("button[data-search-result]")?.focus();
    }
  }

  if (!manifest) {
    return (
      <CatalogBootExperience
        world={world}
        scopeLabel={edition.scopes.find((scope) => scope.id === scopeId)?.label || edition.brand.catalogueLabel}
        error={error}
        onRetry={() => setCatalogRetry((value) => value + 1)}
        onUseCurated={scopeId === edition.defaultScopeId ? undefined : () => setScopeId(edition.defaultScopeId)}
      />
    );
  }

  const emptyLibraryOpen = !manifest.books.length && !browserLibraryOpen && !shelfOrganizerOpen && !emptyLibraryDismissed && !markdownDragActive;
  const volumeLabel = manifest.sourceFileCount === 1 ? singularizeLabel(edition.brand.volumeLabel) : edition.brand.volumeLabel;
  const sceneInteractionEnabled = scenePhase === "ready"
    && !reader
    && !roomNotesOpen
    && !selectedBook
    && !focusId
    && !atlasOpen
    && !displaySettingsOpen
    && !browserLibraryOpen
    && !shelfOrganizerOpen
    && !collectionOpen
    && !searchOpen
    && !emptyLibraryOpen
    && !markdownDragActive;

  return (
    <main
      className={`app-shell mode-${sceneMode} world-${world.id} ${PREVIEW_MODE ? "preview-mode" : ""}`}
      style={{
        ...worldCssVariables(world),
        "--scene-preview-brightness": sceneBrightness * 0.0058
      } as CSSProperties}
      data-theme={world.id}
      data-world={world.id}
      data-room-phase={scenePhase}
      data-scene-interactive={sceneInteractionEnabled}
      aria-busy={sceneEnabled && sceneRequested && scenePhase !== "ready" && scenePhase !== "error"}
      onDragEnter={handleLibraryDragEnter}
      onDragOver={handleLibraryDragOver}
      onDragLeave={handleLibraryDragLeave}
      onDrop={handleLibraryDrop}
    >
      {error && <div className="catalog-error" role="status"><span>{error}</span><button type="button" onClick={() => setCatalogRetry((value) => value + 1)}>Retry</button></div>}
      <div className="scene-preview" style={{ backgroundImage: `url(${world.preview})` }} aria-hidden="true" />
      {sceneRequested && sceneEnabled && (
        <AsyncBoundary
          resetKey={`${world.id}:${sceneRetry}`}
          fallback={(nextError) => <SceneFailureReporter error={nextError} onReport={(message) => (setSceneError(message), setScenePhase("error"))} />}
        >
          <Suspense fallback={null}>
            <LibraryScene
              key={sceneRetry}
              manifest={manifest}
              world={world}
              selectedBookId={selectedId}
              focusBookId={focusId}
              sceneMode={sceneMode}
              qualityPreference={qualityPreference}
              exposureScale={sceneBrightness / 100}
              highlights={highlights}
              paused={Boolean(reader) || atlasOpen || roomNotesOpen}
              motionPaused={motionPaused}
              interactionEnabled={sceneInteractionEnabled}
              onSelectBook={selectBook}
              onHoverBook={setHoveredBook}
              onModeChange={setSceneMode}
              onCanvasReady={() => setScenePhase("loading-model")}
              onArchitectureReady={handleSceneArchitectureReady}
              onProgress={handleSceneProgress}
              onReady={handleSceneReady}
              onFocusComplete={() => {
                setFocusId(undefined);
                setSceneMode("browse");
              }}
            />
          </Suspense>
        </AsyncBoundary>
      )}

      {!PREVIEW_MODE && (scenePhase === "preview" || scenePhase === "error") && (
        <SceneLoadStatus phase={scenePhase} world={world} error={sceneError} onRetry={() => (setSceneError(undefined), setSceneRetry((value) => value + 1), beginSceneLoad())} onKeepPreview={keepPreview} onEnable={beginSceneLoad} />
      )}

      {!PREVIEW_MODE && sceneEnabled && sceneRequested && !["preview", "ready", "error"].includes(scenePhase) && (
        <WorldRevealGate key={`${world.id}:${sceneRetry}`} phase={scenePhase} progress={sceneProgress} world={world} />
      )}
      <div className="walk-reticle" aria-hidden="true" />
      {!PREVIEW_MODE && sceneInteractionEnabled && <MobileJoystick />}
      {!PREVIEW_MODE && sceneInteractionEnabled && !quietMode && (
        <NavigationGuide mode={sceneMode} expanded={controlsExpanded} onExpandedChange={setNavigationGuideExpanded} />
      )}

      {quietMode && <button className="quiet-return" type="button" onClick={() => setQuietMode(false)}>Show library controls <span>Esc</span></button>}
      {!PREVIEW_MODE && sceneInteractionEnabled && !quietMode && !bookCueDismissed && manifest.books.length === 1 && (
        <section className="first-book-card" aria-label="Your book">
          <button className="icon-button compact" type="button" title="Dismiss book introduction" onClick={() => setBookCueDismissed(true)}><X size={15} /></button>
          <span>On your shelf</span>
          <strong>{manifest.books[0].title}</strong>
          <div>
            <button type="button" data-reader-return onClick={() => void openReader(manifest.books[0])}><BookOpen size={15} />Read</button>
            <button type="button" onClick={() => selectBook(manifest.books[0])}><MapPin size={15} />Find on shelf</button>
            <button type="button" title="Add your own books" onClick={() => setBrowserLibraryOpen(true)}><Upload size={15} /></button>
          </div>
        </section>
      )}
      <header className="topbar" hidden={quietMode}>
        <button className="brand" type="button" onClick={centerRoom}>
          <Library size={22} />
          <span>
            <strong>{edition.brand.name}</strong>
            <small>{manifest.sourceFileCount} {volumeLabel}</small>
          </span>
        </button>

        <button className="rooms-button" type="button" title="Open World Atlas"
          aria-label={`Rooms: ${world.label}. Choose from ${WORLDS.length} rooms`}
          aria-haspopup="dialog" aria-expanded={atlasOpen} aria-controls="world-atlas"
          onClick={() => { releaseCursor(); setDisplaySettingsOpen(false); setCollectionOpen(false); setSearchOpen(false); setBrowserLibraryOpen(false); setAtlasOpen(true); }}>
          <Landmark size={21} /><span><strong>Rooms <small>{WORLDS.length}</small></strong><span>{world.label}</span></span><ChevronDown size={17} />
        </button>

        <button
          className={collectionOpen ? "browse-button active" : "browse-button"}
          type="button"
          title="Browse books"
          aria-label="Browse books"
          aria-expanded={collectionOpen}
          onClick={() => collectionOpen ? setCollectionOpen(false) : openCollections()}
        >
          <BookCopy size={18} />
          <span className="browse-desktop-label">Browse books</span><span className="browse-mobile-label">Books</span>
          <small>{manifest.sourceFileCount}</small>
        </button>

        <form className="searchbar" onSubmit={submitSearch}>
          <Search size={18} />
          <input
            ref={searchInputRef}
            value={query}
            onFocus={() => {
              releaseCursor();
              setSearchOpen(true);
            }}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              setSearching(nextQuery.trim().length >= 2);
              setPassageResults([]);
              setSearchOpen(true);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search titles, chapters, or passages"
            aria-label="Search the library"
          />
          {query && (
            <button className="search-clear" type="button" title="Clear search" onClick={clearSearch}>
              <X size={16} />
            </button>
          )}
          <button className="search-submit" type="submit" disabled={!query.trim()} title="Search library">
            {showSearchBusy ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            <span>Search</span>
          </button>
        </form>

        <button className={displaySettingsOpen ? "controls-button active" : "controls-button"}
          type="button" title="Display settings" aria-label="Controls" aria-expanded={displaySettingsOpen}
          aria-haspopup="dialog" aria-controls="display-settings"
          onClick={() => { releaseCursor(); setAtlasOpen(false); setCollectionOpen(false); setSearchOpen(false); setBrowserLibraryOpen(false); setDisplaySettingsOpen((open) => !open); }}>
          <SlidersHorizontal size={18} /><span>Controls</span>
        </button>
      </header>

      {displaySettingsOpen && (
        <>
          <button className="display-settings-scrim" type="button" data-dialog-backdrop aria-hidden="true" tabIndex={-1} onClick={() => setDisplaySettingsOpen(false)} />
          <section ref={displaySettingsRef} id="display-settings" className="display-settings" role="dialog" aria-modal="true" aria-labelledby="display-settings-title" tabIndex={-1}>
            <header>
              <div>
                <span>Make yourself at home</span>
                <strong id="display-settings-title">Library controls</strong>
              </div>
              <button className="icon-button compact" type="button" title="Close display settings" onClick={() => setDisplaySettingsOpen(false)}><X size={17} /></button>
            </header>
            <section className="control-group display-preferences" aria-labelledby="explore-controls-title">
              <h2 id="explore-controls-title">Explore</h2>
              <button type="button" disabled={sceneEnabled && sceneRequested && scenePhase !== "ready"} onClick={() => { setDisplaySettingsOpen(false); centerRoom(); }}><Compass size={17} />Return to the entrance</button>
              <button
                className="immersive-action"
                type="button"
                title={sceneMode === "immersive" ? "Leave immersive navigation" : "Enter immersive navigation"}
                disabled={sceneEnabled && sceneRequested && scenePhase !== "ready"}
                onClick={() => {
                  // Keep pointer-lock entry in the original user gesture.
                  setDisplaySettingsOpen(false);
                  closeBookDetails();
                  if (sceneMode === "immersive") {
                    releaseCursor();
                    setSceneMode("browse");
                  } else if (!sceneRequested || !sceneEnabled) {
                    beginSceneLoad();
                  } else {
                    window.dispatchEvent(new Event("library:enter-immersive"));
                  }
                }}
              >
                <Target size={19} />{sceneMode === "immersive" ? "Leave immersive navigation" : "Explore with mouse & keyboard"}
              </button>
              <button type="button" onClick={() => (setRoomNotesOpen(true), setDisplaySettingsOpen(false))}><Landmark size={17} />About this room</button>
            </section>
            <h2 className="control-group-title">Display &amp; sound</h2>
            <div className="display-preferences">
              <button type="button" aria-pressed={ambienceEnabled} onClick={() => setAmbienceEnabled((enabled) => !enabled)}>{ambienceEnabled ? <VolumeX size={16} /> : <Volume2 size={16} />}{ambienceEnabled ? "Mute ambience" : "Play ambience"}</button>
            </div>
            <details className="control-disclosure">
              <summary>Brightness, quality &amp; motion <ChevronDown size={16} /></summary>
              <div className="advanced-display">
                <label htmlFor="scene-brightness">
                  <span>Darker</span>
                  <output htmlFor="scene-brightness">{sceneBrightness}%</output>
                  <span>Brighter</span>
                </label>
                <input
                  id="scene-brightness"
                  type="range"
                  min={MIN_SCENE_BRIGHTNESS}
                  max={MAX_SCENE_BRIGHTNESS}
                  step="5"
                  value={sceneBrightness}
                  aria-valuetext={`${sceneBrightness}% brightness`}
                  onChange={(event) => setSceneBrightness(Number(event.target.value))}
                />
                <footer>
                  <small>Adjusts the reading room while keeping menus clear.</small>
                  <button type="button" disabled={sceneBrightness === DEFAULT_SCENE_BRIGHTNESS} onClick={() => setSceneBrightness(DEFAULT_SCENE_BRIGHTNESS)}>Reset</button>
                </footer>
                <div className="display-preferences">
                  <label htmlFor="scene-quality">Visual quality</label>
                  <select id="scene-quality" value={qualityPreference} onChange={(event) => setQualityPreference(event.target.value as QualityPreference)}>
                    <option value="auto">Auto — adapt to this device</option>
                    <option value="lite">Lite — conserve power</option>
                    <option value="balanced">Balanced</option>
                    <option value="cinematic">Cinematic — more detail</option>
                  </select>
                  <small>{qualityPreference === "cinematic" ? "Additional detail downloads after the room opens. Uses more power and data." : "Every quality includes the complete room and your books."}</small>
                  <label htmlFor="ambience-volume">Ambience volume <output>{ambienceVolume}%</output></label>
                  <input id="ambience-volume" type="range" min="0" max="100" step="5" value={ambienceVolume} onChange={(event) => setAmbienceVolumePreference(Number(event.target.value))} />
                  <small>Sound pauses while reading and when this tab is hidden.</small>
                  <button type="button" aria-pressed={motionPaused} onClick={() => setMotionPaused((paused) => !paused)}>{motionPaused ? "Resume room motion" : "Pause room motion"}</button>
                  <button type="button" onClick={() => {
                    setSelectedId(undefined);
                    setFocusId(undefined);
                    setSceneMode("browse");
                    setQuietMode(true);
                    setDisplaySettingsOpen(false);
                  }}>Explore with fewer controls</button>
                </div>
              </div>
            </details>
            <section className="control-group display-preferences" aria-labelledby="book-controls-title">
              <h2 id="book-controls-title">Your books</h2>
              <button type="button" onClick={() => { setDisplaySettingsOpen(false); setBrowserLibraryOpen(true); }}><Database size={17} />Add &amp; manage books</button>
              <small>Import Markdown files and manage books saved in this browser.</small>
            </section>
          </section>
        </>
      )}

      {roomNotesOpen && <RoomNotes world={world} motionPaused={motionPaused} onMotionChange={setMotionPaused} onClose={() => setRoomNotesOpen(false)} />}

      <input ref={browserFileInputRef} className="browser-file-input" tabIndex={-1} aria-hidden="true" type="file" accept=".md,text/markdown,text/plain" multiple onChange={handleBrowserFiles} />

      {markdownDragActive && (
        <section className="library-drop-zone" aria-label="Drop Markdown books">
          <Upload size={34} />
          <span>Add to this browser</span>
          <strong>Drop Markdown files to shelve them</strong>
          <small>Your files stay in this browser and are not uploaded.</small>
        </section>
      )}

      {emptyLibraryOpen && (
        <section className="empty-library-panel" aria-label="Empty library">
          <Library size={30} />
          <span>Your shelves are ready</span>
          <h1>Add Markdown books to begin</h1>
          <p>Choose or drop <code>.md</code> files for this browser, or add files under <code>books/</code> and rebuild a shared collection.</p>
          <div className="empty-library-actions">
            <button type="button" onClick={() => browserFileInputRef.current?.click()}><Upload size={17} /> Add books</button>
            <a className="pdf-convert-link" href={PDF_TO_MARKDOWN_URL} target="_blank" rel="noopener noreferrer" aria-label="Open the free PDF-to-Markdown converter in a new tab"><FileText size={17} /> Convert a PDF <ExternalLink size={14} /></a>
            <button className="secondary" type="button" onClick={() => setEmptyLibraryDismissed(true)}><Compass size={17} /> Explore empty room</button>
          </div>
          <small className="pdf-convert-note">The free converter works in your browser. Download the <code>.md</code> file, then add it here.</small>
        </section>
      )}

      {browserLibraryOpen && (
        <>
          <button className="browser-library-scrim" type="button" data-dialog-backdrop aria-hidden="true" tabIndex={-1} onClick={() => setBrowserLibraryOpen(false)} />
          <section ref={browserLibraryRef} className="browser-library-panel" role="dialog" aria-modal="true" aria-label="Browser books" tabIndex={-1}>
            <header>
              <div><span>Private to this browser</span><strong>Manage books</strong></div>
              <button className="icon-button compact" type="button" title="Close" onClick={() => setBrowserLibraryOpen(false)}><X size={18} /></button>
            </header>
            <p>These Markdown files stay in this browser's IndexedDB. They are not uploaded or added to the shared build.</p>
            {!!starterBookCount && (
              <section className="starter-books-control" aria-label={`Bundled starter ${starterBookNoun}`}>
                <div>
                  <strong>Bundled starter {starterBookNoun}</strong>
                  <span>{starterBooksHidden ? "Removed from this browser" : `${starterBookCount} on the ${starterBookCount === 1 ? "shelf" : "shelves"}`}</span>
                </div>
                <p>Remove {starterBookCount === 1 ? "this example" : "the examples"} to begin with an empty room. This affects only this browser and can be undone.</p>
                <button
                  className={starterBooksHidden ? "starter-restore-action" : "starter-remove-action"}
                  type="button"
                  disabled={browserLibraryBusy}
                  onClick={() => setStarterBooksRemoved(!starterBooksHidden)}
                >
                  {starterBooksHidden ? <><BookCopy size={17} /> Restore starter {starterBookNoun}</> : <><Trash2 size={17} /> Remove starter {starterBookNoun}</>}
                </button>
              </section>
            )}
            <button className="browser-organize-action" type="button" onClick={() => openShelfOrganizer()}>
              <Layers size={18} /> Organize shelves
            </button>
            <button className="browser-import-action" type="button" disabled={browserLibraryBusy} onClick={() => browserFileInputRef.current?.click()}>
              {browserLibraryBusy ? <Loader2 className="spin" size={18} /> : <Upload size={18} />} Add Markdown files
            </button>
            <a className="pdf-convert-link" href={PDF_TO_MARKDOWN_URL} target="_blank" rel="noopener noreferrer" aria-label="Open the free PDF-to-Markdown converter in a new tab"><FileText size={18} /> Convert a PDF first <ExternalLink size={14} /></a>
            <small className="pdf-convert-note">Free and no account required. Download the converted <code>.md</code> file, then add it above.</small>
            {browserLibraryMessage && <div className="browser-library-message" role="status">{browserLibraryMessage}</div>}
            <div className="browser-book-list">
              {!browserBooks.length && <p className="empty-copy">No browser books yet.</p>}
              {browserBooks.map((record) => (
                <article key={record.id}>
                  <div className="browser-book-copy"><strong>{record.book.title}</strong><span>{record.book.author} · {record.fileName}</span></div>
                  <div className="browser-book-actions">
                    <button
                      type="button"
                      title={`Show ${record.book.title} on its shelf`}
                      aria-label={`Show ${record.book.title} on its shelf`}
                      disabled={browserLibraryBusy}
                      onClick={() => {
                        setBrowserLibraryOpen(false);
                        selectBook(record.book);
                      }}
                    >
                      <MapPin size={16} />
                    </button>
                    <button type="button" title={`Remove ${record.book.title}`} aria-label={`Remove ${record.book.title}`} disabled={browserLibraryBusy} onClick={() => void removeBrowserBookFromLibrary(record.id)}><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
            </div>
            {!!browserBooks.length && <button className="browser-clear-action" type="button" disabled={browserLibraryBusy} onClick={() => void removeAllBrowserBooks()}><Trash2 size={16} /> Remove all browser books</button>}
            <small>Clearing this site's browser data also removes these books.</small>
          </section>
        </>
      )}

      {shelfOrganizerOpen && (
        <ShelfOrganizer
          manifest={manifest}
          organization={shelfOrganization}
          initialBookId={organizerBookId}
          onClose={() => setShelfOrganizerOpen(false)}
          onSaveShelfTitle={saveShelfTitle}
          onResetShelfTitle={resetShelfTitle}
          onMoveBook={moveBookToShelf}
          onResetBookPlacement={resetBookPlacement}
        />
      )}

      {collectionOpen && (
        <>
          <button className="collection-scrim" type="button" aria-label="Close book browser" onClick={() => setCollectionOpen(false)} />
          <section className="collection-nav open" aria-label="Browse library books">
            <header>
              <div>
                <span>{edition.brand.catalogueLabel}</span>
                <strong>{manifest.sourceFileCount} {volumeLabel}</strong>
              </div>
              <button className="icon-button compact" type="button" title="Close book browser" onClick={() => setCollectionOpen(false)}>
                <PanelLeftClose size={18} />
              </button>
            </header>
            {edition.scopes.length > 1 && (
              <div className="scope-switcher" role="group" aria-label="Catalogue scope">
                {edition.scopes.map((scope) => (
                  <button
                    key={scope.id}
                    type="button"
                    className={`${manifest.scopeId === scope.id ? "active" : ""} ${catalogLoading && scopeId === scope.id ? "loading" : ""}`}
                    aria-pressed={manifest.scopeId === scope.id}
                    onClick={() => setScopeId(scope.id)}
                  >
                    <strong>{scope.label}</strong>
                    <span>{scope.description}</span>
                  </button>
                ))}
              </div>
            )}
            {!!browseFacets.length && (
              <div className="collection-facet-tabs" role="tablist" aria-label="Browse by">
                {browseFacets.map((facet) => (
                  <button
                    key={facet.id}
                    type="button"
                    role="tab"
                    aria-selected={activeFacet?.id === facet.id}
                    className={activeFacet?.id === facet.id ? "active" : ""}
                    onClick={() => {
                      setActiveFacetId(facet.id);
                      setActiveFacetValue(facetGroups(manifest.books, facet.id)[0]?.label);
                    }}
                  >
                    {facet.label}
                  </button>
                ))}
              </div>
            )}
            <div className="collection-browser">
              <nav className="collection-groups" aria-label={activeFacet?.label || "Collections"}>
                {activeGroups.map((group) => (
                  <button
                    key={group.label}
                    type="button"
                    className={activeCollection?.label === group.label ? "active" : ""}
                    aria-pressed={activeCollection?.label === group.label}
                    onClick={() => setActiveFacetValue(group.label)}
                  >
                    <span style={{ background: activeFacet?.color }} />
                    <strong>{group.label}</strong>
                    <small>{group.books.length}</small>
                  </button>
                ))}
              </nav>
              <section className="collection-books" aria-label={`${activeCollection?.label || "Collection"} books`}>
                <header>
                  <span style={{ background: activeFacet?.color }} />
                  <div>
                    <strong>{activeCollection?.label || "No books"}</strong>
                    <small>{collectionBooks.length} volume{collectionBooks.length === 1 ? "" : "s"}</small>
                  </div>
                </header>
                <div className="collection-book-list">
                  {collectionBooks.map((book) => (
                    <button
                      key={book.id}
                      type="button"
                      className={book.id === selectedId ? "active" : ""}
                      onClick={() => {
                        selectBook(book);
                        setCollectionOpen(false);
                      }}
                    >
                      <span>
                        <strong>{book.title}</strong>
                        <small>{book.author} / {book.year || "Undated"} / {formatReadingScale(book.wordCount)}</small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </>
      )}

      {atlasOpen && (
        <section ref={atlasRef} id="world-atlas" className="world-atlas" role="dialog" aria-modal="true" aria-labelledby="world-atlas-title" tabIndex={-1}>
          <header>
            <div>
              <span>World Atlas / {WORLDS.length} destinations</span>
              <h1 id="world-atlas-title">Choose your reading room</h1>
              <p>One collection. Nine unmistakably different rooms.</p>
            </div>
            <div className="atlas-actions">
              <button className="icon-button" type="button" title="Close World Atlas" onClick={() => setAtlasOpen(false)}><X size={20} /></button>
            </div>
          </header>
          <div className="world-grid">
            {WORLDS.map((option, index) => {
              const isCurrentWorld = option.id === world.id;
              return (
                <button key={option.id} className={`world-card ${isCurrentWorld ? "active" : ""}`} type="button" aria-current={isCurrentWorld ? "true" : undefined} onPointerEnter={() => prefetchWorld(option)} onFocus={() => prefetchWorld(option)} onClick={() => chooseWorld(option.id)}>
                  <span className={`world-card-visual preview-${option.id}`} aria-hidden="true">
                    <img src={option.preview} alt="" loading="lazy" decoding="async" />
                    <span className="preview-architecture" />
                    <span className="preview-light" />
                    <span className="world-card-visual-shade" />
                    <span className="world-number">0{index + 1}</span>
                    <span className="world-view-label"><Target size={11} /> Actual room view</span>
                  </span>
                  <span className="world-card-copy">
                    <span className="world-card-eyebrow">
                      <small>{option.era}</small>
                      {isCurrentWorld && <span className="current-room-label">Current</span>}
                    </span>
                    <strong>{option.label}</strong>
                    <span className="world-card-description">{option.description}</span>
                    <span className="world-card-footer">
                      <em><MapPin size={12} />{option.landmark}</em>
                      <span className="world-swatches" aria-hidden="true">
                        {option.swatches.map((swatch) => <i key={swatch} style={{ backgroundColor: swatch }} />)}
                      </span>
                    </span>
                    <span className="world-card-enter">
                      <span>{isCurrentWorld ? "Return to room" : "Enter library"}</span>
                      <ArrowRight size={14} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {searchOpen && (
        <section className="search-palette" ref={searchPaletteRef} aria-label="Library search results">
          <header>
            <div>
              <strong>{query.trim() ? "Search results" : "Explore the collection"}</strong>
              <span>{showSearchBusy ? "Finding passages…" : searching && !visibleResults.length ? "Checking catalogue…" : searchStatus(visibleResults, query)}</span>
            </div>
            <button className="icon-button compact" type="button" title="Close search" onClick={() => setSearchOpen(false)}>
              <X size={17} />
            </button>
          </header>
          {searchError && <p className="error-copy">{searchError}</p>}
          {!searchCapabilities.passages && query.trim() && <p className="search-degraded">Showing catalogue matches; passage search is temporarily unavailable.</p>}
          {!query.trim() && (
            <div className="suggestion-row">
              {edition.suggestedQueries.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setQuery(suggestion)}>
                  <Search size={13} />
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          )}
          {query.trim() && !searching && !visibleResults.length && !searchError && (
            <p className="empty-copy">No matching title or passage. Try a shorter phrase or a distinctive term.</p>
          )}
          {!!visibleResults.length && (
            <div className="search-result-list">
              {visibleResults.slice(0, 8).map((group) => (
                <article key={group.book.id} data-book-id={group.book.id} className={group.book.id === selectedId ? "active" : ""}>
                  <button data-search-result type="button" className="search-book-result" onClick={() => (selectBook(group.book), setSearchOpen(false))}>
                    <span>
                      <strong>{group.book.title}</strong>
                      <small>{group.book.author} / {group.book.year || "Undated"} / {bookContextLabel(group.book)}</small>
                    </span>
                    <span className="match-count">{group.matchCount}</span>
                  </button>
                  <div className="search-passages">
                    {group.matches.slice(0, 3).map((match) => (
                      <button key={match.id} data-match-id={match.id} type="button" onClick={() => openPassage(match)}>
                        <span>{match.locationLabel}</span>
                        <HighlightedParts parts={match.parts} />
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {hoveredBook && !reader && (
        <div className="hover-label">
          <strong>{hoveredBook.title}</strong>
          <span>{hoveredBook.author} / {hoveredBook.year || "Undated"}</span>
        </div>
      )}

      {selectedBook && !reader && (
        <aside className="inspector">
          <header className="inspector-header">
            <div>
              <p>{selectedBook.author}</p>
              <h1>{selectedBook.title}</h1>
              <div className="book-meta">
                <span>{selectedBook.year || "Undated"}</span>
                <span>{formatCount(selectedBook.wordCount)} words</span>
                <span>{bookContextLabel(selectedBook)}</span>
              </div>
            </div>
            <button className="icon-button compact" type="button" title="Close book details" onClick={closeBookDetails}>
              <X size={18} />
            </button>
          </header>

          <div className="inspector-actions">
            <button className="primary" data-reader-return type="button" onClick={() => void openReader(selectedBook, selectedMatch, selectedMatch ? query : "")}>
              <BookOpen size={18} />
              <span>{selectedMatch ? "Read passage" : "Read"}</span>
            </button>
            <button type="button" onClick={() => (releaseCursor(), setFocusId(selectedBook.id), setSceneMode("focus"))}>
              <MapPin size={17} />
              <span>Show on shelf</span>
            </button>
            <button type="button" onClick={() => openShelfOrganizer(selectedBook.id)}>
              <ArrowRightLeft size={17} />
              <span>Move book</span>
            </button>
          </div>

          <div className="inspector-tabs" role="tablist">
            {(["overview", "toc", "source"] as InspectorTab[]).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
                {item === "toc" ? "Contents" : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="inspector-content">
              {selectedMatch && (
                <section className="selected-passage">
                  <span>{selectedMatch.locationLabel}</span>
                  <HighlightedParts parts={selectedMatch.parts} />
                  <button type="button" onClick={() => openPassage(selectedMatch)}>
                    <BookOpen size={14} /> Open matched passage
                  </button>
                </section>
              )}
              <section className="summary-section">
                <span>About this volume</span>
                <p>{selectedBook.summary || (detailLoadingId === selectedBook.id ? "Loading catalogue details..." : selectedBook.excerpt)}</p>
              </section>
              {detailError && <p className="error-copy">{detailError}</p>}
              <dl className="book-facts">
                <div><Clock size={15} /><dt>Reading time</dt><dd>{formatReadingScale(selectedBook.wordCount)}</dd></div>
                <div><ListTree size={15} /><dt>Structure</dt><dd>{selectedBook.sections?.length || selectedBook.headingCount} sections</dd></div>
                <div><Layers size={15} /><dt>Shelf section</dt><dd>{bookContextLabel(selectedBook)}</dd></div>
                <div><FileText size={15} /><dt>Source</dt><dd>Markdown edition</dd></div>
              </dl>
              {!!startHeadings.length && (
                <section className="inspector-list">
                  <span>Start at a section</span>
                  {startHeadings.slice(0, 5).map((heading) => (
                    <button key={`${heading.order}-${heading.id}`} type="button" onClick={() => void openReader(selectedBook, { id: `${selectedBook.id}-${heading.order}`, book: selectedBook, score: 1, snippet: "", parts: [], matchType: "heading", locationLabel: formatHeadingTitle(heading.title), position: 0, headingOrder: heading.order, sectionTitle: heading.title })}>
                      <span>{formatHeadingTitle(heading.title)}</span><ArrowRight size={14} />
                    </button>
                  ))}
                </section>
              )}
              {!!relatedBooks.length && (
                <section className="inspector-list related-list">
                  <span>Nearby on the shelf</span>
                  {relatedBooks.map((book) => (
                    <button key={book.id} type="button" onClick={() => selectBook(book)}>
                      <span><strong>{book.title}</strong><small>{book.year || "Undated"} / {bookContextLabel(book)}</small></span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}

          {tab === "toc" && (
            <div className="inspector-content toc-list">
              {(selectedBook.headings || []).slice(0, 100).map((heading) => (
                <button key={`${heading.order}-${heading.id}`} style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 10 + 10}px` }} onClick={() => void openReader(selectedBook, { id: `${selectedBook.id}-${heading.order}`, book: selectedBook, score: 1, snippet: "", parts: [], matchType: "heading", locationLabel: formatHeadingTitle(heading.title), position: 0, headingOrder: heading.order, sectionTitle: heading.title })}>
                  <span>{formatHeadingTitle(heading.title)}</span><ArrowRight size={13} />
                </button>
              ))}
            </div>
          )}

          {tab === "source" && (
            <div className="inspector-content source-grid">
              <span>File</span><code>{selectedBook.relativeSourcePath}</code>
              <span>Hash</span><code>{selectedBook.sourceHash?.slice(0, 20) || (detailLoadingId === selectedBook.id ? "Loading..." : "Unavailable")}</code>
              <span>Format</span><code>Markdown</code>
              <span>Sections</span><code>{selectedBook.sections?.length || selectedBook.headingCount}</code>
              <span>Placement</span><code>{selectedBook.placement.shelfId} / row {selectedBook.placement.row + 1}</code>
            </div>
          )}
        </aside>
      )}

      {reader && (
        <AsyncBoundary
          resetKey={reader.request.id}
          fallback={(readerError, retryChunk) => <ReaderLoadingShell book={reader.request.book} error={readerError.message} onClose={closeReader} onRetry={() => (retryChunk(), retryReader())} />}
        >
          <Suspense fallback={<ReaderLoadingShell book={reader.request.book} onClose={closeReader} />}>
            <Reader request={reader.request} targetMatch={reader.match} initialFind={reader.find} onClose={closeReader} onRetry={retryReader} onShowShelf={showReaderBookOnShelf} />
          </Suspense>
        </AsyncBoundary>
      )}
    </main>
  );
}

function ShelfOrganizer({
  manifest,
  organization,
  initialBookId,
  onClose,
  onSaveShelfTitle,
  onResetShelfTitle,
  onMoveBook,
  onResetBookPlacement
}: {
  manifest: LibraryManifest;
  organization: ShelfOrganization;
  initialBookId?: string;
  onClose: () => void;
  onSaveShelfTitle: (shelfId: string, title: string) => void;
  onResetShelfTitle: (shelfId: string) => void;
  onMoveBook: (bookId: string, shelfId: string) => void;
  onResetBookPlacement: (bookId: string) => void;
}) {
  const initialBook = manifest.books.find((book) => book.id === initialBookId);
  const [bookId, setBookId] = useState(initialBook?.id || "");
  const [shelfId, setShelfId] = useState(initialBook?.placement.shelfId || manifest.shelves[0]?.id || "");
  const activeShelf = manifest.shelves.find((shelf) => shelf.id === shelfId) || manifest.shelves[0];
  const selectedBook = manifest.books.find((book) => book.id === bookId);
  const [titleDraft, setTitleDraft] = useState(activeShelf?.label || "");
  const [notice, setNotice] = useState<string>();
  const shelfCounts = useMemo(() => {
    const counts = new Map<string, number>();
    manifest.books.forEach((book) => counts.set(book.placement.shelfId, (counts.get(book.placement.shelfId) || 0) + 1));
    return counts;
  }, [manifest.books]);

  useEffect(() => {
    setTitleDraft(activeShelf?.label || "");
  }, [activeShelf?.id, activeShelf?.label]);

  if (!activeShelf) return null;
  const shelfNumber = (activeShelf.bayIndex || 0) + 1;
  const activeCount = shelfCounts.get(activeShelf.id) || 0;
  const selectedBookIsHere = selectedBook?.placement.shelfId === activeShelf.id;
  const targetIsFull = activeCount >= (activeShelf.capacity || 70) && !selectedBookIsHere;
  const hasCustomTitle = Boolean(organization.shelfLabels[activeShelf.id]);
  const hasManualPlacement = Boolean(selectedBook && organization.bookShelfIds[selectedBook.id]);

  function chooseBook(nextBookId: string) {
    setBookId(nextBookId);
    setNotice(undefined);
    const nextBook = manifest.books.find((book) => book.id === nextBookId);
    if (nextBook) setShelfId(nextBook.placement.shelfId);
  }

  function saveTitle(event: FormEvent) {
    event.preventDefault();
    const title = sanitizeShelfTitle(titleDraft);
    if (!title) return;
    onSaveShelfTitle(activeShelf.id, title);
    setTitleDraft(title);
    setNotice(`Shelf ${shelfNumber} is now named “${title}.”`);
  }

  return (
    <div className="shelf-organizer-layer">
      <button className="shelf-organizer-scrim" type="button" aria-label="Close shelf organizer" onClick={onClose} />
      <section className="shelf-organizer" role="dialog" aria-modal="true" aria-labelledby="shelf-organizer-title">
        <header>
          <div>
            <span>Your layout</span>
            <strong id="shelf-organizer-title">Organize shelves</strong>
          </div>
          <button className="icon-button compact" type="button" title="Close shelf organizer" onClick={onClose}><X size={18} /></button>
        </header>
        <p>Rename any shelf and move a book to a specific bay. These choices stay in this browser; they do not rewrite your Markdown files.</p>
        <div className="shelf-organizer-body">
          <nav className="shelf-organizer-list" aria-label="Bookshelves">
            {manifest.shelves.map((shelf) => {
              const count = shelfCounts.get(shelf.id) || 0;
              const number = (shelf.bayIndex || 0) + 1;
              return (
                <button key={shelf.id} type="button" className={shelf.id === activeShelf.id ? "active" : ""} aria-pressed={shelf.id === activeShelf.id} onClick={() => (setShelfId(shelf.id), setNotice(undefined))}>
                  <span>Shelf {number}</span>
                  <strong>{shelf.label}</strong>
                  <small>{count} {count === 1 ? "book" : "books"}</small>
                </button>
              );
            })}
          </nav>
          <div className="shelf-organizer-editor">
            <section>
              <span>Shelf {shelfNumber}</span>
              <h2>{activeShelf.label}</h2>
              <form onSubmit={saveTitle}>
                <label htmlFor="shelf-title">Shelf title</label>
                <input
                  id="shelf-title"
                  value={titleDraft}
                  maxLength={MAX_SHELF_TITLE_LENGTH}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  placeholder={`Shelf ${shelfNumber}`}
                />
                <div>
                  <button className="primary" type="submit" disabled={!sanitizeShelfTitle(titleDraft)}><Save size={16} /> Save name</button>
                  <button type="button" disabled={!hasCustomTitle} onClick={() => (onResetShelfTitle(activeShelf.id), setNotice(`Shelf ${shelfNumber} is using its automatic title again.`))}><RotateCcw size={15} /> Use automatic name</button>
                </div>
              </form>
            </section>
            <section className="shelf-move-editor">
              <label htmlFor="organizer-book">Book to move</label>
              <select id="organizer-book" value={bookId} onChange={(event) => chooseBook(event.target.value)}>
                <option value="">Choose a book</option>
                {[...manifest.books].sort((a, b) => a.title.localeCompare(b.title)).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
              </select>
              {selectedBook ? (
                <>
                  <p><strong>{selectedBook.title}</strong> is currently on Shelf {(selectedBook.placement.bay || 0) + 1}, “{manifest.shelves[selectedBook.placement.bay]?.label || selectedBook.placement.shelfId}.”</p>
                  <div>
                    <button className="primary" type="button" disabled={selectedBookIsHere || targetIsFull} onClick={() => (onMoveBook(selectedBook.id, activeShelf.id), setNotice(`Moved “${selectedBook.title}” to Shelf ${shelfNumber}.`))}>
                      <ArrowRightLeft size={16} /> {targetIsFull ? "Shelf is full" : selectedBookIsHere ? "Already on this shelf" : `Move to Shelf ${shelfNumber}`}
                    </button>
                    <button type="button" disabled={!hasManualPlacement} onClick={() => (onResetBookPlacement(selectedBook.id), setNotice(`“${selectedBook.title}” is using automatic placement again.`))}><RotateCcw size={15} /> Use automatic placement</button>
                  </div>
                </>
              ) : (
                <p>{manifest.books.length ? "Choose a book, then choose its destination shelf on the left." : "Add a book whenever you are ready. Shelf names can still be prepared now."}</p>
              )}
            </section>
            {notice && <div className="shelf-organizer-notice" role="status">{notice}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function CatalogBootExperience({ world, scopeLabel, error, onRetry, onUseCurated }: {
  world: ReturnType<typeof getWorld>;
  scopeLabel: string;
  error?: string;
  onRetry: () => void;
  onUseCurated?: () => void;
}) {
  return (
    <main className={`catalog-boot world-${world.id}`} style={{ ...worldCssVariables(world), backgroundImage: `linear-gradient(115deg, rgba(8, 8, 9, .48), rgba(8, 8, 9, .88)), url(${world.preview})` } as CSSProperties}>
      <header><Library size={22} /><strong>{edition.brand.name}</strong></header>
      <section role={error ? "alert" : "status"} aria-live="polite">
        <Library size={34} />
        <h1>{error ? "The catalogue is unavailable" : "Opening the catalogue"}</h1>
        <p>{error || scopeLabel}</p>
        {error && <div><button type="button" onClick={onRetry}>Retry</button>{onUseCurated && <button type="button" onClick={onUseCurated}>Open curated collection</button>}</div>}
      </section>
    </main>
  );
}

function SceneLoadStatus({ phase, world, error, onRetry, onKeepPreview, onEnable }: {
  phase: SceneLoadPhase;
  world: ReturnType<typeof getWorld>;
  error?: string;
  onRetry: () => void;
  onKeepPreview: () => void;
  onEnable?: () => void;
}) {
  if (phase === "preview") {
    return <button className="scene-status scene-status-action" type="button" onClick={onEnable}><Sparkles size={14} /><span><strong>Preview mode</strong><small>Open the 3D reading room</small></span></button>;
  }
  if (phase === "error") {
    return (
      <div className="scene-status scene-status-error" role="alert">
        <span><strong>3D room unavailable</strong><small>{error || "The catalogue and reader are still ready."}</small></span>
        <button type="button" onClick={onRetry}>Retry</button><button type="button" onClick={onKeepPreview}>Keep preview</button>
      </div>
    );
  }
  return null;
}

function WorldRevealGate({ phase, progress, world }: { phase: SceneLoadPhase; progress: SceneLoadProgress; world: ReturnType<typeof getWorld> }) {
  const [longWait, setLongWait] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLongWait(true), 3000);
    return () => window.clearTimeout(timer);
  }, [world.id]);
  const copy = progress.stage === "code"
    ? "Opening the room"
    : progress.stage === "architecture"
      ? "Building the complete architecture"
      : progress.stage === "collection"
        ? "Placing the collection"
        : progress.stage === "lighting"
          ? "Lighting the final details"
          : "Your room is ready";
  const percent = Math.round(progress.ratio * 100);
  return (
    <section
      className={`world-reveal-gate ${longWait ? "is-long-wait" : ""}`}
      data-phase={phase}
      data-long-wait={longWait}
      aria-label={`Preparing ${world.label}`}
      aria-live="polite"
    >
      <div className="world-reveal-veil" aria-hidden="true" />
      <div className="world-reveal-status" role="status">
        <Loader2 className="spin" size={17} />
        <span><small>{world.era}</small><strong>{copy}</strong></span>
        {longWait && <p>The room is assembling behind the veil. Exploration unlocks when every detail is in place.</p>}
        <div className="world-reveal-progress" aria-label={`${percent}% complete`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} role="progressbar">
          <span style={{ width: `${Math.max(4, percent)}%` }} />
        </div>
      </div>
    </section>
  );
}

function SceneFailureReporter({ error, onReport }: { error: Error; onReport: (message: string) => void }) {
  useEffect(() => onReport(error.message), [error.message]);
  return null;
}

function ReaderLoadingShell({ book, error, onClose, onRetry }: { book: Book; error?: string; onClose: () => void; onRetry?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, '[data-reader-return], [title="Browse books"]');
  return (
    <section ref={ref} className="reader-overlay" role="dialog" aria-modal="true" tabIndex={-1} aria-label={`Opening ${book.title}`} aria-busy={!error}>
      <div className="reader-shell reader-pending-shell">
        <header className="reader-toolbar">
          <span />
          <div className="reader-identity"><span>{book.author}</span><strong>{book.title}</strong></div>
          <span /><span />
          <button className="icon-button" type="button" title="Close reader" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="reader-state" role={error ? "alert" : "status"} aria-live="polite">
          {!error && <Loader2 className="spin delayed-spinner" size={24} />}
          <strong>{error ? "The reader could not be loaded" : "Opening reader…"}</strong>
          {error && <span>{error}</span>}
          <div>{onRetry && <button type="button" onClick={onRetry}>Retry</button>}<button type="button" onClick={onClose}>{error ? "Back to catalogue" : "Cancel"}</button></div>
        </div>
      </div>
    </section>
  );
}

function HighlightedParts({ parts }: { parts: SnippetPart[] }) {
  return <span className="snippet">{parts.map((part, index) => part.highlight ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</span>;
}

function getStartHeadings(book: Book, limit: number) {
  return (book.headings || []).filter((heading) => heading.title.length > 3 && !GENERIC_HEADING.test(heading.title.trim())).slice(0, limit);
}

function getRelatedBooks(book: Book, books: Book[], limit: number) {
  const tokens = new Set(book.title.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4));
  const bookFacets = new Set(Object.values(book.facets || {}).flat());
  return books
    .filter((candidate) => candidate.id !== book.id)
    .map((candidate) => ({
      candidate,
      score: Object.values(candidate.facets || {}).flat().filter((value) => bookFacets.has(value)).length * 4
        + candidate.title.toLowerCase().split(/[^a-z0-9]+/).filter((token) => tokens.has(token)).length
    }))
    .sort((a, b) => b.score - a.score || Math.abs((a.candidate.year || 0) - (book.year || 0)) - Math.abs((b.candidate.year || 0) - (book.year || 0)))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function bookContextLabel(book: Book) {
  return book.shelfSectionLabel || book.categories[0] || book.tags[0] || book.author;
}

function formatReadingScale(wordCount: number) {
  const minutes = Math.max(1, Math.round(wordCount / 230));
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} hr`;
}

function singularizeLabel(label: string) {
  if (label.endsWith("ies")) return `${label.slice(0, -3)}y`;
  return label.endsWith("s") ? label.slice(0, -1) : label;
}

function searchStatus(groups: SearchGroup[], query: string) {
  if (!query.trim()) return "Search the source collection";
  const matches = groups.reduce((total, group) => total + group.matchCount, 0);
  if (!groups.length) return "No matches yet";
  return `${matches} passage${matches === 1 ? "" : "s"} across ${groups.length} volume${groups.length === 1 ? "" : "s"}`;
}

function prefetchWorld(world: ReturnType<typeof getWorld>) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  void world.load();
  // The atlas hover path must not let HDR, art, or backplates compete with the
  // compact room model when a user clicks immediately after pointing at a card.
  // Noncritical visuals are requested by the mounted scene after interaction.
  void fetch(world.assets.fallbackModel, { credentials: "same-origin" })
    .then((response) => response.ok ? response.arrayBuffer() : undefined)
    .catch(() => undefined);
}
