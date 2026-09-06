import { LunarEntrance } from "./LunarEntrance";
import { ModernDaylightIndex } from "./ModernDaylightIndex";
import { useFrame, useLoader, useThree, type ThreeElements } from "@react-three/fiber";
import { Html, useTexture } from "@react-three/drei";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AlexandriaEntrance } from "./AlexandriaPortal";
import { RoomDetails } from "./RoomDetails";
import { RoomGrounding } from "./RoomGrounding";
import { DecoEntrance, RenaissanceEntrance } from "./RefinedEntrances";
import { RENAISSANCE_DOME, RENAISSANCE_SOFFIT } from "./renaissanceArchitecture";
import { InstancedBoxes } from "./shared";
import { ALEXANDRIA_ENTRANCE_DESIGN } from "./alexandriaEntrance";
import { ANTIKYTHERA_DISPLAY_LAYOUT, ANTIKYTHERA_EXHIBIT } from "./antikythera";
import { ARKSHIP_NAVIGATION_DESIGN } from "./arkshipNavigation";
import { createArkshipNavigationTexture } from "./arkshipPassengerDisplay";
import { resolveWorldModelLoadPlan, WORLD_MODEL_UPGRADE_DELAY_MS } from "./loading";
import type { ResolvedQuality, WorldDefinition, WorldEnvironmentProps } from "./types";

const ktxLoaders = new WeakMap<THREE.WebGLRenderer, KTX2Loader>();
const resourceReferences = new Map<string, number>();
const resourceDisposals = new Map<string, number>();
const modelCache = new Map<string, { scene: THREE.Object3D; lastUsed: number }>();
const RenderQuality = createContext<ResolvedQuality>("lite");

// Transmission renders the entire scene again. Reserve refraction for the
// explicit high-quality mode; ordinary alpha glass keeps compact rooms complete.
function WorldGlassMaterial(props: ThreeElements["meshPhysicalMaterial"]) {
  const quality = useContext(RenderQuality);
  return <meshPhysicalMaterial {...props} transmission={quality === "cinematic" ? props.transmission : 0} />;
}

function retainResource(key: string) {
  resourceReferences.set(key, (resourceReferences.get(key) || 0) + 1);
  const pending = resourceDisposals.get(key);
  if (pending !== undefined) {
    window.clearTimeout(pending);
    resourceDisposals.delete(key);
  }
}

function releaseResource(key: string) {
  const remaining = Math.max(0, (resourceReferences.get(key) || 1) - 1);
  resourceReferences.set(key, remaining);
  if (remaining > 0) return;
  const timer = window.setTimeout(() => {
    if ((resourceReferences.get(key) || 0) === 0) {
      // useLoader caches GLB geometry and source textures for the browser session.
      // Disposing those shared resources here can blank a newly mounted clone after
      // a world transition or HMR. Per-instance cloned materials are still disposed.
      resourceReferences.delete(key);
    }
    resourceDisposals.delete(key);
  }, 1200);
  resourceDisposals.set(key, timer);
}

export function AssetWorld({ world, reducedMotion, quality, onArchitectureReady, onReady, exterior }: WorldEnvironmentProps & { world: WorldDefinition; exterior?: ReactNode }) {
  const [modelReady, setModelReady] = useState(false);
  const [practicalsReady, setPracticalsReady] = useState(false);
  const [detailsReady, setDetailsReady] = useState(false);
  const [boundaryReady, setBoundaryReady] = useState(false);
  const [decorReady, setDecorReady] = useState(false);
  const architectureReported = useRef(false);
  const readyReported = useRef(false);
  const handleModelReady = useCallback(() => {
    setModelReady(true);
    if (architectureReported.current) return;
    architectureReported.current = true;
    onArchitectureReady?.();
  }, [onArchitectureReady]);
  const interactionReady = modelReady && practicalsReady && detailsReady && boundaryReady && decorReady;
  useEffect(() => {
    if (!interactionReady || readyReported.current) return;
    readyReported.current = true;
    onReady?.();
  }, [interactionReady, onReady]);
  return (
    <RenderQuality.Provider value={quality}>
    <group>
      <RoomGrounding world={world} />
      <Suspense fallback={null}>
        <ProgressiveWorldModel
          world={world}
          quality={quality}
          allowUpgrade={interactionReady}
          onInitialReady={handleModelReady}
        />
      </Suspense>
      <Suspense fallback={null}>
        <WorldPracticals world={world} reducedMotion={reducedMotion} />
        <AssetReadySignal onReady={() => setPracticalsReady(true)} />
      </Suspense>
      <Suspense fallback={null}>
        <RoomDetails world={world} quality={quality} reducedMotion={reducedMotion} />
        <AssetReadySignal onReady={() => setDetailsReady(true)} />
      </Suspense>
      <Suspense fallback={null}>
        <WorldBoundaryIllusion world={world} reducedMotion={reducedMotion} />
        <AssetReadySignal onReady={() => setBoundaryReady(true)} />
      </Suspense>
      <Suspense fallback={null}>
        {exterior === undefined ? world.assets.backplate && <WorldBackplates world={world} quality={quality} /> : exterior}
        {world.id === "renaissance" && <RenaissanceDome quality={quality} />}
        <WorldArt world={world} />
        <AssetReadySignal onReady={() => setDecorReady(true)} />
      </Suspense>
    </group>
    </RenderQuality.Provider>
  );
}

function rememberModel(url: string, scene: THREE.Object3D) {
  modelCache.set(url, { scene, lastUsed: performance.now() });
}

function scheduleModelEviction() {
  window.setTimeout(() => {
    const inactive = [...modelCache.entries()]
      .filter(([url]) => (resourceReferences.get(`model:${url}`) || 0) === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (modelCache.size > 2 && inactive.length) {
      const [url, entry] = inactive.shift()!;
      useLoader.clear(GLTFLoader, url);
      disposeSourceModel(entry.scene);
      modelCache.delete(url);
    }
  }, 15_000);
}

function disposeSourceModel(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    sourceMaterials.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function AssetReadySignal({ onReady }: { onReady?: () => void }) {
  const callback = useRef(onReady);
  callback.current = onReady;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => callback.current?.());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return null;
}

function ProgressiveWorldModel({ world, quality, allowUpgrade, onInitialReady }: {
  world: WorldDefinition;
  quality: ResolvedQuality;
  allowUpgrade: boolean;
  onInitialReady?: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const plan = useMemo(() => resolveWorldModelLoadPlan(world, quality, saveData), [quality, saveData, world]);
  const [requestUpgrade, setRequestUpgrade] = useState(false);
  const [upgradeSettled, setUpgradeSettled] = useState(false);
  const initialReported = useRef(false);
  useEffect(() => {
    gl.domElement.dataset.worldModelTier = upgradeSettled && plan.upgradeUrl ? "complete" : "compact";
  }, [gl, plan.upgradeUrl, upgradeSettled]);
  const handleInitialReady = useCallback(() => {
    if (initialReported.current) return;
    initialReported.current = true;
    onInitialReady?.();
  }, [onInitialReady]);

  useEffect(() => {
    setRequestUpgrade(false);
    setUpgradeSettled(false);
  }, [plan.initialUrl, plan.upgradeUrl]);

  useEffect(() => {
    if (!allowUpgrade || !plan.upgradeUrl) return;
    const requestIdle = window.requestIdleCallback
      || ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 16 }), 180));
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;
    let idleHandle: number | undefined;
    const delay = window.setTimeout(() => {
      idleHandle = requestIdle(() => setRequestUpgrade(true), { timeout: 8000 });
    }, WORLD_MODEL_UPGRADE_DELAY_MS);
    return () => {
      window.clearTimeout(delay);
      if (idleHandle !== undefined) cancelIdle(idleHandle);
    };
  }, [allowUpgrade, plan.upgradeUrl]);

  if (!plan.upgradeUrl) {
    return <WorldModel world={world} url={plan.initialUrl} quality="lite" onReady={handleInitialReady} />;
  }
  return (
    <group>
      {!upgradeSettled && (
        <WorldModel world={world} url={plan.initialUrl} quality="lite" onReady={handleInitialReady} />
      )}
      {requestUpgrade && (
        <Suspense fallback={null}>
          <WorldModel
            world={world}
            url={plan.upgradeUrl}
            quality={quality}
            fadeIn
            onSettled={() => setUpgradeSettled(true)}
          />
        </Suspense>
      )}
    </group>
  );
}

function WorldModel({ world, url, quality, fadeIn = false, onReady, onSettled }: {
  world: WorldDefinition;
  url: string;
  quality: ResolvedQuality;
  fadeIn?: boolean;
  onReady?: () => void;
  onSettled?: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const group = useRef<THREE.Group>(null);
  const progress = useRef(fadeIn ? 0 : 1);
  const settled = useRef(false);
  const asset = useLoader(GLTFLoader, url, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setKTX2Loader(getKtxLoader(gl));
  });
  const scene = useMemo(() => {
    const next = cloneSkeleton(asset.scene);
    const materialClones = new Map<string, THREE.Material>();
    next.traverse((object) => {
      const normalizedName = object.name.toLowerCase().replace(/[_\s.-]+/g, " ");
      const assetSource = String(object.userData.assetSource || "").toLowerCase();
      if (shouldHideWorldObject(world.id, normalizedName, assetSource)) {
        object.visible = false;
        return;
      }
      applyWorldObjectPolish(world.id, normalizedName, object.name.toLowerCase(), object);
      if (!(object instanceof THREE.Mesh)) return;
      if (world.id === "heritage" && (normalizedName.startsWith("balcony rail") || normalizedName.startsWith("baluster"))) {
        // Long, thin guards can be culled too aggressively after GLB mesh
        // optimization. They are always in view-safe architecture, so favor a
        // stable silhouette over a negligible per-frame culling saving.
        object.frustumCulled = false;
      }
      object.castShadow = quality === "cinematic";
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const clones = materials.map((material) => {
        const key = `${material.uuid}:${normalizedName === "marble nave floor"}`;
        const cached = materialClones.get(key);
        if (cached) return cached;
        const clone = material.clone();
        if (clone instanceof THREE.MeshStandardMaterial) {
          if (clone instanceof THREE.MeshPhysicalMaterial && quality !== "cinematic") clone.transmission = 0;
          clone.envMapIntensity = quality === "lite" ? 0.48 : 0.72;
          tuneWorldMaterial(clone, world);
          if (world.id === "alexandria" && clone.name.toLowerCase().includes("mouseion floor limestone")) {
            clone.roughness = 0.96;
            clone.roughnessMap = null;
            clone.normalScale.set(0.22, 0.22);
            clone.metalness = 0;
            clone.envMapIntensity = 0.2;
            clone.needsUpdate = true;
          }
          if (world.id === "gothic" && normalizedName === "marble nave floor") {
            // The night HDR contains a bright rectangular window that looked
            // like an unexplained luminous panel reflected in the nave. Keep
            // the marble softly reflective, but let actual room lights define
            // its highlights instead of the off-stage environment texture.
            clone.roughness = 0.94;
            clone.metalness = 0;
            clone.envMapIntensity = 0.02;
            clone.needsUpdate = true;
          }
        }
        if (fadeIn) {
          clone.transparent = true;
          clone.opacity = 0;
          clone.depthWrite = false;
        }
        materialClones.set(key, clone);
        return clone;
      });
      object.material = Array.isArray(object.material) ? clones : clones[0];
    });
    return next;
  }, [asset.scene, fadeIn, quality, world]);

  useEffect(() => {
    progress.current = fadeIn ? 0 : 1;
    settled.current = false;
    if (!fadeIn) return;
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        material.transparent = true;
        material.opacity = 0;
        material.depthWrite = false;
        material.needsUpdate = true;
      });
    });
  }, [fadeIn, scene]);

  useEffect(() => {
    onReady?.();
  }, [onReady, scene]);

  useEffect(() => {
    const key = `model:${url}`;
    rememberModel(url, asset.scene);
    retainResource(key);
    return () => {
      const disposed = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => disposed.add(material));
      });
      disposed.forEach((material) => material.dispose());
      releaseResource(key);
      scheduleModelEviction();
    };
  }, [asset.scene, scene, url]);

  useFrame((_, delta) => {
    if (!fadeIn || settled.current) return;
    progress.current = Math.min(1, progress.current + delta / 0.72);
    const opacity = THREE.MathUtils.smoothstep(progress.current, 0, 1);
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => { material.opacity = opacity; });
    });
    if (group.current) {
      const scale = 0.997 + opacity * 0.003;
      group.current.scale.setScalar(scale);
    }
    if (progress.current >= 1) {
      settled.current = true;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          material.opacity = 1;
          material.transparent = false;
          material.depthWrite = true;
          material.needsUpdate = true;
        });
      });
      onSettled?.();
    }
  });

  return <group ref={group}><primitive object={scene} /></group>;
}

function getKtxLoader(renderer: THREE.WebGLRenderer) {
  let loader = ktxLoaders.get(renderer);
  if (!loader) {
    loader = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
    loader.setWorkerLimit(Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2))));
    ktxLoaders.set(renderer, loader);
  }
  return loader;
}

type BackplatePanel = {
  position: [number, number, number];
  size: [number, number];
  rotationY?: number;
  slice?: [number, number];
};

const BACKPLATES: Partial<Record<WorldDefinition["id"], BackplatePanel[]>> = {
  heritage: [
    { position: [-5.8, 4.68, -10.49], size: [2.48, 4.25], slice: [0, 0.42] },
    { position: [5.8, 4.68, -10.49], size: [2.48, 4.25], slice: [0.58, 0.42] }
  ],
  gothic: [
    // Flank the entrance, facing into the nave; the apse shelves obscured
    // these views. Window frames use these same placements below.
    { position: [3.85, 5.5, 12.93], rotationY: Math.PI, size: [2.18, 4.5], slice: [0, 0.34] },
    { position: [-3.85, 5.5, 12.93], rotationY: Math.PI, size: [2.18, 4.5], slice: [0.66, 0.34] }
  ],
  modern: [{ position: [0, 4.15, -9.41], size: [20.5, 6.7] }],
  renaissance: [{ position: [0, 4.0, -11.28], size: [10.9, 6.3] }],
  foundry: [{ position: [0, 4.65, -10.21], size: [12.8, 4.8] }],
};

function WorldBackplates({ world, quality }: { world: WorldDefinition; quality: ResolvedQuality }) {
  const url = world.assets.backplate!;
  const source = useLoader(THREE.TextureLoader, url);
  useEffect(() => {
    const key = `texture:${url}`;
    retainResource(key);
    source.colorSpace = THREE.SRGBColorSpace;
    source.anisotropy = quality === "lite" ? 2 : 8;
    source.needsUpdate = true;
    return () => {
      releaseResource(key);
    };
  }, [quality, source, url]);
  return (
    <group>
      {(BACKPLATES[world.id] || []).map((panel, index) => (
        world.id === "modern"
          ? <ModernParallaxBackplate key={`${world.id}-${index}`} texture={source} panel={panel} quality={quality} />
          : <Backplate key={`${world.id}-${index}`} world={world} texture={source} panel={panel} />
      ))}
    </group>
  );
}

function Backplate({ world, texture, panel }: { world: WorldDefinition; texture: THREE.Texture; panel: BackplatePanel }) {
  const map = useMemo(() => {
    const clone = texture.clone();
    clone.needsUpdate = true;
    if (panel.slice) {
      clone.wrapS = THREE.ClampToEdgeWrapping;
      clone.repeat.set(panel.slice[1], 1);
      clone.offset.set(panel.slice[0], 0);
    }
    return clone;
  }, [panel.slice, texture]);
  useEffect(() => () => map.dispose(), [map]);
  const tint = world.id === "gothic" ? "#53647d"
    : world.id === "foundry" ? "#728589"
      : world.id === "deco" ? "#77766e"
        : world.id === "alexandria" ? "#f2e8d4"
          : "#c8c3b7";
  return (
    <mesh position={panel.position} rotation-y={panel.rotationY || 0} renderOrder={-1}>
      <planeGeometry args={panel.size} />
      <meshBasicMaterial map={map} color={tint} side={THREE.DoubleSide} toneMapped fog />
    </mesh>
  );
}

type BoundaryPart = { matrix: THREE.Matrix4; color: THREE.Color };

function WorldBoundaryIllusion({ world, reducedMotion }: { world: WorldDefinition; reducedMotion: boolean }) {
  const quality = useContext(RenderQuality);
  const gl = useThree((state) => state.gl);
  const laserOpacity = world.boundary.laserOpacity ?? 0;
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        laserOpacity: { value: laserOpacity },
        time: { value: 0 },
        motion: { value: reducedMotion ? 0 : 1 },
        starship: { value: world.boundary.style === "starship" ? 1 : 0 },
        fieldColorA: { value: new THREE.Color(world.boundary.style === "starship" ? "#7f0719" : "#b80005") },
        fieldColorB: { value: new THREE.Color(world.boundary.style === "starship" ? "#ff4960" : "#ff141c") }
      },
      vertexShader: `
        varying vec2 portalUv;
        void main() {
          portalUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float laserOpacity;
        uniform float time;
        uniform float motion;
        uniform float starship;
        uniform vec3 fieldColorA;
        uniform vec3 fieldColorB;
        varying vec2 portalUv;
        void main() {
          float horizontal = pow(max(0.0, sin((portalUv.y * 32.0 + time * 0.55 * motion) * 3.14159265)), 30.0);
          float vertical = pow(max(0.0, sin((portalUv.x * 18.0 - time * 0.34 * motion) * 3.14159265)), 34.0);
          float diagonalA = pow(max(0.0, sin((portalUv.x * 10.0 - portalUv.y * 3.0) * 3.14159265)), 38.0);
          float diagonalB = pow(max(0.0, sin((portalUv.x * 10.0 + portalUv.y * 3.0) * 3.14159265)), 38.0);
          float edgeDistance = min(min(portalUv.x, 1.0 - portalUv.x), min(portalUv.y, 1.0 - portalUv.y));
          float edge = smoothstep(0.055, 0.0, edgeDistance);
          float pulse = 0.92 + 0.08 * sin(time * 1.4 * motion);
          float grid = mix(horizontal + (diagonalA + diagonalB) * 0.34, max(horizontal * 0.8, vertical) + (diagonalA + diagonalB) * 0.12, starship);
          float alpha = clamp(laserOpacity * pulse + grid * 0.16 + edge * 0.2, laserOpacity, 0.52);
          vec3 color = mix(fieldColorA, fieldColorB, clamp(grid + edge * 0.5, 0.0, 1.0));
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });
  }, [laserOpacity, reducedMotion, world.boundary.style]);

  useEffect(() => {
    gl.domElement.dataset.boundaryStyle = world.boundary.style;
    gl.domElement.dataset.boundaryBarrierKind = world.boundary.barrierKind;
    gl.domElement.dataset.boundaryLaserOpacity = String(laserOpacity);
    gl.domElement.dataset.boundaryDepth = String(world.boundary.depth);
    return () => {
      material.dispose();
    };
  }, [gl.domElement, laserOpacity, material, world.boundary.barrierKind, world.boundary.depth, world.boundary.style]);

  useFrame(({ clock }) => {
    material.uniforms.time.value = clock.elapsedTime;
  });

  const boundary = world.boundary;
  return (
    <group>
      {world.id === "lunar" ? <LunarEntrance world={world} /> : world.id === "alexandria" ? <AlexandriaEntrance /> : world.id === "renaissance" ? <RenaissanceEntrance world={world} castShadow={quality === "cinematic"} /> : world.id === "deco" ? <DecoEntrance world={world} /> : <BoundaryArchitecture world={world} />}
      {world.id !== "lunar" && world.id !== "alexandria" && world.id !== "renaissance" && world.id !== "deco" && <BoundaryCorridorLights world={world} />}
      {boundary.barrierKind === "doors" && world.id !== "lunar" && world.id !== "deco" && world.id !== "alexandria" && <RoomEntranceDoors world={world} />}
      {boundary.barrierKind === "energy" && boundary.placements.map((placement, index) => (
          <mesh
            key={`${world.id}-boundary-${index}`}
            position={[
              placement.position[0] + Math.sin(placement.rotationY) * 0.24,
              placement.position[1] + boundary.height / 2,
              placement.position[2] + Math.cos(placement.rotationY) * 0.24
            ]}
            rotation-y={placement.rotationY}
            renderOrder={2}
          >
            <planeGeometry args={[boundary.width, boundary.height]} />
            <primitive object={material} attach="material" />
          </mesh>
        ))}
    </group>
  );
}

function RoomEntranceDoors({ world }: { world: WorldDefinition }) {
  const { width, height, style, placements } = world.boundary;
  const palette = corridorProfile(world);
  const grille = style === "gothic" || style === "deco";
  const wood = style === "georgian" || style === "renaissance";
  const layout = useMemo(() => {
    type Part = { position: [number, number, number]; scale: [number, number, number]; rotation?: [number, number, number] };
    const panels: Part[] = [];
    const trim: Part[] = [];
    const hardware: Part[] = [];
    const inner = width - 0.3;
    for (const side of [-1, 1]) {
      const center = side * inner / 4;
      panels.push({ position: [center, grille ? 0.54 : height / 2, 0.2], scale: [inner / 2 - 0.045, grille ? 1.0 : height - 0.12, 0.16] });
      trim.push({ position: [side * (width / 2 - 0.055), height / 2, 0.28], scale: [0.13, height, 0.18] });
      hardware.push({ position: [side * 0.16, 1.4, 0.34], scale: [0.055, 0.42, 0.08] });
      if (wood) {
        for (const y of [1.15, 3.15]) {
          const panelHeight = y < 2 ? 1.4 : Math.min(1.7, height - 2.5);
          for (const dx of [-1, 1]) trim.push({ position: [center + dx * (inner / 4 - 0.14), y, 0.3], scale: [0.055, panelHeight, 0.055] });
          for (const dy of [-1, 1]) trim.push({ position: [center, y + dy * panelHeight / 2, 0.3], scale: [inner / 2 - 0.23, 0.055, 0.055] });
        }
      }
    }
    trim.push({ position: [0, height - 0.06, 0.28], scale: [width, 0.14, 0.18] }, { position: [0, height / 2, 0.29], scale: [0.07, height, 0.09] });
    if (grille) {
      const count = style === "deco" ? 14 : 12;
      for (let i = 1; i < count; i++) trim.push({ position: [-inner / 2 + inner * i / count, (height + 1) / 2, 0.22], scale: [0.04, height - 1.15, 0.045] });
      for (const y of [1.06, height - 0.24]) trim.push({ position: [0, y, 0.25], scale: [inner, 0.08, 0.1] });
      if (style === "deco") for (const side of [-1, 1]) for (const angle of [-Math.PI / 4, Math.PI / 4]) {
        trim.push({ position: [side * inner / 4, 2.7, 0.29], scale: [0.055, 1.2, 0.055], rotation: [0, 0, angle] });
      }
    } else if (!wood) {
      const count = style === "industrial" ? 14 : 4;
      for (let i = 1; i < count; i++) trim.push({ position: [0, height * i / count, 0.3], scale: [inner - 0.12, 0.035, 0.025] });
    }
    return { panels, trim, hardware };
  }, [width, height, style, grille, wood]);
  return <group name={`${style} entrance closure`}>
    {placements.map((placement, index) => <group key={index} position={placement.position} rotation-y={placement.rotationY}>
      <InstancedBoxes transforms={layout.panels} color={palette.door} roughness={wood ? 0.72 : 0.5} metalness={wood ? 0 : 0.42} castShadow={false} />
      <InstancedBoxes transforms={layout.trim} color={palette.trim} roughness={0.48} metalness={wood ? 0.12 : 0.64} castShadow={false} />
      <InstancedBoxes transforms={layout.hardware} color={palette.hardware} roughness={0.3} metalness={0.7} castShadow={false} />
    </group>)}
  </group>;
}

function BoundaryCorridorLights({ world }: { world: WorldDefinition }) {
  const color = world.boundary.style === "modern"
    ? "#c7e8ff"
    : world.boundary.style === "gothic"
      ? "#ffb16b"
      : world.boundary.style === "industrial"
        ? "#ff9b48"
        : world.boundary.style === "lunar"
          ? "#d9f1ff"
          : world.boundary.style === "starship"
            ? "#7bd8e8"
            : world.boundary.style === "alexandrian"
              ? "#f0c77c"
        : world.scene.practical;
  return (
    <group>
      {world.boundary.placements.map((placement, index) => {
        const middle = transformBoundaryPoint(placement.position, placement.rotationY, [0, world.boundary.height * 0.7, -world.boundary.depth * 0.46]);
        const terminal = transformBoundaryPoint(placement.position, placement.rotationY, [0, world.boundary.height * 0.55, -world.boundary.depth * 0.86]);
        const middleIntensity = world.id === "alexandria" ? 0.72 : world.id === "modern" ? 1.6 : 2.1;
        const terminalIntensity = world.id === "alexandria" ? 0.38 : world.id === "modern" ? 1.1 : 1.7;
        return (
          <group key={`${world.id}-corridor-light-${index}`}>
            <pointLight position={middle} color={color} intensity={middleIntensity} distance={world.boundary.depth * 1.25} decay={2} />
            <pointLight position={terminal} color={world.scene.accent} intensity={terminalIntensity} distance={world.boundary.depth * 0.72} decay={2} />
          </group>
        );
      })}
    </group>
  );
}

function transformBoundaryPoint(origin: [number, number, number], rotationY: number, local: [number, number, number]): [number, number, number] {
  const point = new THREE.Vector3(...local).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY).add(new THREE.Vector3(...origin));
  return [point.x, point.y, point.z];
}

function BoundaryArchitecture({ world }: { world: WorldDefinition }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => buildBoundaryParts(world), [world]);
  const satin = world.id === "heritage" || world.id === "foundry" || world.id === "lunar" || world.id === "arkship";
  const materialFamily = world.id === "modern" ? "concrete"
    : world.id === "foundry" || world.id === "lunar" || world.id === "arkship" ? "metal"
      : world.id === "renaissance" || world.id === "alexandria" ? "marble"
        : world.id === "gothic" ? "stone"
        : "wood";
  const maps = useTexture({
    map: materialFamily === "concrete" ? "/worlds/assets/materials/shelf-concrete-color.webp"
      : materialFamily === "metal" ? "/worlds/assets/materials/shelf-metal-color.webp"
        : materialFamily === "marble" ? "/worlds/assets/materials/marble-color.webp"
          : materialFamily === "stone" ? "/worlds/assets/materials/boundary-stone-color.webp"
            : "/worlds/assets/materials/shelf-wood-color.webp",
    normalMap: materialFamily === "concrete" ? "/worlds/assets/materials/shelf-concrete-normal.webp"
      : materialFamily === "metal" ? "/worlds/assets/materials/shelf-metal-normal.webp"
        : materialFamily === "marble" ? "/worlds/assets/materials/marble-normal.webp"
        : materialFamily === "stone" ? "/worlds/assets/materials/boundary-stone-normal.webp"
          : "/worlds/assets/materials/shelf-wood-normal.webp",
    ...(satin ? {} : { roughnessMap: materialFamily === "concrete" ? "/worlds/assets/materials/shelf-concrete-roughness.webp"
      : materialFamily === "metal" ? "/worlds/assets/materials/shelf-metal-roughness.webp"
        : materialFamily === "marble" ? "/worlds/assets/materials/marble-roughness.webp"
        : materialFamily === "stone" ? "/worlds/assets/materials/boundary-stone-roughness.webp"
          : "/worlds/assets/materials/shelf-wood-roughness.webp" })
  });
  useEffect(() => {
    Object.entries(maps).forEach(([key, texture]) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = key === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    });
  }, [maps]);
  useEffect(() => {
    if (!mesh.current) return;
    parts.forEach((part, index) => {
      mesh.current?.setMatrixAt(index, part.matrix);
      mesh.current?.setColorAt(index, part.color);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [parts]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, parts.length]} castShadow receiveShadow frustumCulled={false}>
      <boxGeometry />
      <meshStandardMaterial
        vertexColors
        map={maps.map}
        normalMap={maps.normalMap}
        normalScale={new THREE.Vector2(satin ? 0.12 : world.id === "modern" ? 0.16 : 0.22, satin ? 0.12 : world.id === "modern" ? 0.16 : 0.22)}
        roughnessMap={satin ? undefined : maps.roughnessMap}
        roughness={satin ? 0.72 : world.id === "modern" ? 0.62 : world.id === "foundry" ? 0.5 : 0.68}
        envMapIntensity={satin ? 0.3 : 1}
        metalness={world.id === "deco" || world.id === "foundry" || world.id === "lunar" || world.id === "arkship" ? 0.34 : 0.08}
        emissive={world.scene.wall}
        emissiveIntensity={0.06}
      />
    </instancedMesh>
  );
}

export function buildBoundaryParts(world: WorldDefinition): BoundaryPart[] {
  const parts: BoundaryPart[] = [];
  const boundary = world.boundary;
  const addPlacement = (position: [number, number, number], rotationY: number) => {
  const structuralTrim = world.scene.metal;
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    new THREE.Vector3(1, 1, 1)
  );
  const addLocal = (position: [number, number, number], scale: [number, number, number], color: string, rotationZ = 0) => {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotationZ)),
      new THREE.Vector3(...scale)
    );
    parts.push({ matrix: parent.clone().multiply(local), color: new THREE.Color(color) });
  };

  const facadeHeight = world.id === "gothic" ? 8.2 : world.id === "foundry" || world.id === "lunar" || world.id === "arkship" ? 7.8 : 7.3;
  const sideWidth = Math.max(0.5, (boundary.span - boundary.width) / 2);
  const sideCenter = boundary.width / 2 + sideWidth / 2;
  const facadeWall = world.id === "modern" ? "#59636a" : world.scene.wall;
  const insetColor = world.id === "modern" ? "#34434c" : world.scene.shelf;
  addLocal([-sideCenter, facadeHeight / 2, -0.08], [sideWidth, facadeHeight, 0.34], facadeWall);
  addLocal([sideCenter, facadeHeight / 2, -0.08], [sideWidth, facadeHeight, 0.34], facadeWall);
  addLocal([-sideCenter, facadeHeight / 2, 0.13], [Math.max(0.2, sideWidth - 0.4), facadeHeight - 0.5, 0.08], insetColor);
  addLocal([sideCenter, facadeHeight / 2, 0.13], [Math.max(0.2, sideWidth - 0.4), facadeHeight - 0.5, 0.08], insetColor);
  addLocal([0, 0.18, 0.3], [boundary.span, 0.36, 0.42], structuralTrim);
  // Deep return walls overlap the imported room shell and prevent the world
  // background from appearing at oblique entrance angles.
  addLocal([-boundary.span / 2 + 0.16, facadeHeight / 2, -0.72], [0.42, facadeHeight, 1.62], facadeWall);
  addLocal([boundary.span / 2 - 0.16, facadeHeight / 2, -0.72], [0.42, facadeHeight, 1.62], facadeWall);
  const crownHeight = Math.max(0.45, facadeHeight - boundary.height);
  addLocal([0, boundary.height + crownHeight / 2, -0.08], [boundary.width, crownHeight, 0.34], world.scene.wall);

  const frameDepth = 0.18;
  addLocal([-(boundary.width / 2 + 0.18), boundary.height / 2, 0.38], [0.3, boundary.height + 0.45, frameDepth], structuralTrim);
  addLocal([boundary.width / 2 + 0.18, boundary.height / 2, 0.38], [0.3, boundary.height + 0.45, frameDepth], structuralTrim);
  const entranceLintelHeight = boundary.style === "alexandrian" ? ALEXANDRIA_ENTRANCE_DESIGN.facadeLintelHeight : 0.34;
  const entranceLintelCenter = boundary.style === "alexandrian"
    ? boundary.height + ALEXANDRIA_ENTRANCE_DESIGN.facadeLintelCenterOffset
    : boundary.height + 0.18;
  addLocal([0, entranceLintelCenter, 0.38], [boundary.width + 0.66, entranceLintelHeight, frameDepth], structuralTrim);
  addLocal([0, 0.1, 0.4], [boundary.width + 0.7, 0.2, 0.34], world.scene.metal);

  addBoundaryCorridor(addLocal, world);

  // The Foundry relay chambers own their mounting rails; this lattice
  // formerly cut through the wall display. Keep the structural door frame.
  if (world.id !== "foundry") {
    for (let x = -boundary.span / 2 + 1.35; x < boundary.span / 2; x += 2.7) {
      if (Math.abs(x) < boundary.width / 2 + 0.55) continue;
      addLocal([x, facadeHeight / 2, 0.26], [0.26, facadeHeight - 0.5, 0.1], structuralTrim);
    }
    for (const side of [-1, 1]) {
      addLocal([side * sideCenter, 1.25, 0.26], [sideWidth - 0.25, 0.18, 0.1], structuralTrim);
      addLocal([side * sideCenter, facadeHeight - 1.0, 0.26], [sideWidth - 0.25, 0.18, 0.1], structuralTrim);
    }
  }

  if (boundary.style === "gothic") {
    addLocal([-boundary.width * 0.25, boundary.height + 0.65, 0.4], [boundary.width * 0.58, 0.18, 0.16], world.scene.metal, -0.52);
    addLocal([boundary.width * 0.25, boundary.height + 0.65, 0.4], [boundary.width * 0.58, 0.18, 0.16], world.scene.metal, 0.52);
  } else if (boundary.style === "georgian") {
    addLocal([0, boundary.height + 0.55, 0.4], [boundary.width + 1.2, 0.18, 0.16], world.scene.metal);
    addLocal([0, boundary.height + 0.82, 0.4], [boundary.width * 0.72, 0.16, 0.16], structuralTrim);
  } else if (boundary.style === "renaissance") {
    addLocal([-boundary.width * 0.29, boundary.height + 0.52, 0.4], [boundary.width * 0.52, 0.16, 0.16], world.scene.metal, -0.38);
    addLocal([boundary.width * 0.29, boundary.height + 0.52, 0.4], [boundary.width * 0.52, 0.16, 0.16], world.scene.metal, 0.38);
  } else if (boundary.style === "deco") {
    addLocal([0, boundary.height + 0.48, 0.4], [boundary.width + 1.0, 0.18, 0.16], world.scene.metal);
    addLocal([0, boundary.height + 0.76, 0.4], [boundary.width * 0.74, 0.18, 0.16], world.scene.metal);
    addLocal([0, boundary.height + 1.04, 0.4], [boundary.width * 0.42, 0.18, 0.16], world.scene.metal);
  } else if (boundary.style === "industrial") {
    addLocal([0, boundary.height * 0.28, 0.4], [boundary.width + 0.35, 0.055, 0.12], world.scene.metal);
    addLocal([0, boundary.height * 0.72, 0.4], [boundary.width + 0.35, 0.055, 0.12], world.scene.metal);
  } else if (boundary.style === "lunar") {
    addLocal([0, boundary.height + 0.48, 0.4], [boundary.width + 0.82, 0.16, 0.18], world.scene.metal);
    addLocal([0, boundary.height + 0.73, 0.4], [boundary.width * 0.68, 0.1, 0.16], world.scene.accent);
    addLocal([-boundary.width / 2 - 0.28, boundary.height / 2, 0.4], [0.14, boundary.height + 0.65, 0.14], world.scene.secondary);
    addLocal([boundary.width / 2 + 0.28, boundary.height / 2, 0.4], [0.14, boundary.height + 0.65, 0.14], world.scene.secondary);
  } else if (boundary.style === "starship") {
    addLocal([0, boundary.height + 0.38, 0.4], [boundary.width + 1.05, 0.14, 0.18], world.scene.metal);
    addLocal([-boundary.width * 0.31, boundary.height + 0.68, 0.4], [boundary.width * 0.48, 0.12, 0.16], world.scene.trim, -0.42);
    addLocal([boundary.width * 0.31, boundary.height + 0.68, 0.4], [boundary.width * 0.48, 0.12, 0.16], world.scene.trim, 0.42);
    addLocal([-boundary.width / 2 - 0.25, boundary.height * 0.52, 0.4], [0.12, boundary.height + 0.55, 0.14], world.scene.accent, -0.07);
    addLocal([boundary.width / 2 + 0.25, boundary.height * 0.52, 0.4], [0.12, boundary.height + 0.55, 0.14], world.scene.accent, 0.07);
  } else if (boundary.style === "alexandrian") {
    addLocal([-boundary.width / 2 - 0.27, boundary.height * 0.5, 0.4], [0.16, boundary.height + 0.38, 0.18], world.scene.trim);
    addLocal([boundary.width / 2 + 0.27, boundary.height * 0.5, 0.4], [0.16, boundary.height + 0.38, 0.18], world.scene.trim);
    addLocal([-boundary.width / 2 - 0.27, boundary.height + 0.04, 0.4], [0.46, 0.16, 0.22], world.scene.metal);
    addLocal([boundary.width / 2 + 0.27, boundary.height + 0.04, 0.4], [0.46, 0.16, 0.22], world.scene.metal);
    addLocal([0, boundary.height - 0.02, 0.41], [boundary.width + 0.82, 0.1, 0.16], world.scene.accent);
  } else {
    addLocal([0, boundary.height + 0.5, 0.4], [boundary.width + 0.9, 0.12, 0.16], world.scene.secondary);
  }

  };
  boundary.placements.forEach((placement) => addPlacement(placement.position, placement.rotationY));

  // The museum exterior owns the Modern Archive's complete glazing system.
  if (world.id !== "alexandria" && world.id !== "modern") {
    for (const panel of BACKPLATES[world.id] || []) addWindowFrameParts(parts, panel, world.scene.metal);
  }
  return parts;
}

function addBoundaryCorridor(
  addLocal: (position: [number, number, number], scale: [number, number, number], color: string, rotationZ?: number) => void,
  world: WorldDefinition
) {
  const { boundary, scene } = world;
  const depth = boundary.depth;
  const width = boundary.width;
  const height = boundary.height;
  const profile = corridorProfile(world);
  const doorWidth = width * (boundary.style === "industrial" ? 0.76 : boundary.style === "starship" ? 0.82 : 0.68);
  const doorHeight = height * (boundary.style === "gothic" ? 0.79 : 0.72);
  const endZ = -depth + 0.12;

  // The vestibule is genuine geometry beyond the collision limit, so movement produces real parallax.
  addLocal([0, 0.0, -depth / 2], [width, 0.18, depth], profile.floor);
  addLocal([0, height, -depth / 2], [width, 0.2, depth], profile.ceiling);
  addLocal([-width / 2, height / 2, -depth / 2], [0.22, height, depth], profile.wall);
  addLocal([width / 2, height / 2, -depth / 2], [0.22, height, depth], profile.wall);

  const endSideWidth = (width - doorWidth) / 2;
  addLocal([-(doorWidth / 2 + endSideWidth / 2), height / 2, endZ - 0.12], [endSideWidth, height, 0.3], profile.wall);
  addLocal([doorWidth / 2 + endSideWidth / 2, height / 2, endZ - 0.12], [endSideWidth, height, 0.3], profile.wall);
  addLocal([0, doorHeight + (height - doorHeight) / 2, endZ - 0.12], [doorWidth, height - doorHeight, 0.3], profile.wall);

  addLocal([-doorWidth * 0.25, doorHeight / 2, endZ], [doorWidth * 0.48, doorHeight, 0.22], profile.door);
  addLocal([doorWidth * 0.25, doorHeight / 2, endZ], [doorWidth * 0.48, doorHeight, 0.22], profile.door);
  addLocal([0, doorHeight / 2, endZ + 0.13], [0.065, doorHeight * 0.94, 0.08], profile.trim);
  addLocal([-(doorWidth / 2 + 0.12), doorHeight / 2, endZ + 0.1], [0.18, doorHeight + 0.3, 0.18], profile.trim);
  addLocal([doorWidth / 2 + 0.12, doorHeight / 2, endZ + 0.1], [0.18, doorHeight + 0.3, 0.18], profile.trim);
  addLocal([0, doorHeight + 0.12, endZ + 0.1], [doorWidth + 0.42, 0.18, 0.18], profile.trim);
  addLocal([-0.13, doorHeight * 0.52, endZ + 0.19], [0.07, 0.2, 0.08], profile.hardware);
  addLocal([0.13, doorHeight * 0.52, endZ + 0.19], [0.07, 0.2, 0.08], profile.hardware);

  const portalSpacing = boundary.style === "gothic" ? 1.75 : 1.55;
  for (let z = -1.35; z > -depth + 1.0; z -= portalSpacing) {
    addLocal([-width / 2 + 0.13, height / 2, z], [0.2, height, 0.22], profile.trim);
    addLocal([width / 2 - 0.13, height / 2, z], [0.2, height, 0.22], profile.trim);
    addLocal([0, height - 0.11, z], [width, 0.2, 0.22], profile.trim);
  }

  if (boundary.style === "georgian") {
    for (const side of [-1, 1]) {
      addLocal([side * (width / 2 - 0.14), 1.05, -depth / 2], [0.08, 0.12, depth - 0.5], profile.trim);
      addLocal([side * (width / 2 - 0.14), 2.25, -depth / 2], [0.08, 0.1, depth - 0.5], profile.trim);
    }
    addLocal([0, doorHeight * 0.28, endZ + 0.14], [doorWidth * 0.78, 0.08, 0.06], profile.hardware);
    addLocal([0, doorHeight * 0.72, endZ + 0.14], [doorWidth * 0.78, 0.08, 0.06], profile.hardware);
  } else if (boundary.style === "gothic") {
    for (let z = -1.35; z > -depth + 1.0; z -= portalSpacing) {
      addLocal([-width * 0.24, height - 0.42, z + 0.01], [width * 0.57, 0.14, 0.16], profile.trim, -0.56);
      addLocal([width * 0.24, height - 0.42, z + 0.01], [width * 0.57, 0.14, 0.16], profile.trim, 0.56);
    }
    for (const x of [-doorWidth * 0.3, -doorWidth * 0.1, doorWidth * 0.1, doorWidth * 0.3]) {
      addLocal([x, doorHeight * 0.54, endZ + 0.16], [0.045, doorHeight * 0.83, 0.05], profile.hardware);
    }
  } else if (boundary.style === "modern") {
    for (let z = -0.8; z > -depth + 0.7; z -= 1.25) {
      addLocal([0, height - 0.22, z], [width * 0.72, 0.055, 0.38], profile.light);
    }
    addLocal([0, 0.13, -depth / 2], [0.06, 0.03, depth - 0.6], scene.accent);
    addLocal([0, doorHeight * 0.5, endZ + 0.14], [0.055, doorHeight * 0.93, 0.05], scene.accent);
  } else if (boundary.style === "renaissance") {
    for (let z = -1.35; z > -depth + 1.0; z -= portalSpacing) {
      addLocal([-width * 0.28, height - 0.36, z + 0.01], [width * 0.53, 0.16, 0.18], profile.trim, -0.43);
      addLocal([width * 0.28, height - 0.36, z + 0.01], [width * 0.53, 0.16, 0.18], profile.trim, 0.43);
    }
    addLocal([0, 0.13, -depth / 2], [width * 0.58, 0.035, depth - 0.4], "#9f4f32");
  } else if (boundary.style === "deco") {
    for (const inset of [0.18, 0.42, 0.66]) {
      addLocal([0, height - inset, -depth / 2], [width - inset * 1.25, 0.08, depth - 0.45], profile.trim);
    }
    addLocal([0, doorHeight * 0.5, endZ + 0.15], [0.055, doorHeight * 0.9, 0.06], profile.hardware);
    addLocal([0, doorHeight + 0.34, endZ + 0.16], [doorWidth * 0.42, 0.2, 0.08], profile.hardware);
  } else if (boundary.style === "lunar") {
    for (let z = -0.9; z > -depth + 0.8; z -= 1.35) {
      addLocal([0, height - 0.18, z], [width * 0.76, 0.07, 0.3], profile.light);
      addLocal([-width / 2 + 0.16, 0.42, z], [0.055, 0.07, 0.48], scene.secondary);
      addLocal([width / 2 - 0.16, 0.42, z], [0.055, 0.07, 0.48], scene.secondary);
    }
    addLocal([0, doorHeight * 0.5, endZ + 0.15], [0.06, doorHeight * 0.9, 0.07], profile.hardware);
    addLocal([0, doorHeight * 0.18, endZ + 0.15], [doorWidth * 0.78, 0.08, 0.07], profile.hardware);
    addLocal([0, doorHeight * 0.82, endZ + 0.15], [doorWidth * 0.78, 0.08, 0.07], profile.hardware);
  } else if (boundary.style === "starship") {
    for (let z = -0.9; z > -depth + 0.8; z -= 1.45) {
      addLocal([0, height - 0.16, z], [width * 0.58, 0.055, 0.34], profile.light);
      addLocal([-width * 0.39, height * 0.52, z], [0.1, height * 0.82, 0.18], profile.trim, -0.16);
      addLocal([width * 0.39, height * 0.52, z], [0.1, height * 0.82, 0.18], profile.trim, 0.16);
    }
    addLocal([-width * 0.28, 0.14, -depth / 2], [0.055, 0.035, depth - 0.55], scene.secondary);
    addLocal([width * 0.28, 0.14, -depth / 2], [0.055, 0.035, depth - 0.55], scene.accent);
    addLocal([-doorWidth * 0.23, doorHeight * 0.5, endZ + 0.15], [doorWidth * 0.58, 0.075, 0.07], profile.hardware, -0.78);
    addLocal([doorWidth * 0.23, doorHeight * 0.5, endZ + 0.15], [doorWidth * 0.58, 0.075, 0.07], profile.hardware, 0.78);
    addLocal([0, doorHeight + 0.32, endZ + 0.15], [doorWidth * 0.46, 0.12, 0.07], scene.secondary);
  } else if (boundary.style === "alexandrian") {
    for (let z = -1.1; z > -depth + 0.9; z -= 1.7) {
      addLocal([-width * 0.3, height - 0.36, z], [width * 0.54, 0.16, 0.18], profile.trim, -0.42);
      addLocal([width * 0.3, height - 0.36, z], [width * 0.54, 0.16, 0.18], profile.trim, 0.42);
      addLocal([-width / 2 + 0.16, height * 0.52, z], [0.13, height * 0.9, 0.18], profile.trim);
      addLocal([width / 2 - 0.16, height * 0.52, z], [0.13, height * 0.9, 0.18], profile.trim);
    }
    addLocal([0, 0.12, -depth / 2], [width * 0.7, 0.04, depth - 0.55], scene.accent);
    addLocal([0, doorHeight * 0.52, endZ + 0.15], [0.06, doorHeight * 0.9, 0.07], profile.hardware);
    addLocal([0, doorHeight + 0.3, endZ + 0.15], [doorWidth * 0.56, 0.12, 0.07], profile.hardware);
  } else {
    for (let z = -1.0; z > -depth + 0.8; z -= 1.45) {
      addLocal([0, height - 0.2, z], [width * 0.82, 0.1, 0.24], profile.light);
      addLocal([-width / 2 + 0.18, 0.72, z], [0.1, 0.1, 0.42], scene.accent);
      addLocal([width / 2 - 0.18, 1.08, z - 0.35], [0.1, 0.1, 0.42], scene.secondary);
    }
    addLocal([0, doorHeight * 0.26, endZ + 0.15], [doorWidth * 0.8, 0.11, 0.07], profile.hardware);
    addLocal([0, doorHeight * 0.74, endZ + 0.15], [doorWidth * 0.8, 0.11, 0.07], profile.hardware);
  }
}

function corridorProfile(world: WorldDefinition) {
  switch (world.boundary.style) {
    case "georgian": return { floor: "#27120d", ceiling: "#392016", wall: "#4a281c", door: "#2a120d", trim: "#8d5a31", hardware: "#c3a05b", light: "#ffd59b" };
    case "gothic": return { floor: "#17191e", ceiling: "#252832", wall: "#3b3d44", door: "#352229", trim: "#69727e", hardware: "#b78b79", light: "#ffb16b" };
    case "modern": return { floor: "#b8ad99", ceiling: "#e1e3df", wall: "#d5d8d5", door: "#71818a", trim: "#27343d", hardware: "#a8d9f5", light: "#d8f2ff" };
    case "renaissance": return { floor: "#7f452b", ceiling: "#d8c79c", wall: "#c8b78d", door: "#4b281a", trim: "#9c683d", hardware: "#c69a58", light: "#ffe2a8" };
    case "deco": return { floor: "#141513", ceiling: "#272820", wall: "#33352f", door: "#9b7a38", trim: "#c3a35b", hardware: "#f0cf79", light: "#ffd98a" };
    case "industrial": return { floor: "#10181c", ceiling: "#172329", wall: "#1c2a31", door: "#50616a", trim: "#8b5b2d", hardware: "#e0a052", light: "#ffad4d" };
    case "lunar": return { floor: "#252d33", ceiling: "#d8dfe1", wall: "#b8c2c7", door: "#4d606b", trim: "#718792", hardware: "#e2a253", light: "#d9f1ff" };
    case "starship": return { floor: "#111922", ceiling: "#26323d", wall: "#313e49", door: "#182631", trim: "#7d929e", hardware: "#d6a15f", light: "#78d7e8" };
    case "alexandrian": return { floor: "#9d6846", ceiling: "#d6c69d", wall: "#c8b78d", door: "#214d67", trim: "#b18a4d", hardware: "#e0bd74", light: "#f5d69c" };
  }
}

function addWindowFrameParts(parts: BoundaryPart[], panel: BackplatePanel, color: string) {
  const parent = new THREE.Matrix4().compose(
    new THREE.Vector3(...panel.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, panel.rotationY || 0, 0)),
    new THREE.Vector3(1, 1, 1)
  );
  const add = (position: [number, number, number], scale: [number, number, number]) => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion(), new THREE.Vector3(...scale));
    parts.push({ matrix: parent.clone().multiply(local), color: new THREE.Color(color) });
  };
  const [width, height] = panel.size;
  add([-width / 2, 0, 0.075], [0.1, height + 0.18, 0.09]);
  add([width / 2, 0, 0.075], [0.1, height + 0.18, 0.09]);
  add([0, -height / 2, 0.075], [width + 0.18, 0.1, 0.09]);
  add([0, height / 2, 0.075], [width + 0.18, 0.1, 0.09]);
  add([0, 0, 0.075], [width, 0.07, 0.075]);
  const columns = Math.max(1, Math.round(width / 3.2));
  for (let column = 1; column < columns; column += 1) {
    add([-width / 2 + (column * width) / columns, 0, 0.075], [0.065, height, 0.075]);
  }
}

function WorldArt({ world }: { world: WorldDefinition }) {
  const artUrl = world.assets.art;
  if (!artUrl) return null;
  return <ArtTexture world={world} url={artUrl} />;
}

function ArtTexture({ world, url }: { world: WorldDefinition; url: string }) {
  const texture = useLoader(THREE.TextureLoader, url);
  useEffect(() => {
    const key = `texture:${url}`;
    retainResource(key);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return () => {
      releaseResource(key);
    };
  }, [texture, url]);
  if (world.id === "heritage") return <FramedArt texture={texture} position={[0, 4.62, -10.46]} size={[3.65, 1.78]} frame={world.scene.metal} />;
  if (world.id === "gothic") return <GothicRoseWindow texture={texture} frame={world.scene.metal} />;
  if (world.id === "deco") return null;
  if (world.id === "alexandria") return <FramedArt texture={texture} position={[ALEXANDRIA_ENTRANCE_DESIGN.centerX, ALEXANDRIA_ENTRANCE_DESIGN.muralCenterY, ALEXANDRIA_ENTRANCE_DESIGN.muralZ]} rotationY={Math.PI} size={[3.72, ALEXANDRIA_ENTRANCE_DESIGN.muralHeight]} frame={world.scene.metal} frameExtension={ALEXANDRIA_ENTRANCE_DESIGN.muralFrameExtension} />;
  return <FramedArt texture={texture} position={[0, 4.25, -10.16]} size={[5.6, 2.8]} frame={world.scene.metal} />;
}

function FramedArt({ texture, position, size, frame, rotationY = 0, round = false, emissiveIntensity = 0.08, frameExtension = 0.18 }: {
  texture: THREE.Texture;
  position: [number, number, number];
  size: [number, number];
  frame: string;
  rotationY?: number;
  round?: boolean;
  emissiveIntensity?: number;
  frameExtension?: number;
}) {
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, 0, 0.052]}>
        {round ? <circleGeometry args={[size[0] / 2, 64]} /> : <planeGeometry args={size} />}
        <meshStandardMaterial map={texture} roughness={0.55} metalness={0.02} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={emissiveIntensity} />
      </mesh>
      {round ? (
        <mesh><torusGeometry args={[size[0] / 2 + 0.08, 0.085, 10, 72]} /><meshStandardMaterial color={frame} metalness={0.65} roughness={0.28} /></mesh>
      ) : (
        <mesh><boxGeometry args={[size[0] + frameExtension, size[1] + frameExtension, 0.08]} /><meshStandardMaterial color={frame} metalness={0.55} roughness={0.3} /></mesh>
      )}
    </group>
  );
}

function GothicRoseWindow({ texture, frame }: { texture: THREE.Texture; frame: string }) {
  return (
    <group name="Gothic rose window" raycast={() => null}>
      <FramedArt
        texture={texture}
        position={[0, 5.95, -13.0]}
        size={[3.82, 3.82]}
        frame={frame}
        round
        emissiveIntensity={0.16}
      />
    </group>
  );
}

const GOTHIC_CANDLE_STAND_POSITIONS = [-7.2, 0, 7.2] as const;

function GothicCandleStandLights() {
  return (
    <>
      {([-3.75, 3.75] as const).flatMap((x) =>
        GOTHIC_CANDLE_STAND_POSITIONS.map((z) => (
            <group key={`${x}:${z}`} position={[x, 1.64, z]} raycast={() => null}>
              <mesh scale={[0.7, 1.35, 0.7]}>
                <sphereGeometry args={[0.055, 12, 8]} />
                <meshStandardMaterial
                  color="#ffe2ae"
                  emissive="#ff922f"
                  emissiveIntensity={1.2}
                  roughness={0.38}
                  toneMapped={false}
                />
              </mesh>
              <pointLight
                position={[0, 0.08, 0]}
                color="#ffad67"
                intensity={0.78}
                distance={6}
                decay={2}
                castShadow={false}
              />
            </group>
        )),
      )}
    </>
  );
}

function WorldPracticals({ world, reducedMotion }: { world: WorldDefinition; reducedMotion: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (light.current && (world.id === "heritage" || world.id === "gothic")) {
      const flicker = reducedMotion ? 1 : 0.88 + Math.sin(clock.elapsedTime * 7.3) * 0.07 + Math.sin(clock.elapsedTime * 13.7) * 0.05;
      light.current.intensity = world.scene.practicalIntensity * 0.48 * flicker;
    }
  });

  const position: [number, number, number] = world.id === "heritage" ? [0, 1.45, -8.95]
    : world.id === "gothic" ? [0, 3.8, -2]
      : world.id === "modern" ? [0, 5.6, 0]
        : world.id === "renaissance" ? [0, 2.1, 0]
          : world.id === "deco" ? [0, 5.7, 0]
            : [0, 3.3, -2];
  return (
    <group>
      <pointLight ref={light} position={position} color={world.scene.practical} intensity={world.scene.practicalIntensity * 0.48} distance={world.id === "modern" ? 20 : 13} decay={2} />
      {world.id === "heritage" && <><HeritageGalleryRails /><HeritageBankerLamps /><HeritageShelfWashLights /><HeritageFire reducedMotion={reducedMotion} /></>}
      {(world.id === "heritage" || world.id === "gothic") && <PeriodChandelier world={world} />}
      {world.id === "gothic" && <>
        <GothicCandleStandLights />
      </>}
      {world.id === "modern" && <>
        <ModernDaylightIndex reducedMotion={reducedMotion} />
      </>}
      {world.id === "deco" && <>
        <DecoFloorInlay />
        <DecoIndexTower reducedMotion={reducedMotion} />
        <pointLight position={[-5.2, 5.8, 0]} color="#f3d49b" intensity={14} distance={12} decay={2} castShadow={false} />
        <pointLight position={[5.2, 5.8, 0]} color="#f3d49b" intensity={14} distance={12} decay={2} castShadow={false} />
        <pointLight position={[0, 2.4, -3.4]} color="#64bbaa" intensity={0.62} distance={7} decay={2} />
      </>}
      {world.id === "foundry" && <>
        <FoundryServiceRuns />
        <FoundryAetherClock reducedMotion={reducedMotion} />
        <pointLight position={[-6.5, 3.2, 1.5]} color="#eb9d46" intensity={2.3} distance={11} decay={2} />
        <pointLight position={[6.5, 3.2, 1.5]} color="#19d9d1" intensity={2.2} distance={11} decay={2} />
        <pointLight position={[0, 2.2, -5.6]} color="#c94889" intensity={1.4} distance={9} decay={2} />
      </>}
      {world.id === "arkship" && <>
        <ArkshipAstrogationDisplay reducedMotion={reducedMotion} />
        <ArkshipNavigationWall reducedMotion={reducedMotion} />
        <ArkshipAisleLights />
        <pointLight position={[0, 3.4, 1.7]} color="#8de0eb" intensity={2.6} distance={9.5} decay={2} />
        <pointLight position={[0, 3.0, -6.5]} color="#edb875" intensity={2.2} distance={10} decay={2} />
      </>}
      {world.id === "lunar" && <>
        <LunarEarthwatchProjection reducedMotion={reducedMotion} />
        <pointLight position={[0, 2.8, 0.2]} color="#75c8e6" intensity={0.62} distance={7} decay={2} />
        <pointLight position={[4, 3.8, 8.8]} color="#dc943f" intensity={0.58} distance={6} decay={2} />
      </>}
      {world.id === "renaissance" && (<>
        <RenaissanceFountain reducedMotion={reducedMotion} />
      </>)}
      {world.id === "alexandria" && <>
        <AntikytheraExhibit reducedMotion={reducedMotion} />
        <pointLight position={[0.3, ANTIKYTHERA_DISPLAY_LAYOUT.caseCenterY + 0.15, 1.18]} color="#efbd72" intensity={0.76} distance={5.8} decay={2} />
      </>}
    </group>
  );
}

function shouldHideWorldObject(worldId: WorldDefinition["id"], name: string, assetSource: string) {
  const hiddenByWorld: Record<WorldDefinition["id"], string[]> = {
    heritage: ["banker lamp", "fire glow", "oxblood armchair", "georgian chandelier", "balcony ", "baluster "],
    gothic: ["rose glass", "gothic reliquary", "nave statue", "nave iron chandelier"],
    modern: ["modern chair west", "modern chair east", "glass bridge", "bridge rail", "north concrete datum", "cobalt index ring"],
    renaissance: ["humanist bust", "illuminator table", "scribe table", "lapis writing surface", "fountain water", "fountain jet"],
    deco: ["central index", "index brass band", "emerald settee", "ivory side table", "emerald lounge"],
    foundry: ["aether index desk", "aether glass", "foundry drill press", "foundry power box", "foundry caged sconce", "copper conduit", "conduit valve"],
    lunar: ["earthwatch pressure glass", "aft airlock header", "aft airlock west jamb", "aft airlock east jamb", "airlock status lintel"],
    arkship: ["forward pressure glass", "observation pressure glass"],
    alexandria: [
      "pinakes armillary stem", "pinakes armillary collar", "pinakes celestial ring", "pinakes celestial axis",
      "scholar desk", "scholar tablet", "scholar lamp"
    ]
  };
  const hiddenAssetSources: Record<WorldDefinition["id"], string[]> = {
    heritage: ["armchair_01", "chandelier_01"],
    gothic: ["gothiccabinet_01", "gothic_statue", "chandelier_01"],
    modern: ["modern_arm_chair_01"],
    renaissance: ["marble_bust_01", "woodentable_02"],
    deco: ["mid_century_lounge_chair"],
    foundry: ["old_drill_press", "power_box_01", "industrial_caged_sconce"],
    lunar: [],
    arkship: [],
    alexandria: []
  };
  return hiddenByWorld[worldId].some((fragment) => name.includes(fragment))
    || hiddenAssetSources[worldId].some((fragment) => assetSource.includes(fragment));
}

function applyWorldObjectPolish(worldId: WorldDefinition["id"], name: string, rawName: string, object: THREE.Object3D) {
  if (worldId === "renaissance"
    && (name.startsWith("arcade column ") || name.startsWith("column base ") || name.startsWith("column capital "))
    && rawName.includes("-8.4")) {
    object.visible = false;
  }
}

function PeriodChandelier({ world }: { world: WorldDefinition }) {
  const cups = useRef<THREE.InstancedMesh>(null);
  const flames = useRef<THREE.InstancedMesh>(null);
  const gothic = world.id === "gothic";
  const radius = gothic ? 1.25 : 1.05;
  const y = gothic ? 6.25 : 5.95;
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      matrix.makeTranslation(x, 0.04, z);
      cups.current?.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(x, 0.2, z), new THREE.Quaternion(), new THREE.Vector3(0.075, 0.15, 0.075));
      flames.current?.setMatrixAt(index, matrix);
    }
    if (cups.current) cups.current.instanceMatrix.needsUpdate = true;
    if (flames.current) flames.current.instanceMatrix.needsUpdate = true;
  }, [radius]);
  return (
    <group position={[0, y, 0]}>
      <mesh rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[radius, gothic ? 0.055 : 0.065, 10, 64]} />
        <meshStandardMaterial color={gothic ? "#181b20" : "#9f743c"} metalness={0.82} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.86, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, 1.72, 12]} />
        <meshStandardMaterial color={gothic ? "#181b20" : "#9f743c"} metalness={0.82} roughness={0.3} />
      </mesh>
      <instancedMesh ref={cups} args={[undefined, undefined, 8]} castShadow>
        <cylinderGeometry args={[0.1, 0.065, 0.12, 12]} />
        <meshStandardMaterial color={gothic ? "#20242a" : "#ad8146"} metalness={0.76} roughness={0.32} />
      </instancedMesh>
      <instancedMesh ref={flames} args={[undefined, undefined, 8]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#ffd29b" emissive="#ff9c45" emissiveIntensity={0.42} roughness={0.45} />
      </instancedMesh>
      <pointLight position={[0, -0.1, 0]} color={gothic ? "#ffad67" : "#ffd09a"} intensity={gothic ? 0.72 : 0.9} distance={8} decay={2} />
    </group>
  );
}

const ARKSHIP_AISLE_LIGHTS = [
  { position: [-7.2, 5.4, -7.2] as [number, number, number], color: "#f0bb79", intensity: 3.2 },
  { position: [-7.2, 5.4, 7.2] as [number, number, number], color: "#f0bb79", intensity: 3.2 },
  { position: [7.8, 5.4, -7.2] as [number, number, number], color: "#8de0eb", intensity: 2.7 },
  { position: [7.8, 5.4, 7.2] as [number, number, number], color: "#8de0eb", intensity: 2.7 },
] as const;

function ArkshipAisleLights() {
  return <>
    {ARKSHIP_AISLE_LIGHTS.map((fixture, index) => (
      <pointLight
        key={`arkship-aisle-light-${index}`}
        position={fixture.position}
        color={fixture.color}
        intensity={fixture.intensity}
        distance={12.5}
        decay={2}
        castShadow={false}
      />
    ))}
  </>;
}

function ArkshipAstrogationDisplay({ reducedMotion }: { reducedMotion: boolean }) {
  const orbitA = useRef<THREE.Group>(null);
  const orbitB = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    if (reducedMotion) return;
    if (orbitA.current) orbitA.current.rotation.y += delta * 0.18;
    if (orbitB.current) orbitB.current.rotation.z -= delta * 0.13;
    if (core.current) {
      const pulse = 0.92 + Math.sin(clock.elapsedTime * 1.7) * 0.08;
      core.current.scale.setScalar(pulse);
    }
  });
  return (
    <group position={[7.75, 2.66, 0]} raycast={() => null}>
      <group ref={orbitA} rotation-x={Math.PI / 2.45}>
        <mesh>
          <torusGeometry args={[0.76, 0.018, 8, 64]} />
          <meshBasicMaterial color="#6ee0ef" transparent opacity={0.72} toneMapped={false} />
        </mesh>
        <mesh rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.54, 0.012, 8, 48]} />
          <meshBasicMaterial color="#4ba4bd" transparent opacity={0.52} toneMapped={false} />
        </mesh>
      </group>
      <group ref={orbitB} rotation-y={Math.PI / 2.8}>
        <mesh>
          <torusGeometry args={[0.62, 0.015, 8, 56]} />
          <meshBasicMaterial color="#d79a55" transparent opacity={0.64} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={core}>
        <sphereGeometry args={[0.095, 18, 12]} />
        <meshBasicMaterial color="#dffbff" toneMapped={false} />
      </mesh>
      <pointLight color="#61c7da" intensity={0.42} distance={3.8} decay={2} />
    </group>
  );
}

type AntikytheraMaterialMaps = {
  woodMap: THREE.Texture;
  woodNormal: THREE.Texture;
  woodRoughness: THREE.Texture;
  metalNormal: THREE.Texture;
  metalRoughness: THREE.Texture;
};

function centerFullscreenHtml(
  _element: THREE.Object3D,
  _camera: THREE.Camera,
  size: { width: number; height: number },
) {
  return [size.width / 2, size.height / 2];
}

function AntikytheraExhibit({ reducedMotion }: { reducedMotion: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const maps = useTexture({
    woodMap: "/worlds/assets/materials/shelf-wood-color.webp",
    woodNormal: "/worlds/assets/materials/shelf-wood-normal.webp",
    woodRoughness: "/worlds/assets/materials/shelf-wood-roughness.webp",
    metalNormal: "/worlds/assets/materials/hardware-metal-normal.webp",
    metalRoughness: "/worlds/assets/materials/hardware-metal-roughness.webp"
  });

  useEffect(() => {
    Object.entries(maps).forEach(([name, texture]) => {
      texture.colorSpace = name === "woodMap" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    });
  }, [maps]);

  const closeExhibit = () => {
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    document.exitPointerLock?.();
    const focusFrame = window.requestAnimationFrame(() => closeButton.current?.focus());
    const blockSceneMovement = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeExhibit();
      } else if (event.key === "Tab" && dialog.current) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      } else if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", blockSceneMovement, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", blockSceneMovement, true);
    };
  }, [open]);

  return (
    <group>
      <group position={[0, ANTIKYTHERA_DISPLAY_LAYOUT.caseCenterY, 0]} rotation-y={-0.18}>
        <AntikytheraCase maps={maps} reducedMotion={reducedMotion} />
      </group>

      <group position={[0.78, 1.55, 0.92]} rotation-x={-0.58}>
        <mesh castShadow>
          <boxGeometry args={[0.72, 0.07, 0.44]} />
          <meshStandardMaterial
            color="#806138"
            normalMap={maps.metalNormal}
            roughnessMap={maps.metalRoughness}
            metalness={0.74}
            roughness={0.34}
          />
        </mesh>
        <mesh position={[0, 0.038, 0]}>
          <boxGeometry args={[0.65, 0.012, 0.37]} />
          <meshStandardMaterial color="#2c241a" metalness={0.24} roughness={0.56} />
        </mesh>
      </group>
      <mesh position={[0.78, ANTIKYTHERA_DISPLAY_LAYOUT.plaqueStemCenterY, 0.81]} castShadow>
        <cylinderGeometry args={[0.035, 0.055, ANTIKYTHERA_DISPLAY_LAYOUT.plaqueStemHeight, 12]} />
        <meshStandardMaterial color="#765631" metalness={0.72} roughness={0.36} />
      </mesh>
      <Html position={[0.78, 1.7, 0.92]} center distanceFactor={7.2} zIndexRange={[24, 12]} occlude={false}>
        <button
          ref={trigger}
          type="button"
          className="antikythera-plaque-trigger scene-hotspot"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span>EXHIBIT 01</span>
          <strong>Antikythera Mechanism</strong>
          <small>Tap to investigate</small>
        </button>
      </Html>

      {open && (
        <Html fullscreen calculatePosition={centerFullscreenHtml} zIndexRange={[120, 100]}>
          <div
            className="antikythera-dialog-layer"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              if (event.currentTarget === event.target) closeExhibit();
            }}
          >
            <article
              ref={dialog}
              className="antikythera-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="antikythera-title"
              aria-describedby="antikythera-summary"
            >
              <header>
                <div>
                  <p>{ANTIKYTHERA_EXHIBIT.eyebrow}</p>
                  <h2 id="antikythera-title">{ANTIKYTHERA_EXHIBIT.title}</h2>
                  <span>{ANTIKYTHERA_EXHIBIT.date} · {ANTIKYTHERA_EXHIBIT.inventory}</span>
                </div>
                <button ref={closeButton} type="button" aria-label="Close exhibit" onClick={closeExhibit}>×</button>
              </header>
              <div className="antikythera-dialog-body">
                <section>
                  <p id="antikythera-summary" className="antikythera-lede">{ANTIKYTHERA_EXHIBIT.summary}</p>
                  <h3>What the evidence shows</h3>
                  <ul>
                    {ANTIKYTHERA_EXHIBIT.established.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
                <section>
                  <h3>What you are seeing</h3>
                  <ul>
                    {ANTIKYTHERA_EXHIBIT.reconstruction.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  <dl>
                    <div><dt>Original case</dt><dd>{ANTIKYTHERA_EXHIBIT.caseDimensionsCm.join(" × ")} cm</dd></div>
                    <div><dt>Front outputs</dt><dd>{ANTIKYTHERA_EXHIBIT.frontOutputs.join(" · ")}</dd></div>
                  </dl>
                </section>
              </div>
              <footer>
                <span>Research and museum records</span>
                <nav aria-label="Antikythera research sources">
                  {ANTIKYTHERA_EXHIBIT.sources.map((source) => (
                    <a key={source.href} href={source.href} target="_blank" rel="noreferrer">{source.label}</a>
                  ))}
                </nav>
                <button type="button" onClick={closeExhibit}>Continue exploring</button>
              </footer>
            </article>
          </div>
        </Html>
      )}
    </group>
  );
}

function AntikytheraCase({ maps, reducedMotion }: { maps: AntikytheraMaterialMaps; reducedMotion: boolean }) {
  const supportFootY = ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportCenterOffsetY
    - ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportHeight / 2
    + 0.025;
  const rails = [
    { position: [0, 1.03, 0] as [number, number, number], size: [1.36, 0.13, 0.78] as [number, number, number] },
    { position: [0, -1.03, 0] as [number, number, number], size: [1.36, 0.13, 0.78] as [number, number, number] },
    { position: [-0.65, 0, 0] as [number, number, number], size: [0.13, 1.94, 0.78] as [number, number, number] },
    { position: [0.65, 0, 0] as [number, number, number], size: [0.13, 1.94, 0.78] as [number, number, number] }
  ];
  return (
    <group>
      <group>
        {rails.map((rail) => (
          <mesh key={rail.position.join("-")} position={rail.position} castShadow receiveShadow>
            <boxGeometry args={rail.size} />
            <meshStandardMaterial
              map={maps.woodMap}
              normalMap={maps.woodNormal}
              normalScale={new THREE.Vector2(0.34, 0.34)}
              roughnessMap={maps.woodRoughness}
              color="#5e321d"
              roughness={0.64}
              metalness={0.02}
            />
          </mesh>
        ))}
        {[
          [-0.65, -1.03, 0.39], [0.65, -1.03, 0.39], [-0.65, 1.03, 0.39], [0.65, 1.03, 0.39],
          [-0.65, -1.03, -0.39], [0.65, -1.03, -0.39], [-0.65, 1.03, -0.39], [0.65, 1.03, -0.39]
        ].map((position) => (
          <mesh key={position.join("-")} position={position as [number, number, number]} castShadow>
            <sphereGeometry args={[0.055, 12, 8]} />
            <meshStandardMaterial color="#8f6c3d" metalness={0.8} roughness={0.33} />
          </mesh>
        ))}
      </group>

      <AntikytheraGearTrain maps={maps} reducedMotion={reducedMotion} />
      <FrontCosmosDisplay maps={maps} reducedMotion={reducedMotion} />
      <RearCalendarDisplay maps={maps} />
      <AntikytheraCrank reducedMotion={reducedMotion} />

      <mesh renderOrder={3}>
        <boxGeometry args={[1.52, 2.34, 0.98]} />
        <WorldGlassMaterial
          color="#dce7dc"
          transparent
          opacity={0.075}
          transmission={0.72}
          thickness={0.025}
          roughness={0.12}
          metalness={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[-0.45, ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportCenterOffsetY, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.07, ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportHeight, 12]} />
        <meshStandardMaterial color="#8b6336" metalness={0.75} roughness={0.34} />
      </mesh>
      <mesh position={[0.45, ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportCenterOffsetY, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.07, ANTIKYTHERA_DISPLAY_LAYOUT.caseSupportHeight, 12]} />
        <meshStandardMaterial color="#8b6336" metalness={0.75} roughness={0.34} />
      </mesh>
      {[-0.45, 0.45].map((x) => (
        <mesh key={`support-foot-${x}`} position={[x, supportFootY, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.11, 0.11, 0.05, 18]} />
          <meshStandardMaterial color="#9b7440" metalness={0.78} roughness={0.32} />
        </mesh>
      ))}
      <mesh position={[0, -1.1, 0]} castShadow>
        <boxGeometry args={[1.06, 0.12, 0.5]} />
        <meshStandardMaterial
          map={maps.woodMap}
          normalMap={maps.woodNormal}
          roughnessMap={maps.woodRoughness}
          color="#4b2b1b"
          roughness={0.66}
        />
      </mesh>
    </group>
  );
}

function FrontCosmosDisplay({ maps, reducedMotion }: { maps: AntikytheraMaterialMaps; reducedMotion: boolean }) {
  const tracks = [
    { radius: 0.13, color: "#e2ded0", speed: 0.018, angle: 1.95, marker: 0.026 },
    { radius: 0.18, color: "#91a09c", speed: -0.009, angle: 0.62, marker: 0.022 },
    { radius: 0.23, color: "#b78b55", speed: 0.007, angle: 2.8, marker: 0.024 },
    { radius: 0.28, color: "#f1bd62", speed: 0.004, angle: -0.36, marker: 0.036 },
    { radius: 0.33, color: "#a95b42", speed: -0.0025, angle: 1.22, marker: 0.023 },
    { radius: 0.38, color: "#c5aa75", speed: 0.0015, angle: 3.64, marker: 0.025 },
    { radius: 0.43, color: "#9b7a59", speed: -0.001, angle: 2.18, marker: 0.026 }
  ];
  return (
    <group position={[0, 0.06, 0.42]}>
      <mesh position={[0, 0, -0.045]} receiveShadow>
        <circleGeometry args={[0.56, 72]} />
        <meshStandardMaterial
          color="#51635a"
          normalMap={maps.metalNormal}
          normalScale={new THREE.Vector2(0.42, 0.42)}
          roughnessMap={maps.metalRoughness}
          metalness={0.72}
          roughness={0.44}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, -0.036]}>
        <ringGeometry args={[0.47, 0.55, 72]} />
        <meshStandardMaterial color="#8f6b3a" metalness={0.78} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, -0.025]}>
        <ringGeometry args={[0.435, 0.465, 72]} />
        <meshStandardMaterial color="#2b584f" metalness={0.62} roughness={0.47} side={THREE.DoubleSide} />
      </mesh>
      <RadialTicks count={48} radius={0.51} length={0.045} thickness={0.008} depth={0.012} color="#d4b77c" z={0.004} />
      <RadialTicks count={12} radius={0.45} length={0.042} thickness={0.014} depth={0.015} color="#e2c990" z={0.012} />
      {tracks.map((track, index) => (
        <CosmosTrack key={track.radius} {...track} z={0.02 + index * 0.003} reducedMotion={reducedMotion} />
      ))}
      <mesh position={[0, 0, 0.04]} castShadow>
        <sphereGeometry args={[0.076, 22, 14]} />
        <meshStandardMaterial color="#335f66" emissive="#163d43" emissiveIntensity={0.18} metalness={0.18} roughness={0.52} />
      </mesh>
      <group position={[0, 0, 0.075]} rotation-z={2.06}>
        <mesh position={[0.105, 0, 0]}>
          <sphereGeometry args={[0.028, 14, 10, 0, Math.PI]} />
          <meshStandardMaterial color="#ece7d8" roughness={0.42} />
        </mesh>
        <mesh position={[0.105, 0, 0]} rotation-y={Math.PI}>
          <sphereGeometry args={[0.028, 14, 10, 0, Math.PI]} />
          <meshStandardMaterial color="#2a261f" roughness={0.58} />
        </mesh>
      </group>
      <InscriptionLines y={0.72} z={-0.02} color="#b89255" />
      <InscriptionLines y={-0.67} z={-0.02} color="#b89255" />
      <mesh position={[0, -0.93, 0]} castShadow>
        <boxGeometry args={[1.02, 0.1, 0.07]} />
        <meshStandardMaterial color="#304d43" metalness={0.58} roughness={0.47} />
      </mesh>
    </group>
  );
}

function CosmosTrack({ radius, color, speed, angle, marker, z, reducedMotion }: {
  radius: number;
  color: string;
  speed: number;
  angle: number;
  marker: number;
  z: number;
  reducedMotion: boolean;
}) {
  const pointer = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!reducedMotion && pointer.current) pointer.current.rotation.z += delta * speed;
  });
  return (
    <>
      <mesh position={[0, 0, z]}>
        <ringGeometry args={[radius - 0.005, radius + 0.005, 64]} />
        <meshStandardMaterial color="#b6955d" metalness={0.66} roughness={0.44} side={THREE.DoubleSide} />
      </mesh>
      <group ref={pointer} rotation-z={angle} position-z={z + 0.012}>
        <mesh position={[radius / 2, 0, 0]}>
          <boxGeometry args={[radius, 0.008, 0.009]} />
          <meshStandardMaterial color="#d2bb83" metalness={0.72} roughness={0.35} />
        </mesh>
        <mesh position={[radius, 0, 0]} castShadow>
          <sphereGeometry args={[marker, 12, 8]} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.38} />
        </mesh>
      </group>
    </>
  );
}

function RadialTicks({ count, radius, length, thickness, depth, color, z }: {
  count: number;
  radius: number;
  length: number;
  thickness: number;
  depth: number;
  color: string;
  z: number;
}) {
  const ticks = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(length, thickness, depth);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < count; index += 1) {
      const angle = index * Math.PI * 2 / count;
      position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      matrix.compose(position, rotation, scale);
      ticks.current?.setMatrixAt(index, matrix);
    }
    if (ticks.current) ticks.current.instanceMatrix.needsUpdate = true;
  }, [count, depth, length, radius, thickness, z]);
  return (
    <instancedMesh ref={ticks} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.68} roughness={0.4} />
    </instancedMesh>
  );
}

function InscriptionLines({ y, z, color }: { y: number; z: number; color: string }) {
  return (
    <group position={[0, y, z]}>
      {[-0.4, -0.27, -0.12, 0.04, 0.2, 0.36].map((x, index) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[index % 3 === 0 ? 0.1 : 0.075, 0.012, 0.012]} />
          <meshStandardMaterial color={color} metalness={0.62} roughness={0.46} />
        </mesh>
      ))}
    </group>
  );
}

function RearCalendarDisplay({ maps }: { maps: AntikytheraMaterialMaps }) {
  return (
    <group position={[0, 0, -0.42]} rotation-y={Math.PI}>
      <mesh position={[0, 0, -0.035]} receiveShadow>
        <boxGeometry args={[1.14, 1.86, 0.05]} />
        <meshStandardMaterial
          color="#536059"
          normalMap={maps.metalNormal}
          normalScale={new THREE.Vector2(0.4, 0.4)}
          roughnessMap={maps.metalRoughness}
          metalness={0.72}
          roughness={0.46}
        />
      </mesh>
      <SpiralDial position={[0, 0.43, 0]} turns={5} outerRadius={0.42} pointerAngle={0.72} />
      <SpiralDial position={[0, -0.43, 0]} turns={4} outerRadius={0.4} pointerAngle={-1.18} />
      <SmallCycleDial position={[-0.28, 0.43, 0.03]} radius={0.105} pointerAngle={2.2} />
      <SmallCycleDial position={[0.28, -0.43, 0.03]} radius={0.105} pointerAngle={-0.42} />
      <InscriptionLines y={0.91} z={0.015} color="#c4a46b" />
      <InscriptionLines y={-0.91} z={0.015} color="#c4a46b" />
    </group>
  );
}

function SpiralDial({ position, turns, outerRadius, pointerAngle }: {
  position: [number, number, number];
  turns: number;
  outerRadius: number;
  pointerAngle: number;
}) {
  const curve = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const segments = turns * 54;
    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments;
      const angle = progress * turns * Math.PI * 2;
      const radius = 0.05 + progress * (outerRadius - 0.05);
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }
    return new THREE.CatmullRomCurve3(points);
  }, [outerRadius, turns]);
  return (
    <group position={position}>
      <mesh position-z={-0.012}>
        <circleGeometry args={[outerRadius + 0.025, 56]} />
        <meshStandardMaterial color="#344943" metalness={0.62} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <tubeGeometry args={[curve, turns * 54, 0.008, 5, false]} />
        <meshStandardMaterial color="#c2a064" metalness={0.78} roughness={0.38} />
      </mesh>
      <group rotation-z={pointerAngle} position-z={0.018}>
        <mesh position={[outerRadius * 0.47, 0, 0]}>
          <boxGeometry args={[outerRadius * 0.94, 0.012, 0.014]} />
          <meshStandardMaterial color="#d1b77e" metalness={0.74} roughness={0.36} />
        </mesh>
      </group>
      <mesh position-z={0.025}>
        <cylinderGeometry args={[0.035, 0.035, 0.04, 16]} />
        <meshStandardMaterial color="#806039" metalness={0.82} roughness={0.32} />
      </mesh>
    </group>
  );
}

function SmallCycleDial({ position, radius, pointerAngle }: {
  position: [number, number, number];
  radius: number;
  pointerAngle: number;
}) {
  return (
    <group position={position}>
      <mesh>
        <torusGeometry args={[radius, 0.009, 6, 32]} />
        <meshStandardMaterial color="#c4a267" metalness={0.76} roughness={0.39} />
      </mesh>
      <group rotation-z={pointerAngle}>
        <mesh position={[radius * 0.45, 0, 0]}>
          <boxGeometry args={[radius * 0.9, 0.009, 0.012]} />
          <meshStandardMaterial color="#d7bf87" metalness={0.7} roughness={0.38} />
        </mesh>
      </group>
    </group>
  );
}

function AntikytheraGearTrain({ maps, reducedMotion }: { maps: AntikytheraMaterialMaps; reducedMotion: boolean }) {
  const gears = [
    { position: [-0.16, 0.08, 0.02] as [number, number, number], teeth: 44, radius: 0.34, bore: 0.052, speed: 0.065, color: "#8c693d" },
    { position: [-0.43, -0.43, 0.11] as [number, number, number], teeth: 28, radius: 0.2, bore: 0.04, speed: -0.102, color: "#a47a45" },
    { position: [0.3, -0.43, -0.08] as [number, number, number], teeth: 34, radius: 0.255, bore: 0.045, speed: -0.084, color: "#765c39" },
    { position: [0.38, 0.4, 0.12] as [number, number, number], teeth: 27, radius: 0.205, bore: 0.04, speed: -0.108, color: "#a9804c" },
    { position: [-0.42, 0.5, -0.13] as [number, number, number], teeth: 22, radius: 0.155, bore: 0.035, speed: -0.132, color: "#6f5a3b" },
    { position: [0.03, 0.64, 0.03] as [number, number, number], teeth: 20, radius: 0.142, bore: 0.034, speed: 0.145, color: "#9b7240" },
    { position: [0.02, -0.7, 0.15] as [number, number, number], teeth: 18, radius: 0.126, bore: 0.032, speed: 0.156, color: "#ad824b" },
    { position: [0.47, 0.02, -0.16] as [number, number, number], teeth: 16, radius: 0.11, bore: 0.03, speed: 0.175, color: "#735a38" }
  ];
  return (
    <group>
      {gears.map((gear, index) => (
        <MechanismGear
          key={`${gear.teeth}-${gear.position.join("-")}`}
          {...gear}
          depth={index % 3 === 0 ? 0.055 : 0.043}
          initialRotation={index * 0.37}
          normalMap={maps.metalNormal}
          roughnessMap={maps.metalRoughness}
          reducedMotion={reducedMotion}
        />
      ))}
    </group>
  );
}

function MechanismGear({ position, teeth, radius, bore, depth, speed, initialRotation, color, normalMap, roughnessMap, reducedMotion }: {
  position: [number, number, number];
  teeth: number;
  radius: number;
  bore: number;
  depth: number;
  speed: number;
  initialRotation: number;
  color: string;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  reducedMotion: boolean;
}) {
  const gear = useRef<THREE.Mesh>(null);
  const shape = useMemo(() => {
    const next = new THREE.Shape();
    const rootRadius = radius * 0.86;
    const steps = teeth * 4;
    for (let index = 0; index < steps; index += 1) {
      const angle = index / steps * Math.PI * 2;
      const toothPhase = index % 4;
      const currentRadius = toothPhase === 1 || toothPhase === 2 ? radius : rootRadius;
      const x = Math.cos(angle) * currentRadius;
      const y = Math.sin(angle) * currentRadius;
      if (index === 0) next.moveTo(x, y);
      else next.lineTo(x, y);
    }
    next.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
    next.holes.push(hole);
    return next;
  }, [bore, radius, teeth]);
  useFrame((_, delta) => {
    if (!reducedMotion && gear.current) gear.current.rotation.z += delta * speed;
  });
  return (
    <group position={position}>
      <mesh ref={gear} position={[0, 0, -depth / 2]} rotation-z={initialRotation} castShadow>
        <extrudeGeometry args={[shape, {
          depth,
          bevelEnabled: true,
          bevelSegments: 1,
          bevelSize: 0.006,
          bevelThickness: 0.006,
          curveSegments: 12
        }]} />
        <meshStandardMaterial
          color={color}
          normalMap={normalMap}
          normalScale={new THREE.Vector2(0.26, 0.26)}
          roughnessMap={roughnessMap}
          metalness={0.76}
          roughness={0.42}
        />
      </mesh>
      <mesh rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[bore * 0.62, bore * 0.62, 0.68, 10]} />
        <meshStandardMaterial color="#59452f" metalness={0.72} roughness={0.4} />
      </mesh>
    </group>
  );
}

function AntikytheraCrank({ reducedMotion }: { reducedMotion: boolean }) {
  const crank = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!reducedMotion && crank.current) crank.current.rotation.x += delta * 0.065;
  });
  return (
    <group ref={crank} position={[0.79, -0.52, 0]} rotation-x={0.7}>
      <mesh rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.034, 0.034, 0.36, 12]} />
        <meshStandardMaterial color="#987143" metalness={0.78} roughness={0.34} />
      </mesh>
      <mesh position={[0.18, 0.15, 0]} castShadow>
        <boxGeometry args={[0.045, 0.3, 0.045]} />
        <meshStandardMaterial color="#8b653d" metalness={0.76} roughness={0.36} />
      </mesh>
      <mesh position={[0.18, 0.3, 0]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.19, 12]} />
        <meshStandardMaterial color="#4b2d1d" roughness={0.68} />
      </mesh>
    </group>
  );
}

export function LunarEarthwatchProjection({ reducedMotion }: { reducedMotion: boolean }) {
  const sourceEarth = useTexture("/worlds/assets/exteriors/earth-blue-marble.webp");
  const globeMap = useMemo(() => {
    const texture = sourceEarth.clone();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [sourceEarth]);
  useEffect(() => () => globeMap.dispose(), [globeMap]);
  const earth = useRef<THREE.Group>(null);
  const polarOrbit = useRef<THREE.Group>(null);
  const satellite = useRef<THREE.Group>(null);
  const moonOrbit = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    if (!reducedMotion) {
      if (earth.current) earth.current.rotation.y += delta * 0.12;
      if (polarOrbit.current) polarOrbit.current.rotation.z -= delta * 0.085;
      if (satellite.current) satellite.current.rotation.z = clock.elapsedTime * 0.23;
      if (moonOrbit.current) moonOrbit.current.rotation.y = clock.elapsedTime * 0.055;
      if (scan.current) scan.current.position.y = Math.sin(clock.elapsedTime * 0.72) * 0.31;
    }
    if (beacon.current) {
      const pulse = reducedMotion ? 1 : 0.88 + Math.sin(clock.elapsedTime * 2.1) * 0.12;
      beacon.current.scale.setScalar(pulse);
    }
  });
  return (
    <group name="Earthwatch orbital display" position={[0, 1.8, 0.2]} raycast={() => null}>
      <mesh position={[0, -0.64, 0]}>
        <coneGeometry args={[0.5, 0.46, 36, 1, true]} />
        <meshBasicMaterial color="#55bfe9" transparent opacity={0.045} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.88, 0]}>
        <cylinderGeometry args={[0.59, 0.68, 0.08, 40]} />
        <meshStandardMaterial color="#183746" emissive="#22789a" emissiveIntensity={0.34} metalness={0.68} roughness={0.3} transparent opacity={0.88} />
      </mesh>
      <mesh position={[0, -0.83, 0]} rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.41, 0.56, 48]} />
        <meshBasicMaterial color="#75d9f5" transparent opacity={0.34} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {Array.from({ length: 8 }, (_, index) => {
        const angle = index * Math.PI / 4;
        return (
          <mesh key={angle} position={[Math.cos(angle) * 0.72, -0.82, Math.sin(angle) * 0.72]} rotation-y={-angle}>
            <boxGeometry args={[0.2, 0.035, 0.055]} />
            <meshBasicMaterial color={index % 2 ? "#76daf4" : "#e9aa5b"} transparent opacity={0.64} toneMapped={false} />
          </mesh>
        );
      })}
      <group ref={earth}>
        <mesh>
          <sphereGeometry args={[0.41, 48, 32]} />
          <meshStandardMaterial map={globeMap} color="#b2dfef" emissiveMap={globeMap} emissive="#5098b9" emissiveIntensity={0.75} roughness={0.86} metalness={0} transparent opacity={0.93} depthWrite={false} />
        </mesh>
        {[-Math.PI / 4, 0, Math.PI / 4].map((latitude) => (
          <mesh key={`latitude-${latitude}`} position={[0, Math.sin(latitude) * 0.416, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[Math.cos(latitude) * 0.416, 0.0025, 4, 64]} />
            <meshBasicMaterial color="#b9e9f6" transparent opacity={0.17} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
        {[0, Math.PI / 3, -Math.PI / 3].map((longitude) => (
          <mesh key={`longitude-${longitude}`} rotation-y={longitude}>
            <torusGeometry args={[0.416, 0.0025, 4, 64]} />
            <meshBasicMaterial color="#b9e9f6" transparent opacity={0.12} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group ref={polarOrbit} rotation-y={Math.PI / 2.6}>
        <mesh>
          <torusGeometry args={[0.62, 0.011, 7, 72]} />
          <meshBasicMaterial color="#86dcf5" transparent opacity={0.62} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <mesh rotation-y={-0.64} rotation-x={0.22}>
        <torusGeometry args={[0.56, 0.008, 7, 72]} />
        <meshBasicMaterial color="#df9e50" transparent opacity={0.46} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={satellite}>
        {[-1, 1].map((side) => <mesh key={side} position={[0.62 + side * 0.075, 0, 0]}>
          <boxGeometry args={[0.068, 0.012, 0.085]} />
          <meshBasicMaterial color="#67bddb" transparent opacity={0.7} toneMapped={false} />
        </mesh>)}
        <mesh position={[0.62, 0, 0]}>
          <boxGeometry args={[0.075, 0.045, 0.055]} />
          <meshBasicMaterial color="#ffd08a" toneMapped={false} />
        </mesh>
      </group>
      <group ref={moonOrbit}>
        <group position={[0.82, 0.12, 0]}>
          <mesh>
            <sphereGeometry args={[0.095, 18, 12]} />
            <meshStandardMaterial color="#d7d4c8" emissive="#7593a0" emissiveIntensity={0.22} roughness={0.96} transparent opacity={0.9} />
          </mesh>
          <mesh scale={1.3}>
            <sphereGeometry args={[0.095, 16, 10]} />
            <meshBasicMaterial color="#8ddff5" transparent opacity={0.12} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      </group>
      <group ref={scan} rotation-x={Math.PI / 2}>
        <mesh>
          <torusGeometry args={[0.415, 0.005, 5, 64]} />
          <meshBasicMaterial color="#efffff" transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={beacon} position={[0, 0.58, 0]}>
        <sphereGeometry args={[0.045, 14, 10]} />
        <meshBasicMaterial color="#ecfbff" transparent opacity={0.88} toneMapped={false} />
      </mesh>
      <pointLight color="#65c9ee" intensity={0.46} distance={3.8} decay={2} />
    </group>
  );
}

function FoundryAetherClock({ reducedMotion }: { reducedMotion: boolean }) {
  const rotor = useRef<THREE.Group>(null);
  const counterRotor = useRef<THREE.Group>(null);
  const blades = useRef<THREE.InstancedMesh>(null);
  const core = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (!blades.current) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(0.82, 0.09, 0.11);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      quaternion.setFromEuler(new THREE.Euler(0, 0, angle));
      matrix.compose(new THREE.Vector3(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0), quaternion, scale);
      blades.current.setMatrixAt(index, matrix);
    }
    blades.current.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(({ clock }, delta) => {
    if (reducedMotion) return;
    if (rotor.current) rotor.current.rotation.z += delta * 0.34;
    if (counterRotor.current) counterRotor.current.rotation.z -= delta * 0.16;
    if (core.current) {
      const pulse = 0.92 + Math.sin(clock.elapsedTime * 2.1) * 0.08;
      core.current.scale.setScalar(pulse);
    }
  });
  return (
    <group position={[0, 2.76, 3.35]} raycast={() => null}>
      <mesh position={[0, -2.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.65, 0.92, 1.36]} />
        <meshStandardMaterial color="#101a20" metalness={0.62} roughness={0.42} />
      </mesh>
      <mesh position={[0, -1.75, 0.02]} castShadow>
        <boxGeometry args={[3.28, 0.16, 1.04]} />
        <meshStandardMaterial color="#9b6539" metalness={0.78} roughness={0.3} />
      </mesh>
      {[-0.92, 0.92].map((x) => (
        <mesh key={x} position={[x, -0.88, 0]} castShadow>
          <boxGeometry args={[0.1, 1.78, 0.1]} />
          <meshStandardMaterial color="#83502f" metalness={0.72} roughness={0.38} />
        </mesh>
      ))}
      <group ref={rotor}>
        <mesh castShadow>
          <torusGeometry args={[1.34, 0.09, 10, 64]} />
          <meshStandardMaterial color="#a66f3d" metalness={0.78} roughness={0.31} />
        </mesh>
        <instancedMesh ref={blades} args={[undefined, undefined, 8]} castShadow>
          <boxGeometry />
          <meshStandardMaterial color="#16242a" metalness={0.62} roughness={0.38} />
        </instancedMesh>
      </group>
      <group ref={counterRotor} rotation-z={0.32}>
        <mesh>
          <torusGeometry args={[0.88, 0.035, 8, 56]} />
          <meshBasicMaterial color="#1ce4db" transparent opacity={0.74} toneMapped={false} />
        </mesh>
        <mesh rotation-z={Math.PI / 2}>
          <torusGeometry args={[1.08, 0.025, 8, 56]} />
          <meshBasicMaterial color="#e04a99" transparent opacity={0.62} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={core} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.42, 20]} />
        <meshStandardMaterial color="#dafcf8" emissive="#19d9d1" emissiveIntensity={1.1} metalness={0.28} roughness={0.24} toneMapped={false} />
      </mesh>
      <pointLight color="#22e7de" intensity={0.62} distance={5.2} decay={2} />
    </group>
  );
}

function RenaissanceFountain({ reducedMotion }: { reducedMotion: boolean }) {
  const surface = useRef<THREE.Mesh>(null);
  const jet = useRef<THREE.Mesh>(null);
  const ripples = useRef<THREE.Mesh[]>([]);
  useFrame(({ clock }, delta) => {
    if (!reducedMotion && surface.current) surface.current.rotation.z += delta * 0.045;
    if (!reducedMotion && jet.current) {
      const scale = 0.94 + Math.sin(clock.elapsedTime * 2.4) * 0.06;
      jet.current.scale.y = scale;
      // Anchor the stream to the pedestal rather than lifting its lower end.
      jet.current.position.y = 1.72 + 0.46 * scale;
    }
    ripples.current.forEach((ripple, index) => {
      if (!ripple || reducedMotion) return;
      const phase = (clock.elapsedTime * 0.17 + index / ripples.current.length) % 1;
      const scale = 0.48 + phase * 0.55;
      ripple.scale.setScalar(scale);
      const material = ripple.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - phase) * 0.34;
    });
  });
  return (
    <group raycast={() => null}>
      <mesh ref={surface} position={[0, 0.601, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.84, 64]} />
        <WorldGlassMaterial color="#638680" roughness={0.16} metalness={0.02} transmission={0.16} clearcoat={0.65} clearcoatRoughness={0.14} transparent opacity={0.76} />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh key={index} ref={(node) => { if (node) ripples.current[index] = node; }} position={[0, 0.611 + index * 0.001, 0]} rotation-x={Math.PI / 2} scale={0.58 + index * 0.19}>
          <torusGeometry args={[1.34, 0.018, 7, 56]} />
          <meshBasicMaterial color="#c6f0e4" transparent opacity={0.28} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={jet} position={[0, 2.18, 0]}>
        <cylinderGeometry args={[0.025, 0.045, 0.92, 12]} />
        <WorldGlassMaterial color="#c9e2de" roughness={0.12} transmission={0.38} transparent opacity={0.52} />
      </mesh>
      <pointLight position={[0, 1.25, 0]} color="#8fd0c7" intensity={0.28} distance={4.2} decay={2} />
    </group>
  );
}

function ArkshipNavigationWall({ reducedMotion }: { reducedMotion: boolean }) {
  const gl = useThree((state) => state.gl);
  const displayMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const lastView = useRef(-1);
  const textures = useMemo(() => ARKSHIP_NAVIGATION_DESIGN.views.map(createArkshipNavigationTexture), []);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.dataset.arkshipNavigationViews = ARKSHIP_NAVIGATION_DESIGN.views.join(",");
    canvas.dataset.arkshipNavigationCycleSeconds = String(ARKSHIP_NAVIGATION_DESIGN.viewSeconds);
    canvas.dataset.arkshipNavigationActiveView = ARKSHIP_NAVIGATION_DESIGN.views[0];
    return () => {
      textures.forEach((texture) => texture.dispose());
      delete canvas.dataset.arkshipNavigationViews;
      delete canvas.dataset.arkshipNavigationCycleSeconds;
      delete canvas.dataset.arkshipNavigationActiveView;
    };
  }, [gl.domElement, textures]);
  useFrame(({ clock }) => {
    const totalViews = ARKSHIP_NAVIGATION_DESIGN.views.length;
    const cyclePosition = reducedMotion ? 0 : clock.elapsedTime % (ARKSHIP_NAVIGATION_DESIGN.viewSeconds * totalViews);
    const activeView = Math.floor(cyclePosition / ARKSHIP_NAVIGATION_DESIGN.viewSeconds);
    const viewPosition = cyclePosition % ARKSHIP_NAVIGATION_DESIGN.viewSeconds;
    const nextView = (activeView + 1) % totalViews;
    const transitionStart = ARKSHIP_NAVIGATION_DESIGN.viewSeconds - ARKSHIP_NAVIGATION_DESIGN.transitionSeconds;
    const blend = reducedMotion || viewPosition < transitionStart ? 0 : (viewPosition - transitionStart) / ARKSHIP_NAVIGATION_DESIGN.transitionSeconds;
    displayMaterials.current.forEach((material, index) => {
      if (!material) return;
      material.opacity = index === activeView ? 1 - blend : index === nextView ? blend : 0;
    });
    if (lastView.current !== activeView) {
      gl.domElement.dataset.arkshipNavigationActiveView = ARKSHIP_NAVIGATION_DESIGN.views[activeView];
      lastView.current = activeView;
    }
  });

  return (
    <group position={[0, 3.62, -13.31]} raycast={() => null}>
      <mesh position={[0, 0, -0.08]} castShadow receiveShadow>
        <boxGeometry args={[9.35, 3.26, 0.16]} />
        <meshStandardMaterial color="#1d2a33" metalness={0.62} roughness={0.34} />
      </mesh>
      {textures.map((texture, index) => (
        <mesh key={texture.name} position={[0, 0, 0.015 + index * 0.001]} renderOrder={index}>
          <planeGeometry args={[8.92, 2.86]} />
          <meshBasicMaterial
            ref={(material) => { displayMaterials.current[index] = material; }}
            map={texture}
            transparent
            opacity={index === 0 ? 1 : 0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[-4.56, 4.56].map((x) => (
        <mesh key={x} position={[x, 0, 0.03]}>
          <boxGeometry args={[0.1, 3.05, 0.1]} />
          <meshStandardMaterial color={x < 0 ? "#d69a52" : "#61c7da"} emissive={x < 0 ? "#7d4724" : "#266878"} emissiveIntensity={0.7} metalness={0.42} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, -1.83, 0.42]} castShadow receiveShadow>
        <boxGeometry args={[8.4, 0.42, 0.92]} />
        <meshStandardMaterial color="#283943" metalness={0.58} roughness={0.38} />
      </mesh>
      <mesh position={[0, -1.61, 0.58]} rotation-x={-0.18}>
        <planeGeometry args={[7.45, 0.34]} />
        <meshBasicMaterial color="#285362" toneMapped={false} />
      </mesh>
      <mesh position={[0, -2.77, 0.28]} castShadow receiveShadow>
        <boxGeometry args={[8.72, 1.42, 0.5]} />
        <meshStandardMaterial color="#17242c" metalness={0.46} roughness={0.44} />
      </mesh>
      {[-3.42, -1.72, 0, 1.72, 3.42].map((x, index) => (
        <group key={x} position={[x, -2.77, 0.56]}>
          <mesh>
            <boxGeometry args={[1.4, 0.94, 0.06]} />
            <meshStandardMaterial color="#0d171d" metalness={0.36} roughness={0.48} />
          </mesh>
          <mesh position={[0, 0.22, 0.04]}>
            <boxGeometry args={[1.04, 0.035, 0.035]} />
            <meshBasicMaterial color={index % 2 === 0 ? "#66dbe9" : "#d69a52"} transparent opacity={0.72} toneMapped={false} />
          </mesh>
          <mesh position={[-0.38, -0.2, 0.04]}>
            <circleGeometry args={[0.035, 12]} />
            <meshBasicMaterial color="#a5f4fa" toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -3.52, 0.26]} castShadow receiveShadow>
        <boxGeometry args={[9.15, 0.12, 0.7]} />
        <meshStandardMaterial color="#657780" metalness={0.72} roughness={0.3} />
      </mesh>
    </group>
  );
}

function HeritageGalleryRails() {
  const rails = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!rails.current) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const postPositions = Array.from({ length: 15 }, (_, index) => -9.1 + index * 1.3);
    let index = 0;
    for (const x of [-8.62, 8.62]) {
      for (const y of [6.2, 7.08]) {
        matrix.compose(new THREE.Vector3(x, y, 0), quaternion, new THREE.Vector3(0.075, 0.075, 19.2));
        rails.current.setMatrixAt(index, matrix);
        index += 1;
      }
      for (const z of postPositions) {
        matrix.compose(new THREE.Vector3(x, 6.64, z), quaternion, new THREE.Vector3(0.065, 0.86, 0.065));
        rails.current.setMatrixAt(index, matrix);
        index += 1;
      }
    }
    rails.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={rails} args={[undefined, undefined, 34]} castShadow>
      <boxGeometry />
      <meshStandardMaterial color="#a77b3f" metalness={0.76} roughness={0.32} />
    </instancedMesh>
  );
}

// The reading hall has one table. Keep lamp instances and their lights together.
const HERITAGE_BANKER_LAMP_X = [0] as const;

function HeritageBankerLamps() {
  const bases = useRef<THREE.InstancedMesh>(null);
  const stems = useRef<THREE.InstancedMesh>(null);
  const shades = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    HERITAGE_BANKER_LAMP_X.forEach((x, index) => {
      // The Blender table top ends at y=0.96. Seat the felt foot directly on
      // it and overlap the stem into the base so no viewing angle shows a gap.
      matrix.makeTranslation(x, 0.99, 1.2);
      bases.current?.setMatrixAt(index, matrix);
      matrix.makeTranslation(x, 1.2, 1.2);
      stems.current?.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(x, 1.42, 1.2), new THREE.Quaternion(), new THREE.Vector3(0.56, 0.13, 0.24));
      shades.current?.setMatrixAt(index, matrix);
    });
    for (const mesh of [bases.current, stems.current, shades.current]) {
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
  }, []);
  return (
    <group>
      <instancedMesh ref={bases} args={[undefined, undefined, HERITAGE_BANKER_LAMP_X.length]} castShadow>
        <cylinderGeometry args={[0.16, 0.21, 0.06, 24]} />
        <meshStandardMaterial color="#9c743c" metalness={0.78} roughness={0.27} />
      </instancedMesh>
      <instancedMesh ref={stems} args={[undefined, undefined, HERITAGE_BANKER_LAMP_X.length]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.42, 16]} />
        <meshStandardMaterial color="#b68a48" metalness={0.82} roughness={0.24} />
      </instancedMesh>
      <instancedMesh ref={shades} args={[undefined, undefined, HERITAGE_BANKER_LAMP_X.length]} castShadow>
        <sphereGeometry args={[0.5, 24, 12]} />
        <meshStandardMaterial color="#285544" emissive="#366e54" emissiveIntensity={0.12} roughness={0.32} metalness={0.08} />
      </instancedMesh>
      {HERITAGE_BANKER_LAMP_X.map((x) => (
        <group key={x}>
          <pointLight position={[x, 1.36, 1.2]} color="#ffd39a" intensity={0.42} distance={3.2} decay={2} />
        </group>
      ))}
    </group>
  );
}

function HeritageShelfWashLights() {
  return (
    <group>
      {[-5.8, 0, 5.8].map((z) => (
        <pointLight
          key={z}
          position={[0, 3.65, z]}
          color="#ffd9a6"
          intensity={0.72}
          distance={10.5}
          decay={2}
          castShadow={false}
        />
      ))}
    </group>
  );
}

function HeritageFire({ reducedMotion }: { reducedMotion: boolean }) {
  const glow = useRef<THREE.PointLight>(null);
  const flame = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 flameUv; void main() { flameUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time;
      varying vec2 flameUv;
      float plume(float center, float height, float seed) {
        float y = flameUv.y / height;
        float bend = sin(y * 7.0 - time * 2.4 + seed) * 0.035 * y;
        float width = max(0.002, (1.0 - y) * 0.17);
        float body = 1.0 - smoothstep(width * 0.18, width, abs(flameUv.x - center - bend));
        return body * (1.0 - smoothstep(0.76, 1.0, y)) * smoothstep(0.0, 0.1, y);
      }
      void main() {
        float heat = max(plume(0.24, 0.74 + sin(time * 1.7) * 0.07, 1.0),
          max(plume(0.5, 0.96 + sin(time * 2.1) * 0.04, 3.0), plume(0.75, 0.8 + sin(time * 1.3) * 0.08, 5.0)));
        vec3 color = mix(vec3(0.91, 0.12, 0.018), vec3(1.0, 0.68, 0.2), heat);
        color = mix(color, vec3(1.0, 0.86, 0.5), heat * (1.0 - flameUv.y) * 0.55);
        gl_FragColor = vec4(color, heat * 0.88);
      }`,
    transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  }), []);
  useEffect(() => () => flame.dispose(), [flame]);
  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    if (!reducedMotion) flame.uniforms.time.value = time;
    if (glow.current) {
      glow.current.intensity = reducedMotion
        ? 2.1
        : 2.1 + Math.sin(time * 2.1) * 0.15 + Math.sin(time * 3.7) * 0.07;
    }
  });
  return (
    <group position={[0, 1.08, -9.62]} raycast={() => null}>
      <mesh position={[0, -0.28, 0]}>
        <planeGeometry args={[1.52, 0.32]} />
        <meshBasicMaterial color="#9e2b0e" transparent opacity={0.38} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {[-0.48, 0, 0.48].map((x, index) => (
        <mesh key={`log-${x}`} position={[x, -0.19 + index * 0.018, 0.07]} rotation-z={index === 1 ? -1.18 : index === 0 ? 1.08 : -0.92}>
          <cylinderGeometry args={[0.095, 0.12, 1.05, 12]} />
          <meshStandardMaterial color="#32140c" emissive="#8b2f12" emissiveIntensity={0.34} roughness={0.92} />
        </mesh>
      ))}
      <mesh position={[0, 0.29, 0.09]}>
        <planeGeometry args={[1.7, 1.3]} />
        <primitive object={flame} attach="material" />
      </mesh>
      <pointLight ref={glow} position={[0, 0.22, 0.72]} color="#ff8a3d" intensity={2.1} distance={6.8} decay={2} />
    </group>
  );
}

function RenaissanceDome({ quality }: { quality: ResolvedQuality }) {
  const soffit = useMemo(() => {
    const { halfSpan, openingRadius } = RENAISSANCE_SOFFIT;
    const shape = new THREE.Shape();
    shape.moveTo(-halfSpan, -halfSpan);
    shape.lineTo(halfSpan, -halfSpan);
    shape.lineTo(halfSpan, halfSpan);
    shape.lineTo(-halfSpan, halfSpan);
    shape.closePath();
    const opening = new THREE.Path();
    opening.absarc(0, 0, openingRadius, 0, Math.PI * 2, true);
    shape.holes.push(opening);
    const geometry = new THREE.ShapeGeometry(shape, RENAISSANCE_SOFFIT.curveSegments);
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 11, uv.getY(i) / 11);
    return geometry;
  }, []);
  useEffect(() => () => soffit.dispose(), [soffit]);
  const maps = useTexture({
    map: "/worlds/assets/materials/dome-plaster-color.webp",
    normalMap: "/worlds/assets/materials/dome-plaster-normal.webp",
    roughnessMap: "/worlds/assets/materials/dome-plaster-roughness.webp"
  });
  const { radius, springY, openingAngle, verticalScale, drum } = RENAISSANCE_DOME;
  const [domeWidthSegments, domeHeightSegments] = RENAISSANCE_DOME.segments[quality === "lite" ? "lite" : "cinematic"];
  const oculusRadius = Math.sin(openingAngle) * radius;
  const oculusY = springY + Math.cos(openingAngle) * radius * verticalScale;
  const ribCount = quality === "lite" ? 6 : 10;
  const ribs = useMemo(() => Array.from({ length: ribCount }, (_, index) => {
    const angle = index * Math.PI * 2 / ribCount;
    const point = (distance: number, y: number) => new THREE.Vector3(Math.sin(angle) * distance, y, Math.cos(angle) * distance);
    return new THREE.QuadraticBezierCurve3(
      point(radius * 0.98, springY + 0.08),
      point(radius * 0.58, springY + 3.35),
      point(oculusRadius * 1.02, oculusY - 0.03)
    );
  }), [oculusRadius, oculusY, ribCount]);

  useEffect(() => {
    Object.entries(maps).forEach(([key, texture]) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(4, 2);
      texture.colorSpace = key === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = quality === "lite" ? 4 : 8;
      texture.needsUpdate = true;
    });
  }, [maps, quality]);

  const material = (
    <meshStandardMaterial
      color="#eadbb4"
      map={maps.map}
      normalMap={maps.normalMap}
      normalScale={new THREE.Vector2(0.13, 0.13)}
      roughnessMap={maps.roughnessMap}
      roughness={0.74}
      side={THREE.BackSide}
    />
  );
  const ringY = (ringRadius: number) => springY + Math.sqrt(radius * radius - ringRadius * ringRadius) * verticalScale;

  return (
    <group raycast={() => null}>
      <mesh position={[0, springY, 0]} scale={[1, verticalScale, 1]} receiveShadow>
        <sphereGeometry args={[radius, domeWidthSegments, domeHeightSegments, 0, Math.PI * 2, openingAngle, Math.PI / 2 - openingAngle]} />
        {material}
      </mesh>

      <mesh name="Continuous square to round plaster soffit" position={[0, RENAISSANCE_SOFFIT.height, 0]} rotation-x={Math.PI / 2} geometry={soffit} receiveShadow>
        <meshStandardMaterial color="#ddc896" map={maps.map} normalMap={maps.normalMap} normalScale={new THREE.Vector2(0.13, 0.13)} roughness={0.86} side={THREE.DoubleSide} />
      </mesh>
      <mesh name="Dome springing drum" position={[0, drum.centerY, 0]} receiveShadow>
        <cylinderGeometry args={[drum.radius, drum.radius, drum.height, drum.radialSegments, 1, true]} />
        <meshStandardMaterial color="#ddc896" map={maps.map} roughness={0.86} side={THREE.DoubleSide} />
      </mesh>

      {ribs.map((curve, index) => (
        <mesh key={index} castShadow>
          <tubeGeometry args={[curve, quality === "lite" ? 18 : 28, 0.075, 8, false]} />
          <meshStandardMaterial color="#a77942" roughness={0.42} metalness={0.34} />
        </mesh>
      ))}

      {[6.4, 8.7].map((ringRadius) => (
        <mesh key={ringRadius} position={[0, ringY(ringRadius), 0]} rotation-x={Math.PI / 2} castShadow>
          <torusGeometry args={[ringRadius, 0.085, 10, quality === "lite" ? 48 : 80]} />
          <meshStandardMaterial color="#a77942" roughness={0.42} metalness={0.34} />
        </mesh>
      ))}

      <mesh position={[0, oculusY, 0]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[oculusRadius, 0.14, 12, quality === "lite" ? 48 : 80]} />
        <meshStandardMaterial color="#b7894d" roughness={0.34} metalness={0.5} />
      </mesh>
      <mesh position={[0, oculusY + 0.015, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[oculusRadius - 0.12, quality === "lite" ? 36 : 64]} />
        <WorldGlassMaterial color="#b9d9e7" roughness={0.12} transmission={0.62} transparent opacity={0.48} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <pointLight position={[0, oculusY - 0.65, 0]} color="#fff0c5" intensity={0.9} distance={14} decay={2} />
    </group>
  );
}

function ModernParallaxBackplate({ texture, panel, quality }: {
  texture: THREE.Texture;
  panel: BackplatePanel;
  quality: ResolvedQuality;
}) {
  const camera = useThree((state) => state.camera);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      sourceMap: { value: texture },
      shift: { value: 0 },
      strength: { value: quality === "lite" ? 0.72 : 1 },
      tint: { value: new THREE.Color("#d2cec4") }
    },
    vertexShader: `
      varying vec2 imageUv;
      void main() {
        imageUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D sourceMap;
      uniform float shift;
      uniform float strength;
      uniform vec3 tint;
      varying vec2 imageUv;
      void main() {
        float nearDepth = smoothstep(0.04, 0.96, 1.0 - imageUv.y);
        float depthFactor = mix(0.18, 1.0, nearDepth) * strength;
        vec2 sampleUv = vec2(clamp(imageUv.x * 0.92 + 0.04 + shift * depthFactor, 0.002, 0.998), imageUv.y);
        gl_FragColor = texture2D(sourceMap, sampleUv);
        gl_FragColor.rgb *= tint;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    toneMapped: true
  }), [quality, texture]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    camera.getWorldDirection(direction);
    const cameraShift = THREE.MathUtils.clamp(
      (camera.position.x - panel.position[0]) * 0.0032 + direction.x * 0.014,
      -0.034,
      0.034
    );
    material.uniforms.shift.value = THREE.MathUtils.damp(material.uniforms.shift.value, cameraShift, 8, delta);
  });

  return (
    <mesh position={panel.position} rotation-y={panel.rotationY || 0} renderOrder={-1}>
      <planeGeometry args={panel.size} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function FoundryServiceRuns() {
  const pipes = useRef<THREE.InstancedMesh>(null);
  const valves = useRef<THREE.InstancedMesh>(null);
  const positions = [-1, 1].flatMap((side) => [-8, -1].map((z) => ({ side, z })));
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const valveRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    positions.forEach(({ side, z }, index) => {
      matrix.makeTranslation(side * 11.82, 3.45, z);
      pipes.current?.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(side * 11.82, 6.45, z), valveRotation, new THREE.Vector3(1, 1, 1));
      valves.current?.setMatrixAt(index, matrix);
      valves.current?.setColorAt(index, new THREE.Color(z > 0 ? "#a93673" : "#187d7c"));
    });
    if (pipes.current) pipes.current.instanceMatrix.needsUpdate = true;
    if (valves.current) {
      valves.current.instanceMatrix.needsUpdate = true;
      if (valves.current.instanceColor) valves.current.instanceColor.needsUpdate = true;
    }
  }, []);

  return (
    <group raycast={() => null}>
      <instancedMesh ref={pipes} args={[undefined, undefined, positions.length]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 6.6, 16]} />
        <meshStandardMaterial color="#8f5838" roughness={0.52} metalness={0.68} />
      </instancedMesh>
      <instancedMesh ref={valves} args={[undefined, undefined, positions.length]}>
        <torusGeometry args={[0.23, 0.035, 10, 28]} />
        <meshStandardMaterial vertexColors roughness={0.38} metalness={0.62} />
      </instancedMesh>
    </group>
  );
}

function DecoFloorInlay() {
  const rays = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!rays.current) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3(0, 0.014, 0);
    const scale = new THREE.Vector3(0.045, 0.008, 15.4);
    for (let index = 0; index < 4; index += 1) {
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * Math.PI / 4, 0));
      matrix.compose(position, quaternion, scale);
      rays.current.setMatrixAt(index, matrix);
    }
    rays.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group>
      <instancedMesh ref={rays} args={[undefined, undefined, 4]} receiveShadow>
        <boxGeometry />
        <meshStandardMaterial color="#725d38" metalness={0.08} roughness={1} />
      </instancedMesh>
      {[3.15, 6.55].map((radius) => (
        <mesh key={radius} position={[0, 0.019, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[radius - 0.035, radius + 0.035, 96]} />
          <meshStandardMaterial color="#725d38" metalness={0.08} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function DecoIndexTower({ reducedMotion }: { reducedMotion: boolean }) {
  const ribs = useRef<THREE.InstancedMesh>(null);
  const rotating = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useEffect(() => {
    if (!ribs.current) return;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const position = new THREE.Vector3(Math.sin(angle) * 0.63, 2.3, Math.cos(angle) * 0.63);
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      matrix.compose(position, quaternion, new THREE.Vector3(0.055, 3.15, 0.075));
      ribs.current.setMatrixAt(index, matrix);
    }
    ribs.current.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(({ clock }, delta) => {
    if (!reducedMotion && rotating.current) rotating.current.rotation.y += delta * 0.055;
    const pulse = reducedMotion ? 1 : 0.9 + Math.sin(clock.elapsedTime * 1.8) * 0.1;
    if (beacon.current) beacon.current.scale.setScalar(pulse);
    if (light.current) light.current.intensity = 0.62 + pulse * 0.16;
  });

  return (
    <group raycast={() => null}>
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.94, 1.04, 0.32, 8]} />
        <meshStandardMaterial color="#111513" roughness={0.24} metalness={0.16} />
      </mesh>
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[0.82, 0.9, 0.22, 8]} />
        <meshStandardMaterial color="#c5a35b" roughness={0.22} metalness={0.88} />
      </mesh>
      <mesh position={[0, 2.3, 0]} castShadow>
        <cylinderGeometry args={[0.58, 0.66, 3.15, 8]} />
        <meshStandardMaterial color="#174d46" emissive="#2e8b7d" emissiveIntensity={0.32} roughness={0.2} metalness={0.18} transparent opacity={0.82} />
      </mesh>
      <group ref={rotating}>
        <instancedMesh ref={ribs} args={[undefined, undefined, 8]} castShadow>
          <boxGeometry />
          <meshStandardMaterial color="#c5a35b" roughness={0.2} metalness={0.9} />
        </instancedMesh>
        <mesh position={[0, 2.3, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.82, 0.025, 8, 56]} />
          <meshBasicMaterial color="#68c8b6" transparent opacity={0.58} toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, 3.92, 0]} castShadow>
        <cylinderGeometry args={[0.76, 0.64, 0.18, 8]} />
        <meshStandardMaterial color="#c5a35b" roughness={0.2} metalness={0.9} />
      </mesh>
      <mesh position={[0, 4.17, 0]} castShadow>
        <cylinderGeometry args={[0.38, 0.62, 0.34, 8]} />
        <meshStandardMaterial color="#111513" roughness={0.22} metalness={0.24} />
      </mesh>
      <mesh ref={beacon} position={[0, 4.43, 0]}>
        <sphereGeometry args={[0.16, 16, 10]} />
        <meshStandardMaterial color="#ffe4a2" emissive="#ffc96f" emissiveIntensity={1.1} roughness={0.24} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 3.15, 0]} color="#67c5b4" intensity={0.78} distance={5.2} decay={2} />
    </group>
  );
}

function tuneWorldMaterial(material: THREE.MeshStandardMaterial, world: WorldDefinition) {
  const name = material.name.toLowerCase();
  if (world.id === "heritage") {
    if (name.includes("oak parquet")) {
      material.color.multiply(new THREE.Color("#a47a5d"));
      material.roughness = Math.max(material.roughness, 0.62);
      material.roughnessMap = null;
      material.normalScale.set(0.18, 0.18);
    } else if (name.includes("oak") || name.includes("wood")) {
      material.color.multiply(new THREE.Color("#c5a17d"));
      material.roughness = 0.76;
      material.roughnessMap = null;
      material.envMapIntensity = 0.22;
    }
    if (name.includes("oxblood wool")) {
      material.color.set("#45212b");
      material.roughness = 1;
      material.envMapIntensity = 0.12;
    }
    if (name.includes("plaster")) material.color.multiply(new THREE.Color("#c8bba2"));
    if (name.includes("lamp glow")) material.emissiveIntensity = 0.08;
  } else if (world.id === "gothic") {
    if (name.includes("limestone") || name.includes("marble")) {
      material.color.multiply(new THREE.Color("#8792a4"));
      material.roughness = 0.92;
      material.roughnessMap = null;
      material.normalScale.set(0.2, 0.2);
      material.envMapIntensity = 0.02;
    }
    if (name.includes("moonlit glass")) {
      material.color.set("#243954");
      material.emissive.set("#315d8f");
      material.emissiveIntensity = 0.08;
    }
    if (name.includes("candle flame")) {
      material.color.set("#ffe2ae");
      material.emissive.set("#ff922f");
      material.emissiveIntensity = 0.92;
      material.toneMapped = false;
    }
  } else if (world.id === "modern") {
    if (name.includes("travertine")) {
      material.color.multiply(new THREE.Color("#b7ae9e"));
      material.roughness = 0.72;
      material.roughnessMap = null;
      material.normalScale.set(0.18, 0.18);
    }
    if (name.includes("concrete")) material.color.multiply(new THREE.Color("#a4abb0"));
  } else if (world.id === "renaissance") {
    if (name.includes("terracotta")) {
      material.color.set("#9e806c");
      material.roughness = 0.84;
      material.roughnessMap = null;
      material.normalScale.set(0.15, 0.15);
      material.metalness = 0;
    }
    if (name.includes("plaster")) material.color.set("#dfd0ae");
    if (name.includes("walnut")) material.color.multiply(new THREE.Color("#b6815f"));
    if (name.includes("marble")) {
      material.color.multiply(new THREE.Color("#c8bba4"));
      material.roughness = 0.68;
    }
  } else if (world.id === "deco") {
    if (name.includes("ebony") || name.includes("onyx")) material.color.set("#494239");
    if (name.includes("onyx")) { material.roughness = 0.68; material.metalness = 0.06; }
    if (name.includes("marble")) {
      material.color.multiply(new THREE.Color("#8f877b"));
      material.roughness = 0.78;
      material.roughnessMap = null;
      material.normalScale.set(0.2, 0.2);
      material.envMapIntensity = 0.4;
    }
    if (name.includes("brass")) material.color.set("#b99550");
    if (name.includes("deco glow")) material.emissiveIntensity = 0.7;
  } else if (world.id === "foundry") {
    if (name.includes("concrete")) {
      material.color.multiply(new THREE.Color("#657277"));
      material.roughness = 0.86;
      material.roughnessMap = null;
      material.normalScale.set(0.18, 0.18);
    }
    if (name.includes("steel")) material.color.multiply(new THREE.Color("#87959a"));
    if (name.includes("copper")) material.color.multiply(new THREE.Color("#b27d61"));
    if (name.includes("cyan signal")) {
      material.color.set("#176f73");
      material.emissive.set("#17a8aa");
      material.emissiveIntensity = 0.18;
    }
    if (name.includes("magenta signal") || name.includes("amber")) material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.42);
  } else if (world.id === "lunar") {
    if (name.includes("sealed deck")) {
      material.color.set("#222a31");
      material.roughness = 0.82;
      material.roughnessMap = null;
      material.normalScale.set(0.15, 0.15);
    }
    if (name.includes("hull composite")) {
      material.color.multiply(new THREE.Color("#aeb9bc"));
      material.roughness = 0.74;
      material.roughnessMap = null;
      material.normalScale.set(0.12, 0.12);
      material.envMapIntensity = 0.24;
    }
    if (name.includes("alloy")) {
      material.color.multiply(new THREE.Color("#798993"));
      material.roughness = 0.6;
      material.roughnessMap = null;
      material.normalScale.set(0.12, 0.12);
      material.envMapIntensity = 0.3;
    }
    if (name.includes("amber") || name.includes("navigation blue")) material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.55);
  } else if (world.id === "arkship") {
    if (name.includes("arkship deck")) {
      material.color.multiply(new THREE.Color("#657785"));
      material.roughness = 0.78;
      material.roughnessMap = null;
      material.normalScale.set(0.14, 0.14);
      material.envMapIntensity = 0.4;
    }
    if (name.includes("warm composite")) material.color.set("#3a4b59");
    if (name.includes("deep hull")) material.color.set("#111a26");
    if (name.includes("alloy")) {
      material.color.multiply(new THREE.Color("#8298a6"));
      material.roughness = 0.6;
      material.roughnessMap = null;
      material.normalScale.set(0.12, 0.12);
      material.envMapIntensity = 0.3;
    }
    if (name.includes("voyage cyan") || name.includes("reading amber")) material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.58);
  } else if (world.id === "alexandria") {
    if (name.includes("limestone") || name.includes("marble")) {
      material.color.multiply(new THREE.Color("#b5aa96"));
      material.roughness = Math.max(material.roughness, 0.72);
      material.metalness = 0;
      material.envMapIntensity = Math.min(material.envMapIntensity, 0.38);
    }
    if (name.includes("papyrus") || name.includes("plaster")) {
      material.roughness = Math.max(material.roughness, 0.78);
      material.metalness = 0;
    }
    if (name.includes("oil lamp amber")) {
      material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.22);
      material.toneMapped = true;
    }
  }
}
