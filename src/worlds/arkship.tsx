import { AssetWorld } from "./AssetWorld";
import { DeepSpaceExterior } from "./SpaceExteriors";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

export default function ArkshipWorld(props: WorldEnvironmentProps) {
  const world = getWorld("arkship");
  return (
    <AssetWorld
      {...props}
      world={world}
      exterior={<DeepSpaceExterior world={world} quality={props.quality} reducedMotion={props.reducedMotion} />}
    />
  );
}
