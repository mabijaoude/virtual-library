/// <reference lib="webworker" />

import { marked } from "marked";
import type { Heading } from "../types";

type ReaderSection = {
  id: string;
  title: string;
  headingOrder?: number;
  sourceStart: number;
  estimatedSize: number;
  markdown: string;
  plainText: string;
};

type InitMessage = { type: "init"; markdown: string; headings: Heading[]; targetHeadingOrder?: number; targetPosition?: number };
type RenderMessage = { type: "render"; indexes: number[] };
type SearchMessage = { type: "search"; id: number; query: string };

let sections: ReaderSection[] = [];

self.addEventListener("message", async (event: MessageEvent<InitMessage | RenderMessage | SearchMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    sections = buildSections(message.markdown, message.headings || []);
    const targetIndex = findTargetSection(sections, message.targetHeadingOrder, message.targetPosition);
    self.postMessage({
      type: "ready",
      targetIndex,
      sections: sections.map(({ markdown: _markdown, plainText: _plainText, ...section }) => section)
    });
    return;
  }

  if (message.type === "render") {
    for (const index of Array.from(new Set(message.indexes))) {
      const section = sections[index];
      if (!section) continue;
      const html = String(await marked.parse(section.markdown));
      self.postMessage({ type: "section", index, html });
    }
    return;
  }

  const query = message.query.trim().toLocaleLowerCase();
  const matches: Array<{ sectionIndex: number; occurrence: number }> = [];
  if (query) {
    sections.some((section, sectionIndex) => {
      const text = section.plainText.toLocaleLowerCase();
      let offset = 0;
      let occurrence = 0;
      while ((offset = text.indexOf(query, offset)) >= 0) {
        matches.push({ sectionIndex, occurrence });
        occurrence += 1;
        offset += Math.max(1, query.length);
        if (matches.length >= 2000) return true;
      }
      return false;
    });
  }
  self.postMessage({ type: "search-result", id: message.id, query: message.query.trim(), matches });
});

function buildSections(markdown: string, headings: Heading[]): ReaderSection[] {
  const source = joinOcrSpacedCaps(markdown.replace(/^---[\s\S]*?\n---\s*/, ""));
  const lines = source.split(/(?<=\n)/);
  const rawSections: Array<{ markdown: string; title: string; headingOrder?: number; sourceStart: number }> = [];
  let buffer = "";
  let title = "Opening";
  let headingOrder: number | undefined;
  let sourceStart = 0;
  let sourceOffset = 0;
  let headingIndex = 0;

  const flush = () => {
    if (!buffer.trim()) return;
    rawSections.push({ markdown: buffer.trim(), title, headingOrder, sourceStart });
    buffer = "";
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trimEnd());
    if (match) {
      flush();
      const heading = headings[headingIndex++];
      const level = Math.min(6, Math.max(1, match[1].length));
      headingOrder = heading?.order;
      title = formatHeadingTitle(heading?.title || match[2]);
      sourceStart = sourceOffset;
      buffer = `<h${level}${heading ? ` id="reader-heading-${heading.order}"` : ""}>${escapeHtml(title)}</h${level}>\n`;
    } else {
      if (!buffer) sourceStart = sourceOffset;
      buffer += line;
    }
    sourceOffset += line.length;
  }
  flush();

  const output: ReaderSection[] = [];
  for (const raw of rawSections) {
    const chunks = chunkAtBlocks(raw.markdown, 40_000);
    chunks.forEach((chunk, part) => {
      const plainText = stripMarkdown(chunk);
      output.push({
        id: `${raw.headingOrder ?? "opening"}-${part}`,
        title: part ? `${raw.title} (continued)` : raw.title,
        headingOrder: raw.headingOrder,
        sourceStart: raw.sourceStart,
        estimatedSize: Math.max(320, Math.min(4200, 180 + plainText.length / 4.5)),
        markdown: chunk,
        plainText
      });
    });
  }
  return output.length ? output : [{ id: "opening-0", title: "Opening", sourceStart: 0, estimatedSize: 500, markdown: source, plainText: stripMarkdown(source) }];
}

function chunkAtBlocks(markdown: string, maxLength: number) {
  if (markdown.length <= maxLength) return [markdown];
  const blocks = markdown.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > maxLength) {
      chunks.push(current);
      current = "";
    }
    if (block.length > maxLength) {
      for (let index = 0; index < block.length; index += maxLength) chunks.push(block.slice(index, index + maxLength));
    } else current += `${current ? "\n\n" : ""}${block}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function findTargetSection(items: ReaderSection[], headingOrder?: number, position?: number) {
  if (typeof headingOrder === "number") {
    const index = items.findIndex((section) => section.headingOrder === headingOrder);
    if (index >= 0) return index;
  }
  if (typeof position === "number" && position > 0) {
    let index = 0;
    for (let cursor = 0; cursor < items.length; cursor += 1) {
      if (items[cursor].sourceStart <= position) index = cursor;
      else break;
    }
    return index;
  }
  return 0;
}

function stripMarkdown(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatHeadingTitle(value: string) {
  return joinOcrSpacedCaps(value).replace(/\s+/g, " ").trim();
}

function joinOcrSpacedCaps(value: string) {
  return value.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, (_match, first: string, rest: string) => `${first}${rest}`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

export {};
