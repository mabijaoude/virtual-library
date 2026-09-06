import { librarySearchClient } from "../searchClient";
import type { Book, BookDetail, LibraryManifest, SearchCapabilities } from "../types";
import type { CatalogProvider, ContentProvider, MetadataProvider, SearchProvider } from "./types";
import { fetchWithDeadline } from "../fetchWithDeadline";
import { loadBrowserBookContent } from "../browserLibrary";

const STATIC_CAPABILITIES: SearchCapabilities = {
  metadata: true,
  headings: true,
  passages: true,
  phrase: true,
  semantic: false
};

export function createStaticCatalogProvider(url = "/library-manifest.json"): CatalogProvider {
  return {
    async load(_scopeId, signal) {
      const response = await fetchWithDeadline(url, {}, { signal, timeoutMs: 2000, retries: 1 });
      if (!response.ok) throw new Error("Library manifest is missing. Run prepare-library first.");
      return response.json() as Promise<LibraryManifest>;
    }
  };
}

export function createStaticMetadataProvider(baseUrl = "/book-metadata"): MetadataProvider {
  return {
    async load(book, signal) {
      if (book.origin === "browser" && book.sourceHash && book.relativeSourcePath && book.headings && book.sections && book.summary !== undefined) {
        return {
          bookId: book.id,
          sourcePath: book.sourcePath,
          relativeSourcePath: book.relativeSourcePath,
          sourceHash: book.sourceHash,
          headings: book.headings,
          sections: book.sections,
          summary: book.summary,
          summarySource: book.summarySource,
          keySections: book.keySections || []
        };
      }
      const response = await fetchWithDeadline(`${baseUrl}/${encodeURIComponent(book.id)}.json`, {}, { signal, timeoutMs: 6000, retries: 1 });
      if (!response.ok) throw new Error(`Could not load catalogue details for ${book.title}`);
      return response.json() as Promise<BookDetail>;
    }
  };
}

export function createContentProvider(): ContentProvider {
  return {
    async load(book: Book, signal) {
      if (book.origin === "browser" || book.contentUrl.startsWith("indexeddb://")) {
        if (signal?.aborted) throw signal.reason || new DOMException("Book load cancelled", "AbortError");
        return loadBrowserBookContent(book.id);
      }
      const contentVersion = book.contentVersion || book.sourceHash?.slice(0, 16);
      const version = contentVersion ? `${book.contentUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(contentVersion)}` : "";
      const response = await fetchWithDeadline(`${book.contentUrl}${version}`, {}, { signal, timeoutMs: 15000, retries: 1 });
      if (!response.ok) throw new Error(`Could not load ${book.title}`);
      return response.text();
    }
  };
}

export function createStaticSearchProvider(): SearchProvider {
  return {
    capabilities: STATIC_CAPABILITIES,
    preload: () => librarySearchClient.preload(),
    replaceBrowserDocuments: (documents) => librarySearchClient.replaceBrowserDocuments(documents),
    async search(request, signal) {
      return {
        hits: await librarySearchClient.search(request.query, request.limit || 72, signal),
        capabilities: STATIC_CAPABILITIES
      };
    }
  };
}
