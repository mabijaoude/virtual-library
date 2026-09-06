import { useLoader } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { InstancedBoxes, InstancedCylinders } from "./shared";
import { buildCypresses, buildGardenTerrace, gardenPart, RENAISSANCE_GARDEN, type GardenPart } from "./renaissanceGardenDesign";
import type { ResolvedQuality } from "./types";

// The terrace and reliefs use the marble already loaded by the entrance.
// Leave shared UV transforms untouched when another room uses the same maps.
export function useLoggiaStone() {
  const maps = useTexture({ map: "/worlds/assets/materials/marble-color.webp", normalMap: "/worlds/assets/materials/marble-normal.webp" });
  useEffect(() => {
    for (const [texture, colorSpace] of [[maps.map, THREE.SRGBColorSpace], [maps.normalMap, THREE.NoColorSpace]] as const) {
      if (texture.colorSpace === colorSpace) continue;
      texture.colorSpace = colorSpace;
      texture.needsUpdate = true;
    }
  }, [maps]);
  return maps;
}

export function RenaissanceInstances({ parts, children, name }: { parts: GardenPart[]; children: ReactNode; name?: string }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    for (const [index, part] of parts.entries()) {
      quaternion.setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
      matrix.compose(new THREE.Vector3(...part.position), quaternion, new THREE.Vector3(...part.scale));
      mesh.current?.setMatrixAt(index, matrix);
    }
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true;
      mesh.current.computeBoundingSphere();
    }
  }, [parts]);
  return <instancedMesh name={name} ref={mesh} args={[undefined, undefined, parts.length]} castShadow={false} receiveShadow>{children}</instancedMesh>;
}

const BALUSTER_PROFILE = [[0.16, 0], [0.16, 0.1], [0.095, 0.14], [0.07, 0.3], [0.135, 0.5], [0.13, 0.65], [0.06, 0.81], [0.065, 0.91], [0.15, 0.95], [0.15, 1]].map(([x, y]) => new THREE.Vector2(x, y));
export const URN_PROFILE = [[0, 0], [0.24, 0], [0.24, 0.1], [0.12, 0.14], [0.09, 0.25], [0.2, 0.3], [0.34, 0.48], [0.38, 0.7], [0.3, 0.86], [0.29, 0.96], [0.36, 1], [0.36, 1.06], [0.28, 1.06], [0.25, 0.96], [0.22, 0.8], [0, 0.77]].map(([x, y]) => new THREE.Vector2(x, y));

export function RenaissanceGarden({ quality, backplateUrl }: { quality: ResolvedQuality; backplateUrl: string }) {
  const source = useLoader(THREE.TextureLoader, backplateUrl);
  const backdrop = useMemo(() => {
    const texture = source.clone();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    texture.rotation = 0;
    texture.anisotropy = quality === "lite" ? 2 : 8;
    texture.needsUpdate = true;
    return texture;
  }, [source, quality]);
  useEffect(() => () => backdrop.dispose(), [backdrop]);
  const maps = useLoggiaStone();
  const needles = useMemo(createCypressNeedleTexture, []);
  useEffect(() => () => needles.dispose(), [needles]);
  const layout = useMemo(buildGardenTerrace, []);
  const trees = useMemo(buildCypresses, []);
  const trunks = useMemo(() => trees.map((tree) => gardenPart(tree.x, 0.22, tree.z, 0.12, 1.72, 0.12)), [trees]);
  const foliage = useMemo(() => trees.map((tree) => gardenPart(tree.x, 0.45, tree.z, tree.radius, tree.height, tree.radius)), [trees]);
  const hedge = useMemo(() => [-7.1, 7.1].flatMap((x) => [-28.5, -36.5].flatMap((z) =>
    Array.from({ length: 12 }, (_, i) => gardenPart(x + ((i % 6) - 2.5) * 1.04, 0.07, z + (i < 6 ? -1.65 : 1.65), 0.79, 0.47, 0.68))
  )), []);
  const vessels = useMemo(() => [-4.1, 4.1].map((x) => gardenPart(x, -0.18, -15, 0.82, 0.82, 0.82)), []);
  const shrubs = useMemo(() => vessels.flatMap((vessel) => [-1, 0, 1].map((i) => gardenPart(vessel.position[0] + i * 0.18, 0.8 + (i === 0 ? 0.12 : 0), -15, 0.34, 0.32, 0.34))), [vessels]);
  const contacts = useMemo(() => [
    ...trees.slice(0, 4).map((tree) => ({ ...gardenPart(tree.x, -0.175, tree.z, tree.radius * 2.6, tree.radius * 2.6, 1), rotation: [-Math.PI / 2, 0, 0] as [number, number, number] })),
    ...vessels.map((vessel) => ({ ...gardenPart(vessel.position[0], -0.174, -15, 0.95, 0.95, 1), rotation: [-Math.PI / 2, 0, 0] as [number, number, number] }))
  ], [trees, vessels]);
  const panorama = RENAISSANCE_GARDEN.backdrop;
  return <group name="Renaissance terraced garden" userData={{ exteriorMode: "tuscan-garden-diorama" }} raycast={() => null}>
    <mesh position={[0, 0, panorama.centerZ]} renderOrder={-5}>
      <GardenBackdropGeometry />
      <meshBasicMaterial map={backdrop} color="#eee5cf" fog={false} side={THREE.BackSide} />
    </mesh>
    <InstancedBoxes transforms={layout.paving} color="#c9bda3" {...maps} normalScale={0.12} roughness={0.82} castShadow={false} />
    <InstancedBoxes transforms={layout.stone} color="#b1a58b" {...maps} normalScale={0.14} roughness={0.76} castShadow={false} />
    <RenaissanceInstances parts={layout.balusters} name="Garden balustrade spindles">
      <latheGeometry args={[BALUSTER_PROFILE, quality === "lite" ? 10 : 16]} />
      <meshStandardMaterial color="#ccbea2" {...maps} roughness={0.73} normalScale={new THREE.Vector2(0.1, 0.1)} />
    </RenaissanceInstances>
    <InstancedBoxes transforms={layout.beds} color="#666346" roughness={1} castShadow={false} />
    <mesh name="Rolling garden ground" position={[0, -0.61, -50]}>
      <GardenTerrainGeometry />
      <meshBasicMaterial map={backdrop} color="#eee5cf" fog={false} />
    </mesh>
    <InstancedBoxes transforms={[gardenPart(0, -0.55, -38, 5.8, 0.16, 29)]} color="#b7a17c" roughness={1} castShadow={false} />
    <InstancedCylinders transforms={trunks} color="#62563b" roughness={1} metalness={0} castShadow={false} />
    <RenaissanceInstances parts={foliage} name="Cypress grove">
      <CypressGeometry />
      <meshBasicMaterial map={needles} color="#a6b48a" alphaTest={0.42} side={THREE.DoubleSide} vertexColors fog={false} />
    </RenaissanceInstances>
    <RenaissanceInstances parts={[...hedge, ...shrubs]} name="Formal garden planting">
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#63704b" roughness={1} />
    </RenaissanceInstances>
    <RenaissanceInstances parts={vessels} name="Terracotta garden vessels">
      <latheGeometry args={[URN_PROFILE, 20]} />
      <meshStandardMaterial color="#a67452" roughness={0.9} />
    </RenaissanceInstances>
    <RenaissanceInstances parts={contacts} name="Soft terrace contact shading">
      <planeGeometry />
      <shaderMaterial transparent depthWrite={false} vertexShader={`
        varying vec2 contactUv;
        void main() {
          contactUv = uv;
          vec4 point = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            point = instanceMatrix * point;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * point;
        }
      `} fragmentShader={`
        varying vec2 contactUv;
        void main() {
          vec2 p = (contactUv - 0.5) * 2.0;
          gl_FragColor = vec4(0.035, 0.028, 0.018, 0.32 * pow(max(0.0, 1.0 - dot(p, p)), 2.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `} />
    </RenaissanceInstances>
  </group>;
}

// Crossed needle sprays give the cypresses a broken, leafy silhouette. Alpha
// testing keeps ordinary depth writes; this is one shared draw for eight trees.
export function createCypressGeometry() {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let row = 0; row < 18; row++) {
    const y = 0.055 + row / 17 * 0.935;
    const crown = Math.pow(Math.sin(Math.PI * Math.pow(y, 0.62)), 0.56);
    for (let spray = 0; spray < 7; spray++) {
      const angle = spray * Math.PI / 3 + row * 2.399;
      const radius = spray === 6 ? 0 : crown * 0.62;
      const cx = Math.cos(angle) * radius, cz = Math.sin(angle) * radius;
      const width = crown * (0.76 + Math.sin(row * 17 + spray) * 0.09);
      const height = Math.min(0.155, 2 * Math.min(y, 1 - y));
      const shade = 0.7 + (Math.sin(row * 29 + spray * 13) + 1) * 0.13;
      for (let cross = 0; cross < 2; cross++) {
        const a = angle + cross * Math.PI / 2;
        const dx = Math.cos(a) * width / 2, dz = Math.sin(a) * width / 2;
        const lean = Math.sin(row * 19 + spray * 31 + cross) * crown * 0.18;
        const leanX = Math.cos(a + 0.7) * lean, leanZ = Math.sin(a + 0.7) * lean;
        const offset = positions.length / 3;
        positions.push(cx - dx, y - height / 2, cz - dz, cx + dx, y - height / 2, cz + dz,
          cx + dx * 0.78 + leanX, y + height / 2, cz + dz * 0.78 + leanZ,
          cx - dx * 0.78 + leanX, y + height / 2, cz - dz * 0.78 + leanZ);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        for (let vertex = 0; vertex < 4; vertex++) colors.push(shade, shade, shade);
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// A tiny deterministic needle mask costs no request or downloaded texture.
export function createCypressNeedleTexture() {
  const width = 64, height = 128;
  const pixels = new Uint8Array(width * height * 4);
  const stroke = (ax: number, ay: number, bx: number, by: number, radius: number, tone: number) => {
    const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by) - radius)); y < Math.min(height, Math.ceil(Math.max(ay, by) + radius)); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - radius)); x < Math.min(width, Math.ceil(Math.max(ax, bx) + radius)); x++) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / Math.max(0.001, lengthSq)));
        const distance = Math.hypot(x - ax - t * dx, y - ay - t * dy);
        const alpha = Math.min(1, Math.max(0, radius + 0.5 - distance));
        const index = (y * width + x) * 4;
        if (alpha * 255 <= pixels[index + 3]) continue;
        const grain = Math.sin(x * 49 + y * 31) * 9;
        pixels.set([tone * 0.79 + grain, tone + grain, tone * 0.55 + grain, alpha * 255], index);
      }
    }
  };
  stroke(32, 2, 32, 125, 1.35, 94);
  for (let branch = 0; branch < 17; branch++) for (const side of [-1, 1]) {
    const y = 8 + branch * 6.6;
    const spread = 25 * (1 - branch / 21) + Math.sin(branch * 7) * 2;
    const endX = 32 + side * spread, endY = y + 15;
    stroke(32, y, endX, endY, 0.9, 101);
    for (let leaf = 1; leaf <= 7; leaf++) {
      const t = leaf / 8;
      const x = 32 + side * spread * t, ly = y + 15 * t;
      stroke(x, ly, x + side * 4, ly + 7, 1.25, 117 + (branch % 3) * 8);
      stroke(x, ly, x + side * 5, ly - 2, 1.05, 105 + (branch % 4) * 7);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Continue the photograph's top sky row over a rounded cap. Unlike an open
// cylinder this has no visible upper edge when leaning close to the opening.
// Cylindrical UVs preserve the hills' proportions instead of stretching a
// widescreen photograph over a shallow, 180-degree strip.
export function createGardenBackdropGeometry() {
  const panorama = RENAISSANCE_GARDEN.backdrop;
  const geometry = new THREE.SphereGeometry(panorama.radius, 64, 24, Math.PI, Math.PI);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    uv.setX(i, 1 - uv.getX(i));
    uv.setY(i, (positions.getY(i) - panorama.centerY) / panorama.height + 0.5);
  }
  return geometry;
}

function GardenBackdropGeometry() {
  const geometry = useMemo(createGardenBackdropGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

export function createGardenTerrainGeometry() {
  const geometry = new THREE.PlaneGeometry(140, 77, 40, 28);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const panorama = RENAISSANCE_GARDEN.backdrop;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i) - 50;
    const distance = Math.hypot(x, z + 11);
    const rise = THREE.MathUtils.smoothstep(distance, 36, 61);
    // Keep the formal beds level; low outboard hills remove a straight ground
    // edge against the photograph when the window is viewed from an arcade.
    const hill = 1.8 + Math.sin(x * 0.17 + z * 0.08) * 0.7 + Math.sin(x * 0.39 - z * 0.13) * 0.34;
    const y = rise * hill;
    positions.setY(i, y);
    // Project the reused landscape over the outboard terrain so its far edge
    // meets matching fields, rather than a solid-color strip below the hills.
    const projectedY = 1.82 + (y - 0.61 - 1.82) * panorama.radius / Math.max(distance, 1);
    uv.setXY(i, 0.5 + Math.atan2(x, -(z + 11)) / Math.PI,
      (projectedY - panorama.centerY) / panorama.height + 0.5);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function GardenTerrainGeometry() {
  const geometry = useMemo(createGardenTerrainGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

function CypressGeometry() {
  const geometry = useMemo(createCypressGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}
