import { describe, expect, it } from "vitest";
import type { ShelfPlacement } from "../types";
import { getWorld, WORLDS } from "./registry";
import { focusPoseForBook, getBayAnchor, getShelfTop, resolveBookTransform, SHELF_BOOK_BASE_Y, SHELF_ROW_SPACING } from "./layout";
import type { Book } from "../types";

const placement: ShelfPlacement = {
  documentId: "test",
  shelfId: "display-bay-1",
  bay: 0,
  row: 2,
  slot: 7,
  width: 0.14,
  height: 0.82,
  depth: 0.43,
  accentColor: "#fff",
  shelfSectionId: "economic-theory",
  importanceScore: 1
};

describe("world shelf projection", () => {
  it("projects one logical slot to different coordinates in every world", () => {
    const positions = WORLDS.map((world) => resolveBookTransform(placement, world).position.toArray().map((value) => value.toFixed(2)).join(":"));
    expect(new Set(positions).size).toBe(9);
  });

  it("creates deterministic annex anchors after the nine authored bays", () => {
    const world = getWorld("heritage");
    const tenth = getBayAnchor(world, 9);
    const eleventh = getBayAnchor(world, 10);
    expect(tenth.rotationY).toBe(world.expansion.rotationY);
    expect(eleventh.position[2] - tenth.position[2]).toBeCloseTo(world.expansion.spacing, 6);
  });

  it("keeps the Heritage rear cases flush and its first side case clear of the corner", () => {
    const world = getWorld("heritage");
    const rear = getBayAnchor(world, 0);
    const side = getBayAnchor(world, 2);

    expect(rear.position[2]).toBeLessThan(-9.8);
    expect(side.position[2]).toBeGreaterThan(-7);
  });

  it("keeps the tallest top-row volume below the case roof in every world", () => {
    const tallestBookTop = SHELF_BOOK_BASE_Y + SHELF_ROW_SPACING * 4 + 0.94;
    for (const world of WORLDS) {
      const roofBoardHeight = world.id === "gothic" ? 0.12 : 0.105;
      const roofBoardBottom = getShelfTop(world) - roofBoardHeight / 2;
      expect(roofBoardBottom, world.id).toBeGreaterThan(tallestBookTop);
    }
  });

  it("focuses every shelf row straight-on at the spine's height", () => {
    const world = getWorld("gothic");
    for (let row = 0; row < 5; row += 1) {
      const rowPlacement = { ...placement, row };
      const book = { id: `row-${row}`, placement: rowPlacement } as Book;
      const transform = resolveBookTransform(rowPlacement, world);
      const pose = focusPoseForBook(book, world);
      const viewDirection = pose.target.clone().sub(pose.position).normalize();

      expect(pose.position.y).toBeCloseTo(pose.target.y, 6);
      expect(pose.target.y).toBeCloseTo(transform.position.y + 0.03, 6);
      expect(viewDirection.y).toBeCloseTo(0, 6);
      expect(viewDirection.dot(transform.front)).toBeLessThan(-0.85);
      expect(pose.position.distanceTo(pose.target)).toBeGreaterThan(2.8);
    }
  });
});
