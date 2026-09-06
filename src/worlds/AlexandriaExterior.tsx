import { useFrame, useLoader } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ResolvedQuality } from "./types";

type Props = {
  quality: ResolvedQuality;
  reducedMotion: boolean;
  backplateUrl: string;
};

export const ALEXANDRIA_HARBOR_COMPOSITION = {
  detailedQuays: false,
  cityRelief: false,
  detailedVessels: false,
  landmarks: false
} as const;

export function AlexandriaHarborExterior({ quality, reducedMotion, backplateUrl }: Props) {
  const backdrop = useLoader(THREE.TextureLoader, backplateUrl);
  useEffect(() => {
    backdrop.colorSpace = THREE.SRGBColorSpace;
    backdrop.wrapS = THREE.ClampToEdgeWrapping;
    backdrop.wrapT = THREE.ClampToEdgeWrapping;
    backdrop.anisotropy = quality === "lite" ? 2 : 8;
    backdrop.needsUpdate = true;
  }, [backdrop, quality]);
  return (
    <group name="Alexandria harbor diorama" userData={{ exteriorMode: "harbor-diorama" }}>
      <HarborCyclorama backdrop={backdrop} />
      <HarborWater quality={quality} reducedMotion={reducedMotion} />
      <HarborQuays detailed={ALEXANDRIA_HARBOR_COMPOSITION.detailedQuays} />
      {ALEXANDRIA_HARBOR_COMPOSITION.cityRelief && <HarborCityRelief />}
      <HarborVessels detailed={ALEXANDRIA_HARBOR_COMPOSITION.detailedVessels} reducedMotion={reducedMotion} />
      {ALEXANDRIA_HARBOR_COMPOSITION.landmarks && <HarborLandmarks reducedMotion={reducedMotion} />}
      <hemisphereLight color="#f6dfb8" groundColor="#3d7181" intensity={quality === "lite" ? 0.3 : 0.48} />
      <directionalLight position={[-24, 28, 15]} color="#ffd39a" intensity={quality === "cinematic" ? 1.08 : 0.88} castShadow={false} />
      <directionalLight position={[24, 12, 8]} color="#91c7d2" intensity={quality === "lite" ? 0.16 : 0.28} castShadow={false} />
    </group>
  );
}

function HarborCyclorama({ backdrop }: { backdrop: THREE.Texture }) {
  return (
    <group name="Continuous Alexandrian harbor cyclorama" raycast={() => null}>
      <mesh position={[0, 10.5, 0]} renderOrder={-4}>
        <cylinderGeometry args={[74, 74, 72, 96, 1, true, Math.PI * 0.35, Math.PI * 1.3]} />
        <meshBasicMaterial map={backdrop} color="#d9d2bf" fog={false} toneMapped side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

type ReliefBox = {
  position: [number, number, number];
  scale: [number, number, number];
  color?: string;
};

type ReliefMaps = {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
};

function HarborCityRelief() {
  const maps = useTexture({
    plasterMap: "/worlds/assets/materials/dome-plaster-color.webp",
    plasterNormal: "/worlds/assets/materials/dome-plaster-normal.webp",
    plasterRoughness: "/worlds/assets/materials/dome-plaster-roughness.webp",
    stoneMap: "/worlds/assets/materials/marble-color.webp",
    stoneNormal: "/worlds/assets/materials/marble-normal.webp",
    stoneRoughness: "/worlds/assets/materials/marble-roughness.webp",
    woodMap: "/worlds/assets/materials/shelf-wood-color.webp",
    woodNormal: "/worlds/assets/materials/shelf-wood-normal.webp",
    woodRoughness: "/worlds/assets/materials/shelf-wood-roughness.webp"
  });
  useEffect(() => {
    for (const [key, texture] of Object.entries(maps)) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = key.endsWith("Map") ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.repeat.set(key.startsWith("plaster") ? 2.8 : 2.1, key.startsWith("plaster") ? 2.2 : 1.4);
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
  }, [maps]);

  const relief = useMemo(() => {
    const buildings = [
      [-42, 2.2, -32, 9.0, 5.4, 4.8],
      [-33.5, 1.65, -34, 7.0, 4.4, 4.2],
      [-25, 1.9, -31, 7.4, 4.8, 4.5],
      [-17.8, 1.35, -33, 5.2, 3.7, 3.8],
      [-11.7, 1.05, -35.5, 5.5, 3.0, 3.2],
      [17.5, 1.45, -34, 6.4, 3.9, 4.0],
      [24.7, 2.0, -31.5, 6.2, 5.0, 4.4],
      [33.5, 1.55, -33.5, 7.2, 4.2, 4.2],
      [42.0, 2.15, -31.5, 8.8, 5.2, 4.8]
    ] as const;
    const shells: ReliefBox[] = [];
    const foundations: ReliefBox[] = [];
    const cornices: ReliefBox[] = [];
    const roofs: ReliefBox[] = [];
    const windows: ReliefBox[] = [];
    const windowFrames: ReliefBox[] = [];
    const doors: ReliefBox[] = [];
    const balconies: ReliefBox[] = [];
    const plasterPalette = ["#d3b581", "#c6a36e", "#ddc394", "#b99061", "#d0ad79"];

    buildings.forEach(([x, y, z, width, height, depth], index) => {
      const front = z + depth / 2 + 0.055;
      const bottom = y - height / 2;
      const top = y + height / 2;
      shells.push({ position: [x, y, z], scale: [width, height, depth], color: plasterPalette[index % plasterPalette.length] });
      foundations.push({ position: [x, bottom + 0.28, z + 0.05], scale: [width + 0.28, 0.58, depth + 0.26], color: index % 2 ? "#927b61" : "#a18a6c" });
      cornices.push(
        { position: [x, top - 0.15, z], scale: [width + 0.34, 0.3, depth + 0.28], color: "#d7c39d" },
        { position: [x, bottom + height * 0.48, front], scale: [width + 0.08, 0.13, 0.16], color: "#c7ad7f" }
      );
      roofs.push({
        position: [x, top + 0.19, z - 0.02],
        scale: [width + 0.42, index % 3 === 1 ? 0.28 : 0.38, depth + 0.38],
        color: index % 2 ? "#9f5739" : "#a96543"
      });
      doors.push({ position: [x + width * (index % 2 ? -0.28 : 0.28), bottom + 0.88, front + 0.035], scale: [0.78, 1.75, 0.12], color: "#4b3328" });

      const levels = height > 4.55 ? [-0.7, 0.85] : [0.15];
      const columns = width > 7.8 ? [-0.33, -0.11, 0.11, 0.33] : [-0.28, 0, 0.28];
      levels.forEach((level) => {
        columns.forEach((offset) => {
          const windowX = x + width * offset;
          const windowY = y + level;
          const windowWidth = Math.min(0.68, width / (columns.length * 3.3));
          windows.push({ position: [windowX, windowY, front + 0.065], scale: [windowWidth, 1.12, 0.08], color: "#30434b" });
          windowFrames.push(
            { position: [windowX - windowWidth / 2 - 0.06, windowY, front + 0.11], scale: [0.1, 1.34, 0.09], color: "#d7c59f" },
            { position: [windowX + windowWidth / 2 + 0.06, windowY, front + 0.11], scale: [0.1, 1.34, 0.09], color: "#d7c59f" },
            { position: [windowX, windowY + 0.64, front + 0.11], scale: [windowWidth + 0.22, 0.12, 0.09], color: "#d7c59f" },
            { position: [windowX, windowY - 0.64, front + 0.11], scale: [windowWidth + 0.22, 0.12, 0.09], color: "#bca577" }
          );
        });
      });

      if (index % 3 === 0) {
        balconies.push(
          { position: [x, y + 0.12, front + 0.42], scale: [width * 0.56, 0.18, 0.78], color: "#9f8567" },
          { position: [x, y + 0.58, front + 0.77], scale: [width * 0.56, 0.72, 0.08], color: "#77543c" }
        );
      }
    });
    return { shells, foundations, cornices, roofs, windows, windowFrames, doors, balconies };
  }, []);

  return (
    <group name="Alexandria harbor architectural relief" raycast={() => null}>
      <ReliefBoxInstances transforms={relief.shells} maps={{ map: maps.plasterMap, normalMap: maps.plasterNormal, roughnessMap: maps.plasterRoughness }} roughness={0.88} normalScale={0.28} emissive="#4d3828" emissiveIntensity={0.14} />
      <ReliefBoxInstances transforms={relief.foundations} maps={{ map: maps.stoneMap, normalMap: maps.stoneNormal, roughnessMap: maps.stoneRoughness }} roughness={0.82} normalScale={0.2} emissive="#332a20" emissiveIntensity={0.08} />
      <ReliefBoxInstances transforms={relief.cornices} maps={{ map: maps.stoneMap, normalMap: maps.stoneNormal, roughnessMap: maps.stoneRoughness }} roughness={0.78} normalScale={0.16} emissive="#4a3a29" emissiveIntensity={0.1} />
      <ReliefBoxInstances transforms={relief.roofs} maps={{ map: maps.plasterMap, normalMap: maps.plasterNormal, roughnessMap: maps.plasterRoughness }} roughness={0.84} normalScale={0.22} emissive="#5b2c1e" emissiveIntensity={0.11} />
      <ReliefBoxInstances transforms={relief.windows} color="#26383f" roughness={0.3} metalness={0.1} emissive="#4c7180" emissiveIntensity={0.08} />
      <ReliefBoxInstances transforms={relief.windowFrames} maps={{ map: maps.stoneMap, normalMap: maps.stoneNormal, roughnessMap: maps.stoneRoughness }} roughness={0.76} normalScale={0.14} />
      <ReliefBoxInstances transforms={relief.doors} maps={{ map: maps.woodMap, normalMap: maps.woodNormal, roughnessMap: maps.woodRoughness }} roughness={0.68} normalScale={0.22} />
      <ReliefBoxInstances transforms={relief.balconies} maps={{ map: maps.woodMap, normalMap: maps.woodNormal, roughnessMap: maps.woodRoughness }} roughness={0.7} normalScale={0.2} />
    </group>
  );
}

function ReliefBoxInstances({ transforms, maps, color = "#ffffff", roughness, metalness = 0, normalScale = 0.2, emissive = "#000000", emissiveIntensity = 0 }: {
  transforms: ReliefBox[];
  maps?: ReliefMaps;
  color?: string;
  roughness: number;
  metalness?: number;
  normalScale?: number;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    transforms.forEach((transform, index) => {
      matrix.compose(new THREE.Vector3(...transform.position), quaternion, new THREE.Vector3(...transform.scale));
      mesh.current?.setMatrixAt(index, matrix);
      if (transform.color) mesh.current?.setColorAt(index, new THREE.Color(transform.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingBox();
    mesh.current.computeBoundingSphere();
  }, [transforms]);
  if (!transforms.length) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, transforms.length]} receiveShadow>
      <boxGeometry />
      <meshStandardMaterial
        vertexColors={transforms.some((transform) => Boolean(transform.color))}
        color={color}
        map={maps?.map}
        normalMap={maps?.normalMap}
        normalScale={maps?.normalMap ? new THREE.Vector2(normalScale, normalScale) : undefined}
        roughnessMap={maps?.roughnessMap}
        roughness={roughness}
        metalness={metalness}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
      />
    </instancedMesh>
  );
}

function HarborWater({ quality, reducedMotion }: { quality: ResolvedQuality; reducedMotion: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      motion: { value: reducedMotion ? 0 : 1 },
      nearColor: { value: new THREE.Color("#174b58") },
      midColor: { value: new THREE.Color("#2f6870") },
      horizonColor: { value: new THREE.Color("#587b79") },
      sunColor: { value: new THREE.Color("#c9ad7d") }
    },
    vertexShader: `
      varying vec2 waterUv;
      varying vec2 waterPosition;
      varying float wave;
      uniform float time;
      uniform float motion;
      void main() {
        waterUv = uv;
        waterPosition = position.xy;
        vec3 transformed = position;
        float animatedTime = time * motion;
        float broad = sin(position.x * 0.18 + position.y * 0.11 + animatedTime * 0.24) * 0.05;
        float cross = sin(position.x * -0.28 + position.y * 0.21 - animatedTime * 0.18) * 0.035;
        float chop = sin(position.x * 0.57 - position.y * 0.43 + animatedTime * 0.33) * 0.012;
        wave = broad + cross + chop;
        transformed.z += wave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 waterUv;
      varying vec2 waterPosition;
      varying float wave;
      uniform float time;
      uniform float motion;
      uniform vec3 nearColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;

      float randomValue(vec2 point) {
        point = fract(point * vec2(123.34, 345.45));
        point += dot(point, point + 34.345);
        return fract(point.x * point.y);
      }

      float smoothNoise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);
        float bottom = mix(randomValue(cell), randomValue(cell + vec2(1.0, 0.0)), local.x);
        float top = mix(randomValue(cell + vec2(0.0, 1.0)), randomValue(cell + vec2(1.0, 1.0)), local.x);
        return mix(bottom, top, local.y);
      }

      float layeredWaterNoise(vec2 point) {
        float first = smoothNoise(point);
        float second = smoothNoise(point * 2.07 + vec2(4.2, -1.7));
        float third = smoothNoise(point * 4.13 + vec2(-2.4, 5.1));
        return first * 0.56 + second * 0.29 + third * 0.15;
      }

      void main() {
        float animatedTime = time * motion;
        vec2 slowDrift = vec2(animatedTime * 0.025, animatedTime * -0.014);
        vec2 crossDrift = vec2(animatedTime * -0.018, animatedTime * 0.021);
        float broadTexture = layeredWaterNoise(waterPosition * 0.15 + slowDrift);
        float fineTexture = layeredWaterNoise(waterPosition * 0.31 + crossDrift);
        float crossingWavelets = sin(waterPosition.x * 0.72 + waterPosition.y * 0.46 + animatedTime * 0.19)
          * sin(waterPosition.x * -0.51 + waterPosition.y * 0.68 - animatedTime * 0.15);
        float surfaceVariation = broadTexture * 0.62 + fineTexture * 0.38 + crossingWavelets * 0.055;
        float brokenCrest = smoothstep(0.76, 0.94, surfaceVariation);

        float middleBlend = smoothstep(0.02, 0.62, waterUv.y);
        float horizonBlend = smoothstep(0.58, 1.0, waterUv.y);
        vec3 color = mix(nearColor, midColor, middleBlend);
        color = mix(color, horizonColor, horizonBlend * 0.82);
        color *= 0.94 + (surfaceVariation - 0.5) * 0.10;

        float brokenHighlight = brokenCrest * mix(0.025, 0.07, horizonBlend);
        brokenHighlight += max(0.0, wave) * 0.025;
        color = mix(color, sunColor, brokenHighlight);
        color = mix(color, horizonColor, smoothstep(0.88, 1.0, waterUv.y) * 0.28);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: false
  }), [reducedMotion]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.time.value = clock.elapsedTime;
  });
  return (
    <mesh position={[0, -1.15, -36]} rotation-x={-Math.PI / 2} raycast={() => null}>
      <planeGeometry args={[56, 52, quality === "cinematic" ? 72 : quality === "balanced" ? 40 : 8, quality === "cinematic" ? 72 : quality === "balanced" ? 40 : 8]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function HarborQuays({ detailed }: { detailed: boolean }) {
  const stone = useLoader(THREE.TextureLoader, "/worlds/assets/materials/marble-color.webp");
  useEffect(() => {
    stone.colorSpace = THREE.SRGBColorSpace;
    stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
    stone.repeat.set(3.5, 1.2);
    stone.needsUpdate = true;
  }, [stone]);
  return (
    <group raycast={() => null}>
      <mesh position={[-14.5, -0.42, -18.2]} rotation-y={0.08} receiveShadow>
        <boxGeometry args={[13.5, 1.45, 7.2]} />
        <meshStandardMaterial map={stone} color="#b99a69" roughness={0.9} emissive="#493824" emissiveIntensity={0.14} />
      </mesh>
      <mesh position={[16.8, -0.58, -21.5]} rotation-y={-0.12} receiveShadow>
        <boxGeometry args={[17.5, 1.18, 5.4]} />
        <meshStandardMaterial map={stone} color="#c2a778" roughness={0.9} emissive="#4c3d29" emissiveIntensity={0.14} />
      </mesh>
      <mesh position={[-5.2, -0.78, -22.4]} rotation-y={0.12}>
        <boxGeometry args={[8.8, 0.42, 2.5]} />
        <meshStandardMaterial color="#765035" roughness={0.84} />
      </mesh>
      {detailed && [-8.4, -6.4, -4.4, -2.4].map((x) => (
        <mesh key={x} position={[x, -0.18, -21.3]}>
          <cylinderGeometry args={[0.13, 0.17, 2.0, 12]} />
          <meshStandardMaterial color="#5b3723" roughness={0.82} />
        </mesh>
      ))}
    </group>
  );
}

function HarborVessels({ detailed, reducedMotion }: { detailed: boolean; reducedMotion: boolean }) {
  return (
    <group>
      <HarborBoat position={[-1.8, -0.72, -18.8]} rotationY={0.24} scale={1.1} sail="#e7d3a4" reducedMotion={reducedMotion} />
      <HarborBoat position={[10.6, -0.84, -27]} rotationY={-0.68} scale={detailed ? 0.92 : 0.75} sail="#d8b879" reducedMotion={reducedMotion} phase={1.7} />
      {detailed && <HarborBoat position={[-14.5, -0.88, -32]} rotationY={0.5} scale={0.72} sail="#ede0bd" reducedMotion={reducedMotion} phase={3.1} />}
    </group>
  );
}

function HarborBoat({ position, rotationY, scale, sail, reducedMotion, phase = 0 }: {
  position: [number, number, number];
  rotationY: number;
  scale: number;
  sail: string;
  reducedMotion: boolean;
  phase?: number;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    group.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.36 + phase) * 0.045;
    group.current.rotation.z = Math.sin(clock.elapsedTime * 0.28 + phase) * 0.012;
  });
  return (
    <group ref={group} position={position} rotation-y={rotationY} scale={scale} raycast={() => null}>
      <mesh rotation-z={Math.PI / 2} scale={[1, 1.85, 0.72]}>
        <cylinderGeometry args={[0.32, 0.06, 2.6, 10, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#5a2e1b" roughness={0.78} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.32, 0]}>
        <cylinderGeometry args={[0.035, 0.055, 2.8, 10]} />
        <meshStandardMaterial color="#4a2b1c" roughness={0.72} />
      </mesh>
      <mesh position={[0.05, 1.55, 0.03]} rotation-y={Math.PI / 2}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([0, -0.95, 0, 0, 1.05, 0, 1.45, -0.75, 0]), 3]} />
        </bufferGeometry>
        <meshStandardMaterial color={sail} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function HarborLandmarks({ reducedMotion }: { reducedMotion: boolean }) {
  const palm = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!palm.current || reducedMotion) return;
    palm.current.rotation.z = Math.sin(clock.elapsedTime * 0.22) * 0.018;
  });
  return (
    <group raycast={() => null}>
      <group position={[-20.5, -0.25, -24.5]}>
        <mesh position={[0, 5.3, 0]}>
          <cylinderGeometry args={[0.88, 1.35, 8.4, 12]} />
          <meshStandardMaterial color="#c5a471" roughness={0.9} />
        </mesh>
        <mesh position={[0, 9.8, 0]}>
          <cylinderGeometry args={[0.45, 0.82, 1.25, 12]} />
          <meshStandardMaterial color="#d5bd8b" roughness={0.86} />
        </mesh>
        <mesh position={[0, 10.6, 0]}>
          <coneGeometry args={[0.8, 1.2, 12]} />
          <meshStandardMaterial color="#efe2bb" roughness={0.78} />
        </mesh>
      </group>
      <group ref={palm} position={[18.5, -0.1, -18.5]}>
        <mesh position={[0, 2.4, 0]} rotation-z={-0.08}>
          <cylinderGeometry args={[0.16, 0.24, 5.2, 10]} />
          <meshStandardMaterial color="#75482b" roughness={0.9} />
        </mesh>
        {Array.from({ length: 8 }, (_, index) => {
          const angle = index * Math.PI / 4;
          return (
            <mesh key={index} position={[Math.cos(angle) * 1.0, 5.0, Math.sin(angle) * 1.0]} rotation={[0, -angle, 0.25]}>
              <boxGeometry args={[2.25, 0.055, 0.3]} />
              <meshStandardMaterial color="#496636" roughness={0.94} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
