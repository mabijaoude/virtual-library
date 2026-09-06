import { AssetWorld } from "./AssetWorld";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

const world = getWorld("heritage");

export default function HeritageWorld(props: WorldEnvironmentProps) {
  return <AssetWorld world={world} {...props} />;
}
