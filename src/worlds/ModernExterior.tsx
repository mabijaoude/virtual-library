import { useFrame, useLoader } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { InstancedBoxes } from "./shared";
import type { ResolvedQuality } from "./types";

type Props = {
  quality: ResolvedQuality;
  reducedMotion: boolean;
  backplateUrl: string;
};

export function ModernMuseumExterior({ quality, reducedMotion, backplateUrl }: Props) {
  const backdrop = useLoader(THREE.TextureLoader, backplateUrl);
  useEffect(() => {
    backdrop.colorSpace = THREE.SRGBColorSpace;
    backdrop.wrapS = THREE.ClampToEdgeWrapping;
    backdrop.wrapT = THREE.ClampToEdgeWrapping;
    backdrop.anisotropy = quality === "lite" ? 2 : 8;
    backdrop.needsUpdate = true;
  }, [backdrop, quality]);

  return (
    <group name="Modern museum campus exterior" userData={{ exteriorMode: "museum-campus-diorama" }}>
      <CampusCyclorama backdrop={backdrop} />
      <MuseumGlazing quality={quality} />
      <MuseumTerrace quality={quality} reducedMotion={reducedMotion} />
      <hemisphereLight color="#eaf6ff" groundColor="#7f8b79" intensity={quality === "lite" ? 0.2 : 0.28} />
      <directionalLight position={[-18, 24, 12]} color="#fff3d5" intensity={quality === "cinematic" ? 0.82 : 0.62} castShadow={false} />
    </group>
  );
}

export function CampusCyclorama({ backdrop }: { backdrop: THREE.Texture }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      sourceMap: { value: backdrop },
      tint: { value: new THREE.Color("#d8e0df") },
      zenith: { value: new THREE.Color("#95b9cf") }
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D sourceMap;
      uniform vec3 tint;
      uniform vec3 zenith;
      varying vec3 skyDirection;
      void main() {
        vec3 d = normalize(skyDirection);
        float azimuth = length(d.xz) < 0.001 ? 3.14159265 : mod(atan(d.x, d.z) + 6.2831853, 6.2831853);
        float u = (azimuth - 1.0681415) / 4.1469023;
        float v = (62.0 * d.y / max(length(d.xz), 0.001) - 11.5) / 54.0 + 0.5;
        vec3 horizon = texture2D(sourceMap, vec2(0.5, 0.98)).rgb * tint;
        vec3 sky = mix(horizon, zenith, smoothstep(0.08, 0.95, max(d.y, 0.0)));
        vec3 campus = texture2D(sourceMap, clamp(vec2(1.0 - u, v), 0.002, 0.998)).rgb * tint;
        // Fade the photograph inside its borders. The closed sky continues
        // over the entire roof and behind the room without a rim or seam.
        float photograph = smoothstep(0.0, 0.09, u) * (1.0 - smoothstep(0.91, 1.0, u));
        photograph *= 1.0 - smoothstep(0.74, 0.98, v);
        gl_FragColor = vec4(mix(sky, campus, photograph), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide, depthWrite: false, fog: false
  }), [backdrop]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh name="Continuous campus sky" renderOrder={-5} raycast={() => null}>
      <sphereGeometry args={[80, 64, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function MuseumGlazing({ quality }: { quality: ResolvedQuality }) {
  const structure = useTexture({
    map: "/worlds/assets/materials/shelf-concrete-color.webp",
    normalMap: "/worlds/assets/materials/shelf-concrete-normal.webp",
    roughnessMap: "/worlds/assets/materials/shelf-concrete-roughness.webp"
  });
  useEffect(() => {
    for (const [key, texture] of Object.entries(structure)) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = key === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.repeat.set(3.6, 1.4);
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
  }, [structure]);
  const concrete = [
    { position: [0, 0.36, -9.64] as [number, number, number], scale: [25.4, 0.72, 0.42] as [number, number, number] },
    { position: [0, 7.72, -9.64] as [number, number, number], scale: [25.4, 0.66, 0.42] as [number, number, number] },
    { position: [-12.45, 4.04, -9.64] as [number, number, number], scale: [0.62, 7.42, 0.42] as [number, number, number] },
    { position: [12.45, 4.04, -9.64] as [number, number, number], scale: [0.62, 7.42, 0.42] as [number, number, number] }
  ];
  const mullions = [
    ...[-8.35, -4.18, 0, 4.18, 8.35].map((x) => ({ position: [x, 4.05, -9.4] as [number, number, number], scale: [0.11, 6.76, 0.13] as [number, number, number] })),
    ...[2.78, 5.38].map((y) => ({ position: [0, y, -9.4] as [number, number, number], scale: [24.2, 0.1, 0.13] as [number, number, number] }))
  ];
  return (
    <group name="Daylight Index glazing" raycast={() => null}>
      <InstancedBoxes transforms={concrete} color="#c5c7c2" map={structure.map} normalMap={structure.normalMap} roughnessMap={structure.roughnessMap} normalScale={0.16} roughness={0.72} castShadow={false} />
      <InstancedBoxes transforms={mullions} color="#26343e" roughness={0.3} metalness={0.72} castShadow={false} />
      <mesh position={[0, 4.05, -9.54]} renderOrder={-1} raycast={() => null}>
        <planeGeometry args={[24.15, 6.7]} />
        <meshPhysicalMaterial
          color="#b9d7df"
          roughness={0.08}
          metalness={0.02}
          transmission={quality === "cinematic" ? 0.28 : 0}
          transparent
          opacity={quality === "lite" ? 0.1 : 0.16}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function MuseumTerrace({ quality, reducedMotion }: { quality: ResolvedQuality; reducedMotion: boolean }) {
  const surfaces = useTexture({
    stoneMap: "/worlds/assets/materials/marble-color.webp",
    stoneNormal: "/worlds/assets/materials/marble-normal.webp",
    stoneRoughness: "/worlds/assets/materials/marble-roughness.webp",
    concreteMap: "/worlds/assets/materials/shelf-concrete-color.webp",
    concreteNormal: "/worlds/assets/materials/shelf-concrete-normal.webp",
    concreteRoughness: "/worlds/assets/materials/shelf-concrete-roughness.webp",
    barkMap: "/worlds/assets/materials/shelf-wood-color.webp",
    barkNormal: "/worlds/assets/materials/shelf-wood-normal.webp",
    barkRoughness: "/worlds/assets/materials/shelf-wood-roughness.webp"
  });
  useEffect(() => {
    for (const [key, texture] of Object.entries(surfaces)) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = key.endsWith("Map") ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.repeat.set(key.startsWith("stone") ? 3.4 : 2.2, key.startsWith("stone") ? 4.8 : 2.0);
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
  }, [surfaces]);
  const terrace = [
    { position: [0, -0.28, -20.5] as [number, number, number], scale: [25.2, 0.42, 21.5] as [number, number, number] },
    { position: [-8.8, 0.05, -18.2] as [number, number, number], scale: [5.1, 0.8, 11.4] as [number, number, number] },
    { position: [8.8, 0.05, -18.2] as [number, number, number], scale: [5.1, 0.8, 11.4] as [number, number, number] }
  ];
  const planters = [
    { position: [-8.8, 0.54, -15.2] as [number, number, number], scale: [4.5, 0.75, 3.1] as [number, number, number] },
    { position: [8.8, 0.54, -15.2] as [number, number, number], scale: [4.5, 0.75, 3.1] as [number, number, number] },
    { position: [-8.8, 0.54, -22.1] as [number, number, number], scale: [4.5, 0.75, 3.1] as [number, number, number] },
    { position: [8.8, 0.54, -22.1] as [number, number, number], scale: [4.5, 0.75, 3.1] as [number, number, number] }
  ];
  return (
    <group name="Modeled museum terrace" raycast={() => null}>
      <InstancedBoxes transforms={terrace} color="#bcb6aa" map={surfaces.stoneMap} normalMap={surfaces.stoneNormal} roughnessMap={surfaces.stoneRoughness} normalScale={0.12} roughness={0.74} castShadow={false} />
      <ReflectingPool quality={quality} reducedMotion={reducedMotion} />
      <InstancedBoxes transforms={planters} color="#a9a59b" map={surfaces.concreteMap} normalMap={surfaces.concreteNormal} roughnessMap={surfaces.concreteRoughness} normalScale={0.16} roughness={0.78} castShadow={false} />
      <CampusPlanting quality={quality} surfaces={surfaces} />
      <CampusPavilion surfaces={surfaces} quality={quality} />
      <CobaltSculpture />
    </group>
  );
}

function ReflectingPool({ quality, reducedMotion }: { quality: ResolvedQuality; reducedMotion: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      motion: { value: reducedMotion ? 0 : 1 },
      waterColor: { value: new THREE.Color("#4a8290") },
      skyColor: { value: new THREE.Color("#c7e5ec") }
    },
    vertexShader: `
      varying vec2 waterUv;
      uniform float time;
      uniform float motion;
      void main() {
        waterUv = uv;
        vec3 transformed = position;
        transformed.z += sin(position.x * 1.4 + time * 0.3 * motion) * 0.012;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 waterUv;
      uniform float time;
      uniform float motion;
      uniform vec3 waterColor;
      uniform vec3 skyColor;
      void main() {
        float ripple = sin(waterUv.y * 115.0 + waterUv.x * 18.0 + time * 0.42 * motion) * 0.5 + 0.5;
        float glint = pow(ripple, 18.0) * 0.22;
        vec3 color = mix(waterColor, skyColor, waterUv.y * 0.34 + glint);
        gl_FragColor = vec4(color, 0.94);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide
  }), [reducedMotion]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.time.value = clock.elapsedTime;
  });
  return (
    <group>
      <mesh position={[0, 0.08, -18.7]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <planeGeometry args={[4.7, 13.4, quality === "cinematic" ? 36 : 8, quality === "cinematic" ? 48 : 12]} />
        <primitive object={material} attach="material" />
      </mesh>
      {[-2.52, 2.52].map((x) => (
        <mesh key={x} position={[x, 0.12, -18.7]}>
          <boxGeometry args={[0.28, 0.34, 13.8]} />
          <meshStandardMaterial color="#cbc3b4" roughness={0.68} />
        </mesh>
      ))}
    </group>
  );
}

function CampusPlanting({
  quality,
  surfaces
}: {
  quality: ResolvedQuality;
  surfaces: Record<string, THREE.Texture>;
}) {
  const detailed = quality !== "lite";
  const trees = detailed
    ? [[-8.8, -14.8, 3.8], [8.8, -15.4, 3.4], [-8.5, -22.0, 3.1], [8.7, -22.2, 3.6]]
    : [[-8.8, -16.0, 3.4], [8.8, -19.0, 3.4]];
  const canopy = [
    [0, 0.8, 0, 0.34, 0.27, 0.32],
    [-0.3, 0.72, 0.04, 0.29, 0.25, 0.27],
    [0.31, 0.73, 0.02, 0.3, 0.24, 0.28],
    [-0.12, 0.87, -0.23, 0.27, 0.23, 0.29],
    [0.16, 0.88, 0.23, 0.26, 0.22, 0.27],
    [-0.42, 0.79, -0.19, 0.22, 0.2, 0.23],
    [0.43, 0.8, 0.18, 0.22, 0.19, 0.22],
    [0.05, 0.95, -0.02, 0.23, 0.18, 0.22],
    [0.02, 0.7, -0.34, 0.24, 0.2, 0.25]
  ];
  return (
    <group>
      {trees.map(([x, z, height], index) => (
        <group key={`${x}-${z}`} position={[x, 0.7, z]}>
          <mesh position={[0, height * 0.34, 0]}>
            <cylinderGeometry args={[0.1, 0.19, height * 0.68, 12]} />
            <meshStandardMaterial color="#806a4f" map={surfaces.barkMap} normalMap={surfaces.barkNormal} roughnessMap={surfaces.barkRoughness} normalScale={new THREE.Vector2(0.32, 0.32)} roughness={0.9} />
          </mesh>
          <mesh position={[-height * 0.1, height * 0.58, 0]} rotation-z={-0.5}>
            <cylinderGeometry args={[0.045, 0.075, height * 0.4, 9]} />
            <meshStandardMaterial color="#806a4f" map={surfaces.barkMap} normalMap={surfaces.barkNormal} roughnessMap={surfaces.barkRoughness} normalScale={new THREE.Vector2(0.28, 0.28)} roughness={0.92} />
          </mesh>
          <mesh position={[height * 0.11, height * 0.59, 0.02]} rotation-z={0.52}>
            <cylinderGeometry args={[0.04, 0.07, height * 0.38, 9]} />
            <meshStandardMaterial color="#806a4f" map={surfaces.barkMap} normalMap={surfaces.barkNormal} roughnessMap={surfaces.barkRoughness} normalScale={new THREE.Vector2(0.28, 0.28)} roughness={0.92} />
          </mesh>
          {canopy.slice(0, detailed ? canopy.length : 6).map(([cx, cy, cz, sx, sy, sz], leafIndex) => (
            <mesh
              key={leafIndex}
              position={[cx * height, cy * height, cz * height]}
              rotation={[leafIndex * 0.31, leafIndex * 0.57, leafIndex * 0.19]}
              scale={[sx * height, sy * height, sz * height]}
            >
              <icosahedronGeometry args={[1, detailed ? 2 : 1]} />
              <meshStandardMaterial
                color={["#3f664e", "#52765a", "#365d48"][leafIndex % 3]}
                roughness={0.92}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function CampusPavilion({ surfaces, quality }: {
  surfaces: Record<string, THREE.Texture>;
  quality: ResolvedQuality;
}) {
  return (
    <group position={[12.5, 0, -29.5]} rotation-y={-0.08}>
      <mesh position={[0, 3.1, 0]}>
        <boxGeometry args={[15, 0.38, 6.8]} />
        <meshStandardMaterial color="#cbc5b9" map={surfaces.stoneMap} normalMap={surfaces.stoneNormal} roughnessMap={surfaces.stoneRoughness} normalScale={new THREE.Vector2(0.14, 0.14)} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.55, 0.12]}>
        <boxGeometry args={[14.2, 2.7, 0.16]} />
        <meshPhysicalMaterial color="#78a2a8" roughness={0.12} transmission={quality === "cinematic" ? 0.24 : 0} transparent opacity={0.52} depthWrite={false} />
      </mesh>
      {[-6.7, -4.45, -2.2, 0, 2.2, 4.45, 6.7].map((x) => (
        <mesh key={x} position={[x, 1.55, 0.25]}>
          <boxGeometry args={[0.11, 2.75, 0.12]} />
          <meshStandardMaterial color="#35444b" metalness={0.64} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function CobaltSculpture() {
  return (
    <group position={[-4.8, 0.45, -15.2]} rotation-y={0.35}>
      <mesh position={[-0.38, 1.0, 0]} rotation-z={-0.55}>
        <boxGeometry args={[0.58, 2.3, 0.62]} />
        <meshStandardMaterial color="#1f69a2" roughness={0.35} metalness={0.18} />
      </mesh>
      <mesh position={[0.48, 1.25, 0.06]} rotation-z={0.62}>
        <boxGeometry args={[0.58, 2.65, 0.62]} />
        <meshStandardMaterial color="#2a78b3" roughness={0.34} metalness={0.18} />
      </mesh>
      <mesh position={[0, -0.22, 0]}>
        <boxGeometry args={[2.0, 0.26, 1.4]} />
        <meshStandardMaterial color="#aaa59a" roughness={0.72} />
      </mesh>
    </group>
  );
}
