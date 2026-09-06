/// <reference lib="webworker" />

import MiniSearch from "minisearch";
import type { SearchPassageHit, SearchWorkerRequest, SearchWorkerResponse } from "./types";

type SearchManifest = {
  version: number;
  documentCount: number;
  shards: Array<{ id: number; url: string; bookCount: number; documentCount: number }>;
};

const indexOptions = {
  idField: "id",
  fields: ["title", "author", "facets", "sectionTitle", "text"],
  storeFields: ["id", "bookId", "title", "author", "sectionTitle", "headingOrder", "position", "preview"]
};

let loading: Promise<void> | undefined;
let indexes: MiniSearch[] = [];
let documentCount = 0;
let browserIndex: MiniSearch | undefined;
let browserDocumentCount = 0;

function ensureLoaded(): Promise<void> {
  if (loading) return loading;
  loading = fetch("/library-search-manifest.json")
    .then((response) => {
      if (!response.ok) throw new Error("The search manifest could not be loaded.");
      return response.json() as Promise<SearchManifest>;
    })
    .then(async (manifest) => {
      documentCount = manifest.documentCount;
      const payloads = await Promise.all(manifest.shards.map(async (shard) => {
        const response = await fetch(shard.url);
        if (!response.ok) throw new Error(`Search shard ${shard.id} could not be loaded.`);
        return response.json() as Promise<{ index: unknown }>;
      }));
      indexes = payloads.map((payload) => MiniSearch.loadJSON(JSON.stringify(payload.index), indexOptions));
    })
    .catch((error) => {
      loading = undefined;
      indexes = [];
      documentCount = 0;
      throw error;
    });
  return loading;
}

function normalizeQuery(value: string) {
  return value.trim().replace(/"/g, "").replace(/\s+/g, " ");
}

function searchPassages(query: string, limit: number): SearchPassageHit[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  const lower = normalized.toLowerCase();
  const merged = new Map<string, SearchPassageHit>();
  for (const index of [...indexes, ...(browserIndex ? [browserIndex] : [])]) {
    const metadataResults = index.search(normalized, {
      fields: ["title", "author", "facets", "sectionTitle"],
      boost: { title: 18, author: 8, facets: 5, sectionTitle: 10 },
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 0.16 : false),
      combineWith: "AND"
    });
    for (const result of metadataResults.slice(0, Math.max(limit * 2, 80))) {
      const title = String(result.title || "");
      const author = String(result.author || "");
      const sectionTitle = String(result.sectionTitle || "Opening");
      const titleLower = title.toLowerCase();
      const authorLower = author.toLowerCase();
      const fields = matchedFields(result.match);
      if (fields.has("title")) {
        const exactTitle = titleLower === lower ? 2400 : titleLower.startsWith(lower) ? 1600 : titleLower.includes(lower) ? 1000 : 0;
        mergeHit(merged, {
          id: `title:${result.bookId}`,
          bookId: String(result.bookId),
          score: result.score + exactTitle,
          kind: "title",
          title,
          author,
          topic: "",
          sectionTitle: "Title",
          headingOrder: 0,
          position: 0,
          text: `${title} - ${author}`
        });
      }
      if (fields.has("author")) {
        const exactAuthor = authorLower === lower ? 800 : authorLower.includes(lower) ? 240 : 0;
        mergeHit(merged, {
          id: `author:${result.bookId}`,
          bookId: String(result.bookId),
          score: result.score + exactAuthor,
          kind: "author",
          title,
          author,
          topic: "",
          sectionTitle: "Author",
          headingOrder: 0,
          position: 0,
          text: `${author} - ${title}`
        });
      }
      if (fields.has("sectionTitle")) {
        mergeHit(merged, {
          id: `heading:${result.bookId}:${result.headingOrder || 0}`,
          bookId: String(result.bookId),
          score: result.score + (sectionTitle.toLowerCase().includes(lower) ? 420 : 0),
          kind: "heading",
          title,
          author,
          topic: "",
          sectionTitle,
          headingOrder: Number(result.headingOrder || 0),
          position: Number(result.position || 0),
          text: String(result.preview || sectionTitle)
        });
      }
      if (fields.has("facets")) {
        mergeHit(merged, {
          id: `metadata:${result.bookId}`,
          bookId: String(result.bookId),
          score: result.score,
          kind: "metadata",
          title,
          author,
          topic: "",
          sectionTitle: "Catalogue",
          headingOrder: 0,
          position: 0,
          text: `${title} - ${author}`
        });
      }
    }

    const contentResults = index.search(normalized, {
      fields: ["text"],
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 0.16 : false),
      combineWith: "AND"
    });
    for (const result of contentResults.slice(0, Math.max(limit * 2, 80))) {
      mergeHit(merged, {
        id: `content:${result.id}`,
        bookId: String(result.bookId),
        score: result.score,
        kind: "content",
        title: String(result.title || ""),
        author: String(result.author || ""),
        topic: "",
        sectionTitle: String(result.sectionTitle || "Opening"),
        headingOrder: Number(result.headingOrder || 0),
        position: Number(result.position || 0),
        text: String(result.preview || result.sectionTitle || "Opening")
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}

function matchedFields(match: unknown): Set<string> {
  if (!match || typeof match !== "object") return new Set();
  return new Set(Object.values(match as Record<string, string[]>).flat());
}

function mergeHit(hits: Map<string, SearchPassageHit>, hit: SearchPassageHit) {
  const previous = hits.get(hit.id);
  if (!previous || hit.score > previous.score) hits.set(hit.id, hit);
}

self.addEventListener("message", async (event: MessageEvent<SearchWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "replace-browser-documents") {
      const documents = request.documents || [];
      browserIndex = new MiniSearch(indexOptions);
      browserIndex.addAll(documents);
      browserDocumentCount = documents.length;
      const response: SearchWorkerResponse = { id: request.id, type: "ready", documentCount: documentCount + browserDocumentCount };
      self.postMessage(response);
      return;
    }
    await ensureLoaded();
    if (request.type === "preload") {
      const response: SearchWorkerResponse = { id: request.id, type: "ready", documentCount: documentCount + browserDocumentCount };
      self.postMessage(response);
      return;
    }
    const response: SearchWorkerResponse = {
      id: request.id,
      type: "results",
      results: searchPassages(request.query || "", request.limit || 72),
      documentCount: documentCount + browserDocumentCount
    };
    self.postMessage(response);
  } catch (error) {
    const response: SearchWorkerResponse = {
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(response);
  }
});

export {};
