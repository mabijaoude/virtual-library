import { useFrame } from "@react-three/fiber";
import { RoundedBox, useTexture } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { InstancedBoxes, InstancedCylinders } from "./shared";
import { FoundryRelayWall } from "./FoundryRelayWall";
import type { ResolvedQuality, WorldDefinition } from "./types";

type Props = {
  world: WorldDefinition;
  quality: ResolvedQuality;
  reducedMotion: boolean;
};

export const LUNAR_CONTROL_PLINTH_POSITIONS = [
  [-5.2, 0, -7.8],
  [5.2, 0, -7.8]
] as const satisfies ReadonlyArray<readonly [number, number, number]>;

export function RoomDetails({ world, quality, reducedMotion }: Props) {
  const castShadow = quality === "cinematic";
  const maps = useFurnishingMaps(world.id);
  switch (world.id) {
    case "heritage":
      return <HeritageDetails world={world} castShadow={castShadow} maps={maps} />;
    case "gothic":
      return <GothicDetails world={world} castShadow={castShadow} maps={maps} />;
    case "modern":
      return <ModernDetails world={world} castShadow={castShadow} maps={maps} />;
    case "renaissance":
      return <RenaissanceDetails world={world} castShadow={castShadow} maps={maps} />;
    case "deco":
      return <DecoDetails world={world} castShadow={castShadow} maps={maps} />;
    case "foundry":
      return <FoundryDetails world={world} castShadow={castShadow} reducedMotion={reducedMotion} maps={maps} />;
    case "lunar":
      return <LunarDetails world={world} castShadow={castShadow} reducedMotion={reducedMotion} maps={maps} />;
    case "arkship":
      return <ArkshipDetails world={world} castShadow={castShadow} maps={maps} />;
    case "alexandria":
      return <AlexandriaDetails world={world} castShadow={castShadow} maps={maps} />;
  }
}

type MaterialSet = {
  map?: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
};

type FurnishingMaps = {
  wood: MaterialSet;
  leather: MaterialSet;
  metal: MaterialSet;
  marble: MaterialSet;
  paperNormal: THREE.Texture;
  papyrus: MaterialSet;
};

const FURNISHING_TEXTURE_URLS = {
  woodMap: "/worlds/assets/materials/shelf-wood-color.webp",
  woodNormal: "/worlds/assets/materials/shelf-wood-normal.webp",
  woodRoughness: "/worlds/assets/materials/shelf-wood-roughness.webp",
  leatherNormal: "/worlds/assets/materials/book-leather-normal.webp",
  leatherRoughness: "/worlds/assets/materials/book-leather-roughness.webp",
  metalNormal: "/worlds/assets/materials/hardware-metal-normal.webp",
  metalRoughness: "/worlds/assets/materials/hardware-metal-roughness.webp",
  marbleMap: "/worlds/assets/materials/marble-color.webp",
  marbleNormal: "/worlds/assets/materials/marble-normal.webp",
  marbleRoughness: "/worlds/assets/materials/marble-roughness.webp",
  paperNormal: "/worlds/assets/materials/paper-normal.webp",
  papyrusMap: "/worlds/assets/materials/alexandria-papyrus-color.webp",
  papyrusNormal: "/worlds/assets/materials/alexandria-papyrus-normal.webp",
  papyrusRoughness: "/worlds/assets/materials/alexandria-papyrus-roughness.webp"
} as const;

type FurnishingTextureKey = keyof typeof FURNISHING_TEXTURE_URLS;
type FurnishingMaterialFamily = "wood" | "leather" | "metal" | "marble" | "paper" | "papyrus";

const FURNISHING_TEXTURE_KEYS: Record<FurnishingMaterialFamily, readonly FurnishingTextureKey[]> = {
  wood: ["woodMap", "woodNormal", "woodRoughness"],
  leather: ["leatherNormal"],
  metal: ["metalNormal", "metalRoughness"],
  marble: ["marbleMap", "marbleNormal", "marbleRoughness"],
  paper: ["paperNormal"],
  papyrus: ["papyrusMap", "papyrusNormal", "papyrusRoughness"]
};

export const WORLD_FURNISHING_MATERIALS: Record<WorldDefinition["id"], readonly FurnishingMaterialFamily[]> = {
  heritage: ["wood", "leather", "paper"],
  gothic: [],
  modern: ["metal", "marble"],
  renaissance: [],
  deco: ["leather", "metal", "marble"],
  foundry: [],
  lunar: ["leather", "metal"],
  arkship: ["leather", "metal"],
  alexandria: ["wood", "paper", "papyrus"]
};

function useFurnishingMaps(worldId: WorldDefinition["id"]): FurnishingMaps {
  const requestedTextures = useMemo(() => Object.fromEntries(
    WORLD_FURNISHING_MATERIALS[worldId]
      .flatMap((family) => FURNISHING_TEXTURE_KEYS[family])
      .filter((key) => !(key === "woodRoughness" && worldId === "heritage")
        && !(key === "metalRoughness" && (worldId === "deco" || worldId === "lunar" || worldId === "arkship")))
      .map((key) => [key, FURNISHING_TEXTURE_URLS[key]])
  ) as Partial<Record<FurnishingTextureKey, string>>, [worldId]);
  const textures = useTexture(requestedTextures) as Partial<Record<FurnishingTextureKey, THREE.Texture>>;
  useEffect(() => {
    Object.entries(textures).forEach(([name, texture]) => {
      if (!texture) return;
      texture.colorSpace = name.endsWith("Map") ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    });
  }, [textures]);
  return {
    wood: { map: textures.woodMap, normalMap: textures.woodNormal!, roughnessMap: textures.woodRoughness! },
    leather: { normalMap: textures.leatherNormal!, roughnessMap: textures.leatherRoughness! },
    metal: { normalMap: textures.metalNormal!, roughnessMap: textures.metalRoughness! },
    marble: { map: textures.marbleMap, normalMap: textures.marbleNormal!, roughnessMap: textures.marbleRoughness! },
    paperNormal: textures.paperNormal!,
    papyrus: { map: textures.papyrusMap, normalMap: textures.papyrusNormal!, roughnessMap: textures.papyrusRoughness! }
  };
}

function HeritageDetails({ world, castShadow, maps }: DetailProps) {
  return (
    <group raycast={() => null}>
      <FloorBorder width={16.4} depth={14.6} color="#8f653b" />
      <HeritageRugBorder />
      {/* Chair fronts point along local +Z; face the hearth beyond the table at -Z. */}
      <ChairCluster positions={[[-1.8, 0, 2.45, Math.PI - 0.2], [1.8, 0, 2.45, Math.PI + 0.2]]} upholstery="#23493d" frame="#5a351f" style="classic" castShadow={castShadow} maps={maps} />
      <PaperCluster positions={[[0.55, 0.97, 1.18, 0.04]]} color={world.scene.paper} normalMap={maps.paperNormal} />
      <InstancedBoxes
        transforms={[-0.76, -0.58, 0.58, 0.76].map((x) => ({ position: [x, 0.72, -9.24], scale: [0.035, 1.06, 0.035] }))}
        color="#3b2b22"
        metalness={0.58}
        roughness={0.42}
        castShadow={castShadow}
      />
      <mesh position={[0, 2.75, -9.5]} castShadow={castShadow}>
        <boxGeometry args={[3.7, 0.13, 0.34]} />
        <meshStandardMaterial color="#6c462d" roughness={0.66} />
      </mesh>
    </group>
  );
}

function HeritageRugBorder() {
  return <InstancedBoxes
    transforms={[[8.65, 4.95, 0.065], [8.3, 4.6, 0.025]].flatMap(([width, depth, band]) => [
      { position: [0, 0.032, 1.3 - depth / 2], scale: [width, 0.004, band] },
      { position: [0, 0.032, 1.3 + depth / 2], scale: [width, 0.004, band] },
      { position: [-width / 2, 0.032, 1.3], scale: [band, 0.004, depth] },
      { position: [width / 2, 0.032, 1.3], scale: [band, 0.004, depth] }
    ])}
    color="#8d744e" roughness={1} envMapIntensity={0.12} castShadow={false}
  />;
}

function GothicDetails(_props: DetailProps) {
  return (
    <group raycast={() => null}>
      <FloorBorder width={12.2} depth={19.2} color="#6e313f" />
    </group>
  );
}

function ModernDetails({ world, castShadow, maps }: DetailProps) {
  return (
    <group raycast={() => null}>
      <ModernBench position={[-5.2, 0, 2.8]} castShadow={castShadow} maps={maps} />
      <ModernBench position={[5.2, 0, 2.8]} castShadow={castShadow} maps={maps} />
      <InstancedBoxes
        transforms={[
          { position: [-4.8, 0.024, 0], scale: [4.1, 0.018, 0.075] },
          { position: [4.8, 0.024, 0], scale: [4.1, 0.018, 0.075] },
          { position: [0, 0.026, -4.75], scale: [0.075, 0.02, 3.1] }
        ]}
        color={world.scene.accent}
        emissive={world.scene.accent}
        emissiveIntensity={0.28}
        roughness={0.34}
        castShadow={false}
      />
    </group>
  );
}

function RenaissanceDetails(_props: DetailProps) {
  return (
    <group raycast={() => null}>
      <FloorBorder width={16.8} depth={17.4} color="#7f402d" />
    </group>
  );
}

function DecoDetails({ castShadow, maps }: DetailProps) {
  const seats: Array<[number, number, number, number]> = [
    [-2.65, 0, -2.65, Math.PI / 4], [2.65, 0, -2.65, -Math.PI / 4]
  ];
  return (
    <group raycast={() => null}>
      <ChairCluster positions={seats} upholstery="#125747" frame="#b28d4d" style="deco" castShadow={castShadow} maps={maps} />
      <DecoSideTable position={[-3.85, 0, -1.65]} castShadow={castShadow} maps={maps} />
      <DecoSideTable position={[3.85, 0, -1.65]} castShadow={castShadow} maps={maps} />
    </group>
  );
}

function FoundryDetails({ world, reducedMotion }: DetailProps & { reducedMotion: boolean }) {
  return (
    <group raycast={() => null}>
      <FoundryFloorCircuit />
      <FoundryRelayWall reducedMotion={reducedMotion} />
      <SignalGauges reducedMotion={reducedMotion} color={world.scene.accent} />
      <InstancedBoxes
        transforms={[-8.2, -4.1, 0, 4.1, 8.2].map((x) => ({ position: [x, 7.54, 1.95], scale: [0.9, 0.06, 0.08] }))}
        color="#d78a3f"
        emissive="#a75d29"
        emissiveIntensity={0.52}
        metalness={0.42}
        roughness={0.3}
        castShadow={false}
      />
    </group>
  );
}

type FoundryTransform = {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
};

function floorRouteSegment(start: [number, number], end: [number, number], width: number, height: number): FoundryTransform {
  const [startX, startZ] = start;
  const [endX, endZ] = end;
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  return {
    position: [(startX + endX) / 2, height / 2 + 0.012, (startZ + endZ) / 2],
    scale: [width, height, Math.hypot(deltaX, deltaZ)],
    rotation: [0, Math.atan2(deltaX, deltaZ), 0]
  };
}

const FOUNDRY_FLOOR_ROUTE_PAIRS: Array<[[number, number], [number, number]]> = [
  [[-1.55, 9.55], [-1.55, 5.05]],
  [[-1.55, 5.05], [-3.0, 4.05]],
  [[-3.0, 4.05], [-3.0, 0.35]],
  [[1.55, 9.55], [1.55, 5.05]],
  [[1.55, 5.05], [3.0, 4.05]],
  [[3.0, 4.05], [3.0, 0.35]]
];

const FOUNDRY_FLOOR_CHANNELS = FOUNDRY_FLOOR_ROUTE_PAIRS.map(([start, end]) => floorRouteSegment(start, end, 0.16, 0.024));
const FOUNDRY_FLOOR_SIGNALS = FOUNDRY_FLOOR_ROUTE_PAIRS.map(([start, end]) => floorRouteSegment(start, end, 0.035, 0.038));

function FoundryFloorCircuit() {
  return (
    <group name="Aether Index floor circuit" raycast={() => null}>
      <InstancedBoxes transforms={FOUNDRY_FLOOR_CHANNELS} color="#071116" metalness={0.62} roughness={0.38} castShadow={false} />
      <InstancedBoxes transforms={FOUNDRY_FLOOR_SIGNALS} color="#20d8d2" emissive="#20d8d2" emissiveIntensity={0.76} metalness={0.18} roughness={0.22} castShadow={false} />
      <InstancedBoxes
        transforms={[
          { position: [-3.0, 0.045, 0.35], scale: [0.28, 0.035, 0.28] },
          { position: [3.0, 0.045, 0.35], scale: [0.28, 0.035, 0.28] },
          { position: [-1.55, 0.045, 9.55], scale: [0.28, 0.035, 0.28] },
          { position: [1.55, 0.045, 9.55], scale: [0.28, 0.035, 0.28] }
        ]}
        color="#dd4d99"
        emissive="#dd4d99"
        emissiveIntensity={0.68}
        roughness={0.24}
        castShadow={false}
      />
    </group>
  );
}

function LunarDetails({ world, castShadow, maps }: DetailProps & { reducedMotion: boolean }) {
  return (
    <group raycast={() => null}>
      <ChairCluster positions={[[-1.8, 0, 1.75, Math.PI], [1.8, 0, 1.75, Math.PI]]} upholstery="#394954" frame="#91a1a8" style="tech" castShadow={castShadow} maps={maps} />
      <ControlPlinths positions={LUNAR_CONTROL_PLINTH_POSITIONS.map((position) => [...position])} accent={world.scene.accent} castShadow={castShadow} />
    </group>
  );
}

function ArkshipDetails({ world, castShadow, maps }: DetailProps) {
  return (
    <group raycast={() => null}>
      <ChairCluster positions={[[7.15, 0, -4.5, -Math.PI / 2], [7.15, 0, 4.5, -Math.PI / 2]]} upholstery="#374b55" frame="#758a93" style="tech" castShadow={castShadow} maps={maps} />
      <InstancedBoxes
        transforms={[-9.6, -3.2, 3.2, 9.6].map((z) => ({ position: [8.95, 0.88, z], scale: [0.16, 1.7, 2.1] }))}
        color="#202f38"
        metalness={0.42}
        roughness={0.48}
        castShadow={castShadow}
      />
      <InstancedBoxes
        transforms={[-9.6, -3.2, 3.2, 9.6].map((z, index) => ({ position: [8.84, 1.08, z], scale: [0.04, 0.09, 1.35], color: index % 2 ? world.scene.secondary : world.scene.accent }))}
        color={world.scene.accent}
        emissive={world.scene.accent}
        emissiveIntensity={0.52}
        roughness={0.26}
        castShadow={false}
      />
      <InstancedBoxes
        transforms={[
          { position: [-5.2, 0.025, 0], scale: [0.08, 0.02, 22.4] },
          { position: [5.2, 0.025, 0], scale: [0.08, 0.02, 22.4] }
        ]}
        color="#c9854d"
        emissive="#80502f"
        emissiveIntensity={0.38}
        roughness={0.32}
        castShadow={false}
      />
    </group>
  );
}

function AlexandriaDetails({ world, castShadow, maps }: DetailProps) {
  return (
    <group raycast={() => null}>
      <FloorBorder width={17.8} depth={17.2} color="#9a7043" />
      <ScholarDesk position={[-3.75, 0, -7.0]} castShadow={castShadow} maps={maps} />
      <ScholarDesk position={[3.75, 0, -7.0]} castShadow={castShadow} maps={maps} />
      <StoolCluster positions={[[-4.5, 0, -5.9], [4.5, 0, -5.9]]} wood="#6d4428" castShadow={castShadow} maps={maps} />
      <PaperCluster positions={[[-3.75, 0.91, -7.0, 0.04], [3.75, 0.91, -7.0, -0.04]]} color="#ddc99a" normalMap={maps.paperNormal} />
      <PapyrusBaskets positions={[[-5.9, 0, -5.8], [5.9, 0, -5.8]]} castShadow={castShadow} maps={maps} />
      <mesh position={[0, 0.019, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[3.21, 3.29, 96]} />
        <meshStandardMaterial color={world.scene.secondary} roughness={0.82} />
      </mesh>
    </group>
  );
}

type DetailProps = { world: WorldDefinition; castShadow: boolean; maps: FurnishingMaps };

function FloorBorder({ width, depth, color }: { width: number; depth: number; color: string }) {
  return (
    <InstancedBoxes
      transforms={[
        { position: [0, 0.022, -depth / 2], scale: [width, 0.02, 0.08] },
        { position: [0, 0.022, depth / 2], scale: [width, 0.02, 0.08] },
        { position: [-width / 2, 0.022, 0], scale: [0.08, 0.02, depth] },
        { position: [width / 2, 0.022, 0], scale: [0.08, 0.02, depth] }
      ]}
      color={color}
      metalness={0.08}
      roughness={0.82}
      castShadow={false}
    />
  );
}

function ModernBench({ position, castShadow, maps }: {
  position: [number, number, number];
  castShadow: boolean;
  maps: FurnishingMaps;
}) {
  return (
    <group position={position}>
      <RoundedBox position={[0, 0.54, 0]} args={[3.35, 0.28, 0.86]} radius={0.055} smoothness={4} castShadow={castShadow} receiveShadow>
        <meshPhysicalMaterial color="#e7e3da" map={maps.marble.map} normalMap={maps.marble.normalMap} normalScale={new THREE.Vector2(0.14, 0.14)} roughnessMap={maps.marble.roughnessMap} roughness={0.54} clearcoat={0.16} clearcoatRoughness={0.62} />
      </RoundedBox>
      <mesh position={[0, 0.39, 0]} castShadow={castShadow}>
        <boxGeometry args={[2.9, 0.12, 0.58]} />
        <meshStandardMaterial color="#2f3d45" normalMap={maps.metal.normalMap} roughnessMap={maps.metal.roughnessMap} roughness={0.38} metalness={0.58} />
      </mesh>
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
        <mesh key={`${x}:${z}`} position={[x * 1.32, 0.19, z * 0.27]} castShadow={castShadow}>
          <boxGeometry args={[0.12, 0.38, 0.12]} />
          <meshStandardMaterial color="#26343d" normalMap={maps.metal.normalMap} roughnessMap={maps.metal.roughnessMap} roughness={0.34} metalness={0.62} />
        </mesh>
      )))}
      <mesh position={[0, 0.21, 0]}>
        <boxGeometry args={[2.64, 0.07, 0.07]} />
        <meshStandardMaterial color="#26343d" roughness={0.34} metalness={0.62} />
      </mesh>
    </group>
  );
}

function DecoSideTable({ position, castShadow, maps }: {
  position: [number, number, number];
  castShadow: boolean;
  maps: FurnishingMaps;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0.08, 0]} castShadow={castShadow}>
        <cylinderGeometry args={[0.42, 0.48, 0.16, 12]} />
        <meshStandardMaterial color="#b99550" normalMap={maps.metal.normalMap} normalScale={new THREE.Vector2(0.12, 0.12)} roughness={0.48} metalness={0.84} envMapIntensity={0.42} />
      </mesh>
      <mesh position={[0, 0.42, 0]} castShadow={castShadow}>
        <cylinderGeometry args={[0.1, 0.14, 0.68, 12]} />
        <meshStandardMaterial color="#b99550" normalMap={maps.metal.normalMap} normalScale={new THREE.Vector2(0.12, 0.12)} roughness={0.48} metalness={0.84} envMapIntensity={0.42} />
      </mesh>
      <mesh position={[0, 0.78, 0]} castShadow={castShadow} receiveShadow>
        <cylinderGeometry args={[0.48, 0.48, 0.1, 24]} />
        <meshPhysicalMaterial color="#eee5d0" map={maps.marble.map} normalMap={maps.marble.normalMap} normalScale={new THREE.Vector2(0.12, 0.12)} roughnessMap={maps.marble.roughnessMap} roughness={0.34} clearcoat={0.34} clearcoatRoughness={0.38} />
      </mesh>
    </group>
  );
}

function ScholarDesk({ position, castShadow, maps }: {
  position: [number, number, number];
  castShadow: boolean;
  maps: FurnishingMaps;
}) {
  return (
    <group position={position}>
      <RoundedBox position={[0, 0.82, 0]} args={[2.55, 0.16, 1.02]} radius={0.045} smoothness={3} castShadow={castShadow} receiveShadow>
        <meshStandardMaterial color="#71482c" map={maps.wood.map} normalMap={maps.wood.normalMap} normalScale={new THREE.Vector2(0.24, 0.24)} roughnessMap={maps.wood.roughnessMap} roughness={0.66} />
      </RoundedBox>
      <mesh position={[0, 0.7, 0]}>
        <boxGeometry args={[2.18, 0.18, 0.72]} />
        <meshStandardMaterial color="#56321f" map={maps.wood.map} normalMap={maps.wood.normalMap} roughnessMap={maps.wood.roughnessMap} roughness={0.72} />
      </mesh>
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => (
        <mesh key={`${x}:${z}`} position={[x * 1.02, 0.34, z * 0.36]} castShadow={castShadow}>
          <boxGeometry args={[0.15, 0.68, 0.15]} />
          <meshStandardMaterial color="#4c2c1b" map={maps.wood.map} normalMap={maps.wood.normalMap} roughnessMap={maps.wood.roughnessMap} roughness={0.72} />
        </mesh>
      )))}
      <mesh position={[0, 0.34, 0]}>
        <boxGeometry args={[1.95, 0.08, 0.08]} />
        <meshStandardMaterial color="#9f6938" roughness={0.44} metalness={0.42} />
      </mesh>
    </group>
  );
}

type ChairStyle = "classic" | "gothic" | "deco" | "tech";

function ChairCluster({ positions, upholstery, frame, style, castShadow, maps }: {
  positions: Array<[number, number, number, number]>;
  upholstery: string;
  frame: string;
  style: ChairStyle;
  castShadow: boolean;
  maps: FurnishingMaps;
}) {
  const deco = style === "deco";
  const tech = style === "tech";
  const gothic = style === "gothic";
  const seatWidth = deco ? 1.42 : tech ? 1.3 : 1.34;
  const backHeight = gothic ? 1.18 : deco ? 0.9 : 0.98;
  const frameMaps = tech || deco ? maps.metal : maps.wood;
  const frameFinish = {
    roughness: deco ? 0.48 : tech ? 0.62 : 0.76,
    metalness: deco ? 0.78 : tech ? 0.5 : 0.02,
    envMapIntensity: deco ? 0.42 : tech ? 0.34 : 0.22
  };
  return (
    <group>
      {positions.map(([x, y, z, rotationY]) => (
        <group key={`${x}:${z}`} position={[x, y, z]} rotation-y={rotationY}>
          <RoundedBox position={[0, 0.55, 0]} args={[seatWidth, 0.24, 1.02]} radius={deco ? 0.13 : 0.075} smoothness={4} castShadow={castShadow} receiveShadow>
            <meshPhysicalMaterial color={upholstery} normalMap={maps.leather.normalMap} normalScale={new THREE.Vector2(0.2, 0.2)} roughness={deco ? 0.88 : 0.74} sheen={deco ? 0.42 : 0.12} sheenColor={new THREE.Color(upholstery)} clearcoat={tech ? 0.12 : 0.04} clearcoatRoughness={0.72} />
          </RoundedBox>
          <RoundedBox position={[0, 1.05 + (backHeight - 0.9) / 2, -0.43]} rotation-x={gothic ? -0.05 : -0.1} args={[seatWidth, backHeight, 0.2]} radius={deco ? 0.12 : 0.065} smoothness={4} castShadow={castShadow} receiveShadow>
            <meshPhysicalMaterial color={upholstery} normalMap={maps.leather.normalMap} normalScale={new THREE.Vector2(0.2, 0.2)} roughness={deco ? 0.9 : 0.76} sheen={deco ? 0.45 : 0.1} sheenColor={new THREE.Color(upholstery)} />
          </RoundedBox>
          {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
            <mesh key={`${sx}:${sz}`} position={[sx * (seatWidth / 2 - 0.15), 0.24, sz * 0.36]} castShadow={castShadow}>
              <cylinderGeometry args={[tech ? 0.055 : 0.07, tech ? 0.07 : 0.085, 0.48, deco ? 12 : 10]} />
              <meshStandardMaterial color={frame} map={frameMaps.map} normalMap={frameMaps.normalMap} normalScale={new THREE.Vector2(0.12, 0.12)} {...frameFinish} />
            </mesh>
          )))}
          {!tech && [-1, 1].map((side) => (
            <group key={side}>
              <mesh position={[side * (seatWidth / 2 + 0.03), 0.77, -0.02]} castShadow={castShadow}>
                <boxGeometry args={[0.08, 0.5, 0.08]} />
                <meshStandardMaterial color={frame} map={frameMaps.map} normalMap={frameMaps.normalMap} normalScale={new THREE.Vector2(0.12, 0.12)} {...frameFinish} />
              </mesh>
              <RoundedBox position={[side * (seatWidth / 2 + 0.03), 1.0, 0.08]} args={[0.13, 0.1, 0.72]} radius={0.035} smoothness={3}>
                <meshStandardMaterial color={deco ? frame : upholstery} normalMap={deco ? maps.metal.normalMap : maps.leather.normalMap} normalScale={new THREE.Vector2(0.12, 0.12)} roughness={deco ? 0.48 : 0.78} metalness={deco ? 0.78 : 0} envMapIntensity={0.42} />
              </RoundedBox>
            </group>
          ))}
          <mesh position={[0, 0.31, 0]}>
            <boxGeometry args={[seatWidth - 0.35, 0.065, 0.065]} />
            <meshStandardMaterial color={frame} map={frameMaps.map} normalMap={frameMaps.normalMap} normalScale={new THREE.Vector2(0.12, 0.12)} {...frameFinish} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function StoolCluster({ positions, wood, castShadow, maps }: { positions: Array<[number, number, number]>; wood: string; castShadow: boolean; maps: FurnishingMaps }) {
  return (
    <group>
      <InstancedCylinders transforms={positions.map((position) => ({ position: [position[0], 0.56, position[2]], scale: [0.42, 0.14, 0.42] }))} color={wood} map={maps.wood.map} normalMap={maps.wood.normalMap} roughnessMap={maps.wood.roughnessMap} roughness={0.68} metalness={0} castShadow={castShadow} />
      <InstancedCylinders
        transforms={positions.flatMap(([x, , z]) =>
          [-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => ({
              position: [x + sx * 0.24, 0.27, z + sz * 0.24] as [number, number, number],
              scale: [0.045, 0.54, 0.045] as [number, number, number]
            }))
          )
        )}
        color="#4b3020"
        map={maps.wood.map}
        normalMap={maps.wood.normalMap}
        roughnessMap={maps.wood.roughnessMap}
        roughness={0.7}
        metalness={0}
        castShadow={castShadow}
      />
      <InstancedBoxes
        transforms={positions.flatMap(([x, , z]) => [
          { position: [x, 0.23, z - 0.24] as [number, number, number], scale: [0.48, 0.055, 0.055] as [number, number, number] },
          { position: [x, 0.23, z + 0.24] as [number, number, number], scale: [0.48, 0.055, 0.055] as [number, number, number] },
          { position: [x - 0.24, 0.23, z] as [number, number, number], scale: [0.055, 0.055, 0.48] as [number, number, number] },
          { position: [x + 0.24, 0.23, z] as [number, number, number], scale: [0.055, 0.055, 0.48] as [number, number, number] }
        ])}
        color="#4b3020"
        map={maps.wood.map}
        normalMap={maps.wood.normalMap}
        roughnessMap={maps.wood.roughnessMap}
        roughness={0.72}
        metalness={0}
        castShadow={castShadow}
      />
    </group>
  );
}

function PaperCluster({ positions, color, normalMap }: { positions: Array<[number, number, number, number]>; color: string; normalMap: THREE.Texture }) {
  return (
    <InstancedBoxes
      transforms={positions.map(([x, y, z, rotationY]) => ({ position: [x, y, z], scale: [0.78, 0.018, 0.54], rotation: [0, rotationY, 0] }))}
      color={color}
      normalMap={normalMap}
      normalScale={0.12}
      roughness={0.94}
      castShadow={false}
    />
  );
}

function SignalGauges({ reducedMotion, color, position = [0, 2.25, 3.05] }: { reducedMotion: boolean; color: string; position?: [number, number, number] }) {
  const lights = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!lights.current) return;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 5; index += 1) {
      matrix.makeTranslation((index - 2) * 0.34, 0, 0);
      lights.current.setMatrixAt(index, matrix);
    }
    lights.current.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(({ clock }) => {
    if (!lights.current || reducedMotion) return;
    const material = lights.current.material;
    if (!Array.isArray(material)) material.opacity = 0.5 + Math.sin(clock.elapsedTime * 1.8) * 0.16;
  });
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[2.35, 0.5, 0.08]} />
        <meshStandardMaterial color="#111a1f" metalness={0.55} roughness={0.42} />
      </mesh>
      <instancedMesh ref={lights} args={[undefined, undefined, 5]} position={[0, 0, 0.055]}>
        <circleGeometry args={[0.075, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.66} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function ControlPlinths({ positions, accent, castShadow }: { positions: Array<[number, number, number]>; accent: string; castShadow: boolean }) {
  return (
    <group>
      <InstancedBoxes transforms={positions.map(([x, , z]) => ({ position: [x, 0.72, z], scale: [2.2, 1.2, 0.82], rotation: [-0.12, 0, 0] }))} color="#27343c" metalness={0.42} roughness={0.46} castShadow={castShadow} />
      <InstancedBoxes transforms={positions.map(([x, , z]) => ({ position: [x, 1.05, z + 0.42], scale: [1.68, 0.36, 0.035], rotation: [-0.12, 0, 0] }))} color={accent} emissive={accent} emissiveIntensity={0.38} roughness={0.28} castShadow={false} />
    </group>
  );
}

function PapyrusBaskets({ positions, castShadow, maps }: { positions: Array<[number, number, number]>; castShadow: boolean; maps: FurnishingMaps }) {
  return (
    <group>
      <InstancedCylinders transforms={positions.map(([x, , z]) => ({ position: [x, 0.42, z], scale: [0.46, 0.72, 0.46] }))} color="#8b5f37" map={maps.papyrus.map} normalMap={maps.papyrus.normalMap} roughnessMap={maps.papyrus.roughnessMap} roughness={0.88} metalness={0} castShadow={castShadow} />
      <InstancedCylinders
        transforms={positions.flatMap(([x, , z], basket) => Array.from({ length: 7 }, (_, index) => {
          const angle = index * 2.4 + basket;
          return {
            position: [x + Math.sin(angle) * 0.24, 0.83 + (index % 3) * 0.05, z + Math.cos(angle) * 0.24] as [number, number, number],
            scale: [0.045, 1.0, 0.045] as [number, number, number]
          };
        }))}
        color="#d0b275"
        normalMap={maps.papyrus.normalMap}
        roughnessMap={maps.papyrus.roughnessMap}
        roughness={0.92}
        metalness={0}
        castShadow={castShadow}
      />
    </group>
  );
}
