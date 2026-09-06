/// <reference lib="webworker" />

type AtlasBook = { id: string; title: string };

type AtlasRequest = {
  id: number;
  width: number;
  height: number;
  columns: number;
  books: AtlasBook[];
  palette: string[];
  metal: string;
  text: string;
};

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<AtlasRequest>) => {
  const request = event.data;
  const rows = Math.max(1, Math.ceil(request.books.length / request.columns));
  const canvas = new OffscreenCanvas(request.width, request.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Offscreen book atlas context is unavailable");
  const tileWidth = request.width / request.columns;
  const tileHeight = request.height / rows;
  request.books.forEach((book, index) => {
    const column = index % request.columns;
    const row = Math.floor(index / request.columns);
    drawSpine(
      context,
      column * tileWidth,
      row * tileHeight,
      tileWidth,
      tileHeight,
      book,
      request.palette,
      request.metal,
      request.text
    );
  });
  const bitmap = canvas.transferToImageBitmap();
  worker.postMessage({ id: request.id, bitmap }, [bitmap]);
};

function drawSpine(
  context: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  book: AtlasBook,
  palette: string[],
  metal: string,
  text: string
) {
  context.fillStyle = palette[hashString(book.id) % palette.length] || "#53372c";
  context.fillRect(x, y, width, height);
  const band = Math.max(1.25, width * 0.055);
  context.fillStyle = metal;
  context.globalAlpha = 0.76;
  context.fillRect(x + width * 0.07, y, band, height);
  context.fillRect(x + width - width * 0.07 - band, y, band, height);
  context.globalAlpha = 1;

  context.fillStyle = "rgba(3, 5, 7, 0.3)";
  context.fillRect(x + width * 0.18, y + height * 0.055, width * 0.64, height * 0.89);
  context.strokeStyle = metal;
  context.lineWidth = Math.max(1, width * 0.02);
  context.strokeRect(x + width * 0.15, y + height * 0.045, width * 0.7, height * 0.91);
  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.rotate(-Math.PI / 2);
  const textWidth = height * 0.76;
  const availableCrossAxis = width * 0.58;
  let size = Math.min(width * 0.28, 38);
  let lines: string[] = [];
  while (size >= 5) {
    context.font = `700 ${size}px "Arial Narrow", "Segoe UI", sans-serif`;
    lines = wrapText(context, book.title, textWidth);
    if (lines.length * size * 1.02 <= availableCrossAxis) break;
    size -= 1;
  }
  context.fillStyle = text;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0, 0, 0, 0.72)";
  context.shadowBlur = Math.max(1, size * 0.08);
  const lineHeight = size * 1.02;
  lines.forEach((line, index) => context.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight));
  context.restore();
}

function wrapText(context: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
