type SearchRequest = { type: "search"; id: number; query: string };
type InitRequest = { type: "init"; text: string };
type FindMatch = { start: number; length: number };

let sourceText = "";

self.addEventListener("message", (event: MessageEvent<InitRequest | SearchRequest>) => {
  if (event.data.type === "init") {
    sourceText = event.data.text;
    return;
  }

  const matches = findMatches(sourceText, event.data.query);
  self.postMessage({ type: "result", id: event.data.id, query: event.data.query, matches });
});

function findMatches(text: string, query: string): FindMatch[] {
  const needles = readerFindNeedles(query);
  if (!text || !needles.length) return [];
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(${needles.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return Array.from(text.matchAll(regex), (match) => ({ start: match.index, length: match[0].length }));
}

function readerFindNeedles(query: string) {
  const quoted = Array.from(query.matchAll(/"([^"]+)"/g), (match) => match[1].replace(/\s+/g, " ").trim()).filter(Boolean);
  if (quoted.length) return Array.from(new Set(quoted)).sort((a, b) => b.length - a.length);
  const normalized = query.replaceAll('"', "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const terms = normalized
    .split(/\s+/)
    .map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((term) => term.length > 2 && !READER_STOP_WORDS.has(term.toLowerCase()));
  return Array.from(new Set([normalized, ...terms])).sort((a, b) => b.length - a.length);
}

const READER_STOP_WORDS = new Set(["and", "are", "for", "from", "has", "have", "into", "that", "the", "there", "this", "was", "were", "with"]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export {};
