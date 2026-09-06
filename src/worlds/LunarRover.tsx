import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { ResolvedQuality } from "./types";
import { LUNAR_ROVER, lunarHeight } from "./lunarTerrain";

type Point = [number, number, number];
const finishes = {
  hull: { color: "#c6c8c1", metalness: 0.42, roughness: 0.48 },
  frame: { color: "#69777b", metalness: 0.75, roughness: 0.4 },
  insulation: { color: "#b58a48", metalness: 0.62, roughness: 0.45 },
  solar: { color: "#142c4c", metalness: 0.3, roughness: 0.32 },
  rubber: { color: "#333735", metalness: 0.12, roughness: 0.93 },
  optics: { color: "#87d3de", metalness: 0.3, roughness: 0.2, emissive: "#397782", emissiveIntensity: 0.2 }
} as const;
type Finish = keyof typeof finishes;

// Static fittings are merged by finish: a detailed vehicle with six draw batches.
export function createRoverFittings(quality: ResolvedQuality) {
  const parts: Record<Finish, THREE.BufferGeometry[]> = { hull: [], frame: [], insulation: [], solar: [], rubber: [], optics: [] };
  const add = (finish: Finish, geometry: THREE.BufferGeometry, position: Point, rotation: Point = [0, 0, 0]) => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    parts[finish].push(geometry.toNonIndexed());
    geometry.dispose();
  };
  const box = (finish: Finish, position: Point, size: Point, rotation?: Point) => add(finish, new THREE.BoxGeometry(...size), position, rotation);
  const strut = (a: Point, b: Point, radius: number, finish: Finish = "frame") => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 8);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    const centre = start.add(end).multiplyScalar(0.5);
    add(finish, geometry, [centre.x, centre.y, centre.z]);
  };
  box("frame", [0, 0.53, 0], [1.68, 0.16, 1.64]);
  box("hull", [0, 0.8, 0], [1.78, 0.4, 1.86]);
  box("insulation", [0, 1.04, -0.2], [1.56, 0.16, 1.23]);
  box("hull", [-0.42, 1.24, -0.35], [0.55, 0.26, 0.66]);
  box("frame", [0.42, 1.21, -0.39], [0.54, 0.2, 0.67]);
  for (let i = 0; i < 8; i++) box("hull", [0.42, 1.326, -0.66 + i * 0.075], [0.5, 0.018, 0.018]);
  // Front stereo navigation cameras and two recessed work lights.
  strut([0, 0.98, 0.64], [0, 1.63, 0.64], 0.045);
  box("hull", [0, 1.68, 0.66], [0.52, 0.18, 0.19]);
  for (const x of [-0.17, 0.17]) {
    add("frame", new THREE.CylinderGeometry(0.069, 0.069, 0.06, 16), [x, 1.68, 0.78], [Math.PI / 2, 0, 0]);
    add("optics", new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16), [x, 1.68, 0.815], [Math.PI / 2, 0, 0]);
  }
  for (const x of [-0.67, 0.67]) {
    box("frame", [x, 0.83, 0.96], [0.3, 0.18, 0.09]);
    box("optics", [x, 0.84, 1.01], [0.22, 0.09, 0.025]);
  }
  // Suspension arms, hub covers, and raised tire grousers.
  for (const x of [-1.08, 1.08]) for (const z of [-0.68, 0.68]) {
    strut([Math.sign(x) * 0.63, 0.65, z * 0.42], [x, 0.38, z], 0.075);
    strut([Math.sign(x) * 0.77, 0.83, z * 0.65], [x * 0.93, 0.4, z], 0.035, "insulation");
    add("frame", new THREE.CylinderGeometry(0.21, 0.21, 0.035, 16), [x + Math.sign(x) * 0.155, 0.38, z], [0, 0, Math.PI / 2]);
    add("insulation", new THREE.CylinderGeometry(0.075, 0.075, 0.043, 12), [x + Math.sign(x) * 0.18, 0.38, z], [0, 0, Math.PI / 2]);
    const treadCount = quality === "lite" ? 14 : 24;
    for (let i = 0; i < treadCount; i++) {
      const angle = i / treadCount * Math.PI * 2;
      box("rubber", [x, 0.38 + Math.cos(angle) * 0.418, z + Math.sin(angle) * 0.418], [0.29, 0.026, 0.042], [angle, 0, 0]);
    }
  }
  // Individually divided solar cells and the supporting outriggers.
  for (const side of [-1, 1]) {
    strut([side * 0.62, 0.91, -0.2], [side * 1.65, 1.19, -0.2], 0.045);
    box("hull", [side * 1.58, 1.2, -0.12], [1.26, 0.055, 1.34]);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
      box("solar", [side * 1.58 + (col - 2) * 0.239, 1.234, -0.12 + (row - 2) * 0.251], [0.224, 0.015, 0.234]);
    }
    for (const z of [-0.6, 0.36]) box("frame", [side * 1.58, 1.248, z], [1.19, 0.01, 0.012]);
  }
  // Mast, cable raceway, sample canisters, and a folded sampling arm.
  strut([0, 1.08, -0.51], [0, 1.98, -0.51], 0.055);
  strut([-0.69, 0.99, 0.54], [-0.76, 1.28, 0.14], 0.055);
  strut([-0.76, 1.28, 0.14], [-0.62, 1.33, -0.3], 0.043);
  box("insulation", [-0.61, 1.33, -0.37], [0.16, 0.14, 0.24]);
  for (const x of [0.2, 0.47, 0.7]) {
    add("hull", new THREE.CylinderGeometry(0.09, 0.09, 0.24, 12), [x, 1.15, 0.51]);
    add("insulation", new THREE.CylinderGeometry(0.095, 0.095, 0.027, 12), [x, 1.28, 0.51]);
  }
  return (Object.keys(parts) as Finish[]).map((finish) => {
    const geometry = mergeGeometries(parts[finish]);
    parts[finish].forEach((part) => part.dispose());
    if (!geometry) throw new Error("Unable to assemble rover fittings");
    return { finish, geometry };
  });
}

export function LunarSurveyRover({ quality, reducedMotion }: { quality: ResolvedQuality; reducedMotion: boolean }) {
  const dish = useRef<THREE.Group>(null);
  const fittings = useMemo(() => createRoverFittings(quality), [quality]);
  const profile = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const radius = i / 11 * 0.62;
    return new THREE.Vector2(radius, radius * radius * 0.48);
  }), []);
  useEffect(() => () => fittings.forEach(({ geometry }) => geometry.dispose()), [fittings]);
  useFrame(({ clock }) => {
    if (!reducedMotion && dish.current) dish.current.rotation.y = 0.3 + Math.sin(clock.elapsedTime * 0.035) * 0.25;
  });
  return <group name="Lunar survey rover"
    position={[LUNAR_ROVER.x, lunarHeight(LUNAR_ROVER.x, LUNAR_ROVER.z) + 0.043, LUNAR_ROVER.z]}
    rotation-y={LUNAR_ROVER.yaw} scale={LUNAR_ROVER.scale}>
    {fittings.map(({ finish, geometry }) => <mesh key={finish} name={`Rover ${finish} fittings`} geometry={geometry}>
      <meshStandardMaterial {...finishes[finish]} envMapIntensity={0.25} />
    </mesh>)}
    {[-1.08, 1.08].flatMap((x) => [-0.68, 0.68].map((z) => <mesh key={`${x}-${z}`} name="Rover tire" position={[x, 0.38, z]} rotation-z={Math.PI / 2}>
      <cylinderGeometry args={[0.42, 0.42, 0.28, 24]} />
      <meshStandardMaterial {...finishes.rubber} envMapIntensity={0} />
    </mesh>))}
    <group ref={dish} name="Steerable survey antenna" position={[0, 2.05, -0.51]} rotation-y={0.3}>
      <group rotation-x={Math.PI / 2 - 0.36}>
        <mesh><latheGeometry args={[profile, quality === "lite" ? 28 : 48]} />
          <meshStandardMaterial color="#c9ccc4" side={THREE.DoubleSide} metalness={0.52} roughness={0.43} />
        </mesh>
        <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.018, 0.025, 0.44, 8]} />
          <meshStandardMaterial color="#6b7373" metalness={0.6} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.44, 0]}><sphereGeometry args={[0.055, 12, 8]} />
          <meshStandardMaterial color="#be9856" metalness={0.62} roughness={0.4} />
        </mesh>
      </group>
    </group>
  </group>;
}
