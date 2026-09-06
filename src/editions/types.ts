import type { Book, BookDetail, LibraryManifest, SearchCapabilities, SearchDocument, SearchRequest, SearchResponse } from "../types";

export type CatalogScopeDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  expectedCount?: number;
};

export interface CatalogProvider {
  load(scopeId: string, signal?: AbortSignal): Promise<LibraryManifest>;
}

export interface MetadataProvider {
  load(book: Book, signal?: AbortSignal): Promise<BookDetail>;
}

export interface ContentProvider {
  load(book: Book, signal?: AbortSignal): Promise<string>;
}

export interface SearchProvider {
  capabilities: SearchCapabilities;
  preload?(scopeId: string): Promise<number>;
  replaceBrowserDocuments?(documents: SearchDocument[]): Promise<number>;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
}

export type EditionDefinition = {
  id: string;
  brand: {
    name: string;
    shortName: string;
    catalogueLabel: string;
    volumeLabel: string;
  };
  storageNamespace: string;
  defaultScopeId: string;
  scopes: CatalogScopeDefinition[];
  browseFacetIds: string[];
  suggestedQueries: string[];
  catalogProvider: CatalogProvider;
  metadataProvider: MetadataProvider;
  contentProvider: ContentProvider;
  searchProvider: SearchProvider;
};
