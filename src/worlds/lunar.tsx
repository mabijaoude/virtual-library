import { AssetWorld } from "./AssetWorld";
import { LunarExterior } from "./SpaceExteriors";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

export default function LunarWorld(props: WorldEnvironmentProps) {
  const world = getWorld("lunar");
  return (
    <AssetWorld
      {...props}
      world={world}
      exterior={<LunarExterior world={world} quality={props.quality} reducedMotion={props.reducedMotion} />}
    />
  );
}
