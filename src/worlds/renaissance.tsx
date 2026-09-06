import { AssetWorld } from "./AssetWorld";
import { RenaissanceGarden } from "./RenaissanceGarden";
import { RenaissanceGallery } from "./RenaissanceGallery";
import { getWorld } from "./registry";
import type { WorldEnvironmentProps } from "./types";

const world = getWorld("renaissance");

export default function RenaissanceWorld(props: WorldEnvironmentProps) {
  return <AssetWorld world={world} {...props} exterior={<>
    <RenaissanceGarden quality={props.quality} backplateUrl={world.assets.backplate!} />
    <RenaissanceGallery />
  </>} />;
}
