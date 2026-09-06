import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, SSAO, Vignette } from "@react-three/postprocessing";
import type { ResolvedQuality, WorldDefinition } from "../worlds/types";

export default function PostEffects({ quality, world, enabled = true }: { quality: ResolvedQuality; world: WorldDefinition; enabled?: boolean }) {
  return (
    <EffectComposer enabled={enabled} multisampling={quality === "cinematic" ? 4 : 0} enableNormalPass>
      <SSAO
        samples={quality === "cinematic" ? 14 : 6}
        rings={quality === "cinematic" ? 5 : 2}
        distanceThreshold={0.92}
        distanceFalloff={0.12}
        rangeThreshold={0.75}
        rangeFalloff={0.15}
        luminanceInfluence={0.55}
        radius={0.22}
        intensity={quality === "cinematic" ? 1.28 : 0.66}
        resolutionScale={0.5}
      />
      <Bloom intensity={world.scene.bloom} luminanceThreshold={0.78} luminanceSmoothing={0.18} mipmapBlur />
      <HueSaturation hue={world.scene.grade.hue} saturation={world.scene.grade.saturation} />
      <BrightnessContrast brightness={world.scene.grade.brightness} contrast={world.scene.grade.contrast} />
      <Vignette eskil={false} offset={0.18} darkness={world.scene.vignette} />
    </EffectComposer>
  );
}
