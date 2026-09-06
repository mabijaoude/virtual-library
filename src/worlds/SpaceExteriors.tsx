import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ResolvedQuality, WorldDefinition } from "./types";
import { LunarSurveyRover } from "./LunarRover";
import { createLunarTerrain, createLunarTracks, createRegolithGrain, lunarHeight, lunarSurfaceSampler, LUNAR_ROVER } from "./lunarTerrain";

const arkshipClock = { elapsed: 0 };
const LUNAR_EXTERIOR_LAYER = 2;

export const ARKSHIP_EXTERIOR_DESIGN = {
  starCount: { lite: 720, balanced: 1650, cinematic: 3000 },
  nearFieldCount: { lite: 88, balanced: 210, cinematic: 380 },
  travelStreakCount: { lite: 18, balanced: 42, cinematic: 72 },
  travelPulseSeconds: 18,
  travelPulseStrength: 1.1,
  planetPassSeconds: 150,
  planetStartPhase: 0.5,
  planetSurfaceOpacity: 1,
  motionRenderOrder: -4,
  nearFieldSpeed: 7.2,
  travelStreakSpeed: 16,
  planetWidthSegments: { lite: 40, balanced: 64, cinematic: 96 },
  planetHeightSegments: { lite: 24, balanced: 40, cinematic: 64 },
  ringSegments: { lite: 72, balanced: 128, cinematic: 192 }
} as const;

export function LunarExterior({ world, quality, reducedMotion }: {
  world: WorldDefinition;
  quality: ResolvedQuality;
  reducedMotion: boolean;
}) {
  const sourceMaps = useTexture({
    color: "/worlds/assets/exteriors/lunar-surface-color.webp",
    earth: "/worlds/assets/exteriors/earth-blue-marble.webp"
  });
  const maps = useMemo(() => {
    const color = sourceMaps.color.clone();
    const grain = createRegolithGrain();
    const earth = sourceMaps.earth.clone();
    color.colorSpace = earth.colorSpace = THREE.SRGBColorSpace;
    grain.colorSpace = THREE.NoColorSpace;
    for (const texture of [color, grain]) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = quality === "cinematic" ? 8 : 3;
      texture.needsUpdate = true;
    }
    color.wrapS = color.wrapT = grain.wrapS = grain.wrapT = THREE.MirroredRepeatWrapping;
    earth.wrapS = THREE.RepeatWrapping;
    earth.wrapT = THREE.ClampToEdgeWrapping;
    earth.anisotropy = quality === "cinematic" ? 8 : 3;
    earth.needsUpdate = true;
    return { color, grain, earth };
  }, [quality, sourceMaps]);
  useEffect(() => () => Object.values(maps).forEach((texture) => texture.dispose()), [maps]);

  const exterior = useRef<THREE.Group>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const earth = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const stars = useMemo(() => createStarField(world.exterior.kind === "lunar" ? world.exterior.starSeed : 1, quality === "cinematic" ? 3200 : quality === "balanced" ? 1800 : 1000, true), [quality, world.exterior]);
  useEffect(() => () => stars.geometry.dispose(), [stars]);
  const terrain = useMemo(() => createLunarTerrain(quality), [quality]);
  const surfaceHeight = useMemo(() => lunarSurfaceSampler(terrain), [terrain]);
  const tracks = useMemo(() => createLunarTracks(surfaceHeight), [surfaceHeight]);
  useEffect(() => () => terrain.dispose(), [terrain]);
  useEffect(() => () => tracks.dispose(), [tracks]);

  useEffect(() => {
    exterior.current?.traverse((object) => object.layers.set(LUNAR_EXTERIOR_LAYER));
    sun.current?.layers.set(LUNAR_EXTERIOR_LAYER);
    camera.layers.enable(LUNAR_EXTERIOR_LAYER);
    return () => camera.layers.disable(LUNAR_EXTERIOR_LAYER);
  }, [camera, quality]);

  useFrame(({ clock }, delta) => {
    if (!reducedMotion && earth.current) {
      earth.current.rotation.y += delta * 0.009;
      earth.current.rotation.z = Math.sin(clock.elapsedTime * 0.045) * 0.006;
    }
  });

  return (
    <group ref={exterior} raycast={() => null}>
      <ambientLight intensity={0.052} color="#82939a" />
      <directionalLight ref={sun} position={[-82, 38, -42]} color="#eef5f3" intensity={quality === "cinematic" ? 4.5 : quality === "balanced" ? 4.3 : 4.1} />
      <points geometry={stars.geometry} frustumCulled={false} renderOrder={-5}>
        <pointsMaterial vertexColors size={quality === "lite" ? 0.82 : 1.08} sizeAttenuation transparent opacity={0.86} depthWrite={false} fog={false} toneMapped={false} />
      </points>
      <group ref={earth} position={[9.2, 11.7, -126]} rotation-y={-0.78} renderOrder={-3}>
        <mesh>
          <sphereGeometry args={[4.2, quality === "cinematic" ? 64 : 36, quality === "cinematic" ? 40 : 24]} />
          <meshStandardMaterial map={maps.earth} color="#dcecf3" roughness={0.92} metalness={0} emissive="#0b1f31" emissiveMap={maps.earth} emissiveIntensity={0.13} fog={false} />
        </mesh>
        <mesh scale={1.045}>
          <sphereGeometry args={[4.2, quality === "cinematic" ? 56 : 32, quality === "cinematic" ? 36 : 20]} />
          <shaderMaterial
            transparent
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            vertexShader={earthAtmosphereVertexShader}
            fragmentShader={earthAtmosphereFragmentShader}
          />
        </mesh>
      </group>
      <mesh name="Continuous lunar ground" geometry={terrain} receiveShadow frustumCulled={false}>
        <meshStandardMaterial map={maps.color} bumpMap={maps.grain} bumpScale={0.12}
          vertexColors roughness={1} metalness={0} envMapIntensity={0} color="#a6a7a5" fog={false} />
      </mesh>
      <mesh name="Survey rover wheel trails" geometry={tracks}>
        <meshStandardMaterial color="#53534f" roughness={1} transparent opacity={0.32}
          depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} fog={false} />
      </mesh>
      <LunarRockField quality={quality} height={surfaceHeight} />
      <LunarSurveyRover quality={quality} reducedMotion={reducedMotion} />
      <LunarLandingBeacons reducedMotion={reducedMotion} height={surfaceHeight} />
      <mesh position={[0, 2.95, -10.72]} renderOrder={1}>
        <planeGeometry args={[16.9, 5.55]} />
        <meshPhysicalMaterial color="#8eb5c4" transparent opacity={0.075} roughness={0.08} metalness={0.02} clearcoat={1} clearcoatRoughness={0.04} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.02, -10.68]}>
        <boxGeometry args={[17.3, 0.14, 0.18]} />
        <meshStandardMaterial color={world.scene.metal} metalness={0.65} roughness={0.28} />
      </mesh>
    </group>
  );
}

function LunarRockField({ quality, height }: { quality: ResolvedQuality; height: (x: number, z: number) => number }) {
  const rocks = useRef<THREE.InstancedMesh>(null);
  const contacts = useRef<THREE.Mesh>(null);
  const contactMap = useMemo(() => {
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const falloff = Math.max(0, 1 - Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5));
      data.set([255, 255, 255, Math.round(falloff * falloff * 220)], (y * 32 + x) * 4);
    }
    const texture = new THREE.DataTexture(data, 32, 32, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);
  useEffect(() => () => contactMap.dispose(), [contactMap]);
  const count = quality === "cinematic" ? 260 : quality === "balanced" ? 170 : 96;
  useEffect(() => {
    if (!rocks.current) return;
    const random = seededRandom(19721211);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const shadowPositions: number[] = [], shadowUvs: number[] = [], shadowIndices: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const z = -12 - Math.pow(random(), 1.5) * 175;
      const spread = 20 + (-z - 18) * 0.46;
      const x = (random() - 0.5) * spread;
      const y = height(x, z);
      const size = 0.07 + random() * (index < 14 ? 1.18 : 0.34);
      position.set(x, y + size * 0.18, z);
      quaternion.setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI));
      scale.set(size * (0.72 + random() * 0.7), size * (0.42 + random() * 0.46), size * (0.74 + random() * 0.72));
      // Seat the rotated rock on the rendered ground instead of guessing its centre height.
      position.y = 0;
      matrix.compose(position, quaternion, scale);
      const vertices = rocks.current.geometry.getAttribute("position");
      const vertex = new THREE.Vector3();
      let support = -Infinity;
      for (let v = 0; v < vertices.count; v++) {
        vertex.fromBufferAttribute(vertices, v).applyMatrix4(matrix);
        support = Math.max(support, height(vertex.x, vertex.z) - vertex.y);
      }
      position.y = support - size * 0.08;
      matrix.compose(position, quaternion, scale);
      rocks.current.setMatrixAt(index, matrix);
      const start = shadowPositions.length / 3;
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        const px = x + (col - 1) * size * 1.35, pz = z + (row - 1) * size * 1.1;
        shadowPositions.push(px, height(px, pz) + 0.025, pz);
        shadowUvs.push(col / 2, row / 2);
        if (row < 2 && col < 2) { const a = start + row * 3 + col; shadowIndices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
      }
    }
    const footprintStart = shadowPositions.length / 3;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const x = LUNAR_ROVER.x + (col - 1) * 1.5, z = LUNAR_ROVER.z + (row - 1) * 1.5;
      shadowPositions.push(x, height(x, z) + 0.025, z);
      shadowUvs.push(col / 2, row / 2);
      if (row < 2 && col < 2) { const a = footprintStart + row * 3 + col; shadowIndices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    }
    rocks.current.instanceMatrix.needsUpdate = true;
    const contactGeometry = new THREE.BufferGeometry();
    contactGeometry.setAttribute("position", new THREE.Float32BufferAttribute(shadowPositions, 3));
    contactGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(shadowUvs, 2));
    contactGeometry.setIndex(shadowIndices);
    if (contacts.current) contacts.current.geometry = contactGeometry;
    return () => contactGeometry.dispose();
  }, [count, height]);
  return (
    <>
      <instancedMesh ref={rocks} args={[undefined, undefined, count]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#85847f" roughness={1} metalness={0} envMapIntensity={0} />
      </instancedMesh>
      <mesh ref={contacts} name="Regolith rock contact shading" frustumCulled={false}>
        <meshBasicMaterial map={contactMap} color="#111211" transparent opacity={0.65} depthWrite={false}
          polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} fog={false} />
      </mesh>
    </>
  );
}

function LunarLandingBeacons({ reducedMotion, height }: { reducedMotion: boolean; height: (x: number, z: number) => number }) {
  const markers = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!markers.current || reducedMotion) return;
    markers.current.children.forEach((marker, index) => {
      marker.children[1]?.scale.setScalar(0.78 + Math.max(0, Math.sin(clock.elapsedTime * 1.45 - index * 0.72)) * 0.34);
    });
  });
  return (
    <group ref={markers}>
      {[
        [-5.8, -0.47, -24],
        [0.4, -0.98, -33],
        [7.4, -1.52, -43]
      ].map(([x, , z], index) => (
        <group key={z} position={[x, height(x, z), z]}>
          <mesh position={[0, 0.28, 0]}>
            <cylinderGeometry args={[0.035, 0.055, 0.56, 10]} />
            <meshStandardMaterial color="#7b8183" metalness={0.82} roughness={0.32} />
          </mesh>
          <mesh position={[0, 0.62, 0]}>
            <sphereGeometry args={[0.075 + index * 0.008, 12, 8]} />
            <meshBasicMaterial color={index === 1 ? "#70d5f3" : "#ffad52"} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const earthAtmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const earthAtmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vViewDirection), 0.0), 2.35);
    gl_FragColor = vec4(0.18, 0.58, 1.0, rim * 0.72);
  }
`;

const arkshipAtmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const arkshipAtmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vViewDirection), 0.0), 2.8);
    vec3 color = mix(vec3(0.16, 0.34, 0.62), vec3(0.46, 0.72, 0.92), rim);
    gl_FragColor = vec4(color, rim * 0.46);
  }
`;

const arkshipRingVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const arkshipRingFragmentShader = `
  varying vec2 vUv;
  void main() {
    float radius = length(vUv - vec2(0.5)) * 2.0;
    float bandPosition = clamp((radius - 0.7333) / 0.2667, 0.0, 1.0);
    float edge = smoothstep(0.0, 0.07, bandPosition) * smoothstep(1.0, 0.91, bandPosition);
    float fineBands = 0.55 + 0.28 * sin(bandPosition * 118.0) + 0.14 * sin(bandPosition * 287.0);
    float division = smoothstep(0.018, 0.055, abs(bandPosition - 0.57));
    vec3 innerColor = vec3(0.42, 0.48, 0.58);
    vec3 outerColor = vec3(0.72, 0.66, 0.54);
    vec3 color = mix(innerColor, outerColor, bandPosition) * (0.78 + fineBands * 0.22);
    float alpha = edge * division * (0.18 + fineBands * 0.13);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function DeepSpaceExterior({ world, quality, reducedMotion }: {
  world: WorldDefinition;
  quality: ResolvedQuality;
  reducedMotion: boolean;
}) {
  const sourceMaps = useTexture({
    nebula: "/worlds/assets/exteriors/arkship-nebula.webp",
    planet: "/worlds/assets/exteriors/arkship-planet.webp"
  });
  const maps = useMemo(() => {
    const nebula = sourceMaps.nebula.clone();
    const planet = sourceMaps.planet.clone();
    nebula.colorSpace = planet.colorSpace = THREE.SRGBColorSpace;
    nebula.wrapS = THREE.RepeatWrapping;
    const anisotropy = quality === "cinematic" ? 12 : quality === "balanced" ? 8 : 3;
    nebula.anisotropy = anisotropy;
    planet.anisotropy = anisotropy;
    nebula.needsUpdate = planet.needsUpdate = true;
    // Soft opacity at every edge prevents the finite nebula cards reading as
    // rectangular pictures against the continuous star field.
    const fadeData = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const edge = Math.min(x, y, 31 - x, 31 - y) / 8;
      const t = Math.min(1, edge);
      const alpha = Math.round(t * t * (3 - 2 * t) * 255);
      fadeData.set([alpha, alpha, alpha, 255], (y * 32 + x) * 4);
    }
    const nebulaFade = new THREE.DataTexture(fadeData, 32, 32);
    nebulaFade.magFilter = nebulaFade.minFilter = THREE.LinearFilter;
    nebulaFade.needsUpdate = true;
    return { nebula, planet, nebulaFade };
  }, [quality, sourceMaps]);
  useEffect(() => () => Object.values(maps).forEach((texture) => texture.dispose()), [maps]);

  const seed = world.exterior.kind === "deep-space" ? world.exterior.starSeed : 1;
  const voyageSeconds = world.exterior.kind === "deep-space" ? world.exterior.voyageSeconds : 480;
  const stars = useMemo(() => createStarField(seed, ARKSHIP_EXTERIOR_DESIGN.starCount[quality], false), [quality, seed]);
  const nearField = useMemo(() => createNearField(seed + 17, ARKSHIP_EXTERIOR_DESIGN.nearFieldCount[quality]), [quality, seed]);
  const travelStreaks = useMemo(() => createTravelStreaks(seed + 43, ARKSHIP_EXTERIOR_DESIGN.travelStreakCount[quality]), [quality, seed]);
  useEffect(() => () => {
    stars.geometry.dispose();
    nearField.geometry.dispose();
    travelStreaks.geometry.dispose();
  }, [nearField, stars, travelStreaks]);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.dataset.arkshipNearFieldCount = String(ARKSHIP_EXTERIOR_DESIGN.nearFieldCount[quality]);
    canvas.dataset.arkshipTravelStreakCount = String(ARKSHIP_EXTERIOR_DESIGN.travelStreakCount[quality]);
    canvas.dataset.arkshipTravelPulseSeconds = String(ARKSHIP_EXTERIOR_DESIGN.travelPulseSeconds);
    canvas.dataset.arkshipPlanetSegments = `${ARKSHIP_EXTERIOR_DESIGN.planetWidthSegments[quality]}x${ARKSHIP_EXTERIOR_DESIGN.planetHeightSegments[quality]}`;
    return () => {
      delete canvas.dataset.arkshipNearFieldCount;
      delete canvas.dataset.arkshipTravelStreakCount;
      delete canvas.dataset.arkshipTravelPulseSeconds;
      delete canvas.dataset.arkshipPlanetSegments;
    };
  }, [gl.domElement, quality]);
  const starsRef = useRef<THREE.Points>(null);
  const nearRef = useRef<THREE.Points>(null);
  const streakRef = useRef<THREE.Mesh>(null);
  const planetRef = useRef<THREE.Group>(null);
  const nebulaNear = useRef<THREE.Mesh>(null);
  const nebulaFar = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    arkshipClock.elapsed = (arkshipClock.elapsed + Math.min(delta, 0.05)) % voyageSeconds;
    const planetPhase = (arkshipClock.elapsed / ARKSHIP_EXTERIOR_DESIGN.planetPassSeconds + ARKSHIP_EXTERIOR_DESIGN.planetStartPhase) % 1;
    const pulsePhase = (arkshipClock.elapsed % ARKSHIP_EXTERIOR_DESIGN.travelPulseSeconds) / ARKSHIP_EXTERIOR_DESIGN.travelPulseSeconds;
    const pulse = 1 + Math.pow(Math.sin(pulsePhase * Math.PI), 8) * ARKSHIP_EXTERIOR_DESIGN.travelPulseStrength;
    const position = nearRef.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (position) {
      for (let index = 0; index < position.count; index += 1) {
        // The library is a midships observation gallery. Stars travel laterally
        // across its side windows instead of rushing toward the camera like a
        // forward cockpit view.
        let x = position.getX(index) - delta * (ARKSHIP_EXTERIOR_DESIGN.nearFieldSpeed + (index % 9) * 0.62) * pulse;
        if (x < -142) x = 142 + (index % 23) * 1.9;
        position.setX(index, x);
      }
      position.needsUpdate = true;
    }
    const streakPosition = streakRef.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (streakPosition) {
      for (let index = 0; index < streakPosition.count / 6; index += 1) {
        const firstVertex = index * 6;
        const headX = streakPosition.getX(firstVertex);
        const tailX = streakPosition.getX(firstVertex + 1);
        const length = tailX - headX;
        const offset = delta * (ARKSHIP_EXTERIOR_DESIGN.travelStreakSpeed + (index % 11) * 1.15) * pulse;
        const nextTailX = tailX - offset;
        const resetHeadX = nextTailX < -146 ? 146 + (index % 19) * 2.15 : null;
        for (let vertex = 0; vertex < 6; vertex += 1) {
          const relativeX = streakPosition.getX(firstVertex + vertex) - headX;
          streakPosition.setX(firstVertex + vertex, resetHeadX === null ? headX + relativeX - offset : resetHeadX + Math.min(relativeX, length));
        }
      }
      streakPosition.needsUpdate = true;
    }
    if (starsRef.current) {
      starsRef.current.rotation.z = Math.sin(arkshipClock.elapsed * 0.011) * 0.004;
      starsRef.current.rotation.y = Math.sin(arkshipClock.elapsed * 0.006) * 0.008;
    }
    if (planetRef.current) {
      planetRef.current.position.x = 54 - planetPhase * 108;
      planetRef.current.position.y = 9 + Math.sin(planetPhase * Math.PI * 2) * 3.5;
      planetRef.current.rotation.y += delta * 0.012;
    }
    if (nebulaNear.current) nebulaNear.current.position.x = -34 + Math.sin(arkshipClock.elapsed * 0.018) * 18;
    if (nebulaFar.current) nebulaFar.current.position.x = 24 - Math.sin(arkshipClock.elapsed * 0.011) * 9;
  });

  return (
    <group rotation-y={-Math.PI / 2} raycast={() => null}>
      <points ref={starsRef} geometry={stars.geometry} frustumCulled={false} renderOrder={-6}>
        <pointsMaterial vertexColors size={quality === "lite" ? 0.62 : quality === "balanced" ? 0.78 : 0.88} sizeAttenuation transparent opacity={0.96} depthWrite={false} fog={false} toneMapped={false} />
      </points>
      {quality !== "lite" && (
        <points geometry={stars.geometry} frustumCulled={false} renderOrder={-7}>
          <pointsMaterial vertexColors size={quality === "cinematic" ? 1.72 : 1.42} sizeAttenuation transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
        </points>
      )}
      {quality !== "lite" && (
        <>
          <mesh ref={nebulaFar} position={[24, 12, -365]} renderOrder={-5}>
            <planeGeometry args={[240, 118]} />
            <meshBasicMaterial map={maps.nebula} alphaMap={maps.nebulaFade} color="#7491c3" transparent opacity={0.34} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
          </mesh>
          <mesh ref={nebulaNear} position={[-34, -8, -305]} scale={[1.25, 0.78, 1]} renderOrder={-4}>
            <planeGeometry args={[205, 102]} />
            <meshBasicMaterial map={maps.nebula} alphaMap={maps.nebulaFade} color="#a65b97" transparent opacity={0.24} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
          </mesh>
          {quality === "cinematic" && (
            <mesh position={[72, 28, -395]} rotation-z={-0.14} scale={[0.92, 0.56, 1]} renderOrder={-5}>
              <planeGeometry args={[210, 104]} />
              <meshBasicMaterial map={maps.nebula} alphaMap={maps.nebulaFade} color="#567fa5" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
            </mesh>
          )}
        </>
      )}
      <group ref={planetRef} position={[0, 9, -250]}>
        <mesh rotation-y={-0.9} renderOrder={-3}>
          <sphereGeometry args={[18, ARKSHIP_EXTERIOR_DESIGN.planetWidthSegments[quality], ARKSHIP_EXTERIOR_DESIGN.planetHeightSegments[quality]]} />
          <meshStandardMaterial map={maps.planet} bumpMap={maps.planet} bumpScale={0.48} color="#b2c7d7" roughness={0.88} emissive="#08111f" emissiveIntensity={0.1} transparent={false} opacity={ARKSHIP_EXTERIOR_DESIGN.planetSurfaceOpacity} depthWrite fog={false} />
        </mesh>
        <mesh scale={1.038} renderOrder={-2}>
          <sphereGeometry args={[18, ARKSHIP_EXTERIOR_DESIGN.planetWidthSegments[quality], ARKSHIP_EXTERIOR_DESIGN.planetHeightSegments[quality]]} />
          <shaderMaterial vertexShader={arkshipAtmosphereVertexShader} fragmentShader={arkshipAtmosphereFragmentShader} transparent side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation-x={Math.PI / 2.7} rotation-z={0.26} renderOrder={-3}>
          <ringGeometry args={[22, 30, ARKSHIP_EXTERIOR_DESIGN.ringSegments[quality]]} />
          <shaderMaterial vertexShader={arkshipRingVertexShader} fragmentShader={arkshipRingFragmentShader} transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
        {quality !== "lite" && (
          <mesh position={[-31, 7, -8]} renderOrder={-3}>
            <sphereGeometry args={[2.3, quality === "cinematic" ? 32 : 24, quality === "cinematic" ? 20 : 16]} />
            <meshStandardMaterial color="#8593a1" roughness={0.94} emissive="#111b25" emissiveIntensity={0.16} fog={false} />
          </mesh>
        )}
        <directionalLight position={[-42, 32, 28]} color="#b7d6ef" intensity={quality === "cinematic" ? 1.35 : 1.12} />
        <directionalLight position={[34, -12, 18]} color="#715c8e" intensity={0.32} />
      </group>
      <mesh ref={streakRef} geometry={travelStreaks.geometry} frustumCulled={false} renderOrder={ARKSHIP_EXTERIOR_DESIGN.motionRenderOrder}>
        <meshBasicMaterial vertexColors transparent opacity={quality === "lite" ? 0.38 : 0.54} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
      </mesh>
      <points ref={nearRef} geometry={nearField.geometry} frustumCulled={false} renderOrder={ARKSHIP_EXTERIOR_DESIGN.motionRenderOrder}>
        <pointsMaterial color="#c7e7f3" size={quality === "lite" ? 0.11 : quality === "balanced" ? 0.15 : 0.18} sizeAttenuation transparent opacity={0.78} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} toneMapped={false} />
      </points>
      <ArkshipExteriorHull world={world} quality={quality} />
      <mesh position={[-0.25, 3.25, -10.84]} renderOrder={1}>
        <planeGeometry args={[23.0, 4.92]} />
        <meshPhysicalMaterial color="#6e9cb0" transparent opacity={0.07} roughness={0.07} metalness={0.04} clearcoat={1} clearcoatRoughness={0.04} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function ArkshipExteriorHull({ world, quality }: { world: WorldDefinition; quality: ResolvedQuality }) {
  const panelCenters = [-9.2, -4.6, 0, 4.6, 9.2];
  const navigationLights = quality === "lite" ? [-8, 0, 8] : [-10, -6, -2, 2, 6, 10];
  return (
    <group raycast={() => null}>
      <mesh position={[-0.25, -0.35, -14.1]} receiveShadow>
        <boxGeometry args={[29.5, 2.2, 5.8]} />
        <meshStandardMaterial color="#101923" roughness={0.53} metalness={0.68} />
      </mesh>
      <mesh position={[-0.25, 0.68, -12.42]} receiveShadow>
        <boxGeometry args={[28.8, 0.86, 2.15]} />
        <meshStandardMaterial color="#233541" roughness={0.4} metalness={0.78} />
      </mesh>
      <mesh position={[-0.25, 1.13, -12.08]} receiveShadow>
        <boxGeometry args={[29.2, 0.16, 2.5]} />
        <meshStandardMaterial color="#617782" roughness={0.36} metalness={0.82} />
      </mesh>
      {panelCenters.map((x, index) => (
        <group key={x} position={[x, 0.72, -11.25]}>
          <mesh rotation-x={-0.05}>
            <boxGeometry args={[4.15, 0.58, 0.34]} />
            <meshStandardMaterial color={index % 2 ? "#1d2a35" : "#243440"} roughness={0.46} metalness={0.62} />
          </mesh>
          <mesh position={[0, 0.02, 0.2]}>
            <boxGeometry args={[3.45, 0.12, 0.08]} />
            <meshStandardMaterial color={index % 2 ? world.scene.secondary : world.scene.accent} roughness={0.25} metalness={0.8} emissive={index % 2 ? world.scene.secondary : world.scene.accent} emissiveIntensity={0.22} />
          </mesh>
        </group>
      ))}
      {[-11.4, -5.7, 0, 5.7, 11.4].map((x) => (
        <group key={`rib-${x}`} position={[x, 1.75, -12.35]}>
          <mesh rotation-z={x < 0 ? -0.18 : 0.18}>
            <boxGeometry args={[0.22, 1.55, 0.3]} />
            <meshStandardMaterial color="#708792" roughness={0.3} metalness={0.88} />
          </mesh>
          <mesh position={[0, 0.72, -0.12]}>
            <boxGeometry args={[1.05, 0.12, 0.22]} />
            <meshStandardMaterial color="#344a57" roughness={0.35} metalness={0.82} />
          </mesh>
        </group>
      ))}
      <mesh position={[-0.25, 2.62, -13.05]}>
        <boxGeometry args={[24.4, 0.12, 0.18]} />
        <meshStandardMaterial color="#637b86" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[-7.4, 2.2, -14.2]}>
        <cylinderGeometry args={[0.1, 0.16, 4.0, 14]} />
        <meshStandardMaterial color={world.scene.metal} roughness={0.3} metalness={0.86} />
      </mesh>
      <mesh position={[-7.4, 4.15, -14.2]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.72, 0.055, 10, 40]} />
        <meshStandardMaterial color="#738c98" roughness={0.28} metalness={0.88} />
      </mesh>
      <mesh position={[7.8, 2.15, -14.5]} rotation-z={-0.28}>
        <boxGeometry args={[0.18, 4.3, 0.22]} />
        <meshStandardMaterial color="#718893" roughness={0.32} metalness={0.86} />
      </mesh>
      <mesh position={[8.35, 4.05, -14.5]} rotation-z={-0.28}>
        <boxGeometry args={[2.3, 0.08, 0.14]} />
        <meshStandardMaterial color="#718893" roughness={0.32} metalness={0.86} />
      </mesh>
      {navigationLights.map((x, index) => (
        <mesh key={x} position={[x, 1.25, -10.98]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshBasicMaterial color={index % 2 ? world.scene.accent : world.scene.secondary} toneMapped={false} />
        </mesh>
      ))}
      <pointLight position={[-7.4, 3.45, -13.2]} color="#6ed5e7" intensity={0.45} distance={8} decay={2} />
    </group>
  );
}

export function createStarField(seed: number, count: number, lunar: boolean) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [new THREE.Color("#c8dcff"), new THREE.Color("#fff5df"), new THREE.Color("#ffe1bc"), new THREE.Color("#9fbfff")];
  for (let index = 0; index < count; index += 1) {
    const distance = lunar ? 520 + random() * 510 : 330 + random() * 190;
    // Cover the full observation hemisphere, including grazing views from the
    // ends of the gallery. Equal-area bands avoid both a rectangular cutoff
    // and accidental empty sectors with a bounded point budget.
    const columns = Math.ceil(Math.sqrt(count * 2));
    const rows = Math.ceil(count / columns);
    const angle = lunar ? (((index % columns) + random()) / columns - 0.5) * Math.PI * 1.18
      : (((index % columns) + random()) / columns - 0.5) * Math.PI;
    const height = lunar ? -0.12 + ((Math.floor(index / columns) + random()) / rows) * 1.12
      : ((Math.floor(index / columns) + random()) / rows - 0.5) * 2;
    const horizontal = distance * Math.sqrt(Math.max(0, 1 - height * height));
    positions[index * 3] = Math.sin(angle) * horizontal;
    positions[index * 3 + 1] = height * distance;
    positions[index * 3 + 2] = -Math.cos(angle) * horizontal;
    const color = palette[Math.floor(random() * palette.length)].clone().multiplyScalar(0.7 + random() * 0.3);
    color.toArray(colors, index * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return { geometry };
}

function createNearField(seed: number, count: number) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 284;
    positions[index * 3 + 1] = (random() - 0.5) * 22;
    positions[index * 3 + 2] = -280 - random() * 125;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return { geometry };
}

function createTravelStreaks(seed: number, count: number) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 18);
  const colors = new Float32Array(count * 18);
  const cool = new THREE.Color("#8fd9f0");
  const warm = new THREE.Color("#f1d4a1");
  for (let index = 0; index < count; index += 1) {
    const x = (random() - 0.5) * 292;
    const y = (random() - 0.5) * 20;
    const z = -276 - random() * 118;
    const depth = THREE.MathUtils.clamp((-z - 276) / 118, 0, 1);
    const length = THREE.MathUtils.lerp(2.8, 0.72, depth) * (0.72 + random() * 0.72);
    const width = THREE.MathUtils.lerp(0.11, 0.025, depth) * (0.72 + random() * 0.5);
    const color = cool.clone().lerp(warm, random() * 0.28).multiplyScalar(0.72 + random() * 0.28);
    const dimColor = color.clone().multiplyScalar(0.16);
    const offset = index * 18;
    const vertices = [
      [x, y - width, z, color], [x + length, y - width, z, dimColor], [x + length, y + width, z, dimColor],
      [x, y - width, z, color], [x + length, y + width, z, dimColor], [x, y + width, z, color]
    ] as const;
    vertices.forEach((vertex, vertexIndex) => {
      const vertexOffset = offset + vertexIndex * 3;
      positions[vertexOffset] = vertex[0];
      positions[vertexOffset + 1] = vertex[1];
      positions[vertexOffset + 2] = vertex[2];
      vertex[3].toArray(colors, vertexOffset);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return { geometry };
}

function seededRandom(seed: number) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
