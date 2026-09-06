import type { ResolvedQuality, WorldDefinition } from "./types";

export type WorldModelLoadPlan = {
  initialUrl: string;
  upgradeUrl?: string;
};

// Complete-model decoding remains outside the initial fully rendered room path.
export const WORLD_MODEL_UPGRADE_DELAY_MS = 10_000;

export function resolveWorldModelLoadPlan(
  world: WorldDefinition,
  quality: ResolvedQuality,
  saveData: boolean
): WorldModelLoadPlan {
  return {
    initialUrl: world.assets.fallbackModel,
    upgradeUrl: quality === "cinematic" && !saveData ? world.assets.completeModel : undefined
  };
}
