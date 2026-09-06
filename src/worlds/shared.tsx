import { RoundedBox, Text, useTexture } from "@react-three/drei";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Shelf } from "../types";
import { getBayAnchor, getShelfTop, SCROLL_CELL_BASE_Y, SCROLL_CELL_SPACING, SHELF_BOARD_BASE_Y, SHELF_ROW_SPACING } from "./layout";
import { SCROLL_BAY_DESIGN } from "./scrollBay";
import type { ResolvedQuality, WorldDefinition } from "./types";

type BoxTransform = {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
};

export function InstancedBoxes({ transforms, color, roughness = 0.7, metalness = 0, emissive, emissiveIntensity = 0, castShadow = true, receiveShadow = true, map, normalMap, roughnessMap, normalScale = 0.28, envMapIntensity = 1 }: {
  transforms: BoxTransform[];
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  normalScale?: number;
  envMapIntensity?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    transforms.forEach((transform, index) => {
      position.fromArray(transform.position);
      scale.fromArray(transform.scale);
      quaternion.setFromEuler(new THREE.Euler(...(transform.rotation || [0, 0, 0])));
      matrix.compose(position, quaternion, scale);
      ref.current?.setMatrixAt(index, matrix);
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      ref.current.computeBoundingBox();
      ref.current.computeBoundingSphere();
    }
  }, [transforms]);
  if (!transforms.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, transforms.length]} castShadow={castShadow} receiveShadow={receiveShadow}>
      <boxGeometry />
      <meshStandardMaterial color={color} map={map} normalMap={normalMap} normalScale={normalMap ? new THREE.Vector2(normalScale, normalScale) : undefined} roughnessMap={roughnessMap} roughness={roughness} metalness={metalness} envMapIntensity={envMapIntensity} emissive={emissive || "#000"} emissiveIntensity={emissiveIntensity} />
    </instancedMesh>
  );
}

export function InstancedCylinders({ transforms, color, roughness = 0.5, metalness = 0.5, castShadow = true, map, normalMap, roughnessMap, normalScale = 0.28 }: {
  transforms: BoxTransform[];
  color: string;
  roughness?: number;
  metalness?: number;
  castShadow?: boolean;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  normalScale?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    transforms.forEach((transform, index) => {
      quaternion.setFromEuler(new THREE.Euler(...(transform.rotation || [0, 0, 0])));
      matrix.compose(new THREE.Vector3(...transform.position), quaternion, new THREE.Vector3(...transform.scale));
      ref.current?.setMatrixAt(index, matrix);
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      ref.current.computeBoundingBox();
      ref.current.computeBoundingSphere();
    }
  }, [transforms]);
  if (!transforms.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, transforms.length]} castShadow={castShadow} receiveShadow>
      <cylinderGeometry args={[1, 1, 1, 16]} />
      <meshStandardMaterial
        color={color}
        map={map}
        normalMap={normalMap}
        normalScale={normalMap ? new THREE.Vector2(normalScale, normalScale) : undefined}
        roughnessMap={roughnessMap}
        roughness={roughness}
        metalness={metalness}
      />
    </instancedMesh>
  );
}

export function InstancedColumns({ positions, radius, height, color, sides = 20, metalness = 0, roughness = 0.68 }: {
  positions: Array<[number, number, number]>;
  radius: number;
  height: number;
  color: string;
  sides?: number;
  metalness?: number;
  roughness?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    positions.forEach((position, index) => {
      matrix.compose(new THREE.Vector3(...position), quaternion, scale);
      ref.current?.setMatrixAt(index, matrix);
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      ref.current.computeBoundingBox();
      ref.current.computeBoundingSphere();
    }
  }, [positions]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius * 1.08, height, sides]} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </instancedMesh>
  );
}

export function SurfacePlane({ size, color, accent, kind = "stone", repeat = [6, 6] }: {
  size: [number, number];
  color: string;
  accent: string;
  kind?: "wood" | "stone" | "tile" | "marble";
  repeat?: [number, number];
}) {
  const maps = useMemo(() => createSurfaceMaps(`${kind}-${color}-${accent}`, color, accent, kind, repeat), [accent, color, kind, repeat[0], repeat[1]]);
  useEffect(() => () => {
    maps.map.dispose();
    maps.bump.dispose();
  }, [maps]);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={size} />
      <meshStandardMaterial map={maps.map} bumpMap={maps.bump} bumpScale={kind === "stone" ? 0.035 : 0.02} roughness={kind === "marble" ? 0.46 : 0.72} metalness={0.01} />
    </mesh>
  );
}

export function ReadingDesk({ position = [0, 0, 0], rotationY = 0, world, width = 3.2 }: {
  position?: [number, number, number];
  rotationY?: number;
  world: WorldDefinition;
  width?: number;
}) {
  const modern = world.id === "modern";
  const deco = world.id === "deco";
  const foundry = world.id === "foundry";
  return (
    <group position={position} rotation-y={rotationY}>
      <RoundedBox position={[0, 0.83, 0]} args={[width, 0.16, 1.18]} radius={modern ? 0.025 : 0.055} smoothness={3} castShadow receiveShadow>
        <meshPhysicalMaterial color={world.scene.shelf} roughness={foundry ? 0.3 : 0.5} metalness={foundry ? 0.55 : 0} clearcoat={deco || foundry ? 0.38 : 0.16} clearcoatRoughness={0.54} />
      </RoundedBox>
      <InstancedBoxes
        transforms={[-1, 1].flatMap((x) => [-1, 1].map((z) => ({ position: [x * (width / 2 - 0.24), 0.41, z * 0.42] as [number, number, number], scale: [modern ? 0.1 : 0.16, 0.82, modern ? 0.1 : 0.16] as [number, number, number] })))}
        color={modern || foundry ? world.scene.metal : world.scene.shelfDark}
        metalness={modern || deco || foundry ? 0.45 : 0.02}
        roughness={0.52}
      />
      <mesh position={[0, 0.96, -0.1]} rotation-x={0.12} castShadow>
        <boxGeometry args={[1.08, 0.035, 0.7]} />
        <meshStandardMaterial color={world.scene.paper} roughness={0.84} />
      </mesh>
      <mesh position={[width * 0.31, 1.28, 0.25]}>
        <cylinderGeometry args={[0.04, 0.04, 0.78, 18]} />
        <meshStandardMaterial color={world.scene.metal} metalness={0.68} roughness={0.28} />
      </mesh>
      {modern ? (
        <RoundedBox position={[width * 0.31, 1.67, 0.25]} args={[0.48, 0.09, 0.2]} radius={0.025} smoothness={3}>
          <meshStandardMaterial color={world.scene.practical} emissive={world.scene.practical} emissiveIntensity={0.82} toneMapped={false} />
        </RoundedBox>
      ) : (
        <mesh position={[width * 0.31, 1.63, 0.25]}>
          <cylinderGeometry args={[0.13, 0.25, 0.18, 24]} />
          <meshStandardMaterial color={foundry ? world.scene.metal : world.scene.practical} emissive={world.scene.practical} emissiveIntensity={foundry ? 0.45 : 0.72} metalness={foundry ? 0.68 : 0.18} roughness={0.32} />
        </mesh>
      )}
    </group>
  );
}

type ShelfBaysProps = { shelves: Shelf[]; world: WorldDefinition; quality: ResolvedQuality; materialsEnabled?: boolean };

export function ShelfBays(props: ShelfBaysProps) {
  return props.materialsEnabled ? <TexturedShelfBays {...props} /> : <ShelfBayList {...props} />;
}

function TexturedShelfBays(props: ShelfBaysProps) {
  const urls = shelfMaterialUrls(props.world);
  const satin = usesSatinShelfFinish(props.world.id);
  const textureUrls: Record<string, string> = {
    primaryMap: urls.primary.color,
    primaryNormalMap: urls.primary.normal,
    hardwareMap: urls.hardware.color,
    hardwareNormalMap: urls.hardware.normal
  };
  // Dark roughness texels multiply the material value toward a mirror finish.
  // Use a stable satin response for oak and brushed habitat cabinetry, without
  // downloading maps that those surfaces no longer sample.
  if (!satin) {
    textureUrls.primaryRoughnessMap = urls.primary.roughness;
    textureUrls.hardwareRoughnessMap = urls.hardware.roughness;
  }
  if (urls.panel.color !== urls.primary.color) {
    textureUrls.panelMap = urls.panel.color;
    textureUrls.panelNormalMap = urls.panel.normal;
    if (!satin) textureUrls.panelRoughnessMap = urls.panel.roughness;
  }
  const shelfMaps = useTexture(textureUrls) as ShelfMaps;
  useEffect(() => {
    for (const [key, texture] of Object.entries(shelfMaps)) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = key.endsWith("Map") && !key.includes("Normal") && !key.includes("Roughness") ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
  }, [shelfMaps]);
  return <ShelfBayList {...props} shelfMaps={shelfMaps} />;
}

function ShelfBayList({ shelves, world, quality, shelfMaps }: ShelfBaysProps & { shelfMaps?: ShelfMaps }) {
  return (
    <group>
      {shelves.map((shelf) => {
        const anchor = getBayAnchor(world, shelf.bayIndex || 0);
        return (
          <group key={shelf.id} position={anchor.position} rotation-y={anchor.rotationY}>
            <ShelfBay shelf={shelf} width={anchor.width} world={world} detailed={Boolean(shelf.occupiedRows?.length)} shelfMaps={shelfMaps} castShadow={quality === "cinematic"} />
          </group>
        );
      })}
    </group>
  );
}

type ShelfMaps = {
  primaryMap: THREE.Texture;
  primaryNormalMap: THREE.Texture;
  primaryRoughnessMap?: THREE.Texture;
  panelMap?: THREE.Texture;
  panelNormalMap?: THREE.Texture;
  panelRoughnessMap?: THREE.Texture;
  hardwareMap: THREE.Texture;
  hardwareNormalMap: THREE.Texture;
  hardwareRoughnessMap?: THREE.Texture;
};

type ShelfMaterialFamily = "wood" | "concrete" | "metal";

function usesSatinShelfFinish(worldId: WorldDefinition["id"]) {
  return worldId === "heritage" || worldId === "lunar" || worldId === "arkship";
}

function shelfMaterialUrls(world: WorldDefinition) {
  const family = (name: ShelfMaterialFamily) => ({
    color: `/worlds/assets/materials/shelf-${name}-color.webp`,
    normal: `/worlds/assets/materials/shelf-${name}-normal.webp`,
    roughness: `/worlds/assets/materials/shelf-${name}-roughness.webp`
  });
  const primary = world.id === "foundry" || world.id === "lunar" || world.id === "arkship" ? family("metal") : family("wood");
  const panel = world.id === "modern" || world.id === "lunar" ? family("concrete") : primary;
  const hardware = world.id === "modern" || world.id === "foundry" || world.id === "lunar" || world.id === "arkship" ? family("metal") : primary;
  return { primary, panel, hardware };
}

export function usesOccupiedShelfBackPanel(worldId: WorldDefinition["id"]) {
  return worldId === "lunar" || worldId === "arkship";
}

export function usesPersistentShelfBackPanel(worldId: WorldDefinition["id"]) {
  return worldId !== "alexandria" && !usesOccupiedShelfBackPanel(worldId);
}

export function getShelfKitDimensions(world: WorldDefinition, width: number) {
  const highTech = world.id === "modern" || world.id === "foundry" || world.id === "lunar" || world.id === "arkship";
  const shelfDepth = world.id === "modern" ? 0.66 : world.id === "lunar" ? 0.7 : world.id === "foundry" || world.id === "arkship" ? 0.76 : 0.82;
  const uprightWidth = highTech ? 0.14 : 0.2;
  const uprightCenter = width / 2 + 0.14;
  const boardWidth = 2 * (uprightCenter - uprightWidth / 2) + 0.012;
  return { highTech, shelfDepth, uprightWidth, uprightCenter, boardWidth, trimWidth: boardWidth - 0.035 };
}

const ShelfBay = memo(function ShelfBay({ shelf, width, world, detailed, shelfMaps, castShadow }: { shelf: Shelf; width: number; world: WorldDefinition; detailed: boolean; shelfMaps?: ShelfMaps; castShadow: boolean }) {
  const top = getShelfTop(world);
  const boards = [...Array.from({ length: 5 }, (_, index) => SHELF_BOARD_BASE_Y + index * SHELF_ROW_SPACING), top];
  const { highTech, shelfDepth, uprightWidth, uprightCenter, boardWidth, trimWidth } = getShelfKitDimensions(world, width);
  const primaryMaps = shelfMaps ? { map: shelfMaps.primaryMap, normalMap: shelfMaps.primaryNormalMap, roughnessMap: shelfMaps.primaryRoughnessMap } : {};
  const panelMaps = shelfMaps?.panelMap
    ? { map: shelfMaps.panelMap, normalMap: shelfMaps.panelNormalMap, roughnessMap: shelfMaps.panelRoughnessMap }
    : primaryMaps;
  const hardwareMaps = shelfMaps ? { map: shelfMaps.hardwareMap, normalMap: shelfMaps.hardwareNormalMap, roughnessMap: shelfMaps.hardwareRoughnessMap } : {};
  const keepBackPanel = usesOccupiedShelfBackPanel(world.id);
  const persistentBackPanel = usesPersistentShelfBackPanel(world.id);
  const shelfBackColor = world.scene.shelfBack || world.scene.shelf;
  const shelfBackFill = persistentBackPanel ? {
    emissive: shelfBackColor,
    emissiveIntensity: world.id === "gothic" || world.id === "deco" || world.id === "foundry" ? 0.13 : 0.075
  } : {};
  const boardTransforms: BoxTransform[] = boards.map((y) => ({ position: [0, y, 0], scale: [boardWidth, world.id === "gothic" ? 0.12 : 0.105, shelfDepth] }));
  const backTransforms: BoxTransform[] = [{ position: [0, top / 2, -shelfDepth / 2 - 0.055], scale: [boardWidth, top, 0.1] }];
  const uprightTransforms: BoxTransform[] = [-1, 1].map((side) => ({ position: [side * uprightCenter, top / 2, -0.04], scale: [uprightWidth, top + 0.18, shelfDepth + 0.12] }));
  const frontEdgeTransforms: BoxTransform[] = boards.map((y) => ({ position: [0, y + 0.037, shelfDepth / 2 + 0.028], scale: [trimWidth, 0.07, 0.055] }));
  const backPanelTransforms: BoxTransform[] = Array.from({ length: 5 }, (_, row) => ({ position: [0, SHELF_BOARD_BASE_Y + SHELF_ROW_SPACING * row + 0.51, -shelfDepth / 2 - 0.002], scale: [boardWidth - 0.18, 0.82, 0.028] }));
  const shelfLightTransforms: BoxTransform[] = boards.slice(1).map((y) => ({ position: [0, y - 0.068, shelfDepth / 2 + 0.018], scale: [trimWidth - 0.3, 0.018, 0.025] }));
  const heritageWoodFill = world.id === "heritage" ? { emissive: "#5a2e1e", emissiveIntensity: 0.055 } : {};
  const satinFinish = usesSatinShelfFinish(world.id) ? {
    roughness: world.id === "heritage" ? 0.78 : 0.66,
    metalness: world.id === "heritage" ? 0.01 : 0.3,
    envMapIntensity: world.id === "heritage" ? 0.22 : 0.34
  } : {};

  return (
    <group>
      {persistentBackPanel && <InstancedBoxes transforms={backTransforms} color={shelfBackColor} roughness={0.76} {...panelMaps} {...shelfBackFill} {...satinFinish} normalScale={0.18} castShadow={false} />}
      {detailed && keepBackPanel && <InstancedBoxes transforms={backTransforms} color={world.scene.shelfDark} roughness={0.8} {...panelMaps} {...satinFinish} normalScale={0.18} castShadow={castShadow} />}
      {detailed && keepBackPanel && <InstancedBoxes transforms={backPanelTransforms} color={world.scene.shelf} roughness={0.72} metalness={world.id === "arkship" ? 0.28 : 0} {...panelMaps} envMapIntensity={usesSatinShelfFinish(world.id) ? 0.24 : 1} normalScale={0.16} castShadow={castShadow} />}
      <InstancedBoxes transforms={boardTransforms} color={world.scene.shelf} roughness={highTech ? 0.48 : 0.65} metalness={world.id === "foundry" || world.id === "arkship" ? 0.38 : world.id === "modern" || world.id === "lunar" ? 0.06 : 0.01} {...primaryMaps} {...heritageWoodFill} {...satinFinish} normalScale={0.2} castShadow={castShadow} />
      {(persistentBackPanel || detailed) && <InstancedBoxes transforms={frontEdgeTransforms} color={highTech ? world.scene.metal : world.scene.trim} roughness={0.42} metalness={highTech ? 0.66 : 0.08} {...hardwareMaps} {...satinFinish} normalScale={0.16} castShadow={castShadow} />}
      <InstancedBoxes transforms={uprightTransforms} color={highTech ? world.scene.metal : world.scene.trim} roughness={0.5} metalness={highTech ? 0.48 : 0.02} {...hardwareMaps} {...heritageWoodFill} {...satinFinish} normalScale={0.16} castShadow={castShadow} />
      {(world.id === "modern" || world.id === "deco" || world.id === "foundry" || world.id === "lunar" || world.id === "arkship") && (
        <InstancedBoxes transforms={shelfLightTransforms} color={world.scene.accent} emissive={world.scene.accent} emissiveIntensity={world.id === "foundry" ? 0.82 : 0.72} roughness={0.2} castShadow={false} />
      )}
      <mesh position={[0, 0.18, 0]} castShadow={castShadow} receiveShadow>
        <boxGeometry args={[width + 0.62, 0.28, shelfDepth + 0.2]} />
        <meshStandardMaterial color={world.scene.shelfDark} roughness={0.58} metalness={world.id === "foundry" || world.id === "arkship" ? 0.5 : 0.02} />
      </mesh>
      <ShelfCrown width={width} top={top} world={world} detailed={detailed} />
      {detailed && (
        <ShelfPlaque label={shelf.label} width={width} top={top} shelfDepth={shelfDepth} world={world} />
      )}
    </group>
  );
});

function ShelfPlaque({ label, width, top, shelfDepth, world }: {
  label: string;
  width: number;
  top: number;
  shelfDepth: number;
  world: WorldDefinition;
}) {
  const palette = world.id === "heritage"
    ? { plate: "#24140e", text: "#f4dfb5" }
    : world.id === "modern"
    ? { plate: "#26343c", text: "#f3f8fa" }
    : world.id === "gothic"
      ? { plate: "#17191d", text: "#f2dfb9" }
      : world.id === "renaissance"
        ? { plate: "#57301f", text: "#fff0c9" }
        : world.id === "deco"
          ? { plate: "#181714", text: "#f4d58a" }
          : world.id === "lunar"
            ? { plate: "#18232b", text: "#eaf6f8" }
            : world.id === "arkship"
              ? { plate: "#0b1119", text: "#e8f4f7" }
              : { plate: "#182429", text: "#dcffff" };
  const plateWidth = width - 0.18;
  const fontSize = THREE.MathUtils.clamp(plateWidth / Math.max(21, label.length * 0.58), 0.1, 0.18);
  const plaqueHeight = world.id === "heritage" ? 0.28 : world.id === "arkship" ? 0.27 : 0.3;
  const plaqueY = world.id === "heritage" ? top + 0.34 : world.id === "arkship" ? top + 0.32 : top + 0.43;
  const plaqueZ = shelfDepth / 2 + (world.id === "heritage" ? 0.09 : world.id === "arkship" ? 0.13 : 0.07);

  return (
    <group position={[0, plaqueY, plaqueZ]}>
      <mesh castShadow>
        <boxGeometry args={[plateWidth, plaqueHeight, 0.055]} />
        <meshStandardMaterial color={palette.plate} roughness={0.48} metalness={world.id === "modern" || world.id === "deco" || world.id === "foundry" || world.id === "lunar" || world.id === "arkship" ? 0.42 : 0.05} />
      </mesh>
      <mesh position={[0, -plaqueHeight / 2 - 0.015, 0.018]}>
        <boxGeometry args={[plateWidth - 0.12, 0.025, 0.025]} />
        <meshStandardMaterial color={world.scene.accent} emissive={world.scene.accent} emissiveIntensity={0.45} toneMapped={false} />
      </mesh>
      <Text
        position={[0, 0, 0.035]}
        fontSize={fontSize}
        maxWidth={plateWidth - 0.22}
        whiteSpace="nowrap"
        overflowWrap="normal"
        anchorX="center"
        anchorY="middle"
        color={palette.text}
        outlineColor={palette.plate}
        outlineWidth={0.004}
        renderOrder={5}
      >
        {label}
      </Text>
    </group>
  );
}

type ScrollBaysProps = { shelves: Shelf[]; world: WorldDefinition; quality: ResolvedQuality; materialsEnabled?: boolean };

export function ScrollBays(props: ScrollBaysProps) {
  return props.materialsEnabled ? <TexturedScrollBays {...props} /> : <ScrollBayList {...props} />;
}

function TexturedScrollBays(props: ScrollBaysProps) {
  const cedarMaps = useTexture({
    cedarMap: SCROLL_BAY_DESIGN.woodTextures.map,
    cedarNormalMap: SCROLL_BAY_DESIGN.woodTextures.normalMap,
    cedarRoughnessMap: SCROLL_BAY_DESIGN.woodTextures.roughnessMap,
    liningMap: SCROLL_BAY_DESIGN.liningTextures.map,
    liningNormalMap: SCROLL_BAY_DESIGN.liningTextures.normalMap,
    liningRoughnessMap: SCROLL_BAY_DESIGN.liningTextures.roughnessMap
  });
  useEffect(() => {
    for (const [key, texture] of Object.entries(cedarMaps)) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = key === "cedarMap" || key === "liningMap" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (key.startsWith("lining")) texture.repeat.set(2.2, 1.5);
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
  }, [cedarMaps]);
  return <ScrollBayList {...props} cedarMaps={cedarMaps} />;
}

function ScrollBayList({ shelves, world, quality, cedarMaps }: ScrollBaysProps & { cedarMaps?: ScrollShelfMaps }) {
  return (
    <group>
      {shelves.map((shelf) => {
        const anchor = getBayAnchor(world, shelf.bayIndex || 0);
        return (
          <group key={shelf.id} position={anchor.position} rotation-y={anchor.rotationY}>
            <ScrollBay shelf={shelf} width={anchor.width} world={world} cedarMaps={cedarMaps} castShadow={quality === "cinematic"} />
          </group>
        );
      })}
    </group>
  );
}

type ScrollShelfMaps = {
  cedarMap: THREE.Texture;
  cedarNormalMap: THREE.Texture;
  cedarRoughnessMap: THREE.Texture;
  liningMap: THREE.Texture;
  liningNormalMap: THREE.Texture;
  liningRoughnessMap: THREE.Texture;
};

const ScrollBay = memo(function ScrollBay({ shelf, width, world, cedarMaps, castShadow }: {
  shelf: Shelf;
  width: number;
  world: WorldDefinition;
  cedarMaps?: ScrollShelfMaps;
  castShadow: boolean;
}) {
  const top = getShelfTop(world) - 0.08;
  const {
    cedarMap,
    cedarNormalMap: cedarNormal,
    cedarRoughnessMap: cedarRoughness,
    liningMap,
    liningNormalMap: liningNormal,
    liningRoughnessMap: liningRoughness
  } = cedarMaps || {};
  const slotSpacing = width / 16;
  const halfX = slotSpacing * 0.49;
  const halfY = 0.43;
  const edgeLength = Math.hypot(halfX, halfY);
  const edgeAngle = Math.atan2(halfY, halfX);
  const shell = useMemo<BoxTransform[]>(() => [
    { position: [0, 0.2, SCROLL_BAY_DESIGN.outerCenterZ], scale: [width + 0.65, 0.32, SCROLL_BAY_DESIGN.outerDepth] },
    { position: [-(width / 2 + 0.2), top / 2, SCROLL_BAY_DESIGN.outerCenterZ], scale: [0.28, top + 0.2, SCROLL_BAY_DESIGN.outerDepth] },
    { position: [width / 2 + 0.2, top / 2, SCROLL_BAY_DESIGN.outerCenterZ], scale: [0.28, top + 0.2, SCROLL_BAY_DESIGN.outerDepth] },
    { position: [0, top, SCROLL_BAY_DESIGN.outerCenterZ], scale: [width + 0.68, 0.28, SCROLL_BAY_DESIGN.outerDepth] }
  ], [top, width]);
  const slotDividers = useMemo<BoxTransform[]>(() => {
    const transforms: BoxTransform[] = [];
    for (let row = 0; row < 5; row += 1) {
      const centerY = SCROLL_CELL_BASE_Y + row * SCROLL_CELL_SPACING;
      for (let slot = 0; slot < 14; slot += 1) {
        const centerX = -(13 * slotSpacing) / 2 + slot * slotSpacing;
        transforms.push(
          { position: [centerX - halfX / 2, centerY + halfY / 2, SCROLL_BAY_DESIGN.slotDividerCenterZ], scale: [edgeLength, 0.028, SCROLL_BAY_DESIGN.slotDividerDepth], rotation: [0, 0, edgeAngle] },
          { position: [centerX + halfX / 2, centerY + halfY / 2, SCROLL_BAY_DESIGN.slotDividerCenterZ], scale: [edgeLength, 0.028, SCROLL_BAY_DESIGN.slotDividerDepth], rotation: [0, 0, -edgeAngle] },
          { position: [centerX - halfX / 2, centerY - halfY / 2, SCROLL_BAY_DESIGN.slotDividerCenterZ], scale: [edgeLength, 0.028, SCROLL_BAY_DESIGN.slotDividerDepth], rotation: [0, 0, -edgeAngle] },
          { position: [centerX + halfX / 2, centerY - halfY / 2, SCROLL_BAY_DESIGN.slotDividerCenterZ], scale: [edgeLength, 0.028, SCROLL_BAY_DESIGN.slotDividerDepth], rotation: [0, 0, edgeAngle] }
        );
      }
    }
    return transforms;
  }, [edgeAngle, edgeLength, halfX, halfY, slotSpacing]);
  const bronzeDetails = useMemo<BoxTransform[]>(() => {
    const transforms: BoxTransform[] = [
      { position: [0, 0.43, SCROLL_BAY_DESIGN.frontTrimZ], scale: [width + 0.3, 0.045, 0.05] },
      { position: [0, top - 0.13, SCROLL_BAY_DESIGN.frontTrimZ], scale: [width + 0.3, 0.045, 0.05] },
      { position: [-(width / 2 + 0.06), top / 2, SCROLL_BAY_DESIGN.frontTrimZ], scale: [0.04, top - 0.35, 0.05] },
      { position: [width / 2 + 0.06, top / 2, SCROLL_BAY_DESIGN.frontTrimZ], scale: [0.04, top - 0.35, 0.05] }
    ];
    for (let index = 0; index < 9; index += 1) {
      transforms.push({ position: [-width / 2 + 0.28 + index * ((width - 0.56) / 8), top + 0.205, SCROLL_BAY_DESIGN.frontTrimZ - 0.03], scale: [0.11, 0.13, 0.075] });
    }
    return transforms;
  }, [top, width]);
  const primaryLabel = shelf.label || shelf.sectionLabel;
  const authorRange = shelf.authorRange && shelf.authorRange !== primaryLabel ? shelf.authorRange : undefined;
  const shellFill = { emissive: "#5a3421", emissiveIntensity: 0.12 };
  const panelFill = { emissive: "#43271b", emissiveIntensity: 0.16 };

  return (
    <group>
      <mesh position={[0, top / 2, SCROLL_BAY_DESIGN.rearPanelZ]} receiveShadow>
        <boxGeometry args={[width + 0.35, top, SCROLL_BAY_DESIGN.rearPanelDepth]} />
        <meshStandardMaterial color={SCROLL_BAY_DESIGN.liningColor} map={liningMap} normalMap={liningNormal} normalScale={new THREE.Vector2(0.1, 0.1)} roughnessMap={liningRoughness} roughness={0.86} emissive={SCROLL_BAY_DESIGN.liningEmissive} emissiveIntensity={0.055} />
      </mesh>
      <InstancedBoxes transforms={shell} color={world.scene.shelf} map={cedarMap} normalMap={cedarNormal} roughnessMap={cedarRoughness} normalScale={0.3} roughness={0.62} metalness={0.01} castShadow={castShadow} {...shellFill} />
      <InstancedBoxes transforms={slotDividers} color={SCROLL_BAY_DESIGN.dividerColor} map={cedarMap} normalMap={cedarNormal} roughnessMap={cedarRoughness} normalScale={0.34} roughness={SCROLL_BAY_DESIGN.dividerRoughness} metalness={SCROLL_BAY_DESIGN.dividerMetalness} castShadow={castShadow} emissive={SCROLL_BAY_DESIGN.dividerEmissive} emissiveIntensity={0.055} />
      <InstancedBoxes transforms={bronzeDetails} color={world.scene.metal} roughness={0.3} metalness={0.66} castShadow={castShadow} />
      <mesh position={[0, top + 0.35, SCROLL_BAY_DESIGN.outerCenterZ]} castShadow>
        <boxGeometry args={[width + 0.38, 0.42, SCROLL_BAY_DESIGN.outerDepth - 0.1]} />
        <meshStandardMaterial color={world.scene.shelfDark} map={cedarMap} normalMap={cedarNormal} normalScale={new THREE.Vector2(0.22, 0.22)} roughnessMap={cedarRoughness} roughness={0.58} {...panelFill} />
      </mesh>
      <mesh position={[0, top + 0.14, SCROLL_BAY_DESIGN.frontTrimZ]}>
        <boxGeometry args={[width + 0.54, 0.052, 0.09]} />
        <meshStandardMaterial color={world.scene.metal} metalness={0.72} roughness={0.3} />
      </mesh>
      <ScrollShelfPlaque primary={primaryLabel} secondary={authorRange} width={width} top={top} />
    </group>
  );
});

export function balanceScrollPlaqueLabel(label: string, targetLineLength = 30) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (label.length <= targetLineLength || words.length < 2) return label.trim();
  let bestIndex = 1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ");
    const second = words.slice(index).join(" ");
    const overflow = Math.max(0, first.length - targetLineLength) + Math.max(0, second.length - targetLineLength);
    const delta = Math.abs(first.length - second.length) + overflow * 5;
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return `${words.slice(0, bestIndex).join(" ")}\n${words.slice(bestIndex).join(" ")}`;
}

function ScrollShelfPlaque({ primary, secondary, width, top }: {
  primary: string;
  secondary?: string;
  width: number;
  top: number;
}) {
  const balanced = balanceScrollPlaqueLabel(primary, 28);
  const lineCount = balanced.includes("\n") ? 2 : 1;
  const plateHeight = secondary ? (lineCount === 2 ? 0.64 : 0.54) : lineCount === 2 ? 0.53 : 0.44;
  const plateWidth = width + 0.02;
  const primarySize = THREE.MathUtils.clamp(width / Math.max(23, primary.length * 0.49), 0.13, 0.19);
  const primaryY = secondary ? (lineCount === 2 ? 0.085 : 0.075) : 0;
  return (
    <group position={[0, top + 0.23, 0.62]}>
      <mesh castShadow>
        <boxGeometry args={[plateWidth, plateHeight, 0.075]} />
        <meshStandardMaterial color="#2c170f" roughness={0.58} metalness={0.02} />
      </mesh>
      <mesh position={[0, -plateHeight / 2 + 0.035, 0.048]}>
        <boxGeometry args={[plateWidth - 0.16, 0.035, 0.025]} />
        <meshStandardMaterial color="#c59a55" metalness={0.72} roughness={0.28} />
      </mesh>
      <Text
        position={[0, primaryY, 0.055]}
        fontSize={primarySize}
        maxWidth={plateWidth - 0.2}
        textAlign="center"
        lineHeight={0.92}
        anchorX="center"
        anchorY="middle"
        color="#f5e6bb"
        outlineWidth={0.004}
        outlineColor="#24120b"
        renderOrder={7}
      >
        {balanced}
      </Text>
      {secondary && (
        <Text
          position={[0, -plateHeight / 2 + 0.105, 0.056]}
          fontSize={0.086}
          maxWidth={plateWidth - 0.24}
          whiteSpace="nowrap"
          overflowWrap="normal"
          anchorX="center"
          anchorY="middle"
          color="#cdbd91"
          renderOrder={7}
        >
          {secondary}
        </Text>
      )}
    </group>
  );
}

function ShelfCrown({ width, top, world, detailed }: { width: number; top: number; world: WorldDefinition; detailed: boolean }) {
  if (!detailed) {
    return (
      <group position={[0, top + 0.12, 0]}>
        <mesh castShadow><boxGeometry args={[width + 0.66, 0.18, 0.78]} /><meshStandardMaterial color={world.scene.trim} roughness={0.46} metalness={world.id === "modern" || world.id === "foundry" ? 0.55 : 0.04} /></mesh>
        {(world.id === "modern" || world.id === "deco" || world.id === "foundry") && <mesh position={[0, 0.11, 0.4]}><boxGeometry args={[width - 0.18, 0.025, 0.025]} /><meshStandardMaterial color={world.scene.accent} emissive={world.scene.accent} emissiveIntensity={0.9} toneMapped={false} /></mesh>}
      </group>
    );
  }
  if (world.id === "gothic") {
    return (
      <group position={[0, top + 0.15, -0.04]}>
        <mesh castShadow><boxGeometry args={[width + 0.62, 0.2, 0.78]} /><meshStandardMaterial color={world.scene.shelfDark} roughness={0.58} /></mesh>
        {[-width / 2, 0, width / 2].map((x) => <mesh key={x} position={[x, 0.43, 0]} castShadow><coneGeometry args={[0.15, 0.75, 4]} /><meshStandardMaterial color={world.scene.trim} roughness={0.64} /></mesh>)}
      </group>
    );
  }
  if (world.id === "modern") {
    return (
      <group position={[0, top + 0.18, 0]}>
        <mesh><boxGeometry args={[width + 0.42, 0.12, 0.7]} /><meshStandardMaterial color={world.scene.metal} metalness={0.46} roughness={0.3} /></mesh>
        <mesh position={[0, 0.17, 0.28]}><boxGeometry args={[width - 0.15, 0.055, 0.055]} /><meshStandardMaterial color={world.scene.practical} emissive={world.scene.practical} emissiveIntensity={1.2} /></mesh>
      </group>
    );
  }
  if (world.id === "renaissance") {
    return (
      <group position={[0, top + 0.13, -0.02]}>
        <mesh castShadow><boxGeometry args={[width + 0.7, 0.18, 0.82]} /><meshStandardMaterial color={world.scene.trim} roughness={0.54} /></mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (width / 2 + 0.16), 0.26, 0]} rotation-z={Math.PI / 4} castShadow>
            <boxGeometry args={[0.24, 0.24, 0.67]} />
            <meshStandardMaterial color={world.scene.shelf} roughness={0.58} />
          </mesh>
        ))}
      </group>
    );
  }
  if (world.id === "deco") {
    return (
      <group position={[0, top + 0.1, 0]}>
        {[0, 0.13, 0.25].map((y, index) => <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[width + 0.72 - index * 0.36, 0.1, 0.77 - index * 0.08]} /><meshStandardMaterial color={index === 1 ? world.scene.metal : world.scene.shelf} metalness={index === 1 ? 0.7 : 0.06} roughness={0.34} /></mesh>)}
      </group>
    );
  }
  if (world.id === "foundry") {
    return (
      <group position={[0, top + 0.1, 0]}>
        {[0, 0.14, 0.28].map((y, index) => <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[width + 0.74 - index * 0.28, 0.11, 0.8 - index * 0.1]} /><meshStandardMaterial color={index === 1 ? world.scene.metal : world.scene.shelfDark} metalness={index === 1 ? 0.82 : 0.5} roughness={0.28} /></mesh>)}
        <mesh position={[0, 0.18, 0.42]}><boxGeometry args={[width - 0.24, 0.035, 0.035]} /><meshStandardMaterial color={world.scene.accent} emissive={world.scene.accent} emissiveIntensity={1.6} toneMapped={false} /></mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[side * (width / 2 + 0.18), 0.45, 0]} rotation-z={side * 0.32}><cylinderGeometry args={[0.06, 0.06, 0.82, 14]} /><meshStandardMaterial color={world.scene.metal} metalness={0.85} roughness={0.24} /></mesh>)}
      </group>
    );
  }
  if (world.id === "lunar") {
    return (
      <group position={[0, top + 0.11, 0]}>
        <mesh castShadow><boxGeometry args={[width + 0.6, 0.16, 0.72]} /><meshStandardMaterial color={world.scene.metal} metalness={0.54} roughness={0.34} /></mesh>
        <mesh position={[0, 0.12, 0.37]}><boxGeometry args={[width - 0.26, 0.028, 0.03]} /><meshStandardMaterial color={world.scene.accent} emissive={world.scene.accent} emissiveIntensity={0.95} toneMapped={false} /></mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[side * (width / 2 + 0.16), 0.13, 0]}><boxGeometry args={[0.16, 0.3, 0.8]} /><meshStandardMaterial color={world.scene.trim} metalness={0.44} roughness={0.38} /></mesh>)}
      </group>
    );
  }
  if (world.id === "arkship") {
    return (
      <group position={[0, top + 0.08, -0.02]}>
        <mesh castShadow><boxGeometry args={[width + 0.5, 0.11, 0.7]} /><meshStandardMaterial color={world.scene.shelfDark} metalness={0.58} roughness={0.34} /></mesh>
        <mesh position={[0, 0.075, 0.36]}><boxGeometry args={[width - 0.22, 0.022, 0.028]} /><meshStandardMaterial color={world.scene.accent} emissive={world.scene.accent} emissiveIntensity={0.62} toneMapped={false} /></mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[side * (width / 2 + 0.11), 0.08, -0.01]}><boxGeometry args={[0.12, 0.2, 0.72]} /><meshStandardMaterial color={world.scene.trim} metalness={0.7} roughness={0.28} /></mesh>)}
      </group>
    );
  }
  return (
    <group position={[0, top + 0.12, 0]}>
      <mesh castShadow><boxGeometry args={[width + 0.72, 0.18, 0.82]} /><meshStandardMaterial color={world.scene.trim} roughness={0.52} /></mesh>
      <mesh position={[0, 0.2, -0.02]} castShadow><boxGeometry args={[width + 0.95, 0.14, 0.58]} /><meshStandardMaterial color={world.scene.shelfDark} roughness={0.5} /></mesh>
    </group>
  );
}

function createSurfaceMaps(seed: string, dark: string, light: string, kind: string, repeat: [number, number]) {
  const size = 512;
  const canvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  canvas.width = canvas.height = bumpCanvas.width = bumpCanvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const bump = bumpCanvas.getContext("2d")!;
  const random = seededRandom(hashString(seed));
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size);
  bump.fillStyle = "#777";
  bump.fillRect(0, 0, size, size);

  if (kind === "wood") {
    for (let x = 0; x < size; x += 28) {
      ctx.fillStyle = random() > 0.5 ? light : dark;
      ctx.globalAlpha = 0.26;
      ctx.fillRect(x, 0, 24, size);
      ctx.globalAlpha = 1;
      for (let line = 0; line < 7; line += 1) {
        const offset = x + random() * 24;
        ctx.strokeStyle = light;
        ctx.globalAlpha = 0.08 + random() * 0.1;
        ctx.beginPath();
        ctx.moveTo(offset, 0);
        for (let y = 0; y <= size; y += 24) ctx.lineTo(offset + Math.sin(y * 0.035 + random() * 3) * 2.4, y);
        ctx.stroke();
        bump.strokeStyle = `rgb(${90 + Math.floor(random() * 50)},${90 + Math.floor(random() * 50)},${90 + Math.floor(random() * 50)})`;
        bump.stroke();
      }
    }
  } else {
    const tile = kind === "tile" ? 64 : 96;
    for (let y = 0; y < size; y += tile) for (let x = 0; x < size; x += tile) {
      ctx.fillStyle = (x / tile + y / tile) % 2 ? light : dark;
      ctx.globalAlpha = kind === "marble" ? 0.14 : 0.24;
      ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      bump.strokeStyle = "#505050";
      bump.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
    }
  }
  ctx.globalAlpha = 1;
  const map = new THREE.CanvasTexture(canvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  for (const texture of [map, bumpMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.colorSpace = texture === map ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
  }
  return { map, bump: bumpMap };
}

function seededRandom(seed: number) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
