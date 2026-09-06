import { AssetWorld } from "./AssetWorld";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

const world = getWorld("deco");

export default function DecoWorld(props: WorldEnvironmentProps) {
  return <AssetWorld world={world} {...props} />;
}
