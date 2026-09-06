import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLibraryCatalog, listMarkdownFiles, parseMatterSafely, parseSourceMetadata, resolveLibrarySource } from "./prepare-library.mjs";

let sourceRoot;

beforeEach(async () => {
  sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "virtual-library-ingest-"));
});

afterEach(async () => {
  await fs.rm(sourceRoot, { recursive: true, force: true });
});

describe("Markdown ingestion", () => {
  it("discovers nested Markdown and honors frontmatter before H1 and filename metadata", async () => {
    const nested = path.join(sourceRoot, "essays");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, "Ignored - Name - Filename Title - 1999.md"), `---
title: Frontmatter Title
authors:
  - Jane Scholar
categories: [History]
tags: [Archives, Research]
summary: This is a sufficiently detailed frontmatter summary for the catalogue and reader inspector.
---
# Heading Title

A substantive opening paragraph about archives and institutions.`, "utf8");
    await fs.writeFile(path.join(sourceRoot, "Smith - John - Filename Fallback - 1984.md"), "A book with no frontmatter and no heading still belongs in the library.", "utf8");

    const { manifest } = await buildLibraryCatalog({ sourceRoot, copyContent: false, includePassages: false });

    expect(manifest.sourceFileCount).toBe(2);
    const frontmatterBook = manifest.books.find((book) => book.title === "Frontmatter Title");
    expect(frontmatterBook.author).toBe("Jane Scholar");
    expect(frontmatterBook.facets.categories).toEqual(["History"]);
    expect(frontmatterBook.facets.tags).toEqual(["Archives", "Research"]);
    expect(manifest.books.some((book) => book.title === "Filename Fallback" && book.author === "John Smith")).toBe(true);
    expect(manifest.facetDefinitions.map((facet) => facet.id)).toEqual(["authors", "categories", "tags"]);
  });

  it("keeps duplicate stems in different folders as distinct stable books", async () => {
    await fs.mkdir(path.join(sourceRoot, "one"));
    await fs.mkdir(path.join(sourceRoot, "two"));
    await fs.writeFile(path.join(sourceRoot, "one", "Shared.md"), "# First Edition\n\nFirst body.", "utf8");
    await fs.writeFile(path.join(sourceRoot, "two", "Shared.md"), "# Second Edition\n\nSecond body.", "utf8");

    const first = await buildLibraryCatalog({ sourceRoot, includePassages: false });
    const second = await buildLibraryCatalog({ sourceRoot, includePassages: false });
    expect(new Set(first.manifest.books.map((book) => book.id)).size).toBe(2);
    expect(first.manifest.books.map((book) => book.id).sort()).toEqual(second.manifest.books.map((book) => book.id).sort());
  });

  it("survives malformed YAML and marks inferred metadata for review", () => {
    const raw = "---\ntitle: Broken\nyear: 2020duplicate_field: value\n---\n# Recovered Heading\n\nBody text.";
    expect(parseMatterSafely(raw).parseError).toBe(true);
    const parsed = parseSourceMetadata("Author - Alice - Filename Title - 2020.md", raw);
    expect(parsed.title).toBe("Recovered Heading");
    expect(parsed.metadataNeedsReview).toBe(true);
  });

  it("generates an honest empty nine-bay library", async () => {
    const { manifest } = await buildLibraryCatalog({ sourceRoot, includePassages: false });
    expect(manifest.books).toEqual([]);
    expect(manifest.shelves).toHaveLength(9);
    expect(manifest.shelves.every((shelf) => shelf.occupiedRows.length === 0)).toBe(true);
  });

  it("uses the bundled starter book only while the configured collection is empty", async () => {
    const booksRoot = path.join(sourceRoot, "books");
    const examplesRoot = path.join(sourceRoot, "examples");
    await fs.mkdir(examplesRoot);
    await fs.writeFile(path.join(examplesRoot, "start-here.md"), "# Start Here\n\nWelcome to the library.", "utf8");

    const starter = await resolveLibrarySource({ projectRoot: sourceRoot, contentRootSetting: "books" });
    expect(starter.usingBundledExamples).toBe(true);
    expect(starter.sourceRoot).toBe(examplesRoot);
    expect(starter.sourceRootLabel).toBe("examples");
    expect(await listMarkdownFiles(starter.sourceRoot)).toHaveLength(1);
    const starterCatalog = await buildLibraryCatalog({
      sourceRoot: starter.sourceRoot,
      sourceRootLabel: starter.sourceRootLabel,
      bookOrigin: starter.usingBundledExamples ? "bundled" : undefined,
      includePassages: false
    });
    expect(starterCatalog.manifest.books.every((book) => book.origin === "bundled")).toBe(true);

    await fs.writeFile(path.join(booksRoot, "owner-book.md"), "# Owner Book\n\nThe configured collection takes priority.", "utf8");
    const configured = await resolveLibrarySource({ projectRoot: sourceRoot, contentRootSetting: "books" });
    expect(configured.usingBundledExamples).toBe(false);
    expect(configured.sourceRoot).toBe(booksRoot);
    expect(configured.sourceRootLabel).toBe("books");
    expect(await listMarkdownFiles(configured.sourceRoot)).toHaveLength(1);
    const ownerCatalog = await buildLibraryCatalog({
      sourceRoot: configured.sourceRoot,
      sourceRootLabel: configured.sourceRootLabel,
      bookOrigin: configured.usingBundledExamples ? "bundled" : undefined,
      includePassages: false
    });
    expect(ownerCatalog.manifest.books[0].origin).toBeUndefined();
  });
});
