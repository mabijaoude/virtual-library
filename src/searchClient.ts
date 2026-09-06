import type { SearchDocument, SearchPassageHit, SearchWorkerRequest, SearchWorkerResponse } from "./types";

type PendingRequest = {
  resolve: (response: SearchWorkerResponse) => void;
  reject: (reason: Error) => void;
  cleanup?: () => void;
};

class LibrarySearchClient {
  private worker?: Worker;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();

  preload(): Promise<number> {
    return this.send({ type: "preload" }).then((response) => response.documentCount || 0);
  }

  search(query: string, limit = 72, signal?: AbortSignal): Promise<SearchPassageHit[]> {
    return this.send({ type: "search", query, limit }, signal).then((response) => response.results || []);
  }

  replaceBrowserDocuments(documents: SearchDocument[]): Promise<number> {
    return this.send({ type: "replace-browser-documents", documents }).then((response) => response.documentCount || 0);
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event: MessageEvent<SearchWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      pending.cleanup?.();
      if (response.type === "error") pending.reject(new Error(response.message || "Search failed."));
      else pending.resolve(response);
    });
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "The search worker stopped unexpectedly.");
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = undefined;
    });
    return this.worker;
  }

  private send(request: Omit<SearchWorkerRequest, "id">, signal?: AbortSignal): Promise<SearchWorkerResponse> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Search cancelled", "AbortError"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) });
      this.getWorker().postMessage({ ...request, id } satisfies SearchWorkerRequest);
    });
  }
}

export const librarySearchClient = new LibrarySearchClient();
