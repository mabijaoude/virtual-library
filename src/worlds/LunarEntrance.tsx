import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { InstancedBoxes } from "./shared";
import type { WorldDefinition } from "./types";

export const LUNAR_AFT_WALL = { minX: -10.6, maxX: 10.6, height: 6.58 } as const;

function outline(points: number[][]) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return shape;
}

export function createAirlockGeometry() {
  const frame = outline([[-2.12, 0], [2.12, 0], [2.12, 4.35], [1.72, 4.78], [-1.72, 4.78], [-2.12, 4.35]]);
  frame.holes.push(outline([[-1.76, 0.14], [-1.76, 4.14], [-1.48, 4.44], [1.48, 4.44], [1.76, 4.14], [1.76, 0.14]]));
  const leaf = outline([[0.05, 0.17], [1.5, 0.17], [1.72, 0.39], [1.72, 4.09], [1.44, 4.4], [0.05, 4.4]]);
  const options = { depth: 0.16, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.025, bevelSegments: 2, steps: 1 };
  return { frame: new THREE.ExtrudeGeometry(frame, options), leaf: new THREE.ExtrudeGeometry(leaf, { ...options, depth: 0.11 }) };
}

export function LunarEntrance({ world }: { world: WorldDefinition }) {
  const geometry = useMemo(createAirlockGeometry, []);
  const sign = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 256;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#172a34"; context.fillRect(0, 0, 1024, 256);
    context.textAlign = "center"; context.fillStyle = "#e7eef0";
    context.font = "500 66px sans-serif"; context.fillText("HABITAT  /  01", 512, 106);
    context.fillStyle = "#94c7d3"; context.font = "30px sans-serif";
    context.fillText("PRESSURIZED  /  INTERNAL TRANSFER", 512, 185);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }, []);
  useEffect(() => () => { geometry.frame.dispose(); geometry.leaf.dispose(); sign.dispose(); }, [geometry, sign]);
  const doorX = world.boundary.placements[0].position[0];
  const left = doorX - LUNAR_AFT_WALL.maxX, right = doorX - LUNAR_AFT_WALL.minX;
  const wall = [
    { position: [(left - 1.75) / 2, 3.29, -0.045] as [number, number, number], scale: [-1.75 - left, 6.58, 0.3] as [number, number, number] },
    { position: [(right + 1.75) / 2, 3.29, -0.045] as [number, number, number], scale: [right - 1.75, 6.58, 0.3] as [number, number, number] },
    { position: [0, 5.49, -0.045] as [number, number, number], scale: [3.5, 2.18, 0.3] as [number, number, number] }
  ];
  return <group name="Lunar habitat entrance" position={world.boundary.placements[0].position} rotation-y={Math.PI} raycast={() => null}>
    <group name="Continuous aft hull finish">
      <InstancedBoxes transforms={wall} color="#9aa9b0" roughness={0.78} metalness={0.12} castShadow={false} />
      <InstancedBoxes transforms={[
        { position: [(left + right) / 2, 0.13, 0.09], scale: [right - left, 0.26, 0.08] },
        { position: [(left + right) / 2, 6.4, 0.15], scale: [right - left, 0.2, 0.12] }
      ]} color="#41545e" roughness={0.58} metalness={0.35} castShadow={false} />
    </group>
    <mesh name="Airlock gasket" position={[0, 2.25, 0.12]}><boxGeometry args={[3.66, 4.5, 0.12]} />
      <meshStandardMaterial color="#101d25" roughness={0.8} /></mesh>
    <mesh name="Chamfered pressure frame" geometry={geometry.frame} position={[0, 0, 0.24]}>
      <meshStandardMaterial color="#b1c1c7" metalness={0.65} roughness={0.36} /></mesh>
    {[-1, 1].map(side => <group key={side}>
      <mesh name="Sealed airlock leaf" geometry={geometry.leaf} scale-x={side} position={[0, 0, 0.22]}>
        <meshStandardMaterial color="#425e6d" metalness={0.45} roughness={0.46} side={THREE.DoubleSide} /></mesh>
      <mesh name="Inspection port bezel" position={[side * 0.88, 3.15, 0.39]}>
        <torusGeometry args={[0.29, 0.055, 12, 40]} /><meshStandardMaterial color="#b6c8cc" metalness={0.72} roughness={0.3} /></mesh>
      <mesh name="Inspection port" position={[side * 0.88, 3.15, 0.4]}>
        <circleGeometry args={[0.255, 40]} /><meshStandardMaterial color="#142e3e" metalness={0.58} roughness={0.2} emissive="#284c5c" emissiveIntensity={0.15} /></mesh>
      <InstancedBoxes transforms={[
        { position: [side * 0.88, 0.7, 0.36], scale: [1.28, 0.32, 0.055] },
        { position: [side * 0.88, 2.48, 0.36], scale: [1.22, 0.035, 0.04] },
        ...[1.25, 2.2, 3.7].map(y => ({ position: [side * 1.63, y, 0.44] as [number, number, number], scale: [0.2, 0.24, 0.14] as [number, number, number] }))
      ]} color="#859ca6" roughness={0.4} metalness={0.62} castShadow={false} />
      <mesh position={[side * 1.91, 2.6, 0.43]}><boxGeometry args={[0.035, 2.65, 0.025]} />
        <meshBasicMaterial color="#9ed5df" /></mesh>
    </group>)}
    <group name="Manual pressure latch" position={[0, 1.65, 0.53]}>
      <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.12, 0.12, 0.23, 24]} /><meshStandardMaterial color="#a9bac0" metalness={0.65} roughness={0.36} /></mesh>
      <mesh><torusGeometry args={[0.23, 0.035, 10, 36]} /><meshStandardMaterial color="#c8a568" metalness={0.65} roughness={0.34} /></mesh>
      <InstancedBoxes transforms={[0, Math.PI / 2].map(angle => ({ position: [0, 0, 0] as [number, number, number], scale: [0.43, 0.035, 0.05] as [number, number, number], rotation: [0, 0, angle] as [number, number, number] }))} color="#c8a568" roughness={0.34} metalness={0.65} castShadow={false} />
    </group>
    <mesh name="Airlock identification" position={[0, 5.35, 0.19]}><planeGeometry args={[3.35, 0.84]} /><meshBasicMaterial map={sign} /></mesh>
  </group>;
}
