import { describe, expect, it } from "vitest";
import { bookAtlasLayout } from "./bookAtlas";

describe("bookAtlasLayout", () => {
  it("uses a compact atlas for empty and one-book collections", () => {
    expect(bookAtlasLayout(0, 8192)).toEqual({ width: 128, height: 512, columns: 1, rows: 1 });
    expect(bookAtlasLayout(1, 8192)).toEqual({ width: 128, height: 512, columns: 1, rows: 1 });
  });

  it("grows with the collection without immediately allocating the maximum texture", () => {
    expect(bookAtlasLayout(9, 8192)).toEqual({ width: 320, height: 768, columns: 5, rows: 2 });
    expect(bookAtlasLayout(70, 8192)).toEqual({ width: 896, height: 1920, columns: 14, rows: 5 });
  });

  it("respects the renderer texture limit for large collections", () => {
    const layout = bookAtlasLayout(565, 1024);
    expect(layout.width).toBeLessThanOrEqual(1024);
    expect(layout.height).toBeLessThanOrEqual(1024);
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(565);
  });
});
