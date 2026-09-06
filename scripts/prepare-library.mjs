import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import MiniSearch from "minisearch";
import { createBookDetail, createCatalogSummary } from "./catalog-shapes.mjs";

const root = process.cwd();
const publicRoot = path.join(root, "public");
const manifestPath = path.join(publicRoot, "library-manifest.json");
const searchManifestPath = path.join(publicRoot, "library-search-manifest.json");
const searchRoot = path.join(publicRoot, "library-search-shards");
const contentRoot = path.join(publicRoot, "book-content");
const metadataRoot = path.join(publicRoot, "book-metadata");
const SHELF_ROWS = 5;
const SLOTS_PER_ROW = 14;
const PREFERRED_ROWS = [2, 1, 3, 0, 4];
const BASE_BAY_COUNT = 9;
const SEARCH_BOOKS_PER_SHARD = 40;
const SEARCH_CHUNK_SIZE = 1800;
const SEARCH_CHUNK_OVERLAP = 180;

export const GENERIC_FACETS = [
  { id: "authors", label: "Authors", color: "#4f86a8" },
  { id: "categories", label: "Categories", color: "#b78936" },
  { id: "tags", label: "Tags", color: "#778b61" }
];

const SECTION_COLORS = ["#b78936", "#4f86a8", "#a9575d", "#6f8d5d", "#8267a8", "#d17845", "#7d8e9c", "#b36f8c", "#907451"];

export async function listMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(fullPath)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(fullPath);
  }
  return files;
}

export async function resolveLibrarySource({
  projectRoot = root,
  contentRootSetting = process.env.LIBRARY_CONTENT_ROOT || "books"
} = {}) {
  const configuredSourceRoot = path.resolve(projectRoot, contentRootSetting);
  await fs.mkdir(configuredSourceRoot, { recursive: true });
  const configuredFiles = await listMarkdownFiles(configuredSourceRoot);
  const usingBundledExamples = configuredFiles.length === 0;
  const sourceRoot = usingBundledExamples ? path.join(projectRoot, "examples") : configuredSourceRoot;
  const sourceRootLabel = usingBundledExamples
    ? "examples"
    : path.isAbsolute(contentRootSetting)
      ? path.basename(configuredSourceRoot)
      : contentRootSetting.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");

  if (usingBundledExamples) {
    const starterFiles = await listMarkdownFiles(sourceRoot);
    if (!starterFiles.length) {
      throw new Error(`No Markdown books were found in ${configuredSourceRoot} and the bundled examples directory is empty.`);
    }
  }

  return { sourceRoot, sourceRootLabel, configuredSourceRoot, usingBundledExamples };
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function cleanInlineMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMatterSafely(raw) {
  try {
    return { ...matter(raw), parseError: false };
  } catch (error) {
    matter.clearCache?.();
    const frontmatterBlock = raw.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/);
    return {
      data: {},
      content: frontmatterBlock ? raw.slice(frontmatterBlock[0].length) : raw,
      parseError: true,
      error
    };
  }
}

function firstHeading(raw) {
  const match = parseMatterSafely(raw).content.match(/^#\s+(.+)$/m);
  return match ? cleanInlineMarkdown(match[1]) : "";
}

function asList(value) {
  if (Array.isArray(value)) return value.map(cleanInlineMarkdown).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string" && value.includes(",")) return value.split(",").map(cleanInlineMarkdown).filter(Boolean);
  return [cleanInlineMarkdown(value)].filter(Boolean);
}

function structuredFilename(stem) {
  const parts = stem.split(" - ");
  if (parts.length < 3) return {};
  const surname = parts[0]?.trim();
  const given = parts[1]?.trim();
  const last = parts[parts.length - 1]?.trim();
  const yearMatch = last.match(/\b(18|19|20)\d{2}\b/);
  return {
    author: [given, surname].filter(Boolean).join(" "),
    title: (yearMatch ? parts.slice(2, -1) : parts.slice(2)).join(" - ").trim(),
    year: yearMatch ? Number(yearMatch[0]) : undefined,
    complete: Boolean(yearMatch)
  };
}

export function parseSourceMetadata(filePath, raw, authorAliases = new Map()) {
  const stem = path.basename(filePath, ".md");
  const parsed = parseMatterSafely(raw);
  const data = parsed.data || {};
  const filename = structuredFilename(stem);
  const headingTitle = firstHeading(raw);
  const rawAuthors = asList(data.authors ?? data.author);
  const inferredAuthor = filename.author || "Unknown Author";
  const authors = (rawAuthors.length ? rawAuthors : [inferredAuthor]).map((author) => authorAliases.get(author) || author);
  const categories = asList(data.categories ?? data.category);
  const tags = asList(data.tags ?? data.tag);
  const collections = asList(data.collections ?? data.collection ?? data.shelf);
  const yearValue = Number(data.year);
  return {
    stem,
    title: cleanInlineMarkdown(data.title || headingTitle || filename.title || stem),
    authors,
    author: authors[0] || "Unknown Author",
    year: Number.isInteger(yearValue) && yearValue > 0 ? yearValue : filename.year,
    categories,
    tags,
    collections,
    explicitSummary: cleanInlineMarkdown(data.summary || data.description || data.synopsis || ""),
    metadataNeedsReview: parsed.parseError || !data.title && !headingTitle && !filename.title || authors[0] === "Unknown Author" || !filename.complete && !data.year
  };
}

export function extractHeadings(raw) {
  const headings = [];
  const content = parseMatterSafely(raw).content;
  const matches = content.matchAll(/^(#{1,6})\s+(.+)$/gm);
  for (const match of matches) {
    const text = cleanInlineMarkdown(match[2]);
    if (!text) continue;
    headings.push({ id: slugify(text), title: text, level: match[1].length, order: headings.length });
    if (headings.length >= 120) break;
  }
  return headings;
}

export function getPlainText(raw) {
  return cleanInlineMarkdown(
    parseMatterSafely(raw).content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/!\[[^\]]*]\([^)]+\)/g, "")
      .replace(/^#{1,6}\s+/gm, "")
  );
}

export function countWords(value) {
  return (String(value || "").match(/\b[\w'’-]+\b/g) || []).length;
}

function sectionExcerpt(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 360);
}

export function extractSections(raw, headings, plainText) {
  const text = plainText || getPlainText(raw);
  if (!headings.length) {
    return [{ id: "opening", title: "Opening", level: 1, headingOrder: 0, position: 0, wordCount: countWords(text), excerpt: sectionExcerpt(text) }];
  }
  const lower = text.toLowerCase();
  const positions = [];
  let cursor = 0;
  for (const heading of headings) {
    const needle = cleanInlineMarkdown(heading.title).toLowerCase();
    const found = needle ? lower.indexOf(needle, cursor) : -1;
    const position = found >= 0 ? found : cursor;
    positions.push(position);
    cursor = Math.max(cursor, position + needle.length);
  }
  return headings.map((heading, index) => {
    const start = positions[index];
    const end = positions[index + 1] ?? text.length;
    const sectionText = text.slice(start, end).trim();
    return {
      id: `${heading.id}-${heading.order}`,
      title: heading.title,
      level: heading.level,
      headingOrder: heading.order,
      position: start,
      wordCount: countWords(sectionText),
      excerpt: sectionExcerpt(sectionText)
    };
  });
}

function substantiveParagraphs(raw) {
  return parseMatterSafely(raw).content
    .split(/\r?\n\s*\r?\n/)
    .map(cleanInlineMarkdown)
    .map(stripSummaryBoilerplate)
    .filter((text) => text.length > 120)
    .filter((text) => !/^(contents|index|copyright|cover art|permission|all rights reserved|isbn|published by|about the publisher)/i.test(text))
    .filter((text) => !/(no part of this (?:book|publication)|may be reproduced|printed in the united states)/i.test(text))
    .filter((text) => !/(subscribe to (?:our|the)|join (?:our|the) mailing list|visit (?:our|the) (?:website|site)|scan|use this qr code|donate|generous supporters)/i.test(text));
}

function stripSummaryBoilerplate(text) {
  const sentences = text.replace(/https?:\/\/\S+/gi, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return sentences
    .filter((sentence) => !/^\s*(?:©|\(c\)|copyright\b|isbn\b|published by\b|permission\b)/i.test(sentence))
    .filter((sentence) => !/(creative commons|all rights reserved|licensed under|attribution license|may be reproduced|printing history)/i.test(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summaryFrom(raw, explicitSummary = "") {
  if (explicitSummary.length > 40) return { text: explicitSummary.slice(0, 900), source: "frontmatter" };
  const content = parseMatterSafely(raw).content;
  const introduction = content.match(/^#{1,4}\s+(?:introduction|preface|foreword|prologue|opening remarks?)\s*$([\s\S]*?)(?=^#{1,4}\s+|$)/im);
  const blocks = content.split(/\r?\n\s*\r?\n/);
  const unmarkedIntroductionIndex = blocks.findIndex((block) => /^(?:introduction|preface|foreword|prologue|opening remarks?)$/i.test(cleanInlineMarkdown(block)));
  const introductionBody = introduction?.[1] || (unmarkedIntroductionIndex >= 0 ? blocks.slice(unmarkedIntroductionIndex + 1).join("\n\n") : "");
  const introductionParagraphs = introductionBody ? substantiveParagraphs(introductionBody) : [];
  if (introductionParagraphs.length) return { text: introductionParagraphs.slice(0, 2).join(" ").slice(0, 900), source: "introduction" };
  const paragraphs = substantiveParagraphs(raw);
  return { text: (paragraphs.slice(0, 2).join(" ") || getPlainText(raw)).slice(0, 900), source: "extractive" };
}

function excerptFrom(raw) {
  const paragraphs = substantiveParagraphs(raw);
  return (paragraphs[0] || getPlainText(raw)).slice(0, 520);
}

function mapRange(value, min, max, outMin, outMax) {
  if (max <= min) return (outMin + outMax) / 2;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return outMin + ratio * (outMax - outMin);
}

function lastName(author) {
  const words = String(author || "Unknown").trim().split(/\s+/);
  return words[words.length - 1] || "Unknown";
}

function authorRange(books) {
  const authors = Array.from(new Set(books.map((book) => book.author || "Unknown Author"))).sort((a, b) => lastName(a).localeCompare(lastName(b)) || a.localeCompare(b));
  if (!authors.length) return "Reserve";
  if (authors.length === 1) return authors[0];
  return `${lastName(authors[0])}–${lastName(authors[authors.length - 1])}`;
}

export function buildLayout(books, { sectionOrder = [], shelfLabelMode = "sections" } = {}) {
  const wordCounts = books.map((book) => book.wordCount);
  const minWords = wordCounts.length ? Math.min(...wordCounts) : 0;
  const maxWords = wordCounts.length ? Math.max(...wordCounts) : 1;
  const capacity = SHELF_ROWS * SLOTS_PER_ROW;
  const requiredBayCount = Math.max(BASE_BAY_COUNT, Math.ceil(books.length / capacity));
  const sectionRank = new Map(sectionOrder.map((section, index) => [section, index]));
  const orderedBooks = [...books].sort((a, b) =>
    (sectionRank.get(a.shelfSectionId || "general") ?? 999) - (sectionRank.get(b.shelfSectionId || "general") ?? 999) ||
    String(a.shelfSectionLabel || "General").localeCompare(String(b.shelfSectionLabel || "General")) ||
    lastName(a.author).localeCompare(lastName(b.author)) ||
    String(a.author || "Unknown Author").localeCompare(String(b.author || "Unknown Author")) ||
    (a.year || 9999) - (b.year || 9999) ||
    a.title.localeCompare(b.title)
  );
  const shelves = Array.from({ length: requiredBayCount }, (_, bay) => ({
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

  for (let bayIndex = 0; bayIndex < shelves.length; bayIndex += 1) {
    const shelf = shelves[bayIndex];
    const shelfBooks = orderedBooks.slice(bayIndex * capacity, (bayIndex + 1) * capacity);
    const rowsUsed = Math.min(SHELF_ROWS, Math.ceil(shelfBooks.length / SLOTS_PER_ROW));
    const activeRows = PREFERRED_ROWS.slice(0, rowsUsed);
    shelf.occupiedRows = [...activeRows].sort((a, b) => a - b);
    if (shelfBooks.length) {
      const sections = Array.from(new Set(shelfBooks.map((book) => book.shelfSectionLabel || "General")));
      shelf.sectionId = shelfBooks[0].shelfSectionId || "general";
      shelf.sectionLabel = sections.length === 1 ? sections[0] : `${sections[0]}–${sections[sections.length - 1]}`;
      shelf.authorRange = authorRange(shelfBooks);
      if (bayIndex < BASE_BAY_COUNT) {
        shelf.label = shelfLabelMode === "sections" ? shelf.sectionLabel : shelf.authorRange;
      }
    }

    for (let activeRowIndex = 0; activeRowIndex < activeRows.length; activeRowIndex += 1) {
      const row = activeRows[activeRowIndex];
      const rowBooks = shelfBooks.slice(activeRowIndex * SLOTS_PER_ROW, (activeRowIndex + 1) * SLOTS_PER_ROW);
      const startSlot = Math.max(0, Math.floor((SLOTS_PER_ROW - rowBooks.length) / 2));
      for (let rowIndex = 0; rowIndex < rowBooks.length; rowIndex += 1) {
        const book = rowBooks[rowIndex];
        book.placement = {
          documentId: book.id,
          shelfId: shelf.id,
          bay: bayIndex,
          row,
          slot: startSlot + rowIndex,
          width: Number(mapRange(book.wordCount, minWords, maxWords, 0.095, 0.17).toFixed(3)),
          height: Number(mapRange(book.wordCount, minWords, maxWords, 0.7, 0.94).toFixed(3)),
          depth: 0.43,
          accentColor: book.accentColor || SECTION_COLORS[bayIndex % SECTION_COLORS.length],
          shelfSectionId: book.shelfSectionId || "general",
          importanceScore: Number(mapRange(book.wordCount, minWords, maxWords, 0.25, 1).toFixed(3))
        };
      }
    }
  }
  return shelves;
}

function toRoman(value) {
  const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return numerals[value] || String(value);
}

export function sanitizePassageText(text) {
  const opening = text.slice(0, 3200);
  if (!/(subscribe to (?:our|the)|join (?:our|the) mailing list|visit (?:our|the) (?:website|site)|scan|use this qr code|donate|generous supporters)/i.test(opening)) return text;
  const starts = ["Contents", "Foreword", "Preface", "Introduction", "Chapter One"]
    .map((marker) => text.indexOf(marker))
    .filter((index) => index > 0)
    .sort((a, b) => a - b);
  return starts.length ? text.slice(starts[0]).trim() : text;
}

function createPassageDocuments(book, plain) {
  const sections = book.sections?.length ? book.sections : [{ title: "Opening", headingOrder: 0, position: 0 }];
  const documents = [];
  sections.forEach((section, sectionIndex) => {
    const sectionStart = section.position || 0;
    const sectionEnd = sections[sectionIndex + 1]?.position ?? plain.length;
    const sectionText = sanitizePassageText(plain.slice(sectionStart, sectionEnd).trim());
    if (!sectionText) return;
    let offset = 0;
    let chunkIndex = 0;
    while (offset < sectionText.length) {
      const text = sectionText.slice(offset, offset + SEARCH_CHUNK_SIZE);
      if (text.trim()) {
        documents.push({
          id: `${book.id}:${section.headingOrder || 0}:${chunkIndex}`,
          bookId: book.id,
          title: book.title,
          author: book.author,
          facets: Object.values(book.facets).flat().join(" "),
          sectionTitle: section.title || "Opening",
          headingOrder: section.headingOrder || 0,
          position: sectionStart + offset,
          preview: text.slice(0, 520),
          text
        });
      }
      if (offset + SEARCH_CHUNK_SIZE >= sectionText.length) break;
      offset += SEARCH_CHUNK_SIZE - SEARCH_CHUNK_OVERLAP;
      chunkIndex += 1;
    }
  });
  return documents;
}

export function searchIndexOptions() {
  return {
    idField: "id",
    fields: ["title", "author", "facets", "sectionTitle", "text"],
    storeFields: ["id", "bookId", "title", "author", "sectionTitle", "headingOrder", "position", "preview"]
  };
}

function colorForSection(sectionId, sectionOrder) {
  const orderedIndex = sectionOrder.indexOf(sectionId);
  const hash = createHash("sha256").update(sectionId).digest()[0];
  return SECTION_COLORS[orderedIndex >= 0 ? orderedIndex % SECTION_COLORS.length : hash % SECTION_COLORS.length];
}

function authorRef(name) {
  return { id: slugify(name) || "unknown-author", name };
}

export async function buildLibraryCatalog({
  sourceRoot,
  editionId = "generic",
  scopeId = "local",
  scopeLabel = "Local Library",
  bookOrigin,
  metadataRecords = [],
  authorAliases = new Map(),
  curatedBooks = [],
  copyContent = false,
  includePassages = true,
  contentOutputRoot = contentRoot,
  sourceRootLabel,
  profile = {}
}) {
  const metadataByStem = new Map(metadataRecords.map((record) => [record.stem, record]));
  const curatedByStem = new Map(curatedBooks.map((record) => [record.stem, record]));
  const files = (await listMarkdownFiles(sourceRoot)).sort((a, b) => a.localeCompare(b));
  const books = [];
  const passageDocuments = [];
  const unresolvedAuthorAliases = [];
  const ids = new Set();
  const sectionOrder = profile.sectionOrder || [];

  if (copyContent) {
    await fs.rm(contentOutputRoot, { recursive: true, force: true });
    await fs.mkdir(contentOutputRoot, { recursive: true });
  }

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const metadata = parseSourceMetadata(filePath, raw, authorAliases);
    const external = metadataByStem.get(metadata.stem);
    const curated = curatedByStem.get(metadata.stem);
    const headings = extractHeadings(raw);
    const plain = getPlainText(raw);
    const sections = extractSections(raw, headings, plain);
    const wordCount = countWords(plain);
    const relativeToSource = path.relative(sourceRoot, filePath).replaceAll(path.sep, "/");
    const relativeSourcePath = sourceRootLabel ? `${sourceRootLabel.replace(/\/$/, "")}/${relativeToSource}` : relativeToSource;
    let id = external?.book_id || curated?.id || slugify(relativeToSource.replace(/\.md$/i, "")) || createHash("sha256").update(relativeSourcePath).digest("hex").slice(0, 16);
    if (ids.has(id)) id = `${id}-${createHash("sha256").update(relativeSourcePath).digest("hex").slice(0, 8)}`;
    ids.add(id);
    const author = authorAliases.get(external?.author || metadata.author) || external?.author || metadata.author;
    if (external?.author && metadata.author !== external.author && !authorAliases.has(metadata.author) && !external._catalogOverride) {
      unresolvedAuthorAliases.push({ stem: metadata.stem, sourceAuthor: metadata.author, canonicalAuthor: external.author });
    }
    const authorNames = external?.authors?.length
      ? external.authors
      : [author, ...metadata.authors.filter((name) => name !== author)];
    const authors = authorNames.map((name) => authorAliases.get(name) || name).map(authorRef);
    const categories = metadata.categories;
    const tags = metadata.tags;
    const extension = profile.mapBook?.({ metadata, external, authors, categories, tags }) || {};
    const facets = extension.facets || { authors: authors.map((item) => item.name), categories, tags };
    const shelfSectionLabel = extension.shelfSectionLabel || metadata.collections[0] || author;
    const shelfSectionId = extension.shelfSectionId || slugify(shelfSectionLabel) || "general";
    const summary = summaryFrom(raw, metadata.explicitSummary);
    const hash = createHash("sha256").update(raw).digest("hex");
    const contentUrl = copyContent ? `/book-content/${encodeURIComponent(id)}.md` : `/api/books/${encodeURIComponent(id)}/content`;
    const book = {
      id,
      slug: slugify(extension.title || external?.title || metadata.title) || id,
      title: extension.title || external?.title || metadata.title,
      author: extension.author || author,
      authors: extension.authors || authors,
      year: extension.year || external?.year || metadata.year,
      type: "book",
      origin: bookOrigin,
      sourcePath: relativeSourcePath,
      relativeSourcePath,
      sourceFormat: "markdown",
      sourceHash: hash,
      contentUrl,
      headings,
      headingCount: headings.length,
      sections,
      wordCount,
      excerpt: excerptFrom(raw),
      summary: summary.text,
      summarySource: summary.source,
      readingMinutes: Math.max(1, Math.round(wordCount / 230)),
      keySections: sections.filter((section) => section.wordCount > 80).slice(0, 5).map((section) => ({ title: section.title, headingOrder: section.headingOrder, excerpt: section.excerpt })),
      topics: extension.topics || [...categories, ...tags],
      tags,
      categories,
      facets,
      shelfSectionId,
      shelfSectionLabel,
      accentColor: colorForSection(shelfSectionId, sectionOrder),
      metadataNeedsReview: metadata.metadataNeedsReview,
      placement: undefined
    };
    books.push(book);
    if (includePassages) passageDocuments.push(...createPassageDocuments(book, plain));
    if (copyContent) await fs.writeFile(path.join(contentOutputRoot, `${id}.md`), raw, "utf8");
  }

  const shelves = buildLayout(books, {
    sectionOrder,
    shelfLabelMode: profile.shelfLabelMode || "sections"
  });
  const manifest = {
    version: createHash("sha256").update(books.map((book) => book.sourceHash).join("|")).digest("hex").slice(0, 12),
    generatedAt: new Date().toISOString(),
    editionId,
    scopeId,
    scopeLabel,
    sourceRoot: sourceRootLabel || path.basename(sourceRoot),
    sourceFileCount: books.length,
    rooms: [{ id: "logical-library", label: profile.roomLabel || "Virtual Library", width: 0, depth: 0, height: 0 }],
    shelves,
    books,
    facetDefinitions: profile.facetDefinitions || GENERIC_FACETS
  };
  return { manifest, passageDocuments, diagnostics: { unresolvedAuthorAliases } };
}

async function writeSearchShards(passageDocuments, books) {
  await fs.rm(searchRoot, { recursive: true, force: true });
  await fs.mkdir(searchRoot, { recursive: true });
  const documentsByBook = new Map();
  for (const document of passageDocuments) {
    if (!documentsByBook.has(document.bookId)) documentsByBook.set(document.bookId, []);
    documentsByBook.get(document.bookId).push(document);
  }
  const shards = [];
  for (let start = 0; start < books.length; start += SEARCH_BOOKS_PER_SHARD) {
    const shardBooks = books.slice(start, start + SEARCH_BOOKS_PER_SHARD);
    const documents = shardBooks.flatMap((book) => documentsByBook.get(book.id) || []);
    const miniSearch = new MiniSearch(searchIndexOptions());
    miniSearch.addAll(documents);
    const file = `shard-${String(shards.length + 1).padStart(3, "0")}.json`;
    await fs.writeFile(path.join(searchRoot, file), JSON.stringify({ version: 2, index: miniSearch.toJSON() }), "utf8");
    shards.push({ id: shards.length + 1, url: `/library-search-shards/${file}`, bookCount: shardBooks.length, documentCount: documents.length });
  }
  await fs.writeFile(searchManifestPath, JSON.stringify({ version: 2, documentCount: passageDocuments.length, shards }), "utf8");
}

async function main() {
  const contentRootSetting = process.env.LIBRARY_CONTENT_ROOT || "books";
  const { sourceRoot, sourceRootLabel, usingBundledExamples } = await resolveLibrarySource({ contentRootSetting });
  await fs.mkdir(publicRoot, { recursive: true });
  const { manifest, passageDocuments } = await buildLibraryCatalog({
    sourceRoot,
    editionId: "generic",
    scopeId: "local",
    scopeLabel: "Local Library",
    copyContent: true,
    includePassages: true,
    sourceRootLabel,
    bookOrigin: usingBundledExamples ? "bundled" : undefined
  });
  await fs.rm(metadataRoot, { recursive: true, force: true });
  await fs.mkdir(metadataRoot, { recursive: true });
  await Promise.all(manifest.books.map((book) => fs.writeFile(
    path.join(metadataRoot, `${book.id}.json`),
    `${JSON.stringify(createBookDetail(book))}\n`,
    "utf8"
  )));
  await fs.writeFile(manifestPath, `${JSON.stringify(createCatalogSummary(manifest))}\n`, "utf8");
  await writeSearchShards(passageDocuments, manifest.books);
  await fs.rm(path.join(publicRoot, "library-search-index.json"), { force: true });
  const shardCount = Math.ceil(manifest.books.length / SEARCH_BOOKS_PER_SHARD);
  const starterNote = usingBundledExamples ? " using the bundled starter fallback" : "";
  console.log(`Generated ${manifest.books.length} books, ${manifest.books.length} metadata records, and ${passageDocuments.length} search chunks across ${shardCount} shards${starterNote}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
