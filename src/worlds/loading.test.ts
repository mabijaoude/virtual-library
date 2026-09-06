import { describe, expect, it } from "vitest";
import {
  resolveWorldModelLoadPlan,
  WORLD_MODEL_UPGRADE_DELAY_MS
} from "./loading";
import { WORLDS } from "./registry";

describe("world model loading", () => {
  it("opens every room with its compact authored model", () => {
    for (const world of WORLDS) {
      const plan = resolveWorldModelLoadPlan(world, "balanced", false);
      expect(plan.initialUrl).toBe(world.assets.fallbackModel);
      expect(plan.upgradeUrl).toBeUndefined();
    }
  });

  it("reserves the complete model for explicit cinematic sessions", () => {
    for (const world of WORLDS) {
      expect(resolveWorldModelLoadPlan(world, "lite", false).upgradeUrl).toBeUndefined();
      expect(resolveWorldModelLoadPlan(world, "balanced", false).upgradeUrl).toBeUndefined();
      expect(resolveWorldModelLoadPlan(world, "cinematic", true).upgradeUrl).toBeUndefined();
      expect(resolveWorldModelLoadPlan(world, "cinematic", false).upgradeUrl).toBe(world.assets.completeModel);
    }
  });

  it("keeps optional complete-model decoding well outside initial readiness", () => {
    expect(WORLD_MODEL_UPGRADE_DELAY_MS).toBeGreaterThanOrEqual(10_000);
  });
});
