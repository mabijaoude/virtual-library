import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { InstancedBoxes, InstancedCylinders } from "./shared";
import { advanceRelayPhase, FOUNDRY_RELAY } from "./foundryRelayDesign";

type Part = { position: [number, number, number]; scale: [number, number, number]; rotation?: [number, number, number] };
type Ring = { x: number; y: number; z: number; radius: number; depth?: number };

function part(x: number, y: number, z: number, width: number, height: number, depth: number, angle = 0): Part {
  return { position: [x, y, z], scale: [width, height, depth], rotation: [0, 0, angle] };
}

export function buildRelayParts() {
  const casings: Part[] = [];
  const copper: Part[] = [];
  const contacts: Part[] = [];
  const darkDiscs: Part[] = [];
  const rings: Ring[] = [];
  for (const x of FOUNDRY_RELAY.centers) {
    casings.push(part(x, 3.8, 0.03, 3.8, 5.8, 0.22));
    casings.push(part(x, 1.38, 0.3, 3.55, 0.72, 0.58));
    for (const side of [-1, 1]) {
      copper.push(part(x + side * 1.78, 3.82, 0.22, 0.12, 5.75, 0.22));
      casings.push(part(x + side * 1.64, 3.8, 0.17, 0.17, 5.55, 0.26));
      for (const y of [1.07, 2.4, 6.59]) copper.push(part(x + side * 1.77, y, 0.36, 0.2, 0.16, 0.12));
    }
    for (const y of [1, 2.48, 6.62]) copper.push(part(x, y, 0.22, 3.65, 0.12, 0.22));
    darkDiscs.push({ position: [x, FOUNDRY_RELAY.centerY, 0.27], scale: [1.7, 0.32, 1.7], rotation: [Math.PI / 2, 0, 0] });
    // The plain circular rotor web bridges the backing to the vanes and hub;
    // its rotationally symmetric face can share the existing cylinder batch.
    darkDiscs.push({ position: [x, FOUNDRY_RELAY.centerY, 0.525], scale: [1.13, 0.2, 1.13], rotation: [Math.PI / 2, 0, 0] });
    for (const radius of [1.68, 1.46, 0.51]) rings.push({ x, y: FOUNDRY_RELAY.centerY, z: radius === 0.51 ? 0.71 : 0.57, radius });
    // Four narrow standoffs overlap both the recess and fixed outer collar.
    for (let support = 0; support < 4; support++) {
      const angle = support * Math.PI / 2;
      copper.push(part(x + Math.cos(angle) * 1.57, FOUNDRY_RELAY.centerY + Math.sin(angle) * 1.57,
        0.48, 0.32, 0.07, 0.2, angle));
    }
    // Radial copper windings sit in front of the dark machined recess.
    for (let i = 0; i < 28; i++) {
      const angle = i * Math.PI * 2 / 28;
      copper.push(part(x + Math.cos(angle) * 1.36, FOUNDRY_RELAY.centerY + Math.sin(angle) * 1.36, 0.54, 0.22, 0.09, 0.22, angle));
      contacts.push(part(x + Math.cos(angle) * 1.58, FOUNDRY_RELAY.centerY + Math.sin(angle) * 1.58, 0.65, i % 7 === 0 ? 0.16 : 0.08, 0.027, 0.025, angle));
    }
    // Shallow inspection meters and a finned power supply ground the rings.
    for (const dx of [-0.95, 0, 0.95]) {
      casings.push(part(x + dx, 2.03, 0.29, 0.7, 0.52, 0.18));
      copper.push(part(x + dx, 2.03, 0.395, 0.57, 0.36, 0.04));
      casings.push(part(x + dx, 2.03, 0.425, 0.5, 0.29, 0.025));
      for (let mark = 0; mark < 5; mark++) contacts.push(part(x + dx - 0.18 + mark * 0.09, 2.02, 0.449, 0.028, 0.06 + (4 - mark) * 0.025, 0.018));
    }
    for (let fin = 0; fin < 13; fin++) copper.push(part(x - 1.38 + fin * 0.23, 1.38, 0.61, 0.07, 0.46, 0.08));
  }
  // A single physical bridge joins the chambers above the shutter, leaving
  // the doorway clear. Outboard service banks stay behind the shelf lane.
  casings.push(part(0, 6.92, 0.03, 14.7, 0.38, 0.22));
  for (const y of [6.82, 7.04]) copper.push(part(0, y, 0.19, 14.5, 0.055, 0.1));
  for (const side of [-1, 1]) {
    // Keep shallow wall fittings behind the bounds' physical wall plane,
    // including the camera's 0.32 m radius at the southern walking limit.
    casings.push(part(side * 9.24, 3.87, -0.04, 2.3, 5.4, 0.12));
    for (const dx of [-0.68, -0.22, 0.22, 0.68]) {
      copper.push(part(side * (9.24 + dx), 3.88, 0.06, 0.07, 4.95, 0.06));
      for (const y of [1.5, 3.9, 6.2]) contacts.push(part(side * (9.24 + dx), y, 0.105, 0.19, 0.08, 0.025));
    }
  }
  return { casings, copper, contacts, darkDiscs, rings };
}

function RingBatch({ rings, color, glow = false }: { rings: Ring[]; color: string; glow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      matrix.compose(new THREE.Vector3(ring.x, ring.y, ring.z), new THREE.Quaternion(), new THREE.Vector3(ring.radius, ring.radius, ring.depth || 1));
      ref.current?.setMatrixAt(i, matrix);
    }
    if (ref.current) { ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere(); }
  }, [rings]);
  return <instancedMesh ref={ref} args={[undefined, undefined, rings.length]} castShadow={false} receiveShadow={!glow}>
    <torusGeometry args={[1, glow ? 0.016 : 0.035, 6, 64]} />
    <meshStandardMaterial color={color} metalness={glow ? 0.15 : 0.65} roughness={glow ? 0.35 : 0.4} emissive={color} emissiveIntensity={glow ? 0.78 : 0.025} />
  </instancedMesh>;
}

function RelayRotor({ x, side, reducedMotion }: { x: number; side: number; reducedMotion: boolean }) {
  const rotor = useRef<THREE.Group>(null);
  const markers = useRef<THREE.InstancedMesh>(null);
  const phase = useRef(0);
  const scratch = useMemo(() => ({ matrix: new THREE.Matrix4(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(0.045, 0.045, 0.045) }), []);
  const color = side < 0 ? "#37d6d3" : "#db659f";
  const blades = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4;
    return part(Math.cos(a) * 0.83, Math.sin(a) * 0.83, 0, 0.22, 0.59, 0.065, a - 0.48);
  }), []);
  const rings = useMemo(() => [{ x: 0, y: 0, z: 0.655, radius: 1.15 }, { x: 0, y: 0, z: 0.735, radius: 0.36 }], []);
  useFrame((_, delta) => {
    phase.current = advanceRelayPhase(phase.current, delta, reducedMotion);
    if (rotor.current) rotor.current.rotation.z = side * phase.current * FOUNDRY_RELAY.rotorSpeed + side * 0.22;
    if (markers.current) {
      for (let i = 0; i < 2; i++) {
        const a = side * phase.current * FOUNDRY_RELAY.markerSpeed + i * Math.PI;
        scratch.position.set(Math.cos(a) * FOUNDRY_RELAY.markerRadius, Math.sin(a) * FOUNDRY_RELAY.markerRadius, 0.75);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        markers.current.setMatrixAt(i, scratch.matrix);
      }
      markers.current.instanceMatrix.needsUpdate = true;
    }
  });
  return <group position={[x, FOUNDRY_RELAY.centerY, 0]}>
    <group ref={rotor} position-z={0.63} rotation-z={side * 0.22}>
      <InstancedBoxes transforms={blades} color="#728b88" metalness={0.75} roughness={0.37} emissive="#193534" emissiveIntensity={0.12} castShadow={false} />
    </group>
    <RingBatch rings={rings} color={color} glow />
    <mesh position={[0, 0, 0.665]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.4, 0.47, 0.15, 32]} />
      <meshStandardMaterial color="#203e45" metalness={0.65} roughness={0.38} />
    </mesh>
    <mesh position-z={0.748}>
      <circleGeometry args={[0.285, 32]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.65} roughness={0.3} metalness={0.2} />
    </mesh>
    <instancedMesh ref={markers} args={[undefined, undefined, 2]} frustumCulled={false} castShadow={false}>
      <sphereGeometry args={[1, 10, 6]} />
      <meshBasicMaterial color={side < 0 ? "#b2fff1" : "#ffc0d8"} toneMapped={false} />
    </instancedMesh>
  </group>;
}

export function FoundryRelayWall({ reducedMotion }: { reducedMotion: boolean }) {
  const parts = useMemo(buildRelayParts, []);
  const traces = useMemo(() => FOUNDRY_RELAY.centers.map((x) => [
    part(x, 6.92, 0.2, 3.25, 0.05, 0.035),
    part(x, 2.5, 0.41, 2.75, 0.028, 0.025)
  ]), []);
  return <group name="Foundry twin aether relay chambers" raycast={() => null}>
    <group position={[0, 0, FOUNDRY_RELAY.wallZ]} rotation-y={Math.PI}>
      <InstancedBoxes transforms={parts.casings} color="#26373e" metalness={0.5} roughness={0.57} castShadow={false} />
      <InstancedBoxes transforms={parts.copper} color="#c18a56" metalness={0.65} roughness={0.4} emissive="#533221" emissiveIntensity={0.08} castShadow={false} />
      <InstancedBoxes transforms={parts.contacts} color="#bad1c5" metalness={0.55} roughness={0.46} emissive="#506c61" emissiveIntensity={0.14} castShadow={false} />
      <InstancedCylinders transforms={parts.darkDiscs} color="#0b1c23" roughness={0.52} metalness={0.42} castShadow={false} />
      <RingBatch rings={parts.rings} color="#b88959" />
      {FOUNDRY_RELAY.centers.map((x, i) => <RelayRotor key={x} x={x} side={i === 0 ? -1 : 1} reducedMotion={reducedMotion} />)}
      {traces.map((transforms, i) => <InstancedBoxes key={i} transforms={transforms} color={i === 0 ? "#2cc5c4" : "#d868a4"} emissive={i === 0 ? "#2cc5c4" : "#d868a4"} emissiveIntensity={0.65} roughness={0.4} castShadow={false} />)}
    </group>
    <pointLight position={[-5.4, 4.35, 8.65]} color="#e2a9c1" intensity={8} distance={7.5} decay={2} castShadow={false} />
    <pointLight position={[5.4, 4.35, 8.65]} color="#a4e9de" intensity={8} distance={7.5} decay={2} castShadow={false} />
  </group>;
}
