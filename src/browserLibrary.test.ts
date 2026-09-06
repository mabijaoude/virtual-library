import { describe, expect, it } from "vitest";
import {
  MAX_BROWSER_BOOK_BYTES,
  MAX_BROWSER_IMPORT_FILES,
  mergeBrowserBooks,
  parseShelfOrganization,
  parseImportedMarkdown,
  planBrowserImport
} from "./browserLibrary";
import type { LibraryManifest } from "./types";

function emptyManifest(): LibraryManifest {
  return {
    version: "base",
    generatedAt: "2026-01-01T00:00:00.000Z",
    editionId: "generic",
    scopeId: "local",
    scopeLabel: "Local Library",
    sourceRoot: "books",
    sourceFileCount: 0,
    rooms: [{ id: "logical-library", label: "Virtual Library", width: 0, depth: 0 }],
    shelves: [],
    books: [],
    facetDefinitions: [
      { id: "authors", label: "Authors" },
      { id: "categories", label: "Categories" },
      { id: "tags", label: "Tags" }
    ]
  };
}

describe("browser Markdown ingestion", () => {
  it("rejects unsupported and oversized browser imports before reading them", () => {
    const files = [
      { name: "notes.txt", size: 100 },
      { name: "oversized.md", size: MAX_BROWSER_BOOK_BYTES + 1 },
      { name: "book.md", size: 1_024 }
    ];
    const plan = planBrowserImport(files);
    expect(plan.accepted).toEqual([files[2]]);
    expect(plan.rejected).toBe(2);
    expect(plan.warnings.join(" ")).toContain("only .md files");
    expect(plan.warnings.join(" ")).toContain("per-book browser limit");
  });

  it("bounds the number and aggregate size of files in one browser import", () => {
    const tooMany = Array.from({ length: MAX_BROWSER_IMPORT_FILES + 1 }, (_, index) => ({ name: `${index}.md`, size: 1 }));
    expect(planBrowserImport(tooMany).rejected).toBe(1);

    const largeFiles = Array.from({ length: 6 }, (_, index) => ({ name: `${index}.md`, size: MAX_BROWSER_BOOK_BYTES }));
    const aggregatePlan = planBrowserImport(largeFiles);
    expect(aggregatePlan.accepted).toHaveLength(5);
    expect(aggregatePlan.rejected).toBe(1);
  });

  it("uses frontmatter and creates searchable browser content", async () => {
    const record = await parseImportedMarkdown("notes.md", `---
title: Field Notes
author: Ada Example
categories: [Science]
collection: Research
---

# Opening

This field notebook records the changing shoreline and the plants found at each marked observation point.
`);
    expect(record.book.title).toBe("Field Notes");
    expect(record.book.author).toBe("Ada Example");
    expect(record.book.origin).toBe("browser");
    expect(record.book.shelfSectionLabel).toBe("Research");
    expect(record.searchDocuments[0].text).toContain("changing shoreline");
  });

  it("falls back to an H1 and unknown author for arbitrary Markdown", async () => {
    const record = await parseImportedMarkdown("anything.md", "# A Useful Note\n\nPlain Markdown is enough to create a book.");
    expect(record.book.title).toBe("A Useful Note");
    expect(record.book.author).toBe("Unknown Author");
    expect(record.book.metadataNeedsReview).toBe(true);
  });

  it("merges browser records and recomputes shelf placement", async () => {
    const first = await parseImportedMarkdown("one.md", "# One\n\nA first document with enough words to appear on a shelf.");
    const second = await parseImportedMarkdown("two.md", "# Two\n\nA second document with different text and a stable position.");
    const merged = mergeBrowserBooks(emptyManifest(), [first, second]);
    expect(merged.sourceFileCount).toBe(2);
    expect(merged.shelves).toHaveLength(9);
    expect(new Set(merged.books.map((book) => `${book.placement.bay}:${book.placement.row}:${book.placement.slot}`)).size).toBe(2);
  });

  it("uses collection names for shelf plaques", async () => {
    const starter = await parseImportedMarkdown("start-here.md", `---
title: Start Here
author: Virtual Library contributors
collection: Start Here
---

# Start Here

Welcome to the library.`);
    const merged = mergeBrowserBooks(emptyManifest(), [starter]);
    expect(merged.shelves[0].label).toBe("Start Here");
  });

  it("applies browser-local shelf names and explicit book destinations", async () => {
    const first = await parseImportedMarkdown("one.md", "# One\n\nA first automatically placed book.");
    const second = await parseImportedMarkdown("two.md", "# Two\n\nA second book that will move across the room.");
    const merged = mergeBrowserBooks(emptyManifest(), [first, second], {
      organization: {
        shelfLabels: { "display-bay-9": "My Research" },
        bookShelfIds: { [second.id]: "display-bay-9" }
      }
    });

    expect(merged.shelves[8].label).toBe("My Research");
    expect(merged.books.find((book) => book.id === second.id)?.placement.shelfId).toBe("display-bay-9");
    expect(merged.books.find((book) => book.id === first.id)?.placement.shelfId).toBe("display-bay-1");
  });

  it("sanitizes stored shelf organization and recovers from invalid data", () => {
    expect(parseShelfOrganization("not json")).toEqual({ shelfLabels: {}, bookShelfIds: {} });
    expect(parseShelfOrganization(JSON.stringify({
      shelfLabels: { "display-bay-1": "  Start   Here  ", "display-bay-2": 42 },
      bookShelfIds: { "book-1": "display-bay-4", "book-2": "somewhere-else" }
    }))).toEqual({
      shelfLabels: { "display-bay-1": "Start Here" },
      bookShelfIds: { "book-1": "display-bay-4" }
    });
  });

  it("can remove the bundled starter book while preserving browser imports", async () => {
    const starter = await parseImportedMarkdown("starter.md", "# Starter\n\nA bundled guide for a new library.");
    const personal = await parseImportedMarkdown("personal.md", "# Personal Book\n\nA visitor-owned browser book.");
    const starterManifest = emptyManifest();
    starterManifest.books = [{ ...starter.book, id: "starter", origin: "bundled" }];
    starterManifest.sourceFileCount = 1;

    const visible = mergeBrowserBooks(starterManifest, [personal]);
    const hidden = mergeBrowserBooks(starterManifest, [personal], { hideBundledBooks: true });

    expect(visible.books.map((book) => book.id)).toContain("starter");
    expect(hidden.books.map((book) => book.id)).toEqual([personal.id]);
    expect(hidden.books[0].origin).toBe("browser");
    expect(hidden.sourceFileCount).toBe(1);
    expect(hidden.version).not.toBe(visible.version);
  });
});
