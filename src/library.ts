import edition from "@edition";
import type { Book, BookDetail, FacetDefinition, Heading, LibraryManifest, ResolvedBook, SearchGroup, SearchMatch, SearchPassageHit, SearchResult, SnippetPart } from "./types";

const MAX_CONTENT_CACHE_BYTES = 20 * 1024 * 1024;
const MAX_CONTENT_CACHE_BOOKS = 2;
const contentCache = new Map<string, { text: string; bytes: number }>();
let contentCacheBytes = 0;
const detailCache = new Map<string, Promise<BookDetail>>();
const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "is",
  "it",
  "many",
  "of",
  "on",
  "or",
  "that",
  "the",
  "there",
  "this",
  "to",
  "was",
  "were",
  "with"
]);

export async function loadManifest(scopeId = edition.defaultScopeId, signal?: AbortSignal): Promise<LibraryManifest> {
  return edition.catalogProvider.load(scopeId, signal);
}

export async function loadBookDetail(book: Book, manifestVersion: string, signal?: AbortSignal): Promise<BookDetail> {
  if (book.bookId && book.headings && book.sections && book.summary !== undefined && book.relativeSourcePath && book.sourceHash) {
    return book as BookDetail;
  }
  const cacheKey = `${manifestVersion}:${book.id}`;
  let pending = detailCache.get(cacheKey);
  if (!pending) {
    pending = edition.metadataProvider.load(book, signal).catch((error) => {
      detailCache.delete(cacheKey);
      throw error;
    });
    detailCache.set(cacheKey, pending);
  }
  return pending;
}

export async function resolveBook(book: Book, manifestVersion: string, signal?: AbortSignal): Promise<ResolvedBook> {
  return { ...book, ...(await loadBookDetail(book, manifestVersion, signal)) } as ResolvedBook;
}

export async function loadBookContent(book: Book, signal?: AbortSignal): Promise<string> {
  const cacheKey = `${book.id}:${book.sourceHash || book.contentUrl}`;
  const cached = contentCache.get(cacheKey);
  if (cached) {
    contentCache.delete(cacheKey);
    contentCache.set(cacheKey, cached);
    return cached.text;
  }
  const text = await edition.contentProvider.load(book, signal);
  const bytes = new Blob([text]).size;
  const replaced = contentCache.get(cacheKey);
  if (replaced) contentCacheBytes -= replaced.bytes;
  contentCache.set(cacheKey, { text, bytes });
  contentCacheBytes += bytes;
  while (contentCache.size > MAX_CONTENT_CACHE_BOOKS || contentCacheBytes > MAX_CONTENT_CACHE_BYTES) {
    const oldestKey = contentCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = contentCache.get(oldestKey);
    contentCache.delete(oldestKey);
    contentCacheBytes -= oldest?.bytes || 0;
  }
  return text;
}

export function bookFacetValues(book: Book, facetId: string): string[] {
  return book.facets?.[facetId]?.filter(Boolean) || [];
}

export function visibleFacetDefinitions(manifest: LibraryManifest, preferredIds = edition.browseFacetIds): FacetDefinition[] {
  const byId = new Map(manifest.facetDefinitions.map((facet) => [facet.id, facet]));
  return preferredIds
    .map((id) => byId.get(id))
    .filter((facet): facet is FacetDefinition => Boolean(facet))
    .filter((facet) => manifest.books.some((book) => bookFacetValues(book, facet.id).length > 0));
}

export function facetGroups(books: Book[], facetId: string) {
  const grouped = new Map<string, Book[]>();
  for (const book of books) {
    for (const value of bookFacetValues(book, facetId)) {
      if (!grouped.has(value)) grouped.set(value, []);
      grouped.get(value)?.push(book);
    }
  }
  return Array.from(grouped, ([label, groupedBooks]) => ({ label, books: groupedBooks }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function cleanMarkdownSnippet(value: string): string {
  return joinOcrSpacedCaps(value)
    .replace(/^---[\s\S]*?\n---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanMarkdownForReader(value: string, headings: Book["headings"] = []): string {
  let headingIndex = 0;
  return joinOcrSpacedCaps(value.replace(/^---[\s\S]*?\n---\s*/, ""))
    .replace(/^(#{1,6})\s+(.+)$/gm, (line, hashes: string) => {
      if (!headings.length) return line;
      const heading = headings[headingIndex];
      headingIndex += 1;
      if (!heading) return line;
      const level = Math.min(6, Math.max(1, hashes.length));
      return `<h${level} id="reader-heading-${heading.order}">${escapeHtml(formatHeadingTitle(heading.title))}</h${level}>`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatHeadingTitle(value: string): string {
  const joined = joinOcrSpacedCaps(value).replace(/\s+/g, " ").trim();
  if (!joined) return joined;
  const letters = joined.match(/\p{L}/gu) || [];
  const uppercaseLetters = joined.match(/\p{Lu}/gu) || [];
  const isMostlyUppercase = letters.length > 4 && uppercaseLetters.length / letters.length > 0.82;
  return isMostlyUppercase ? toTitleCase(joined) : joined;
}

function joinOcrSpacedCaps(value: string): string {
  return value.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, (match, first: string, rest: string, offset: number, full: string) => {
    const prefix = full.slice(0, offset);
    if (first === "A" && !/\p{L}/u.test(prefix)) return match;
    return `${first}${rest}`;
  });
}

export function quickSearch(books: Book[], query: string): SearchResult[] {
  return quickSearchGroups(books, query).flatMap((group) => group.matches);
}

export function quickSearchGroups(books: Book[], query: string): SearchGroup[] {
  const parsed = parseQuery(query);
  if (!parsed.normalized) return [];

  return books
    .map((book) => {
      const headings = book.headings || [];
      const headingText = headings.slice(0, 24).map((heading) => heading.title).join(" ");
      const facetText = Object.values(book.facets || {}).flat().join(" ");
      const metadata = `${book.title} ${book.authors.map((author) => author.name).join(" ")} ${book.year || ""} ${facetText}`;
      const haystack = `${metadata} ${headingText}`.toLowerCase();
      const exact = haystack.includes(parsed.normalized);
      const titleExact = book.title.toLowerCase().includes(parsed.normalized);
      const matchedHeading = matchingHeading(headings, parsed);
      const termHits = countMatchedFamilies(haystack, parsed.termFamilies);
      const score = termHits * 3 + (exact ? 24 : 0) + (titleExact ? 1000 : 0);
      const snippet = exact ? `${book.title} - ${book.author}` : book.excerpt;
      const match = makeMatch({
        book,
        score,
        snippet,
        query: parsed,
        matchType: titleExact || metadata.toLowerCase().includes(parsed.normalized) ? "metadata" : "heading",
        locationLabel: titleExact ? "Title" : matchedHeading ? `Contents - ${formatHeadingTitle(matchedHeading.title)}` : "Heading or catalog",
        position: sectionForHeading(book, matchedHeading)?.position || 0,
        headingOrder: matchedHeading?.order,
        sectionTitle: matchedHeading?.title,
        suffix: "catalog"
      });
      return {
        book,
        score,
        matchCount: score > 0 ? 1 : 0,
        matches: score > 0 ? [match] : []
      };
    })
    .filter((group) => group.score > 0)
    .sort((a, b) => b.score - a.score || b.book.wordCount - a.book.wordCount)
    .slice(0, 12);
}

export function passageHitsToGroups(books: Book[], hits: SearchPassageHit[], query: string): SearchGroup[] {
  const parsed = parseQuery(query);
  const booksById = new Map(books.map((book) => [book.id, book]));
  const grouped = new Map<string, SearchGroup>();

  for (const hit of hits) {
    const book = booksById.get(hit.bookId);
    if (!book) continue;
    const match = makeMatch({
      book,
      score: hit.score,
      snippet: hit.text,
      query: parsed,
      matchType: hit.kind === "title" || hit.kind === "author" || hit.kind === "metadata" ? "metadata" : hit.kind === "heading" ? "heading" : "content",
      locationLabel: hit.kind === "title"
        ? "Title"
        : hit.kind === "author"
          ? "Author"
          : hit.kind === "metadata"
            ? "Catalogue"
            : `${hit.kind === "heading" ? "Heading" : "Passage"} in ${formatHeadingTitle(hit.sectionTitle || "Opening")}`,
      position: hit.position,
      headingOrder: hit.headingOrder,
      sectionTitle: hit.sectionTitle,
      suffix: `worker-${hit.id}`
    });
    const previous = grouped.get(book.id);
    if (previous) {
      previous.score = Math.max(previous.score, hit.score);
      previous.matchCount += 1;
      if (previous.matches.length < 4) previous.matches.push(match);
    } else {
      grouped.set(book.id, { book, score: hit.score, matchCount: 1, matches: [match] });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.score - a.score || b.book.wordCount - a.book.wordCount)
    .slice(0, 16);
}

export async function deepSearch(books: Book[], query: string): Promise<SearchResult[]> {
  return (await deepSearchGroups(books, query)).flatMap((group) => group.matches);
}

export async function deepSearchGroups(books: Book[], query: string): Promise<SearchGroup[]> {
  const parsed = parseQuery(query);
  if (!parsed.normalized) return [];
  const byBook = new Map<string, SearchGroup>();
  const fallbackByBook = new Map<string, SearchGroup>();
  const fallbackFamily = parsed.termFamilies.find((family) => family.length > 1) || parsed.termFamilies[0];

  for (const group of quickSearchGroups(books, query)) {
    byBook.set(group.book.id, group);
  }

  await Promise.all(
    books.map(async (book) => {
      const markdown = await loadBookContent(book);
      const clean = cleanMarkdownSnippet(markdown);
      const lower = clean.toLowerCase();
      const positions = collectMatchPositions(lower, parsed);
      if (!positions.length) return;

      const requiredFamilies = Math.min(parsed.termFamilies.length, 3);
      const matchesFor = (minimumFamilies: number, requiredFamily?: string[]) =>
        positions.map((position, index) => {
          const snippet = windowAround(clean, position, 440);
          const phraseHit = lower.slice(position, position + parsed.normalized.length) === parsed.normalized;
          const local = snippet.toLowerCase();
          const localTermHits = countMatchedFamilies(local, parsed.termFamilies);
          if (requiredFamily && !familyMatches(local, requiredFamily)) return undefined;
          if (!phraseHit && minimumFamilies > 1 && localTermHits < minimumFamilies) return undefined;
          const section = sectionForPosition(book, position);
          return makeMatch({
            book,
            score: (phraseHit ? 32 : 0) + localTermHits * 5 + Math.max(0, 8 - index),
            snippet,
            query: parsed,
            matchType: "content",
            locationLabel: section ? `Passage in ${formatHeadingTitle(section.title)}` : `Passage ${index + 1}`,
            position,
            headingOrder: section?.headingOrder,
            sectionTitle: section?.title,
            findIndex: readerFindIndexForPosition(clean, parsed, position),
            suffix: `content-${position}`
          });
        })
        .filter((match): match is SearchMatch => Boolean(match))
        .slice(0, 8);
      const contentMatches = matchesFor(requiredFamilies);
      const fallbackMatches = contentMatches.length || requiredFamilies <= 1 ? [] : matchesFor(1, fallbackFamily);
      if (!contentMatches.length && fallbackMatches.length) {
        fallbackByBook.set(book.id, {
          book,
          score: fallbackMatches.reduce((total, match) => total + match.score, 0),
          matchCount: fallbackMatches.length,
          matches: fallbackMatches
        });
      }
      if (!contentMatches.length) return;

      const previous = byBook.get(book.id);
      const matches = [...(previous?.matches || []), ...contentMatches].sort((a, b) => b.score - a.score);
      byBook.set(book.id, {
        book,
        score: matches.reduce((total, match) => total + match.score, 0),
        matchCount: matches.length,
        matches
      });
    })
  );

  if (!byBook.size && fallbackByBook.size) {
    for (const [id, group] of fallbackByBook) byBook.set(id, group);
  }

  return Array.from(byBook.values())
    .sort((a, b) => b.score - a.score || b.book.wordCount - a.book.wordCount)
    .slice(0, 16)
    .map((group) => ({ ...group, matches: group.matches.slice(0, 5) }));
}

export async function searchInsideBook(book: Book, query: string): Promise<SearchResult[]> {
  const parsed = parseQuery(query);
  if (!parsed.normalized) return [];
  const markdown = await loadBookContent(book);
  const clean = cleanMarkdownSnippet(markdown);
  const lower = clean.toLowerCase();
  const positions = collectMatchPositions(lower, parsed);

  const requiredFamilies = Math.min(parsed.termFamilies.length, 3);
  const matchesFor = (minimumFamilies: number, requiredFamily?: string[]) =>
    positions.map((position, index) => {
      const snippet = windowAround(clean, position, 420);
      const phraseHit = lower.slice(position, position + parsed.normalized.length) === parsed.normalized;
      const local = snippet.toLowerCase();
      const localTermHits = countMatchedFamilies(local, parsed.termFamilies);
      if (requiredFamily && !familyMatches(local, requiredFamily)) return undefined;
      if (!phraseHit && minimumFamilies > 1 && localTermHits < minimumFamilies) return undefined;
      const section = sectionForPosition(book, position);
      return makeMatch({
      book,
      score: (phraseHit ? 28 : 0) + localTermHits * 4,
      snippet,
      query: parsed,
      matchType: "content",
      locationLabel: section ? `Passage in ${formatHeadingTitle(section.title)}` : `Passage ${index + 1}`,
      position,
      headingOrder: section?.headingOrder,
      sectionTitle: section?.title,
      findIndex: readerFindIndexForPosition(clean, parsed, position),
      suffix: `inside-${position}`
    });
    })
    .filter((match): match is SearchMatch => Boolean(match))
    .slice(0, 8);
  const strictMatches = matchesFor(requiredFamilies);
  return strictMatches.length || requiredFamilies <= 1 ? strictMatches : matchesFor(1, parsed.termFamilies[0]);
}

export function parseQuery(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
  const terms = normalized
    .split(/\s+/)
    .map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((term) => term.length > 2 && !stopWords.has(term));
  const termFamilies = terms.map((term) => termVariants(term));
  const searchTerms = Array.from(new Set(termFamilies.flat()));
  return { normalized, terms, termFamilies, searchTerms };
}

export function highlightSnippet(snippet: string, query: ReturnType<typeof parseQuery>): SnippetPart[] {
  if (!snippet || (!query.normalized && !query.searchTerms.length)) return [{ text: snippet, highlight: false }];
  const merged = collectHighlightRanges(snippet, query);
  if (!merged.length) return [{ text: snippet, highlight: false }];

  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: snippet.slice(cursor, start), highlight: false });
    parts.push({ text: snippet.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), highlight: false });
  return parts;
}

export function readerFindIndexForPosition(
  text: string,
  query: ReturnType<typeof parseQuery>,
  position: number,
  exhaustive = false
): number | undefined {
  const ranges = collectHighlightRanges(text, query, exhaustive ? Number.POSITIVE_INFINITY : 80);
  if (!ranges.length) return undefined;
  const containing = ranges.findIndex(([start, end]) => position >= start && position < end);
  if (containing >= 0) return containing;
  const next = ranges.findIndex(([start]) => start > position);
  if (next === -1) return ranges.length - 1;
  return Math.max(0, next - 1);
}

export function sectionForPosition(book: Book, position: number) {
  const sections = [...(book.sections || [])].sort((a, b) => a.position - b.position);
  if (!sections.length) return undefined;
  let current = sections[0];
  for (const section of sections) {
    if (section.position > position) break;
    current = section;
  }
  return current;
}

function collectHighlightRanges(snippet: string, query: ReturnType<typeof parseQuery>, maxPerNeedle = 80): Array<[number, number]> {
  if (!snippet || (!query.normalized && !query.searchTerms.length)) return [];
  const ranges: Array<[number, number]> = [];
  const lower = snippet.toLowerCase();
  addRanges(lower, query.normalized, ranges, maxPerNeedle);
  for (const term of query.searchTerms) addTermRanges(lower, term, ranges, maxPerNeedle);
  const merged = ranges
    .sort((a, b) => a[0] - b[0] || b[1] - a[1])
    .reduce<Array<[number, number]>>((acc, range) => {
      const last = acc[acc.length - 1];
      if (!last || range[0] > last[1]) {
        acc.push([...range]);
      } else {
        last[1] = Math.max(last[1], range[1]);
      }
      return acc;
    }, []);
  return merged;
}

function makeMatch({
  book,
  score,
  snippet,
  query,
  matchType,
  locationLabel,
  position,
  headingOrder,
  sectionTitle,
  findIndex,
  suffix
}: {
  book: Book;
  score: number;
  snippet: string;
  query: ReturnType<typeof parseQuery>;
  matchType: SearchMatch["matchType"];
  locationLabel: string;
  position: number;
  headingOrder?: number;
  sectionTitle?: string;
  findIndex?: number;
  suffix: string;
}): SearchMatch {
  // The visible card is only three lines: keep the actual match near its start,
  // including worker passages whose strongest hit is late in a long section.
  if (snippet.length > 240) {
    const firstMatch = collectHighlightRanges(snippet, query)[0]?.[0] ?? 0;
    const start = Math.max(0, firstMatch - 65);
    const end = Math.min(snippet.length, start + 240);
    snippet = `${start ? "…" : ""}${snippet.slice(start, end)}${end < snippet.length ? "…" : ""}`;
  }
  return {
    id: `${book.id}-${suffix}`,
    book,
    score,
    snippet,
    parts: highlightSnippet(snippet, query),
    matchType,
    locationLabel,
    position,
    headingOrder,
    matchPosition: position,
    findIndex,
    sectionTitle
  };
}

function matchingHeading(headings: Heading[], query: ReturnType<typeof parseQuery>) {
  const normalized = query.normalized.toLowerCase();
  return headings.find((heading) => {
    const lower = heading.title.toLowerCase();
    return lower.includes(normalized) || countMatchedFamilies(lower, query.termFamilies) > 0;
  });
}

function sectionForHeading(book: Book, heading?: Heading) {
  if (!heading) return undefined;
  return book.sections?.find((section) => section.headingOrder === heading.order);
}

function collectMatchPositions(lower: string, query: ReturnType<typeof parseQuery>): number[] {
  const exactPhraseFound = lower.includes(query.normalized);
  const requiredFamilies = Math.min(query.termFamilies.length, 3);
  const matchedFamilies = countMatchedFamilies(lower, query.termFamilies);
  if (!exactPhraseFound && requiredFamilies > 1 && matchedFamilies === 0) {
    return [];
  }

  const positions = new Set<number>();
  addPositions(lower, query.normalized, positions, 12);
  for (const term of query.searchTerms) addTermPositions(lower, term, positions, 8);
  return Array.from(positions).sort((a, b) => {
    const aExact = lower.slice(a, a + query.normalized.length) === query.normalized ? 0 : 1;
    const bExact = lower.slice(b, b + query.normalized.length) === query.normalized ? 0 : 1;
    return aExact - bExact || a - b;
  });
}

function countMatchedFamilies(value: string, families: string[][]): number {
  return families.reduce((total, family) => total + (family.some((term) => termRegex(term).test(value)) ? 1 : 0), 0);
}

function familyMatches(value: string, family: string[]): boolean {
  return family.some((term) => termRegex(term).test(value));
}

function termVariants(term: string): string[] {
  if (term === "twix") return ["twix", "twixt"];
  return [term];
}

function addPositions(value: string, needle: string, positions: Set<number>, max: number) {
  if (!needle) return;
  let index = value.indexOf(needle);
  let guard = 0;
  while (index >= 0 && guard < max) {
    positions.add(index);
    index = value.indexOf(needle, index + Math.max(1, needle.length));
    guard += 1;
  }
}

function addRanges(value: string, needle: string, ranges: Array<[number, number]>, max: number) {
  if (!needle) return;
  let index = value.indexOf(needle);
  let guard = 0;
  while (index >= 0 && guard < max) {
    ranges.push([index, index + needle.length]);
    index = value.indexOf(needle, index + Math.max(1, needle.length));
    guard += 1;
  }
}

function addTermPositions(value: string, term: string, positions: Set<number>, max: number) {
  const regex = termRegex(term);
  let guard = 0;
  let match = regex.exec(value);
  while (match && guard < max) {
    positions.add(match.index);
    match = regex.exec(value);
    guard += 1;
  }
}

function addTermRanges(value: string, term: string, ranges: Array<[number, number]>, max: number) {
  const regex = termRegex(term);
  let guard = 0;
  let match = regex.exec(value);
  while (match && guard < max) {
    ranges.push([match.index, match.index + match[0].length]);
    match = regex.exec(value);
    guard += 1;
  }
}

function termRegex(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "giu");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function toTitleCase(value: string): string {
  const smallWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part, index, parts) => {
      if (!/[a-z]/.test(part)) return part;
      const previous = parts[index - 2] || "";
      const isBoundary = index === 0 || previous === "-" || /[:([/]$/.test(previous);
      if (!isBoundary && smallWords.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("")
    .replace(/\bn\./gi, "N.");
}

function windowAround(text: string, index: number, size: number): string {
  const half = Math.floor(size / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(text.length, index + half);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
