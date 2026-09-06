import { useMemo } from "react";
import * as THREE from "three";
import { InstancedBoxes } from "./shared";
import { RenaissanceInstances, URN_PROFILE, useLoggiaStone } from "./RenaissanceGarden";
import { gardenPart, RENAISSANCE_GARDEN, type GardenPart } from "./renaissanceGardenDesign";

export function RenaissanceGallery() {
  const maps = useLoggiaStone();
  return <group name="Three studies in stone and bronze" raycast={() => null}>
    <GalleryFrames maps={maps} />
    {RENAISSANCE_GARDEN.reliefs.map((relief) => <group key={relief.kind} position={[...relief.position]} rotation-y={relief.rotationY} scale={[...relief.scale]}>
      {relief.kind === "celestial" ? <CelestialRelief /> : relief.kind === "botanical" ? <BotanicalRelief maps={maps} /> : <RosetteRelief maps={maps} />}
    </group>)}
  </group>;
}

export function buildGalleryFrames() {
  const border = [
    ...[-0.76, 0.76].map((x) => gardenPart(x, 0, 0.015, 0.1, 2.28, 0.2)),
    ...[-1.14, 1.14].map((y) => gardenPart(0, y, 0.015, 1.62, 0.14, 0.24)),
    gardenPart(0, -1.25, 0.06, 1.78, 0.12, 0.34),
    gardenPart(0, 1.27, 0.015, 1.78, 0.12, 0.3)
  ];
  const place = (parts: GardenPart[]) => RENAISSANCE_GARDEN.reliefs.flatMap((relief) => parts.map((part): GardenPart => {
    const [sx, sy, sz] = relief.scale;
    const [x, y, z] = part.position;
    return {
      position: [relief.position[0] + Math.sin(relief.rotationY) * z * sz, relief.position[1] + y * sy, relief.position[2] - Math.sin(relief.rotationY) * x * sx],
      scale: [part.scale[0] * sx, part.scale[1] * sy, part.scale[2] * sz], rotation: [0, relief.rotationY, 0]
    };
  }));
  return {
    border: place(border),
    backing: place([gardenPart(0, 0, -0.025, 1.44, 2.16, 0.16)]),
    bronze: place([-0.69, 0.69].map((x) => gardenPart(x, 0, 0.09, 0.022, 2.1, 0.025)))
  };
}

function GalleryFrames({ maps }: { maps: ReturnType<typeof useLoggiaStone> }) {
  const frames = useMemo(buildGalleryFrames, []);
  return <group>
    <InstancedBoxes transforms={frames.backing} color="#9c7653" roughness={0.9} castShadow={false} />
    <InstancedBoxes transforms={frames.border} color="#c4b69a" {...maps} normalScale={0.1} roughness={0.58} metalness={0.03} castShadow={false} />
    <InstancedBoxes transforms={frames.bronze} color="#98733f" roughness={0.53} metalness={0.5} castShadow={false} />
  </group>;
}

function CelestialRelief() {
  const ticks = useMemo(() => Array.from({ length: 24 }, (_, i): GardenPart => {
    const a = i * Math.PI / 12;
    return { position: [Math.cos(a) * 0.565, Math.sin(a) * 0.565 + 0.12, 0.14], scale: [i % 3 ? 0.035 : 0.08, 0.012, 0.02], rotation: [0, 0, a] };
  }), []);
  const rings = useMemo(() => [gardenPart(0, 0.12, 0.15, 0.62, 0.62, 0.62), gardenPart(0, 0.12, 0.18, 0.49, 0.49, 0.49),
    { ...gardenPart(0, 0.12, 0.22, 0.23, 0.47, 0.3), rotation: [0, 0, -0.38] as [number, number, number] }], []);
  return <group name="Celestial geometry in bronze">
    <mesh position={[0, 0.12, 0.075]}><circleGeometry args={[0.66, 48]} /><meshStandardMaterial color="#334b60" roughness={0.7} /></mesh>
    <RenaissanceInstances parts={rings}><torusGeometry args={[1, 0.028, 6, 48]} /><meshStandardMaterial color="#b69960" metalness={0.65} roughness={0.43} /></RenaissanceInstances>
    <InstancedBoxes transforms={ticks} color="#c7af77" metalness={0.48} roughness={0.5} castShadow={false} />
    <mesh position={[0, 0.12, 0.23]}><sphereGeometry args={[0.092, 16, 10]} /><meshStandardMaterial color="#c7af77" metalness={0.6} roughness={0.38} /></mesh>
    <InstancedBoxes transforms={[gardenPart(0, -0.7, 0.12, 0.73, 0.028, 0.025), gardenPart(0, -0.81, 0.12, 0.4, 0.018, 0.025)]} color="#ae8b55" metalness={0.4} roughness={0.58} castShadow={false} />
  </group>;
}

function BotanicalRelief({ maps }: { maps: ReturnType<typeof useLoggiaStone> }) {
  const leaves = useMemo(() => [-1, 1].flatMap((side) => Array.from({ length: 6 }, (_, i): GardenPart => ({
    position: [side * (0.16 + Math.sin(i * 0.44) * 0.33), -0.11 + i * 0.15, 0.13],
    scale: [0.07, 0.14, 0.038], rotation: [0, 0, -side * (0.5 + i * 0.08)]
  }))), []);
  return <group name="Laurel and carved vessel relief">
    <RenaissanceInstances parts={[gardenPart(0, -0.85, 0.08, 0.78, 0.78, 0.33)]}>
      <latheGeometry args={[URN_PROFILE, 24]} /><meshStandardMaterial color="#ded1b2" {...maps} roughness={0.61} normalScale={new THREE.Vector2(0.08, 0.08)} />
    </RenaissanceInstances>
    <InstancedBoxes transforms={[gardenPart(0, -0.93, 0.11, 0.8, 0.13, 0.25), gardenPart(0, 0.22, 0.11, 0.025, 1.3, 0.025)]} color="#cfbc92" roughness={0.65} castShadow={false} />
    <RenaissanceInstances parts={leaves}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#9e996e" metalness={0.12} roughness={0.67} /></RenaissanceInstances>
  </group>;
}

function RosetteRelief({ maps }: { maps: ReturnType<typeof useLoggiaStone> }) {
  const petals = useMemo(() => Array.from({ length: 8 }, (_, i): GardenPart => {
    const a = i * Math.PI / 4;
    return { position: [Math.cos(a) * 0.36, Math.sin(a) * 0.36 + 0.12, 0.12], scale: [0.28, 0.105, 0.035], rotation: [0, 0, a] };
  }), []);
  return <group name="Pietra dura floral study">
    <mesh position={[0, 0.12, 0.08]}><circleGeometry args={[0.64, 48]} /><meshStandardMaterial color="#d4c6a6" {...maps} roughness={0.6} /></mesh>
    <RenaissanceInstances parts={petals}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#344e61" metalness={0.06} roughness={0.52} /></RenaissanceInstances>
    <mesh position={[0, 0.12, 0.15]}><sphereGeometry args={[0.095, 16, 10]} /><meshStandardMaterial color="#bca26a" metalness={0.55} roughness={0.4} /></mesh>
    <InstancedBoxes transforms={[-1, 1].flatMap((side) => [-0.86, 0.87].map((y): GardenPart => ({ position: [side * 0.51, y, 0.11], scale: [0.1, 0.1, 0.035], rotation: [0, 0, Math.PI / 4] })))} color="#344e61" roughness={0.6} castShadow={false} />
  </group>;
}
