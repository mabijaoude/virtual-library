export type FacetDefinition = {
  id: string;
  label: string;
  color?: string;
};

export type BookAuthor = {
  id: string;
  name: string;
};

export type Heading = {
  id: string;
  title: string;
  level: number;
  order: number;
};

export type BookSection = {
  id: string;
  title: string;
  level: number;
  headingOrder: number;
  position: number;
  wordCount: number;
  excerpt: string;
};

export type DisplayPlacement = {
  documentId: string;
  shelfId: string;
  bay: number;
  row: number;
  slot: number;
  width: number;
  height: number;
  depth: number;
  accentColor: string;
  shelfSectionId: string;
  importanceScore: number;
};

export type ShelfPlacement = DisplayPlacement;

export type CatalogBook = {
  id: string;
  slug: string;
  title: string;
  author: string;
  authors: BookAuthor[];
  year?: number;
  type: "book";
  origin?: "bundled" | "browser";
  sourceFileName?: string;
  sourceFormat: "markdown";
  contentUrl: string;
  contentVersion?: string;
  headingCount: number;
  wordCount: number;
  excerpt: string;
  readingMinutes?: number;
  topics: string[];
  tags: string[];
  categories: string[];
  facets: Record<string, string[]>;
  shelfSectionId: string;
  shelfSectionLabel: string;
  metadataNeedsReview: boolean;
  placement: DisplayPlacement;
};

export type BookDetail = {
  bookId: string;
  sourcePath?: string;
  relativeSourcePath: string;
  sourceHash: string;
  headings: Heading[];
  sections: BookSection[];
  summary: string;
  summarySource?: "frontmatter" | "introduction" | "extractive";
  keySections: Array<{
    title: string;
    headingOrder: number;
    excerpt: string;
  }>;
};

export type Book = CatalogBook & Partial<BookDetail>;
export type ResolvedBook = CatalogBook & BookDetail;

export type Shelf = {
  id: string;
  label: string;
  sectionId: string;
  sectionLabel: string;
  authorRange?: string;
  bayIndex?: number;
  rows: number;
  slotsPerRow: number;
  capacity?: number;
  occupiedRows?: number[];
};

export type Room = {
  id: string;
  label: string;
  width: number;
  depth: number;
  height?: number;
};

export type LibraryManifest = {
  version: string;
  generatedAt: string;
  editionId: string;
  scopeId: string;
  scopeLabel: string;
  sourceRoot: string;
  sourceFileCount: number;
  rooms: Room[];
  shelves: Shelf[];
  books: Book[];
  facetDefinitions: FacetDefinition[];
};

export type SnippetPart = {
  text: string;
  highlight: boolean;
};

export type SearchMatch = {
  id: string;
  book: Book;
  score: number;
  snippet: string;
  parts: SnippetPart[];
  matchType: "metadata" | "heading" | "content";
  locationLabel: string;
  position: number;
  headingOrder?: number;
  matchPosition?: number;
  findIndex?: number;
  sectionTitle?: string;
};

export type SearchResult = SearchMatch;

export type SearchGroup = {
  book: Book;
  score: number;
  matchCount: number;
  matches: SearchMatch[];
};

export type SearchPassageHit = {
  id: string;
  bookId: string;
  score: number;
  kind?: "title" | "author" | "metadata" | "heading" | "phrase" | "content" | "semantic";
  title: string;
  author: string;
  topic: string;
  sectionTitle: string;
  headingOrder: number;
  position: number;
  text: string;
};

export type SearchDocument = {
  id: string;
  bookId: string;
  title: string;
  author: string;
  facets: string;
  sectionTitle: string;
  headingOrder: number;
  position: number;
  preview: string;
  text: string;
};

export type SearchWorkerRequest = {
  id: number;
  type: "search" | "preload" | "replace-browser-documents";
  query?: string;
  limit?: number;
  documents?: SearchDocument[];
};

export type SearchWorkerResponse = {
  id: number;
  type: "ready" | "results" | "error";
  results?: SearchPassageHit[];
  documentCount?: number;
  message?: string;
};

export type SearchCapabilities = {
  metadata: boolean;
  headings: boolean;
  passages: boolean;
  phrase: boolean;
  semantic: boolean;
};

export type SearchRequest = {
  scopeId: string;
  query: string;
  limit?: number;
  filters?: Record<string, string[]>;
  mode?: "phrase" | "semantic" | "combined";
};

export type SearchResponse = {
  hits: SearchPassageHit[];
  capabilities: SearchCapabilities;
  partial?: boolean;
  sourceTimings?: Partial<Record<"metadata" | "phrase" | "semantic", number>>;
};

export type SceneMode = "browse" | "immersive" | "focus" | "reader";
