import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { WorldDefinition, WorldId } from "./types";

type Footprint = readonly [x: number, z: number, width: number, depth: number, yaw?: number];

// Contact shading is available in every tier. These footprints follow the fixed
// furnishings, never the walkable aisles, and add one draw call without downloads.
const FURNITURE: Record<WorldId, readonly Footprint[]> = {
  heritage: [[0, 1.2, 2.9, 2.1], [-1.8, 2.45, 1.25, 1.25, 0.2], [1.8, 2.45, 1.25, 1.25, -0.2]],
  gothic: [],
  modern: [[0, 0, 5.6, 3.8], [-5.2, 2.8, 3.5, 1.1], [5.2, 2.8, 3.5, 1.1]],
  renaissance: [[0, 0, 4.2, 4.2], [0, -9.7, 3.6, 0.75]],
  deco: [[0, 0, 2.1, 2.1], [-2.65, -2.65, 1.25, 1.25], [2.65, -2.65, 1.25, 1.25], [-3.85, -1.65, 0.9, 0.9], [3.85, -1.65, 0.9, 0.9]],
  foundry: [[0, 3.35, 4.5, 1.7]],
  lunar: [[0, 0.2, 3.6, 2.1], [-5.2, -7.8, 2.4, 1.4], [5.2, -7.8, 2.4, 1.4], [-1.8, 1.75, 1.45, 1.3], [1.8, 1.75, 1.45, 1.3]],
  arkship: [[7.75, 0, 1.7, 1.8], [7.15, -4.5, 1.45, 1.3, -Math.PI / 2], [7.15, 4.5, 1.45, 1.3, -Math.PI / 2]],
  alexandria: [[0, 0, 2.6, 2.6], [-3.75, -7, 2.7, 1.2], [3.75, -7, 2.7, 1.2], [-4.5, -5.9, 0.95, 0.95], [4.5, -5.9, 0.95, 0.95], [-5.9, -5.8, 1, 1], [5.9, -5.8, 1, 1]]
};

const WINDOW_LIGHT: Partial<Record<WorldId, readonly Footprint[]>> = {
  heritage: [[-5.6, -6.7, 2.4, 4.6, -0.16], [5.6, -6.7, 2.4, 4.6, -0.16]],
  gothic: [[0, -6.5, 3.8, 7.0]],
  modern: [[-5.1, -5.4, 3.8, 6.2, -0.25], [0, -5.4, 3.8, 6.2, -0.25], [5.1, -5.4, 3.8, 6.2, -0.25]],
  renaissance: [[-4.6, -1.8, 2.8, 8.4, -0.22], [0, -1.8, 2.8, 8.4, -0.22], [4.6, -1.8, 2.8, 8.4, -0.22]],
  lunar: [[-4.5, -5.0, 3.6, 5.8, -0.4], [1.0, -5.0, 3.6, 5.8, -0.4], [6.5, -5.0, 3.6, 5.8, -0.4]],
  arkship: [[8.3, -6, 2.4, 5.0], [8.3, 0, 2.4, 5.0], [8.3, 6, 2.4, 5.0]],
  alexandria: [[-6.8, -6.2, 3.0, 5.2, -0.2], [-2.3, -6.2, 3.0, 5.2, -0.2], [2.3, -6.2, 3.0, 5.2, -0.2], [6.8, -6.2, 3.0, 5.2, -0.2]]
};

export function RoomGrounding({ world }: { world: WorldDefinition }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const footprints = useMemo<Footprint[]>(() => [
    ...world.bays.map((bay): Footprint => [
      bay.position[0] + Math.sin(bay.rotationY) * 0.14,
      bay.position[2] + Math.cos(bay.rotationY) * 0.14,
      bay.width + 0.3, 1.15, bay.rotationY
    ]),
    ...FURNITURE[world.id]
  ], [world]);
  const mask = useMemo(() => {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const edge = Math.max(Math.abs(2 * x / (size - 1) - 1), Math.abs(2 * y / (size - 1) - 1));
      const alpha = Math.pow(Math.max(0, 1 - edge ** 3), 2);
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
    const texture = new THREE.DataTexture(data, size, size);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);
  useEffect(() => () => mask.dispose(), [mask]);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const floorRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    footprints.forEach(([x, z, width, depth, yaw = 0], index) => {
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(floorRotation);
      matrix.compose(new THREE.Vector3(x, 0.045, z), rotation, new THREE.Vector3(width, depth, 1));
      mesh.current?.setMatrixAt(index, matrix);
    });
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true;
      mesh.current.computeBoundingSphere();
    }
  }, [footprints]);
  return <>
    <instancedMesh ref={mesh} args={[undefined, undefined, footprints.length]} raycast={() => null} renderOrder={1}>
      <planeGeometry />
      <meshBasicMaterial color="#18120d" map={mask} transparent opacity={0.32} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
    </instancedMesh>
    {(WINDOW_LIGHT[world.id] || []).map(([x, z, width, depth, yaw = 0], index) => (
      <group key={index} position={[x, 0.028, z]} rotation-y={yaw}>
        <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial map={mask} color={world.id === "gothic" || world.id === "arkship" ? "#668bc2" : "#ffe2a2"} transparent opacity={world.id === "gothic" ? 0.13 : 0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    ))}
  </>;
}
