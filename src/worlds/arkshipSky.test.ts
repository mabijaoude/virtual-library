import { describe, expect, it } from "vitest";
import { ARKSHIP_EXTERIOR_DESIGN, createStarField } from "./SpaceExteriors";

describe("Arkship observation sky", () => {
  it.each(Object.entries(ARKSHIP_EXTERIOR_DESIGN.starCount))("covers oblique and elevated window views in %s", (_, count) => {
    const { geometry } = createStarField(24112079, count, false);
    try {
      const p = geometry.getAttribute("position");
      const sectors = Array.from({ length: 6 }, () => [0, 0, 0]);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const azimuth = Math.atan2(x, -z);
        const elevation = Math.atan2(y, Math.hypot(x, z));
        // Six horizontal views, each with below/level/above-eye coverage.
        if (Math.abs(elevation) < Math.PI / 3) {
          const column = Math.min(5, Math.floor((azimuth + Math.PI / 2) / (Math.PI / 6)));
          const row = elevation < -.2 ? 0 : elevation > .2 ? 2 : 1;
          sectors[column][row]++;
        }
        expect(Math.hypot(x, y, z)).toBeLessThan(900);
        expect(Math.hypot(x, y, z)).toBeGreaterThan(300);
      }
      expect(p.count).toBe(count);
      for (const sector of sectors) for (const stars of sector) expect(stars).toBeGreaterThan(8);
    } finally { geometry.dispose(); }
  });
});
