import { AssetWorld } from "./AssetWorld";
import { AlexandriaHarborExterior } from "./AlexandriaExterior";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

export default function AlexandriaWorld(props: WorldEnvironmentProps) {
  const world = getWorld("alexandria");
  return (
    <AssetWorld
      {...props}
      world={world}
      exterior={(
        <AlexandriaHarborExterior
          quality={props.quality}
          reducedMotion={props.reducedMotion}
          backplateUrl={world.assets.backplate!}
        />
      )}
    />
  );
}
