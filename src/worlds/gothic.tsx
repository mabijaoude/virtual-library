import { AssetWorld } from "./AssetWorld";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

const world = getWorld("gothic");

export default function GothicWorld(props: WorldEnvironmentProps) {
  return <AssetWorld world={world} {...props} />;
}
