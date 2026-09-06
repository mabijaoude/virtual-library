import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { InstancedBoxes } from "./shared";

// A daylight armillary: a grounded dial, a fixed meridian and a slowly
// turning inner orbit. All details share the existing desk's footprint.
export function ModernDaylightIndex({ reducedMotion }: { reducedMotion: boolean }) {
  const orbit = useRef<THREE.Group>(null);
  const dial = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const angle = i / 60 * Math.PI * 2;
    return { position: [Math.sin(angle) * 1.42, 1.565, Math.cos(angle) * 1.42] as [number, number, number],
      scale: [0.018, 0.012, i % 5 === 0 ? 0.16 : 0.065] as [number, number, number],
      rotation: [0, angle, 0] as [number, number, number] };
  }), []);
  const label = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 160;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#25323a"; context.fillRect(0, 0, 768, 160);
    context.textAlign = "center"; context.fillStyle = "#e6dfcc";
    context.font = "500 36px sans-serif"; context.fillText("THE DAYLIGHT INDEX", 384, 65);
    context.fillStyle = "#9dbbc5"; context.font = "22px sans-serif";
    context.fillText("LIGHT  /  TIME  /  PERSPECTIVE", 384, 112);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  useEffect(() => () => label.dispose(), [label]);
  useFrame((_, delta) => { if (!reducedMotion && orbit.current) orbit.current.rotation.y += delta * 0.075; });
  return <group name="Daylight armillary" raycast={() => null}>
    <mesh position={[0, 1.32, 0]}><cylinderGeometry args={[1.73, 1.73, 0.35, 96]} />
      <meshStandardMaterial color="#35434a" metalness={0.72} roughness={0.32} /></mesh>
    <mesh position={[0, 1.505, 0]}><cylinderGeometry args={[1.69, 1.73, 0.06, 96]} />
      <meshStandardMaterial color="#c2b390" metalness={0.78} roughness={0.3} /></mesh>
    <mesh position={[0, 1.54, 0]}><cylinderGeometry args={[1.59, 1.59, 0.025, 96]} />
      <meshStandardMaterial color="#243d4c" metalness={0.48} roughness={0.38} /></mesh>
    <InstancedBoxes transforms={dial} color="#d4c49c" metalness={0.75} roughness={0.32} castShadow={false} />
    {[1.24, 1.62].map(radius => <mesh key={radius} position={[0, 1.562, 0]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[radius, 0.008, 8, 96]} />
      <meshStandardMaterial color="#c2b390" metalness={0.7} roughness={0.3} /></mesh>)}
    <mesh position={[0, 1.64, 0]}><cylinderGeometry args={[0.32, 0.42, 0.17, 48]} />
      <meshStandardMaterial color="#bec7c7" metalness={0.8} roughness={0.26} /></mesh>
    <mesh position={[0, 1.88, 0]}><cylinderGeometry args={[0.075, 0.13, 0.35, 24]} />
      <meshStandardMaterial color="#667e89" metalness={0.8} roughness={0.26} /></mesh>
    <group position={[0, 2.73, 0]}>
      <mesh><torusGeometry args={[0.84, 0.037, 12, 96]} />
        <meshStandardMaterial color="#c6b58c" metalness={0.84} roughness={0.26} /></mesh>
      <group ref={orbit} rotation-y={0.65}>
        <mesh rotation-x={0.38}><torusGeometry args={[0.72, 0.025, 12, 96]} />
          <meshStandardMaterial color="#367da0" metalness={0.74} roughness={0.25} /></mesh>
        <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.57, 0.019, 12, 80]} />
          <meshStandardMaterial color="#cbd8d8" metalness={0.8} roughness={0.24} /></mesh>
        <mesh position={[0.67, 0, 0]}><sphereGeometry args={[0.065, 20, 12]} />
          <meshStandardMaterial color="#dbb66d" metalness={0.7} roughness={0.26} /></mesh>
      </group>
      <mesh><icosahedronGeometry args={[0.25, 1]} />
        <meshStandardMaterial color="#83c3d5" emissive="#397d98" emissiveIntensity={0.32} metalness={0.5} roughness={0.22} /></mesh>
      <mesh><cylinderGeometry args={[0.022, 0.022, 1.73, 16]} />
        <meshStandardMaterial color="#c7d0cf" metalness={0.82} roughness={0.25} /></mesh>
      {[-0.85, 0.85].map(y => <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.075, 0.075, 0.11, 24]} />
        <meshStandardMaterial color="#c2b390" metalness={0.8} roughness={0.27} /></mesh>)}
    </group>
    <mesh position={[0, 1.58, 1.04]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[0.94, 0.196]} /><meshBasicMaterial map={label} /></mesh>
  </group>;
}
