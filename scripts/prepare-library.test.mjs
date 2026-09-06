import { describe, expect, it } from "vitest";
import { buildLayout, sanitizePassageText, summaryFrom } from "./prepare-library.mjs";

function books(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `book-${index}`,
    title: `Book ${index}`,
    author: "Example Author",
    year: 1900 + index,
    wordCount: 1000 + index * 100,
    shelfSectionId: "example-author",
    shelfSectionLabel: "Example Author"
  }));
}

describe("buildLayout", () => {
  it("keeps nine logical bays at five rows and fourteen slots", () => {
    const shelves = buildLayout([]);
    expect(shelves).toHaveLength(9);
    expect(shelves.every((shelf) => shelf.rows === 5 && shelf.slotsPerRow === 14 && shelf.capacity === 70)).toBe(true);
    expect(shelves.every((shelf) => shelf.occupiedRows.length === 0)).toBe(true);
  });

  it("packs forty-two volumes into three complete center-first rows in one bay", () => {
    const sourceBooks = books(42);
    const shelves = buildLayout(sourceBooks);
    expect(shelves[0].occupiedRows).toEqual([1, 2, 3]);
    expect(shelves.slice(1).every((shelf) => shelf.occupiedRows.length === 0)).toBe(true);
    expect(new Set(sourceBooks.map((book) => `${book.placement.bay}:${book.placement.row}:${book.placement.slot}`)).size).toBe(42);
  });

  it("uses the collection as the default shelf title", () => {
    const sourceBooks = books(1);
    sourceBooks[0].shelfSectionId = "start-here";
    sourceBooks[0].shelfSectionLabel = "Start Here";
    const shelves = buildLayout(sourceBooks);
    expect(shelves[0].label).toBe("Start Here");
  });

  it("creates a numbered annex after the base 630-volume capacity", () => {
    const sourceBooks = books(631);
    const shelves = buildLayout(sourceBooks);
    expect(shelves).toHaveLength(10);
    expect(shelves[9].label).toBe("Annex Bay I");
  });
});

describe("summaryFrom", () => {
  it("skips promotional front matter and uses an unmarked introduction", () => {
    const source = `---
title: Example
---

READER NEWS

Visit our website and join our mailing list for free articles, videos, and podcasts.

The publisher thanks its generous supporters. This paragraph is deliberately long enough to look substantive but remains promotional boilerplate.

Introduction

This book explains how communities preserve knowledge and why durable archives matter across generations. It gives the reader a direct map of the argument before developing its historical applications.

A second substantive paragraph develops the central thesis with enough detail to serve as useful catalogue copy rather than publication metadata or donor acknowledgments.

Chapter One

Later body text belongs outside the summary.`;
    const summary = summaryFrom(source);
    expect(summary.source).toBe("introduction");
    expect(summary.text).toContain("communities preserve knowledge");
    expect(summary.text).not.toMatch(/mailing list|supporters/i);
  });

  it("removes promotional material from searchable opening passages", () => {
    const passage = "Visit our website for free articles and join our mailing list. Use this QR code for details. Contents Foreword Introduction This is the actual searchable opening of the work.";
    const cleaned = sanitizePassageText(passage);
    expect(cleaned).toBe("Contents Foreword Introduction This is the actual searchable opening of the work.");
  });

  it("removes publication-license sentences before substantive opening copy", () => {
    const source = "© 2020 by Example Press and published under the Creative Commons Attribution License 4.0. http://creativecommons.org/licenses/by/4.0/ The archive began as a community effort to preserve regional oral histories. This opening develops that story and gives readers useful context for the chapters that follow.";
    const summary = summaryFrom(source);
    expect(summary.text).toContain("archive began as a community effort");
    expect(summary.text).not.toMatch(/creative commons|creativecommons|©/i);
  });
});
