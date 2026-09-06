import { useTexture } from "@react-three/drei";
import { InstancedBoxes } from "./shared";
import type { WorldDefinition } from "./types";

type Part = { position: [number, number, number]; scale: [number, number, number]; rotation?: [number, number, number] };

export function DecoEntrance({ world }: { world: WorldDefinition }) {
  const wood = useTexture({ map: "/worlds/assets/materials/shelf-wood-color.webp", normalMap: "/worlds/assets/materials/shelf-wood-normal.webp" });
  const panels: Part[] = [];
  const brass: Part[] = [];
  const glass: Part[] = [];
  for (const side of [-1, 1]) {
    panels.push({ position: [side * 0.795, 2.2, 0], scale: [1.58, 4.4, 0.2] });
    panels.push({ position: [side * 1.785, 2.25, -0.055], scale: [0.42, 4.5, 0.28] });
    for (const inset of [0, 1, 2]) {
      const x = 1.65 + inset * 0.15;
      const top = 4.48 + inset * 0.17;
      brass.push({ position: [side * x, top / 2, 0.14 - inset * 0.035], scale: [0.075, top, 0.09] });
      if (side === 1) brass.push({ position: [0, top, 0.14 - inset * 0.035], scale: [x * 2, 0.075, 0.09] });
    }
    // Fine border and rising fan inlays keep the doors calm at room scale.
    for (const dx of [-0.62, 0.62]) brass.push({ position: [side * 0.795 + dx, 2.2, 0.12], scale: [0.025, 4.05, 0.025] });
    for (const y of [0.18, 4.22]) brass.push({ position: [side * 0.795, y, 0.12], scale: [1.26, 0.025, 0.025] });
    for (const ray of [-1, 0, 1]) brass.push({ position: [side * 0.795 + ray * 0.19, 3.1 + Math.abs(ray) * 0.04, 0.13], scale: [0.025, 1.25, 0.025], rotation: [0, 0, -ray * 0.3] });
    brass.push({ position: [side * 0.16, 1.65, 0.23], scale: [0.055, 0.62, 0.1] });
    panels.push({ position: [side * 2.7, 3.05, 0.03], scale: [0.58, 1.5, 0.28] });
    glass.push({ position: [side * 2.7, 3.05, 0.2], scale: [0.25, 1.08, 0.2] });
    for (const y of [2.47, 3.63]) brass.push({ position: [side * 2.7, y, 0.2], scale: [0.43, 0.08, 0.32] });
  }
  panels.push({ position: [0, 4.6, -0.055], scale: [3.99, 0.58, 0.28] }, { position: [0, 2.2, -0.085], scale: [0.035, 4.4, 0.08] });
  brass.push({ position: [0, 0.045, 0.08], scale: [3.9, 0.09, 0.36] });
  return <group name="Deco stepped double doors and warm sconces">
    {world.boundary.placements.map((placement, index) => <group key={index} position={placement.position} rotation-y={placement.rotationY}>
      <InstancedBoxes transforms={panels} color="#45413a" {...wood} normalScale={0.14} roughness={0.62} metalness={0.08} castShadow={false} />
      <InstancedBoxes transforms={brass} color="#d5b776" roughness={0.38} metalness={0.72} castShadow={false} />
      <InstancedBoxes transforms={glass} color="#ffdf9e" emissive="#ffca79" emissiveIntensity={0.9} roughness={0.7} castShadow={false} />
      {[-1, 1].map((side) => <pointLight key={side} position={[side * 2.7, 3.1, 0.85]} color="#ffdc9f" intensity={14} distance={9} decay={2} castShadow={false} />)}
    </group>)}
  </group>;
}

export function RenaissanceEntrance({ world, castShadow }: { world: WorldDefinition; castShadow: boolean }) {
  const plaster = useTexture({ map: "/worlds/assets/materials/dome-plaster-color.webp", normalMap: "/worlds/assets/materials/dome-plaster-normal.webp" });
  const marble = useTexture({ map: "/worlds/assets/materials/marble-color.webp", normalMap: "/worlds/assets/materials/marble-normal.webp" });
  const walls: Part[] = [
    ...[-1, 1].map((side): Part => ({ position: [side * 6.3, 3.65, -0.08], scale: [8.6, 7.3, 0.34] })),
    { position: [0, 6.05, -0.08], scale: [4, 2.5, 0.34] },
    ...[-1, 1].map((side): Part => ({ position: [side * 10.44, 3.65, -0.4], scale: [0.4, 7.3, 1.05] })),
    { position: [0, 6.73, 0.1], scale: [21.2, 0.35, 0.28] }
  ];
  const stone: Part[] = [
    ...[-1, 1].map((side): Part => ({ position: [side * 2.18, 2.45, 0.19], scale: [0.3, 4.9, 0.28] })),
    { position: [0, 4.94, 0.19], scale: [4.66, 0.22, 0.28] },
    { position: [0, 5.14, 0.17], scale: [4.96, 0.16, 0.34] },
    { position: [0, 0.08, 0.15], scale: [4.65, 0.16, 0.36] },
    ...[-1, 1].map((side): Part => ({ position: [side * 6.5, 0.25, 0.08], scale: [8.05, 0.5, 0.22] }))
  ];
  const bronze: Part[] = [{ position: [0, 5.28, 0.13], scale: [4.66, 0.055, 0.23] }];
  return <group name="Renaissance plaster and marble entrance">
    {world.boundary.placements.map((placement, index) => <group key={index} position={placement.position} rotation-y={placement.rotationY}>
      <InstancedBoxes transforms={walls} color="#d0c19c" {...plaster} normalScale={0.13} roughness={0.92} metalness={0} castShadow={castShadow} />
      <InstancedBoxes transforms={stone} color="#c8bba4" {...marble} normalScale={0.2} roughness={0.68} metalness={0.02} castShadow={castShadow} />
      <InstancedBoxes transforms={bronze} color="#ad7b3e" roughness={0.5} metalness={0.65} castShadow={false} />
    </group>)}
  </group>;
}
