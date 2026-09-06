import { AssetWorld } from "./AssetWorld";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

const world = getWorld("foundry");

export default function FoundryWorld(props: WorldEnvironmentProps) {
  return <AssetWorld world={world} {...props} />;
}
