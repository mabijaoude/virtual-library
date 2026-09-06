import { AssetWorld } from "./AssetWorld";
import { ModernMuseumExterior } from "./ModernExterior";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

const world = getWorld("modern");

export default function ModernWorld(props: WorldEnvironmentProps) {
  return (
    <AssetWorld
      world={world}
      {...props}
      exterior={(
        <ModernMuseumExterior
          quality={props.quality}
          reducedMotion={props.reducedMotion}
          backplateUrl={world.assets.backplate!}
        />
      )}
    />
  );
}
