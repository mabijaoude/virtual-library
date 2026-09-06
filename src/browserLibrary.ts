import { safeLoad } from "js-yaml";
import type { Book, BookSection, Heading, LibraryManifest, SearchDocument, Shelf } from "./types";

const DB_NAME = "virtual-library";
const DB_VERSION = 1;
const BOOK_STORE = "browser-books";
const SHELF_ROWS = 5;
const SLOTS_PER_ROW = 14;
const PREFERRED_ROWS = [2, 1, 3, 0, 4];
const BASE_BAY_COUNT = 9;
const COLORS = ["#b78936", "#4f86a8", "#a9575d", "#6f8d5d", "#8267a8", "#d17845", "#7d8e9c", "#b36f8c", "#907451"];
export const MAX_BROWSER_IMPORT_FILES = 500;
export const MAX_BROWSER_BOOK_BYTES = 24 * 1024 * 1024;
export const MAX_BROWSER_IMPORT_BYTES = 128 * 1024 * 1024;

export type BrowserBookRecord = {
  id: string;
  fileName: string;
  sourceHash: string;
  importedAt: string;
  content: string;
  book: Book;
  searchDocuments: SearchDocument[];
};

export type BrowserImportResult = {
  added: number;
  replaced: number;
  skipped: number;
  rejected: number;
  warnings: string[];
};

export type ShelfOrganization = {
  shelfLabels: Record<string, string>;
  bookShelfIds: Record<string, string>;
};

export const MAX_SHELF_TITLE_LENGTH = 48;

export function emptyShelfOrganization(): ShelfOrganization {
  return { shelfLabels: {}, bookShelfIds: {} };
}

export function parseShelfOrganization(raw: string | null | undefined): ShelfOrganization {
  if (!raw) return emptyShelfOrganization();
  try {
    const parsed = JSON.parse(raw) as Partial<ShelfOrganization>;
    return {
      shelfLabels: cleanStringRecord(parsed.shelfLabels, sanitizeShelfTitle),
      bookShelfIds: cleanStringRecord(parsed.bookShelfIds, (value) => isShelfId(value) ? value : "")
    };
  } catch {
    return emptyShelfOrganization();
  }
}

export function sanitizeShelfTitle(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_SHELF_TITLE_LENGTH);
}

type BrowserImportCandidate = Pick<File, "name" | "size">;

export function planBrowserImport<T extends BrowserImportCandidate>(files: T[]) {
  const accepted: T[] = [];
  const warnings: string[] = [];
  let rejected = 0;
  let acceptedBytes = 0;

  if (files.length > MAX_BROWSER_IMPORT_FILES) {
    const excess = files.length - MAX_BROWSER_IMPORT_FILES;
    rejected += excess;
    warnings.push(`${excess} file${excess === 1 ? " was" : "s were"} not considered because one import is limited to ${MAX_BROWSER_IMPORT_FILES} files.`);
  }

  for (const file of files.slice(0, MAX_BROWSER_IMPORT_FILES)) {
    if (!file.name.toLowerCase().endsWith(".md")) {
      rejected += 1;
      warnings.push(`${file.name}: only .md files are supported.`);
      continue;
    }
    if (file.size > MAX_BROWSER_BOOK_BYTES) {
      rejected += 1;
      warnings.push(`${file.name}: larger than the ${formatBytes(MAX_BROWSER_BOOK_BYTES)} per-book browser limit.`);
      continue;
    }
    if (acceptedBytes + file.size > MAX_BROWSER_IMPORT_BYTES) {
      rejected += 1;
      warnings.push(`${file.name}: would exceed the ${formatBytes(MAX_BROWSER_IMPORT_BYTES)} limit for one browser import.`);
      continue;
    }
    accepted.push(file);
    acceptedBytes += file.size;
  }

  return { accepted, rejected, warnings };
}

type ParsedMatter = {
  data: Record<string, unknown>;
  content: string;
  parseError: boolean;
};

export async function listBrowserBooks(): Promise<BrowserBookRecord[]> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(BOOK_STORE, "readonly");
    const records = await requestResult<BrowserBookRecord[]>(transaction.objectStore(BOOK_STORE).getAll());
    await transactionComplete(transaction);
    return records.sort((a, b) => a.fileName.localeCompare(b.fileName));
  } finally {
    db.close();
  }
}

export async function loadBrowserBookContent(bookId: string): Promise<string> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(BOOK_STORE, "readonly");
    const record = await requestResult<BrowserBookRecord | undefined>(transaction.objectStore(BOOK_STORE).get(bookId));
    await transactionComplete(transaction);
    if (!record) throw new Error("This browser book is no longer available.");
    return record.content;
  } finally {
    db.close();
  }
}

export async function importBrowserFiles(files: File[]): Promise<BrowserImportResult> {
  const result: BrowserImportResult = { added: 0, replaced: 0, skipped: 0, rejected: 0, warnings: [] };
  const plan = planBrowserImport(files);
  result.rejected = plan.rejected;
  result.warnings.push(...plan.warnings);
  const existing = await listBrowserBooks();
  const existingById = new Map(existing.map((record) => [record.id, record]));
  const knownHashes = new Set(existing.map((record) => record.sourceHash));
  const pending = new Map<string, BrowserBookRecord>();

  for (const file of plan.accepted) {
    try {
      const content = await file.text();
      const record = await parseImportedMarkdown(file.name, content);
      const previous = existingById.get(record.id) || pending.get(record.id);
      if (knownHashes.has(record.sourceHash) && previous?.sourceHash !== record.sourceHash) {
        result.skipped += 1;
        result.warnings.push(`${file.name}: this exact content is already in the browser library.`);
        continue;
      }
      if (previous?.sourceHash === record.sourceHash) {
        result.skipped += 1;
        continue;
      }
      if (record.book.metadataNeedsReview) {
        result.warnings.push(`${file.name}: some metadata was inferred; add title/author frontmatter for more precise shelving.`);
      }
      if (previous) result.replaced += 1;
      else result.added += 1;
      pending.set(record.id, record);
      knownHashes.add(record.sourceHash);
    } catch (error) {
      result.rejected += 1;
      result.warnings.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (pending.size) await putBrowserBooks([...pending.values()]);
  return result;
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

export async function removeBrowserBook(bookId: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(BOOK_STORE, "readwrite");
    transaction.objectStore(BOOK_STORE).delete(bookId);
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

export async function clearBrowserBooks(): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(BOOK_STORE, "readwrite");
    transaction.objectStore(BOOK_STORE).clear();
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

export async function parseImportedMarkdown(fileName: string, raw: string): Promise<BrowserBookRecord> {
  const sourceHash = await digest(raw);
  const filenameHash = await digest(fileName.toLowerCase());
  const stem = fileName.replace(/\.md$/i, "");
  const matter = parseMatter(raw);
  const filename = structuredFilename(stem);
  const headingTitle = firstHeading(matter.content);
  const frontmatterAuthors = asList(matter.data.authors ?? matter.data.author);
  const inferredAuthor = filename.author || "Unknown Author";
  const authorNames = frontmatterAuthors.length ? frontmatterAuthors : [inferredAuthor];
  const author = authorNames[0] || "Unknown Author";
  const title = cleanInline(matter.data.title || headingTitle || filename.title || stem) || "Untitled";
  const categories = asList(matter.data.categories ?? matter.data.category);
  const tags = asList(matter.data.tags ?? matter.data.tag);
  const collections = asList(matter.data.collections ?? matter.data.collection ?? matter.data.shelf);
  const yearValue = Number(matter.data.year);
  const year = Number.isInteger(yearValue) && yearValue > 0 ? yearValue : filename.year;
  const headings = extractHeadings(matter.content);
  const plainText = plainTextFrom(matter.content);
  const sections = extractSections(headings, plainText);
  const wordCount = countWords(plainText);
  const explicitSummary = cleanInline(matter.data.summary || matter.data.description || matter.data.synopsis || "");
  const summary = explicitSummary.length > 40 ? explicitSummary.slice(0, 900) : summaryFrom(matter.content, plainText);
  const summarySource = explicitSummary.length > 40 ? "frontmatter" as const : "extractive" as const;
  const shelfSectionLabel = collections[0] || author;
  const shelfSectionId = slugify(shelfSectionLabel) || "general";
  const id = `browser-${slugify(stem) || "book"}-${filenameHash.slice(0, 8)}`;
  const authors = authorNames.map((name) => ({ id: slugify(name) || "unknown-author", name }));
  const metadataNeedsReview = matter.parseError || (!matter.data.title && !headingTitle && !filename.title) || author === "Unknown Author";
  const book: Book = {
    id,
    slug: slugify(title) || id,
    title,
    author,
    authors,
    year,
    type: "book",
    origin: "browser",
    sourceFileName: fileName,
    sourcePath: `browser/${fileName}`,
    relativeSourcePath: fileName,
    sourceFormat: "markdown",
    sourceHash,
    contentVersion: sourceHash.slice(0, 16),
    contentUrl: `indexeddb://${id}`,
    headings,
    headingCount: headings.length,
    sections,
    wordCount,
    excerpt: firstSubstantiveParagraph(matter.content, plainText).slice(0, 520),
    summary,
    summarySource,
    readingMinutes: Math.max(1, Math.round(wordCount / 230)),
    keySections: sections.filter((section) => section.wordCount > 80).slice(0, 5).map((section) => ({
      title: section.title,
      headingOrder: section.headingOrder,
      excerpt: section.excerpt
    })),
    topics: [...categories, ...tags],
    tags,
    categories,
    facets: { authors: authors.map((item) => item.name), categories, tags },
    shelfSectionId,
    shelfSectionLabel,
    metadataNeedsReview,
    placement: emptyPlacement(id, shelfSectionId)
  };
  return {
    id,
    fileName,
    sourceHash,
    importedAt: new Date().toISOString(),
    content: raw,
    book,
    searchDocuments: createSearchDocuments(book, plainText)
  };
}

export function mergeBrowserBooks(
  manifest: LibraryManifest,
  records: BrowserBookRecord[],
  {
    hideBundledBooks = false,
    organization = emptyShelfOrganization()
  }: { hideBundledBooks?: boolean; organization?: ShelfOrganization } = {}
): LibraryManifest {
  const books = [
    ...manifest.books
      .filter((book) => book.origin !== "browser" && (!hideBundledBooks || book.origin !== "bundled"))
      .map((book) => ({ ...book, placement: { ...book.placement } })),
    ...records.map((record) => ({ ...record.book, placement: { ...record.book.placement } }))
  ];
  const shelves = buildLayout(books, organization);
  const browserFingerprint = stableHash([
    hideBundledBooks ? "hidden" : "visible",
    records.map((record) => record.sourceHash).sort().join("|"),
    organizationFingerprint(organization)
  ].join("|"));
  return {
    ...manifest,
    version: `${manifest.version}-b${browserFingerprint}`,
    sourceFileCount: books.length,
    books,
    shelves
  };
}

export function browserSearchDocuments(records: BrowserBookRecord[]): SearchDocument[] {
  return records.flatMap((record) => record.searchDocuments);
}

function buildLayout(books: Book[], organization: ShelfOrganization): Shelf[] {
  const wordCounts = books.map((book) => book.wordCount);
  const minWords = wordCounts.length ? Math.min(...wordCounts) : 0;
  const maxWords = wordCounts.length ? Math.max(...wordCounts) : 1;
  const capacity = SHELF_ROWS * SLOTS_PER_ROW;
  const bayCount = Math.max(BASE_BAY_COUNT, Math.ceil(books.length / capacity));
  const ordered = [...books].sort((a, b) =>
    a.shelfSectionLabel.localeCompare(b.shelfSectionLabel) ||
    lastName(a.author).localeCompare(lastName(b.author)) ||
    a.author.localeCompare(b.author) ||
    (a.year || 9999) - (b.year || 9999) ||
    a.title.localeCompare(b.title)
  );
  const shelfBooks: Book[][] = Array.from({ length: bayCount }, () => []);
  const unassigned: Book[] = [];
  ordered.forEach((book) => {
    const assignedBay = shelfBayIndex(organization.bookShelfIds[book.id]);
    if (assignedBay >= 0 && assignedBay < bayCount && shelfBooks[assignedBay].length < capacity) {
      shelfBooks[assignedBay].push(book);
    } else {
      unassigned.push(book);
    }
  });
  let fillBay = 0;
  unassigned.forEach((book) => {
    while (fillBay < bayCount && shelfBooks[fillBay].length >= capacity) fillBay += 1;
    if (fillBay < bayCount) shelfBooks[fillBay].push(book);
  });
  const shelves: Shelf[] = Array.from({ length: bayCount }, (_, bay) => ({
    id: `display-bay-${bay + 1}`,
    label: bay < BASE_BAY_COUNT ? `Collection Bay ${toRoman(bay + 1)}` : `Annex Bay ${toRoman(bay + 1 - BASE_BAY_COUNT)}`,
    sectionId: "reserve",
    sectionLabel: "Reserve",
    bayIndex: bay,
    rows: SHELF_ROWS,
    slotsPerRow: SLOTS_PER_ROW,
    capacity,
    occupiedRows: []
  }));

  shelves.forEach((shelf, bayIndex) => {
    const booksOnShelf = shelfBooks[bayIndex];
    const activeRows = PREFERRED_ROWS.slice(0, Math.min(SHELF_ROWS, Math.ceil(booksOnShelf.length / SLOTS_PER_ROW)));
    shelf.occupiedRows = [...activeRows].sort((a, b) => a - b);
    if (booksOnShelf.length) {
      const sections = [...new Set(booksOnShelf.map((book) => book.shelfSectionLabel || "General"))];
      shelf.sectionId = booksOnShelf[0].shelfSectionId || "general";
      shelf.sectionLabel = sections.length === 1 ? sections[0] : `${sections[0]}–${sections.at(-1)}`;
      shelf.authorRange = authorRange(booksOnShelf);
      shelf.label = shelf.sectionLabel;
    }
    const customLabel = sanitizeShelfTitle(organization.shelfLabels[shelf.id] || "");
    if (customLabel) shelf.label = customLabel;
    activeRows.forEach((row, activeRowIndex) => {
      const rowBooks = booksOnShelf.slice(activeRowIndex * SLOTS_PER_ROW, (activeRowIndex + 1) * SLOTS_PER_ROW);
      const startSlot = Math.max(0, Math.floor((SLOTS_PER_ROW - rowBooks.length) / 2));
      rowBooks.forEach((book, rowIndex) => {
        book.placement = {
          documentId: book.id,
          shelfId: shelf.id,
          bay: bayIndex,
          row,
          slot: startSlot + rowIndex,
          width: round(mapRange(book.wordCount, minWords, maxWords, 0.095, 0.17)),
          height: round(mapRange(book.wordCount, minWords, maxWords, 0.7, 0.94)),
          depth: 0.43,
          accentColor: book.placement.accentColor || colorFor(book.shelfSectionId),
          shelfSectionId: book.shelfSectionId || "general",
          importanceScore: round(mapRange(book.wordCount, minWords, maxWords, 0.25, 1))
        };
      });
    });
  });
  return shelves;
}

function cleanStringRecord(value: unknown, clean: (entry: string) => string): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .slice(0, 2_000)
    .map(([key, entry]) => [String(key).slice(0, 180), clean(typeof entry === "string" ? entry : "")])
    .filter(([key, entry]) => Boolean(key && entry)));
}

function isShelfId(value: string): boolean {
  return /^display-bay-[1-9]\d*$/.test(value);
}

function shelfBayIndex(value: string | undefined): number {
  if (!value || !isShelfId(value)) return -1;
  return Number(value.slice("display-bay-".length)) - 1;
}

function organizationFingerprint(organization: ShelfOrganization): string {
  return JSON.stringify({
    shelfLabels: Object.entries(organization.shelfLabels).sort(([a], [b]) => a.localeCompare(b)),
    bookShelfIds: Object.entries(organization.bookShelfIds).sort(([a], [b]) => a.localeCompare(b))
  });
}

function parseMatter(raw: string): ParsedMatter {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { data: {}, content: raw, parseError: false };
  try {
    const parsed = safeLoad(match[1]);
    const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    return { data, content: raw.slice(match[0].length), parseError: false };
  } catch {
    return { data: {}, content: raw.slice(match[0].length), parseError: true };
  }
}

function structuredFilename(stem: string) {
  const parts = stem.split(" - ");
  if (parts.length < 3) return {} as { author?: string; title?: string; year?: number };
  const last = parts.at(-1)?.trim() || "";
  const yearMatch = last.match(/\b(18|19|20)\d{2}\b/);
  return {
    author: [parts[1]?.trim(), parts[0]?.trim()].filter(Boolean).join(" "),
    title: (yearMatch ? parts.slice(2, -1) : parts.slice(2)).join(" - ").trim(),
    year: yearMatch ? Number(yearMatch[0]) : undefined
  };
}

function extractHeadings(content: string): Heading[] {
  return [...content.matchAll(/^(#{1,6})\s+(.+)$/gm)].slice(0, 120).map((match, order) => ({
    id: slugify(cleanInline(match[2])),
    title: cleanInline(match[2]),
    level: match[1].length,
    order
  }));
}

function extractSections(headings: Heading[], plainText: string): BookSection[] {
  if (!headings.length) {
    return [{ id: "opening", title: "Opening", level: 1, headingOrder: 0, position: 0, wordCount: countWords(plainText), excerpt: plainText.slice(0, 360) }];
  }
  const lower = plainText.toLowerCase();
  let cursor = 0;
  const positions = headings.map((heading) => {
    const found = lower.indexOf(heading.title.toLowerCase(), cursor);
    const position = found >= 0 ? found : cursor;
    cursor = Math.max(cursor, position + heading.title.length);
    return position;
  });
  return headings.map((heading, index) => {
    const position = positions[index];
    const text = plainText.slice(position, positions[index + 1] ?? plainText.length).trim();
    return {
      id: `${heading.id}-${heading.order}`,
      title: heading.title,
      level: heading.level,
      headingOrder: heading.order,
      position,
      wordCount: countWords(text),
      excerpt: text.slice(0, 360)
    };
  });
}

function createSearchDocuments(book: Book, plainText: string): SearchDocument[] {
  const sections = book.sections?.length ? book.sections : [{ title: "Opening", headingOrder: 0, position: 0 }];
  const documents: SearchDocument[] = [];
  sections.forEach((section, sectionIndex) => {
    const start = section.position || 0;
    const end = sections[sectionIndex + 1]?.position ?? plainText.length;
    const text = plainText.slice(start, end).trim();
    for (let offset = 0, chunk = 0; offset < text.length; offset += 1620, chunk += 1) {
      const value = text.slice(offset, offset + 1800);
      if (!value) break;
      documents.push({
        id: `${book.id}:${section.headingOrder || 0}:${chunk}`,
        bookId: book.id,
        title: book.title,
        author: book.author,
        facets: Object.values(book.facets).flat().join(" "),
        sectionTitle: section.title || "Opening",
        headingOrder: section.headingOrder || 0,
        position: start + offset,
        preview: value.slice(0, 520),
        text: value
      });
      if (offset + 1800 >= text.length) break;
    }
  });
  return documents;
}

function summaryFrom(content: string, plainText: string) {
  const paragraphs = content.split(/\r?\n\s*\r?\n/).map(cleanInline).filter((value) => value.length > 120);
  return (paragraphs.slice(0, 2).join(" ") || plainText).slice(0, 900);
}

function firstSubstantiveParagraph(content: string, plainText: string) {
  return content.split(/\r?\n\s*\r?\n/).map(cleanInline).find((value) => value.length > 80) || plainText;
}

function plainTextFrom(content: string) {
  return cleanInline(content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, ""));
}

function firstHeading(content: string) {
  return cleanInline(content.match(/^#\s+(.+)$/m)?.[1] || "");
}

function cleanInline(value: unknown) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanInline).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string" && value.includes(",")) return value.split(",").map(cleanInline).filter(Boolean);
  return [cleanInline(value)].filter(Boolean);
}

function countWords(value: string) {
  return (value.match(/\b[\w'’-]+\b/g) || []).length;
}

function slugify(value: unknown) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function colorFor(value: string) {
  return COLORS[parseInt(stableHash(value).slice(0, 2), 16) % COLORS.length];
}

function emptyPlacement(id: string, shelfSectionId: string) {
  return { documentId: id, shelfId: "display-bay-1", bay: 0, row: 2, slot: 0, width: 0.12, height: 0.8, depth: 0.43, accentColor: colorFor(shelfSectionId), shelfSectionId, importanceScore: 0.5 };
}

function authorRange(books: Book[]) {
  const authors = [...new Set(books.map((book) => book.author || "Unknown Author"))].sort((a, b) => lastName(a).localeCompare(lastName(b)) || a.localeCompare(b));
  if (!authors.length) return "Reserve";
  if (authors.length === 1) return authors[0];
  return `${lastName(authors[0])}–${lastName(authors.at(-1) || "")}`;
}

function lastName(author: string) {
  return author.trim().split(/\s+/).at(-1) || "Unknown";
}

function mapRange(value: number, min: number, max: number, outMin: number, outMax: number) {
  if (max <= min) return (outMin + outMax) / 2;
  return outMin + Math.max(0, Math.min(1, (value - min) / (max - min))) * (outMax - outMin);
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function toRoman(value: number) {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][value] || String(value);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function digest(value: string) {
  if (!globalThis.crypto?.subtle) return stableHash(value).repeat(8);
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function putBrowserBooks(records: BrowserBookRecord[]) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(BOOK_STORE, "readwrite");
    const store = transaction.objectStore(BOOK_STORE);
    records.forEach((record) => store.put(record));
    await transactionComplete(transaction);
  } finally {
    db.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Browser storage is unavailable in this environment."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BOOK_STORE)) request.result.createObjectStore(BOOK_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Browser storage transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("Browser storage transaction failed."));
  });
}
