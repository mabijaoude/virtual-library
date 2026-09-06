import { describe, expect, it } from "vitest";
import { ANTIKYTHERA_DISPLAY_LAYOUT, ANTIKYTHERA_EXHIBIT } from "./antikythera";

describe("Antikythera exhibit", () => {
  it("keeps the reconstruction anchored to the museum evidence", () => {
    expect(ANTIKYTHERA_EXHIBIT.caseDimensionsCm).toEqual([33, 18, 10]);
    expect(ANTIKYTHERA_EXHIBIT.date).toContain("150–100 BCE");
    expect(ANTIKYTHERA_EXHIBIT.inventory).toContain("X 15087");
  });

  it("documents the reconstructed flat planetary display without presenting it as certainty", () => {
    expect(ANTIKYTHERA_EXHIBIT.frontOutputs).toEqual([
      "Moon", "Mercury", "Venus", "Sun", "Mars", "Jupiter", "Saturn", "Date"
    ]);
    expect(ANTIKYTHERA_EXHIBIT.reconstruction.join(" ")).toMatch(/flat/i);
    expect(ANTIKYTHERA_EXHIBIT.reconstruction.join(" ")).toMatch(/not a claim/i);
  });

  it("links the exhibit to research and museum sources", () => {
    expect(ANTIKYTHERA_EXHIBIT.sources).toHaveLength(3);
    expect(ANTIKYTHERA_EXHIBIT.sources.every((source) => source.href.startsWith("https://"))).toBe(true);
    expect(ANTIKYTHERA_EXHIBIT.sources[0].href).toContain("s41598-021-84310-w");
  });

  it("seats both exhibit supports on authored display surfaces", () => {
    const caseSupportBottom = ANTIKYTHERA_DISPLAY_LAYOUT.caseCenterY
      + ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportCenterOffsetY
      - ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportHeight / 2;
    const plaqueStemBottom = ANTIKYTHERA_DISPLAY_LAYOUT.plaqueStemCenterY
      - ANTIKYTHERA_DISPLAY_LAYOUT.plaqueStemHeight / 2;

    expect(caseSupportBottom).toBeCloseTo(ANTIKYTHERA_DISPLAY_LAYOUT.mountingTabletTopY, 3);
    expect(plaqueStemBottom).toBeCloseTo(ANTIKYTHERA_DISPLAY_LAYOUT.pedestalTopY, 3);
  });
});
