import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanMarkdownForReader, deepSearchGroups, formatHeadingTitle, highlightSnippet, parseQuery, passageHitsToGroups, readerFindIndexForPosition, sectionForPosition } from "./library";
import type { Book } from "./types";

function book(overrides: Partial<Book>): Book {
  return {
    id: overrides.id || "book-1",
    slug: overrides.slug || overrides.id || "book-1",
    title: overrides.title || "Test Book",
    author: overrides.author || "Ada Example",
    authors: overrides.authors || [{ id: "ada-example", name: overrides.author || "Ada Example" }],
    year: overrides.year || 1999,
    type: "book",
    sourcePath: "books/Test.md",
    relativeSourcePath: "books/Test.md",
    sourceFormat: "markdown",
    sourceHash: "hash",
    contentUrl: overrides.contentUrl || "/book-content/test.md",
    headings: overrides.headings || [{ id: "chapter", title: "Archives and Memory", level: 2, order: 1 }],
    headingCount: overrides.headingCount || 1,
    sections: overrides.sections || [
      {
        id: "chapter-1",
        title: "Archives and Memory",
        level: 2,
        headingOrder: 1,
        position: 0,
        wordCount: 200,
        excerpt: "Archives and Memory"
      }
    ],
    wordCount: overrides.wordCount || 1000,
    excerpt: overrides.excerpt || "A short catalogue excerpt about archives.",
    summary: overrides.summary || "A fuller summary paragraph about the book and its major argument.",
    topics: overrides.topics || ["Archives"],
    tags: overrides.tags || [],
    categories: overrides.categories || ["Archives"],
    facets: overrides.facets || { authors: [overrides.author || "Ada Example"], categories: ["Archives"], tags: [] },
    shelfSectionId: overrides.shelfSectionId || "ada-example",
    shelfSectionLabel: overrides.shelfSectionLabel || "Ada Example",
    metadataNeedsReview: false,
    placement: overrides.placement || {
      documentId: "book-1",
      shelfId: "display-bay-1",
      bay: 0,
      row: 0,
      slot: 0,
      width: 0.1,
      height: 1,
      depth: 0.45,
      accentColor: "#c7a34a",
      shelfSectionId: "ada-example",
      importanceScore: 1
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("highlightSnippet", () => {
  it("highlights phrase and individual query terms", () => {
    const parts = highlightSnippet("There is many a slip twix cup and lip in the old saying.", parseQuery("twix cup and lip"));
    expect(parts.some((part) => part.highlight && part.text.toLowerCase().includes("twix cup and lip"))).toBe(true);
  });

  it("does not highlight short terms inside larger words", () => {
    const parts = highlightSnippet("Phillip wrote about the slip between cup and lip.", parseQuery("twix cup and lip"));
    const highlighted = parts.filter((part) => part.highlight).map((part) => part.text.toLowerCase());
    expect(highlighted).toContain("cup");
    expect(highlighted).toContain("lip");
    expect(parts.some((part) => part.highlight && part.text.toLowerCase().includes("phillip"))).toBe(false);
  });
});

describe("reader anchors", () => {
  it("maps a body position to the nearest generated section", () => {
    const sample = book({
      sections: [
        { id: "intro", title: "Introduction", level: 1, headingOrder: 0, position: 0, wordCount: 20, excerpt: "Intro" },
        { id: "archive", title: "Archives and Memory", level: 2, headingOrder: 2, position: 100, wordCount: 40, excerpt: "Archives" }
      ]
    });

    expect(sectionForPosition(sample, 140)?.headingOrder).toBe(2);
  });

  it("computes the highlighted reader mark nearest a search position", () => {
    const text = "Coastal archive first. More text. Coastal archive target.";
    expect(readerFindIndexForPosition(text, parseQuery("Coastal archive"), text.lastIndexOf("Coastal"))).toBe(1);
  });

  it("can resolve anchors beyond the bounded search-preview scan", () => {
    const text = Array.from({ length: 120 }, (_, index) => `coastal observation ${index}`).join("\n");
    expect(readerFindIndexForPosition(text, parseQuery("coastal observation"), text.lastIndexOf("coastal"), true)).toBe(119);
  });
});

describe("cleanMarkdownForReader", () => {
  it("removes YAML frontmatter before rendering the reader", () => {
    const markdown = `---\ntitle: \"A Book\"\nsource_pdf: \"source.pdf\"\n---\n\n# Chapter One\n\nReadable text.`;
    expect(cleanMarkdownForReader(markdown)).toBe("# Chapter One\n\nReadable text.");
  });

  it("adds stable reader anchors when book headings are provided", () => {
    const markdown = `---\ntitle: \"A Book\"\n---\n\n# Chapter One\n\n## Section Two`;
    const rendered = cleanMarkdownForReader(markdown, [
      { id: "chapter-one", title: "Chapter One", level: 1, order: 0 },
      { id: "section-two", title: "Section Two", level: 2, order: 1 }
    ]);

    expect(rendered).toContain('<h1 id="reader-heading-0">Chapter One</h1>');
    expect(rendered).toContain('<h2 id="reader-heading-1">Section Two</h2>');
  });

  it("normalizes OCR-style spaced all-caps headings for display", () => {
    expect(formatHeadingTitle("T HE A RCHIVE AND M EMORY")).toBe("The Archive and Memory");
    expect(formatHeadingTitle("A TREATISE ON C OASTAL E COLOGY WITH")).toBe("A Treatise on Coastal Ecology with");
    expect(formatHeadingTitle("1 F UNDAMENTALS OF F IELD R ESEARCH [1]")).toBe("1 Fundamentals of Field Research [1]");
  });
});

describe("deepSearchGroups", () => {
  it("returns grouped passage matches with counts and highlighted snippets", async () => {
    const books = [
      book({
        id: "archive",
        title: "Field Notes",
        contentUrl: "/archive.md"
      }),
      book({
        id: "garden",
        title: "The Winter Garden",
        contentUrl: "/garden.md"
      })
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          url.includes("archive")
            ? "The coastal archive appears here. Later the coastal archive appears again beside the lighthouse."
            : "This book mentions garden cycles but not the target phrase."
      }))
    );

    const groups = await deepSearchGroups(books, "coastal archive");
    expect(groups[0].book.title).toBe("Field Notes");
    expect(groups[0].matchCount).toBeGreaterThanOrEqual(2);
    expect(groups[0].matches[0].parts.some((part) => part.highlight && /coastal archive/i.test(part.text))).toBe(true);
    expect(groups[0].matches[0].headingOrder).toBe(1);
    expect(groups[0].matches[0].findIndex).toBeTypeOf("number");
  });

  it("falls back to useful partial body matches for over-specific phrase queries", async () => {
    const books = [
      book({
        id: "proverb",
        title: "Collected Harbour Proverbs",
        contentUrl: "/proverb.md"
      })
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "There was a considerable slip, however, 'twixt order and execution."
      }))
    );

    const groups = await deepSearchGroups(books, "Twix cup and lip");
    expect(groups[0]?.book.id).toBe("proverb");
    expect(groups[0]?.matches[0].snippet.toLowerCase()).toContain("twixt");
  });
});

describe("passageHitsToGroups", () => {
  it("keeps a late passage match visible without moving its reader target", () => {
    const source = book({ id: "late-match" });
    const groups = passageHitsToGroups([source], [{
      id: "passage", bookId: source.id, score: 100, title: "", author: "", topic: "",
      sectionTitle: "Opening", headingOrder: 0, position: 420,
      text: `${"A long opening paragraph. ".repeat(30)}The observatory overlooks the harbor.`
    }], "observatory");
    const match = groups[0].matches[0];
    expect(match.parts.some((part) => part.highlight && part.text === "observatory")).toBe(true);
    expect(match.snippet.indexOf("observatory")).toBeLessThan(80);
    expect(match.snippet.length).toBeLessThanOrEqual(242);
    expect(match.position).toBe(420);
  });
  it("groups worker hits by the strongest passage instead of rewarding repetition", () => {
    const primary = book({ id: "primary", title: "Primary Source" });
    const repeated = book({ id: "repeated", title: "Repeated Source" });
    const groups = passageHitsToGroups(
      [primary, repeated],
      [
        { id: "primary-1", bookId: "primary", score: 120, title: "", author: "", topic: "", sectionTitle: "Opening", headingOrder: 0, position: 0, text: "Individual valuation is the keystone." },
        { id: "repeat-1", bookId: "repeated", score: 80, title: "", author: "", topic: "", sectionTitle: "One", headingOrder: 0, position: 10, text: "Individual valuation appears." },
        { id: "repeat-2", bookId: "repeated", score: 75, title: "", author: "", topic: "", sectionTitle: "Two", headingOrder: 1, position: 20, text: "Valuation appears again." }
      ],
      "individual valuation"
    );
    expect(groups[0].book.id).toBe("primary");
    expect(groups[1].matchCount).toBe(2);
  });
});
