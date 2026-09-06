import { describe, expect, it } from "vitest";
import { WORLD_FURNISHING_MATERIALS } from "./RoomDetails";
import { WORLDS } from "./registry";

describe("world furnishing texture profiles", () => {
  it("defines a focused texture set for every room", () => {
    expect(Object.keys(WORLD_FURNISHING_MATERIALS).sort()).toEqual(WORLDS.map((world) => world.id).sort());
    expect(WORLD_FURNISHING_MATERIALS.gothic).toEqual([]);
    expect(WORLD_FURNISHING_MATERIALS.renaissance).toEqual([]);
    expect(WORLD_FURNISHING_MATERIALS.foundry).toEqual([]);
    expect(WORLD_FURNISHING_MATERIALS.alexandria).toEqual(["wood", "paper", "papyrus"]);
  });
});
