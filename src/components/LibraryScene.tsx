import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Environment, RoundedBox, useTexture } from "@react-three/drei";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { bookAtlasLayout } from "../bookAtlas";
import { recordRoomStage } from "../performance";
import { updateAmbienceListener } from "../ambient";
import { dampPlanarVelocity, isTapGesture, movementVectorFromInput, resolvePlanarCollisions, shouldStartLookDrag, stepCrouchOffset, stepJumpMotion, type MovementInput, type VerticalMotionState } from "../navigation";
import type { Book, LibraryManifest, SceneMode } from "../types";
import { focusPoseForBook, resolveBookTransform } from "../worlds/layout";
import { ScrollBays, ShelfBays } from "../worlds/shared";
import type { QualityPreference, ResolvedQuality, SceneLoadProgress, WorldDefinition, WorldId } from "../worlds/types";
import { ScrollCollection } from "./ScrollCollection";

const loadPostEffects = () => import("./PostEffects");
const PostEffects = lazy(loadPostEffects);

type SceneProps = {
  manifest: LibraryManifest;
  world: WorldDefinition;
  selectedBookId?: string;
  focusBookId?: string;
  sceneMode: SceneMode;
  qualityPreference: QualityPreference;
  exposureScale?: number;
  paused?: boolean;
  motionPaused?: boolean;
  interactionEnabled?: boolean;
  highlights: Map<string, number>;
  onSelectBook: (book: Book) => void;
  onHoverBook: (book?: Book) => void;
  onModeChange: (mode: SceneMode) => void;
  onFocusComplete: () => void;
  onCanvasReady?: () => void;
  onArchitectureReady?: () => void;
  onProgress?: (progress: SceneLoadProgress) => void;
  onReady?: () => void;
};

type CameraMemory = { position: THREE.Vector3; yaw: number; pitch: number };
const cameraMemory = new Map<WorldId, CameraMemory>();
let rendererSequence = 0;

export default function LibraryScene(props: SceneProps) {
  const [rendererRevision, setRendererRevision] = useState(0);
  const [quality, setQuality] = useState<ResolvedQuality>(initialAutoQuality);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const recreateRenderer = useCallback(() => {
    props.onCanvasReady?.();
    setRendererRevision((revision) => revision + 1);
  }, [props.onCanvasReady]);
  return (
    <Canvas
      key={rendererRevision}
      className={props.interactionEnabled ? "library-canvas" : "library-canvas input-blocked"}
      frameloop={props.paused || !visible ? "demand" : "always"}
      shadows={quality === "cinematic" ? "percentage" : false}
      dpr={quality === "cinematic" ? [1, 1.65] : quality === "balanced" ? [1, 1.25] : 1}
      camera={{ position: props.world.spawn.position, fov: 54, near: 0.06, far: props.world.cameraFar }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.shadowMap.type = THREE.PCFShadowMap;
        gl.toneMapping = THREE.AgXToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.info.autoReset = false;
        gl.domElement.dataset.rendererId = String(++rendererSequence);
      }}
    >
      <RenderLifecycleRecovery onRecreate={recreateRenderer} />
      <LibraryRoom key={props.world.id} {...props} onQualityChange={setQuality} />
    </Canvas>
  );
}

function LibraryRoom({ manifest, world, selectedBookId, focusBookId, sceneMode, qualityPreference, exposureScale = 1, paused = false, motionPaused = false, interactionEnabled = true, highlights, onSelectBook, onHoverBook, onModeChange, onFocusComplete, onCanvasReady, onArchitectureReady, onProgress, onReady, onQualityChange }: SceneProps & { onQualityChange: (quality: ResolvedQuality) => void }) {
  const focusedBook = manifest.books.find((book) => book.id === focusBookId);
  const systemReducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const reducedMotion = motionPaused || systemReducedMotion;
  const [adaptiveQuality, setAdaptiveQuality] = useState<ResolvedQuality>(() => initialAutoQuality());
  const quality = qualityPreference === "auto" ? adaptiveQuality : qualityPreference;
  // The space rooms produced saturated frames with the effect chain in walkthroughs.
  // Follow Alexandria's direct-rendering policy, retaining detailed models and lighting.
  const postProcessing = quality === "cinematic" && !["lunar", "arkship", "alexandria"].includes(world.id);
  const lowPower = quality === "lite";
  const lighting = world.lighting;
  const WorldEnvironment = useMemo(() => lazy(world.load), [world.id]);
  const [canvasReady, setCanvasReady] = useState(false);
  const [architectureReady, setArchitectureReady] = useState(false);
  const worldAssetsRequested = true;
  const enhancementsRequested = true;
  const [labelsReady, setLabelsReady] = useState(false);
  const [effectsReady, setEffectsReady] = useState(false);
  const [environmentReady, setEnvironmentReady] = useState(false);
  const [worldDetailsReady, setWorldDetailsReady] = useState(false);
  const [shelvesReady, setShelvesReady] = useState(false);
  const [bookMaterialsReady, setBookMaterialsReady] = useState(false);
  const readyReported = useRef(false);
  const [presented, setPresented] = useState(false);
  const [presentationPrepared, setPresentationPrepared] = useState(false);
  const architectureReported = useRef(false);
  const architectureCallback = useRef(onArchitectureReady);
  architectureCallback.current = onArchitectureReady;
  const progressCallback = useRef(onProgress);
  progressCallback.current = onProgress;
  const handleArchitectureReady = () => setArchitectureReady(true);

  useEffect(() => {
    if (!architectureReady || architectureReported.current) return;
    architectureReported.current = true;
    architectureCallback.current?.();
  }, [architectureReady]);

  useEffect(() => {
    if (qualityPreference === "auto") setAdaptiveQuality(initialAutoQuality());
  }, [qualityPreference]);
  useEffect(() => onQualityChange(quality), [quality, onQualityChange]);

  useEffect(() => {
    if (interactionEnabled) return;
    onHoverBook(undefined);
    document.body.style.cursor = "";
  }, [interactionEnabled, onHoverBook]);

  useEffect(() => {
    if (!enhancementsRequested) setEffectsReady(false);
    else if (!postProcessing) setEffectsReady(true);
    else {
      setEffectsReady(false);
      let cancelled = false;
      void loadPostEffects().then(() => {
        if (!cancelled) setEffectsReady(true);
      });
      return () => { cancelled = true; };
    }
  }, [enhancementsRequested, postProcessing]);

  const fullyReady = architectureReady && labelsReady && effectsReady && environmentReady && worldDetailsReady && shelvesReady && bookMaterialsReady;
  useEffect(() => {
    const tasks = [canvasReady, architectureReady, labelsReady, effectsReady, environmentReady, worldDetailsReady, shelvesReady, bookMaterialsReady];
    const completed = tasks.filter(Boolean).length;
    ["canvas", "architecture", "labels", "effects", "environment", "details", "shelves", "bookMaterials"].forEach((name, index) => {
      if (tasks[index]) recordRoomStage(name);
    });
    const stage = !canvasReady
      ? "code"
      : !architectureReady
        ? "architecture"
        : !labelsReady || !shelvesReady || !bookMaterialsReady
          ? "collection"
          : !effectsReady || !environmentReady || !worldDetailsReady
            ? "lighting"
            : "ready";
    progressCallback.current?.({ stage, completed, total: tasks.length, ratio: completed / tasks.length });
  }, [architectureReady, bookMaterialsReady, canvasReady, effectsReady, environmentReady, labelsReady, shelvesReady, worldDetailsReady]);
  useEffect(() => {
    document.documentElement.dataset.roomReadiness = [
      `architecture:${architectureReady}`,
      `enhancements:${enhancementsRequested}`,
      `labels:${labelsReady}`,
      `effects:${effectsReady}`,
      `environment:${environmentReady}`,
      `world:${worldDetailsReady}`,
      `shelves:${shelvesReady}`,
      `bookMaterials:${bookMaterialsReady}`
    ].join(",");
  }, [architectureReady, bookMaterialsReady, effectsReady, enhancementsRequested, environmentReady, labelsReady, shelvesReady, worldDetailsReady]);
  const reportReady = () => {
    if (readyReported.current) return;
    readyReported.current = true;
    setPresented(true);
    onReady?.();
  };
  return (
    <>
      <WorldAtmosphere world={world} exposureScale={exposureScale} />
      <FirstUsableFrame onReady={() => {
        setCanvasReady(true);
        onCanvasReady?.();
      }} />
      <SceneTelemetry active={presented && !paused} bookCount={manifest.books.length} shelfCount={manifest.shelves.length} world={world} quality={quality} qualityPreference={qualityPreference} onDecline={setAdaptiveQuality} />
      <ambientLight intensity={world.scene.ambientIntensity * lighting.ambient * (quality === "lite" ? 1.12 : 1)} color={world.scene.ambient} />
      <hemisphereLight color={world.scene.ambient} groundColor={world.scene.shelfDark} intensity={lighting.hemisphere} />
      <directionalLight
        position={world.scene.keyPosition}
        intensity={world.scene.keyIntensity * lighting.key}
        color={world.scene.key}
        castShadow={quality === "cinematic"}
        shadow-mapSize={[quality === "cinematic" ? 2048 : 1024, quality === "cinematic" ? 2048 : 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0002}
        shadow-normalBias={0.015}
        shadow-radius={2}
      />
      <pointLight position={[0, 4.9, 1]} intensity={world.scene.practicalIntensity * lighting.practical} distance={15} color={world.scene.practical} castShadow={false} />
      {enhancementsRequested && (
        <Suspense fallback={null}>
          {quality === "cinematic" && world.id !== "gothic" && (
            <Environment files={world.assets.environment} background={false} environmentIntensity={lighting.environment} />
          )}
          <MountedReadySignal onReady={() => setEnvironmentReady(true)} />
        </Suspense>
      )}

      {worldAssetsRequested && (
        <Suspense fallback={null}>
          <WorldEnvironment reducedMotion={reducedMotion} quality={quality} onArchitectureReady={handleArchitectureReady} onReady={() => setWorldDetailsReady(true)} />
        </Suspense>
      )}
      {world.displayArtifact === "scroll" ? (
        <>
          <Suspense fallback={<ScrollBays shelves={manifest.shelves} world={world} quality={quality} />}>
            <ScrollBays shelves={manifest.shelves} world={world} quality={quality} materialsEnabled={canvasReady} />
            {canvasReady && <MountedReadySignal onReady={() => setShelvesReady(true)} />}
          </Suspense>
          <Suspense fallback={null}>
            <ScrollCollection
              books={manifest.books}
              world={world}
              selectedBookId={selectedBookId}
              quality={quality}
              highlights={highlights}
              onSelectBook={onSelectBook}
              onHoverBook={onHoverBook}
              onReady={() => {
                setLabelsReady(true);
                setBookMaterialsReady(true);
              }}
            />
          </Suspense>
        </>
      ) : (
        <>
          <Suspense fallback={<ShelfBays shelves={manifest.shelves} world={world} quality={quality} />}>
            <ShelfBays shelves={manifest.shelves} world={world} quality={quality} materialsEnabled={canvasReady} />
            {canvasReady && <MountedReadySignal onReady={() => setShelvesReady(true)} />}
          </Suspense>
          <BookCollection
            books={manifest.books}
            world={world}
            selectedBookId={selectedBookId}
            quality={quality}
            highlights={highlights}
            onSelectBook={onSelectBook}
            onHoverBook={onHoverBook}
            labelsEnabled={canvasReady}
            onLabelsReady={() => setLabelsReady(true)}
          />
          {canvasReady && (
            <Suspense fallback={null}>
              <BookMaterialAssetsReady onReady={() => setBookMaterialsReady(true)} />
            </Suspense>
          )}
        </>
      )}
      <NavigationController
        books={manifest.books}
        world={world}
        focusBook={focusedBook}
        sceneMode={sceneMode}
        onModeChange={onModeChange}
        onFocusComplete={onFocusComplete}
        onSelectBook={onSelectBook}
        interactionEnabled={interactionEnabled}
      />
      <DustField world={world} reducedMotion={reducedMotion || lowPower} quality={quality} />
      {enhancementsRequested && postProcessing && (
        <Suspense fallback={null}>
          <PostEffects quality={quality} world={world} enabled={presentationPrepared} />
        </Suspense>
      )}
      <ScenePresentation ready={fullyReady} composed={postProcessing} composedReady={presentationPrepared} onPrepared={() => setPresentationPrepared(true)} onReady={reportReady} />
    </>
  );
}

// Assemble the complete compact scene before submitting its materials to the GPU.
// Rendering every partial Suspense reveal repeatedly compiles shaders for different
// light counts. Parallel compilation keeps the loading interface responsive.
function ScenePresentation({ ready, composed, composedReady, onPrepared, onReady }: { ready: boolean; composed: boolean; composedReady: boolean; onPrepared: () => void; onReady: () => void }) {
  const { gl, scene, camera, invalidate } = useThree();
  const prepared = useRef(false);
  const displayedFrames = useRef(0);
  const [error, setError] = useState<Error>();
  const preparedCallback = useRef(onPrepared);
  preparedCallback.current = onPrepared;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // StrictMode/HMR can dispose a material while compileAsync is polling its
    // shader program. Development uses synchronous preparation; production
    // keeps parallel compilation so the loading interface stays responsive.
    const prepare = import.meta.env.DEV
      ? Promise.resolve(gl.compile(scene, camera))
      : gl.compileAsync(scene, camera);
    void prepare.then(() => {
      if (cancelled) return;
      recordRoomStage("shaders");
      prepared.current = true;
      preparedCallback.current();
      invalidate();
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return () => { cancelled = true; };
  }, [ready, composed, gl, scene, camera, invalidate]);
  useFrame(() => {
    if (!prepared.current || (composed && !composedReady)) return;
    if (!composed) gl.render(scene, camera);
    if (++displayedFrames.current === 1) onReady();
  }, composed ? 2 : 1);
  if (error) throw error;
  return null;
}

function FirstUsableFrame({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current || ++frames.current < 2) return;
    reported.current = true;
    onReady();
  });
  return null;
}

function MountedReadySignal({ onReady }: { onReady: () => void }) {
  const callback = useRef(onReady);
  callback.current = onReady;
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => callback.current());
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, []);
  return null;
}

function BookMaterialAssetsReady({ onReady }: { onReady: () => void }) {
  useTexture([
    "/worlds/assets/materials/book-leather-normal.webp",
    "/worlds/assets/materials/book-leather-roughness.webp"
  ]);
  return <MountedReadySignal onReady={onReady} />;
}

function WorldAtmosphere({ world, exposureScale }: { world: WorldDefinition; exposureScale: number }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color(world.scene.background);
    scene.fog = new THREE.Fog(world.scene.fog, world.scene.fogNear, world.scene.fogFar);
    gl.toneMappingExposure = world.scene.exposure * world.lighting.exposure * exposureScale;
    camera.far = world.cameraFar;
    camera.updateProjectionMatrix();
  }, [camera, exposureScale, gl, scene, world]);
  return null;
}

function RenderLifecycleRecovery({ onRecreate }: { onRecreate: () => void }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    let recoveryTimer = 0;
    let firstFrame = 0;
    let secondFrame = 0;
    let recreating = false;

    const resetNavigation = () => window.dispatchEvent(new Event("library:reset-navigation-input"));
    const recreate = () => {
      if (recreating) return;
      recreating = true;
      canvas.dataset.rendererStatus = "recovering";
      onRecreate();
    };
    const verifyRenderer = () => {
      resetNavigation();
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (gl.getContext().isContextLost()) recreate();
          else {
            canvas.dataset.rendererStatus = "ready";
            invalidate();
          }
        });
      });
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      resetNavigation();
      canvas.dataset.rendererStatus = "lost";
      window.clearTimeout(recoveryTimer);
      recoveryTimer = window.setTimeout(recreate, 600);
    };
    const contextRestored = () => {
      window.clearTimeout(recoveryTimer);
      canvas.dataset.rendererStatus = "restored";
      recreate();
    };
    const visibilityChanged = () => {
      if (document.hidden) resetNavigation();
      else verifyRenderer();
    };

    canvas.dataset.rendererStatus = "ready";
    canvas.addEventListener("webglcontextlost", contextLost, { passive: false });
    canvas.addEventListener("webglcontextrestored", contextRestored);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", verifyRenderer);
    window.addEventListener("pageshow", verifyRenderer);
    window.addEventListener("pagehide", resetNavigation);
    return () => {
      window.clearTimeout(recoveryTimer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", verifyRenderer);
      window.removeEventListener("pageshow", verifyRenderer);
      window.removeEventListener("pagehide", resetNavigation);
    };
  }, [gl, invalidate, onRecreate]);
  return null;
}

function SceneTelemetry({ active, bookCount, shelfCount, world, quality, qualityPreference, onDecline }: {
  active: boolean;
  bookCount: number;
  shelfCount: number;
  world: WorldDefinition;
  quality: ResolvedQuality;
  qualityPreference: QualityPreference;
  onDecline: (quality: ResolvedQuality) => void;
}) {
  const { gl, setDpr } = useThree();
  const frames = useRef(0);
  const elapsed = useRef(0);
  const frameTimes = useRef<number[]>([]);
  const skipFrame = useRef(true);
  const lowered = useRef(false);
  useEffect(() => {
    gl.domElement.dataset.sourceBooks = String(bookCount);
    gl.domElement.dataset.shelfBays = String(shelfCount);
    gl.domElement.dataset.sceneTheme = world.id;
    gl.domElement.dataset.worldLandmark = world.landmark;
    gl.domElement.dataset.quality = quality;
  }, [bookCount, gl.domElement, quality, shelfCount, world]);
  useEffect(() => {
    frames.current = 0;
    elapsed.current = 0;
    lowered.current = false;
    frameTimes.current = [];
    skipFrame.current = true;
  }, [active, quality, world.id]);
  useEffect(() => {
    const reset = () => { skipFrame.current = true; };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);
  useEffect(() => {
    for (const key of ["measuredFps", "frameP95Ms", "drawCalls", "triangles", "geometries", "textures", "shaderPrograms"]) delete gl.domElement.dataset[key];
  }, [gl, world.id]);
  useFrame((_, delta) => {
    const calls = gl.info.render.calls;
    const triangles = gl.info.render.triangles;
    gl.info.reset();
    if (!active || document.hidden) return;
    if (skipFrame.current) { skipFrame.current = false; return; }
    frames.current += 1;
    elapsed.current += delta;
    frameTimes.current.push(delta * 1000);
    if (frameTimes.current.length > 300) frameTimes.current.shift();
    if (frames.current === 1 || frames.current % 60 === 0) {
      const sorted = [...frameTimes.current].sort((a, b) => a - b);
      gl.domElement.dataset.frameP95Ms = sorted[Math.floor((sorted.length - 1) * 0.95)].toFixed(2);
      gl.domElement.dataset.drawCalls = String(calls);
      gl.domElement.dataset.drawCallsSource = "renderer-all-passes";
      gl.domElement.dataset.triangles = String(Math.round(triangles));
      gl.domElement.dataset.geometries = String(gl.info.memory.geometries);
      gl.domElement.dataset.textures = String(gl.info.memory.textures);
      gl.domElement.dataset.shaderPrograms = String(gl.info.programs?.length || 0);
    }
    if (!lowered.current && elapsed.current > 6) {
      const fps = frames.current / elapsed.current;
      gl.domElement.dataset.measuredFps = fps.toFixed(1);
      if (qualityPreference === "auto" && fps < (quality === "cinematic" ? 48 : 38)) {
        lowered.current = true;
        const next = quality === "cinematic" ? "balanced" : "lite";
        if (next === "lite") setDpr(1);
        onDecline(next);
        gl.domElement.dataset.quality = next;
      }
    }
  });
  return null;
}

function BookCollection({ books, world, selectedBookId, quality, highlights, onSelectBook, onHoverBook, labelsEnabled, onLabelsReady }: {
  books: Book[];
  world: WorldDefinition;
  selectedBookId?: string;
  quality: ResolvedQuality;
  highlights: Map<string, number>;
  onSelectBook: (book: Book) => void;
  onHoverBook: (book?: Book) => void;
  labelsEnabled: boolean;
  onLabelsReady: () => void;
}) {
  const { camera, gl } = useThree();
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const labelRef = useRef<THREE.InstancedMesh>(null);
  const [hoveredId, setHoveredId] = useState<string>();
  const outwards = useRef(new Float32Array(books.length));
  const bookPointer = useRef<{ pointerId: number; origin: { x: number; y: number } } | undefined>(undefined);
  const instanceBoundsDirty = useRef(true);
  const animationActive = useRef(true);
  const scratch = useMemo(() => ({ matrix: new THREE.Matrix4(), quaternion: new THREE.Quaternion(), euler: new THREE.Euler(), position: new THREE.Vector3(), scale: new THREE.Vector3() }), []);
  const labelAtlas = useBookLabelAtlas(books, world, labelsEnabled, gl.capabilities.maxTextureSize);
  const bodyGeometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 3, 0.08), []);
  const transforms = useMemo(() => books.map((book) => resolveBookTransform(book.placement, world)), [books, world]);

  useEffect(() => {
    outwards.current = new Float32Array(books.length);
    instanceBoundsDirty.current = true;
    animationActive.current = true;
  }, [books.length, labelAtlas, transforms]);
  useEffect(() => { animationActive.current = true; }, [highlights, hoveredId, selectedBookId]);

  useEffect(() => {
    gl.domElement.dataset.spineAtlasWorld = world.id;
    gl.domElement.dataset.spineAtlasVersion = labelAtlas ? String(labelAtlas.atlas.texture.version) : "pending";
    gl.domElement.dataset.spineAtlasPages = labelAtlas ? "1" : "0";
    gl.domElement.dataset.spineAtlasSource = labelAtlas ? String(labelAtlas.atlas.texture.userData.atlasSource || "canvas") : "pending";
    gl.domElement.dataset.spineAtlasDimensions = labelAtlas ? String(labelAtlas.atlas.texture.userData.atlasDimensions || "unknown") : "pending";
    gl.domElement.dataset.spineAtlasTileDimensions = labelAtlas ? String(labelAtlas.atlas.texture.userData.atlasTileDimensions || "unknown") : "pending";
    gl.domElement.dataset.interactiveBooks = String(books.length);
    gl.domElement.dataset.bookFrustumCulling = "disabled";
  }, [books.length, gl.domElement, labelAtlas, world]);
  useEffect(() => {
    if (labelsEnabled && labelAtlas) onLabelsReady();
  }, [labelAtlas, labelsEnabled, onLabelsReady]);

  useEffect(() => {
    const restoreAtlas = () => {
      if (!labelAtlas) return;
      labelAtlas.atlas.texture.needsUpdate = true;
      gl.domElement.dataset.spineAtlasVersion = String(labelAtlas.atlas.texture.version);
    };
    gl.domElement.addEventListener("webglcontextrestored", restoreAtlas);
    return () => gl.domElement.removeEventListener("webglcontextrestored", restoreAtlas);
  }, [gl.domElement, labelAtlas]);

  useEffect(() => {
    books.forEach((book, index) => {
      const base = new THREE.Color(world.scene.bookPalette[hashString(book.id) % world.scene.bookPalette.length]);
      const strength = highlights.get(book.id) || 0;
      if (strength) base.lerp(new THREE.Color(world.scene.secondary), 0.24 + strength * 0.46);
      bodyRef.current?.setColorAt(index, base);
    });
    if (bodyRef.current?.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
  }, [books, highlights, world]);

  useEffect(() => () => bodyGeometry.dispose(), [bodyGeometry]);

  useFrame((_, delta) => {
    if (!animationActive.current) return;
    const { matrix, quaternion, euler, position, scale } = scratch;
    let largestChange = 0;
    books.forEach((book, index) => {
      const transform = transforms[index];
      const hidden = book.id === selectedBookId;
      const targetOut = book.id === hoveredId ? 0.14 : highlights.has(book.id) ? 0.035 + (highlights.get(book.id) || 0) * 0.055 : 0;
      const previousOut = outwards.current[index] || 0;
      outwards.current[index] = THREE.MathUtils.damp(previousOut, targetOut, 10, delta);
      largestChange = Math.max(largestChange, Math.abs(outwards.current[index] - previousOut));
      position.copy(transform.position).addScaledVector(transform.front, outwards.current[index]);
      quaternion.setFromEuler(euler.set(0, transform.rotationY, ancientLean(book.id), "YXZ"));
      const visibility = hidden ? 0.0001 : 1;
      scale.set(transform.width * visibility, book.placement.height * visibility, book.placement.depth * visibility);
      matrix.compose(position, quaternion, scale);
      bodyRef.current?.setMatrixAt(index, matrix);
      position.addScaledVector(transform.front, book.placement.depth / 2 + 0.018);
      scale.set(transform.width * 0.93 * visibility, book.placement.height * 0.96 * visibility, 1);
      matrix.compose(position, quaternion, scale);
      labelRef.current?.setMatrixAt(index, matrix);
    });
    if (bodyRef.current) bodyRef.current.instanceMatrix.needsUpdate = true;
    if (labelRef.current) labelRef.current.instanceMatrix.needsUpdate = true;
    if (instanceBoundsDirty.current && bodyRef.current && labelRef.current) {
      bodyRef.current.computeBoundingBox();
      bodyRef.current.computeBoundingSphere();
      labelRef.current.computeBoundingBox();
      labelRef.current.computeBoundingSphere();
      instanceBoundsDirty.current = false;
      gl.domElement.dataset.bookBoundsWorld = world.id;
    }
    if (largestChange < 0.00002) animationActive.current = false;
  });

  const bookForEvent = (event: ThreeEvent<PointerEvent>) => {
    if (typeof event.instanceId !== "number") return undefined;
    const offset = Number(event.object.userData.bookIndexOffset || 0);
    return books[offset + event.instanceId];
  };
  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const book = bookForEvent(event);
    if (!book) return;
    setHoveredId(book.id);
    onHoverBook(book);
    document.body.style.cursor = "pointer";
  };
  const handleOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setHoveredId(undefined);
    onHoverBook(undefined);
    document.body.style.cursor = "";
  };
  useEffect(() => {
    const start = (event: PointerEvent) => {
      if (event.button !== 0) return;
      bookPointer.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY } };
      gl.domElement.dataset.bookTapStart = `${event.clientX},${event.clientY}`;
    };
    const finish = (event: PointerEvent) => {
      const pressed = bookPointer.current;
      if (!pressed || pressed.pointerId !== event.pointerId) return;
      bookPointer.current = undefined;
      if (!isTapGesture(pressed.origin, { x: event.clientX, y: event.clientY })) return;
      const rect = gl.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const targets = [labelRef.current, bodyRef.current].filter((target): target is THREE.InstancedMesh => Boolean(target));
      const hit = raycaster.intersectObjects(targets, false).find((intersection) => typeof intersection.instanceId === "number");
      const offset = Number(hit?.object.userData.bookIndexOffset || 0);
      const book = typeof hit?.instanceId === "number" ? books[offset + hit.instanceId] : undefined;
      gl.domElement.dataset.bookTapHit = book?.id || "none";
      if (book) onSelectBook(book);
    };
    const cancel = (event: PointerEvent) => {
      if (bookPointer.current?.pointerId === event.pointerId) bookPointer.current = undefined;
    };
    gl.domElement.addEventListener("pointerdown", start);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      gl.domElement.removeEventListener("pointerdown", start);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [books, camera, gl.domElement, onSelectBook]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.userData.bookIds = books.map((book) => book.id);
      bodyRef.current.userData.bookIndexOffset = 0;
    }
    if (labelRef.current) {
      labelRef.current.userData.bookIds = books.map((book) => book.id);
      labelRef.current.userData.bookIndexOffset = 0;
    }
  }, [books, labelAtlas]);

  const selectedBook = books.find((book) => book.id === selectedBookId);
  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[bodyGeometry, undefined, books.length]}
        userData={{ bookIds: books.map((book) => book.id), bookIndexOffset: 0 }}
        frustumCulled={false}
        castShadow={quality === "cinematic"}
        receiveShadow
        onPointerOver={handleOver}
        onPointerOut={handleOut}
      >
        <BookLeatherMaterial enabled={labelsEnabled} />
      </instancedMesh>
      {labelAtlas && (
        <instancedMesh
          key={`${world.id}:${books.length}`}
          ref={labelRef}
          args={[labelAtlas.geometry, labelAtlas.material, books.length]}
          userData={{ bookIds: books.map((book) => book.id), bookIndexOffset: 0 }}
          frustumCulled={false}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        />
      )}
      {selectedBook && <HeroBook book={selectedBook} world={world} materialsEnabled={labelsEnabled} />}
    </group>
  );
}

type BookLabelAtlasResources = {
  atlas: BookAtlas;
  geometry: THREE.PlaneGeometry;
  material: THREE.ShaderMaterial;
};

function useBookLabelAtlas(books: Book[], world: WorldDefinition, enabled: boolean, maxTextureSize: number) {
  const [resources, setResources] = useState<BookLabelAtlasResources>();
  useEffect(() => {
    setResources(undefined);
    if (!enabled) return;

    const { width, height, columns } = bookAtlasLayout(books.length, maxTextureSize);
    const atlas = createBookAtlas(books, world, width, height, columns);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("instanceUvOffset", new THREE.InstancedBufferAttribute(atlas.offsets, 2));
    geometry.setAttribute("instanceUvScale", new THREE.InstancedBufferAttribute(atlas.scales, 2));
    const owned = { atlas, geometry, material: createBookLabelMaterial(atlas) };
    setResources(owned);
    return () => {
      owned.atlas.texture.dispose();
      owned.geometry.dispose();
      owned.material.dispose();
    };
  }, [books, enabled, maxTextureSize, world]);
  return resources;
}

function BookLeatherMaterial({ enabled, color }: { enabled: boolean; color?: string }) {
  const fallback = color
    ? <meshPhysicalMaterial color={color} roughness={0.68} clearcoat={0.1} emissive={color} emissiveIntensity={0.05} />
    : <meshStandardMaterial vertexColors roughness={0.72} />;
  if (!enabled) return fallback;
  return <Suspense fallback={fallback}><TexturedBookLeatherMaterial color={color} /></Suspense>;
}

function TexturedBookLeatherMaterial({ color }: { color?: string }) {
  const maps = useTexture({
    normalMap: "/worlds/assets/materials/book-leather-normal.webp",
    roughnessMap: "/worlds/assets/materials/book-leather-roughness.webp"
  });
  useEffect(() => {
    for (const texture of Object.values(maps)) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
  }, [maps]);
  return color
    ? <meshPhysicalMaterial color={color} normalMap={maps.normalMap} normalScale={new THREE.Vector2(0.42, 0.42)} roughnessMap={maps.roughnessMap} roughness={0.64} clearcoat={0.18} emissive={color} emissiveIntensity={0.08} />
    : <meshPhysicalMaterial vertexColors normalMap={maps.normalMap} normalScale={new THREE.Vector2(0.34, 0.34)} roughnessMap={maps.roughnessMap} roughness={0.68} clearcoat={0.16} clearcoatRoughness={0.72} envMapIntensity={0.9} />;
}

function HeroBook({ book, world, materialsEnabled }: { book: Book; world: WorldDefinition; materialsEnabled: boolean }) {
  const group = useRef<THREE.Group>(null);
  const tooling = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => resolveBookTransform(book.placement, world), [book, world]);
  const texture = useMemo(() => createSingleSpineTexture(book, world), [book.id, world.id]);
  const leather = world.scene.bookPalette[hashString(book.id) % world.scene.bookPalette.length];
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    if (!tooling.current) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const front = book.placement.depth / 2 + 0.014;
    [-1, 1].forEach((side, index) => {
      matrix.compose(
        new THREE.Vector3(0, side * book.placement.height * 0.475, front + 0.002),
        quaternion,
        new THREE.Vector3(transform.width * 0.82, 0.022, 0.03)
      );
      tooling.current?.setMatrixAt(index, matrix);
      tooling.current?.setColorAt(index, new THREE.Color(side > 0 ? "#8d2942" : "#1c6671"));
    });
    tooling.current.instanceMatrix.needsUpdate = true;
    if (tooling.current.instanceColor) tooling.current.instanceColor.needsUpdate = true;
  }, [book, world.scene.metal, transform.width]);
  useFrame((_, delta) => {
    if (!group.current) return;
    const target = transform.position.clone().addScaledVector(transform.front, 0.29);
    group.current.position.lerp(target, 1 - Math.exp(-delta * 9));
    group.current.scale.lerp(new THREE.Vector3(1.045, 1.045, 1.045), 1 - Math.exp(-delta * 8));
  });
  return (
    <group ref={group} position={transform.position} rotation={[0, transform.rotationY, ancientLean(book.id)]}>
      <RoundedBox args={[transform.width, book.placement.height, book.placement.depth]} radius={0.024} smoothness={4} castShadow>
        <BookLeatherMaterial enabled={materialsEnabled} color={leather} />
      </RoundedBox>
      <instancedMesh ref={tooling} args={[undefined, undefined, 2]} castShadow>
        <boxGeometry />
        <meshStandardMaterial vertexColors metalness={0.62} roughness={0.34} />
      </instancedMesh>
      <mesh position={[0, 0, book.placement.depth / 2 + 0.03]}>
        <planeGeometry args={[transform.width * 0.94, book.placement.height * 0.96]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function NavigationController({ books, world, focusBook, sceneMode, onModeChange, onFocusComplete, onSelectBook, interactionEnabled }: {
  books: Book[];
  world: WorldDefinition;
  focusBook?: Book;
  sceneMode: SceneMode;
  onModeChange: (mode: SceneMode) => void;
  onFocusComplete: () => void;
  onSelectBook: (book: Book) => void;
  interactionEnabled: boolean;
}) {
  const { camera, gl, scene } = useThree();
  const arrivalYaw = () => window.matchMedia("(orientation: portrait)").matches ? world.spawn.portraitYaw ?? world.spawn.yaw : world.spawn.yaw;
  const keys = useRef(new Set<string>());
  const yaw = useRef(arrivalYaw());
  const pitch = useRef(world.spawn.pitch);
  const targetYaw = useRef(arrivalYaw());
  const targetPitch = useRef(world.spawn.pitch);
  const velocity = useRef({ x: 0, z: 0 });
  const verticalMotion = useRef<VerticalMotionState>({ height: world.motion.floorHeight, velocity: 0, grounded: true });
  const jumpQueued = useRef(false);
  const crouchOffset = useRef(0);
  const mobileInput = useRef<MovementInput>({ forward: 0, strafe: 0 });
  const dragging = useRef(false);
  const activeLookPointer = useRef<number | undefined>(undefined);
  const dragPoint = useRef<{ x: number; y: number } | undefined>(undefined);
  const modeRef = useRef(sceneMode);
  const focusRef = useRef<Book | undefined>(focusBook);
  const focusedSeconds = useRef(0);
  const completedFocus = useRef<string | undefined>(undefined);
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const resetTransientInput = useCallback(() => {
    keys.current.clear();
    velocity.current = { x: 0, z: 0 };
    dragging.current = false;
    activeLookPointer.current = undefined;
    dragPoint.current = undefined;
    jumpQueued.current = false;
    mobileInput.current = { forward: 0, strafe: 0 };
  }, []);

  useEffect(() => { modeRef.current = sceneMode; }, [sceneMode]);
  useEffect(() => { focusRef.current = focusBook; }, [focusBook]);
  useEffect(() => {
    const saved = cameraMemory.get(world.id);
    camera.position.copy(saved?.position || new THREE.Vector3(...world.spawn.position));
    camera.position.y = Math.max(world.motion.floorHeight, camera.position.y);
    yaw.current = targetYaw.current = saved?.yaw ?? arrivalYaw();
    pitch.current = targetPitch.current = saved?.pitch ?? world.spawn.pitch;
    velocity.current = { x: 0, z: 0 };
    verticalMotion.current = { height: Math.max(world.motion.floorHeight, camera.position.y), velocity: 0, grounded: camera.position.y <= world.motion.floorHeight + 0.002 };
    jumpQueued.current = false;
    crouchOffset.current = 0;
    mobileInput.current = { forward: 0, strafe: 0 };
    camera.rotation.order = "YXZ";
  }, [camera, world.id]);

  // Explicit UI commands must survive a modal disabling movement. The HTML
  // controls and R3F scene commit independently, so closing a dialog cannot be
  // relied on to reinstall scene listeners before its click handler dispatches.
  useEffect(() => {
    let mounted = true;
    const clearFocus = () => {
      const wasFocused = Boolean(focusRef.current);
      focusRef.current = undefined;
      focusedSeconds.current = 0;
      completedFocus.current = undefined;
      resetTransientInput();
      if (wasFocused) onFocusComplete();
    };
    const setMode = (mode: SceneMode) => {
      modeRef.current = mode;
      onModeChange(mode);
    };
    const enterImmersive = () => {
      if (window.matchMedia("(pointer: coarse)").matches) return;
      clearFocus();
      const direction = camera.getWorldDirection(new THREE.Vector3());
      yaw.current = targetYaw.current = Math.atan2(-direction.x, -direction.z);
      pitch.current = targetPitch.current = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
      crouchOffset.current = 0;
      const height = Math.max(world.motion.floorHeight, camera.position.y);
      camera.position.y = height;
      verticalMotion.current = { height, velocity: 0, grounded: height <= world.motion.floorHeight + 0.002 };
      const failed = () => { if (mounted) setMode("browse"); };
      try { (gl.domElement.requestPointerLock?.() as Promise<void> | undefined)?.catch(failed); }
      catch { failed(); }
    };
    const centerWorld = () => {
      clearFocus();
      document.exitPointerLock?.();
      camera.position.set(...world.spawn.position);
      camera.position.y = world.motion.floorHeight;
      yaw.current = targetYaw.current = arrivalYaw();
      pitch.current = targetPitch.current = world.spawn.pitch;
      camera.quaternion.setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, "YXZ"));
      verticalMotion.current = { height: world.motion.floorHeight, velocity: 0, grounded: true };
      crouchOffset.current = 0;
      cameraMemory.set(world.id, { position: camera.position.clone(), yaw: yaw.current, pitch: pitch.current });
      publishCameraState(gl.domElement, camera, yaw.current, pitch.current);
      setMode("browse");
    };
    const lockChange = () => {
      resetTransientInput();
      setMode(document.pointerLockElement === gl.domElement ? "immersive" : "browse");
    };
    window.addEventListener("library:enter-immersive", enterImmersive);
    window.addEventListener("library:center-room", centerWorld);
    document.addEventListener("pointerlockchange", lockChange);
    return () => {
      mounted = false;
      window.removeEventListener("library:enter-immersive", enterImmersive);
      window.removeEventListener("library:center-room", centerWorld);
      document.removeEventListener("pointerlockchange", lockChange);
    };
  }, [camera, gl.domElement, onFocusComplete, onModeChange, resetTransientInput, world]);

  useEffect(() => {
    if (!interactionEnabled) {
      resetTransientInput();
      return;
    }
    const pointerMove = (event: PointerEvent | MouseEvent) => {
      const locked = document.pointerLockElement === gl.domElement;
      if (!locked && !dragging.current) return;
      const previous = dragPoint.current;
      const deltaX = locked ? (event as MouseEvent).movementX : previous ? event.clientX - previous.x : 0;
      const deltaY = locked ? (event as MouseEvent).movementY : previous ? event.clientY - previous.y : 0;
      dragPoint.current = { x: event.clientX, y: event.clientY };
      const sensitivity = locked ? 0.00225 : 0.00265;
      targetYaw.current -= THREE.MathUtils.clamp(deltaX, -72, 72) * sensitivity;
      targetPitch.current = THREE.MathUtils.clamp(targetPitch.current - THREE.MathUtils.clamp(deltaY, -56, 56) * sensitivity, -1.02, 1.02);
      if ((Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) && focusRef.current) onFocusComplete();
    };
    const pointerDown = (event: PointerEvent) => {
      const pointerLocked = document.pointerLockElement === gl.domElement;
      if (!shouldStartLookDrag(event.button, pointerLocked)) {
        if (event.button !== 0) {
          event.preventDefault();
          resetTransientInput();
        }
        return;
      }
      dragging.current = true;
      activeLookPointer.current = event.pointerId;
      dragPoint.current = { x: event.clientX, y: event.clientY };
      gl.domElement.setPointerCapture?.(event.pointerId);
    };
    const pointerUp = (event: PointerEvent) => {
      if (activeLookPointer.current !== event.pointerId) return;
      dragging.current = false;
      activeLookPointer.current = undefined;
      dragPoint.current = undefined;
      if (gl.domElement.hasPointerCapture?.(event.pointerId)) gl.domElement.releasePointerCapture(event.pointerId);
    };
    const pointerCancel = () => resetTransientInput();
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      resetTransientInput();
    };
    const mobileMove = (event: Event) => {
      const detail = (event as CustomEvent<MovementInput>).detail;
      mobileInput.current = {
        forward: THREE.MathUtils.clamp(detail?.forward || 0, -1, 1),
        strafe: THREE.MathUtils.clamp(detail?.strafe || 0, -1, 1)
      };
      if (Math.hypot(mobileInput.current.forward, mobileInput.current.strafe) > 0.02 && focusRef.current) onFocusComplete();
    };
    const mobileJump = () => {
      if (focusRef.current) {
        onFocusComplete();
        return;
      }
      jumpQueued.current = true;
    };
    const down = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      if (event.code === "Space") {
        if (target instanceof HTMLElement && target.matches("button, a")) return;
        event.preventDefault();
        if (event.repeat) return;
        if (focusRef.current) onFocusComplete();
        else jumpQueued.current = true;
        return;
      }
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        if (focusRef.current) onFocusComplete();
      }
      if (key === "e" && document.pointerLockElement === gl.domElement) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hit = raycaster.intersectObjects(scene.children, true).find((intersection) => Boolean(intersection.object.userData.bookId || intersection.object.userData.bookIds));
        const id = hit?.object.userData.bookId || (typeof hit?.instanceId === "number" ? hit.object.userData.bookIds?.[hit.instanceId] : undefined);
        const book = booksById.get(String(id || ""));
        if (book) { document.exitPointerLock?.(); onSelectBook(book); }
      }
      keys.current.add(key);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    gl.domElement.addEventListener("pointerdown", pointerDown);
    gl.domElement.addEventListener("pointermove", pointerMove);
    gl.domElement.addEventListener("pointerup", pointerUp);
    gl.domElement.addEventListener("pointercancel", pointerCancel);
    gl.domElement.addEventListener("contextmenu", contextMenu);
    window.addEventListener("mousemove", pointerMove);
    window.addEventListener("blur", resetTransientInput);
    window.addEventListener("pagehide", resetTransientInput);
    window.addEventListener("library:reset-navigation-input", resetTransientInput);
    window.addEventListener("library:mobile-move", mobileMove);
    window.addEventListener("library:mobile-jump", mobileJump);
    document.addEventListener("visibilitychange", resetTransientInput);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      gl.domElement.removeEventListener("pointerdown", pointerDown);
      gl.domElement.removeEventListener("pointermove", pointerMove);
      gl.domElement.removeEventListener("pointerup", pointerUp);
      gl.domElement.removeEventListener("pointercancel", pointerCancel);
      gl.domElement.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("mousemove", pointerMove);
      window.removeEventListener("blur", resetTransientInput);
      window.removeEventListener("pagehide", resetTransientInput);
      window.removeEventListener("library:reset-navigation-input", resetTransientInput);
      window.removeEventListener("library:mobile-move", mobileMove);
      window.removeEventListener("library:mobile-jump", mobileJump);
      document.removeEventListener("visibilitychange", resetTransientInput);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [booksById, camera, gl.domElement, interactionEnabled, onFocusComplete, onSelectBook, resetTransientInput, scene]);

  useEffect(() => { focusedSeconds.current = 0; completedFocus.current = undefined; }, [focusBook?.id, world.id]);

  useFrame((_, delta) => {
    const activeFocus = focusRef.current;
    if (activeFocus) {
      jumpQueued.current = false;
      crouchOffset.current = 0;
      verticalMotion.current = { height: camera.position.y, velocity: 0, grounded: false };
      focusedSeconds.current += delta;
      const pose = focusPoseForBook(activeFocus, world);
      camera.position.lerp(pose.position, 1 - Math.exp(-delta * 3.2));
      camera.lookAt(pose.target);
      if (completedFocus.current !== activeFocus.id && (focusedSeconds.current > 1.05 || camera.position.distanceTo(pose.position) < 0.05)) {
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
        const direction = pose.target.clone().sub(camera.position).normalize();
        yaw.current = targetYaw.current = Math.atan2(-direction.x, -direction.z);
        pitch.current = targetPitch.current = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
        completedFocus.current = activeFocus.id;
      }
      publishCameraState(gl.domElement, camera, yaw.current, pitch.current);
      return;
    }

    const rotationSpeed = modeRef.current === "immersive" ? 18 : 12;
    yaw.current = THREE.MathUtils.lerp(yaw.current, targetYaw.current, 1 - Math.exp(-delta * rotationSpeed));
    pitch.current = THREE.MathUtils.lerp(pitch.current, targetPitch.current, 1 - Math.exp(-delta * rotationSpeed));
    camera.quaternion.setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, "YXZ"));
    const keyboardForward = (keys.current.has("w") || keys.current.has("arrowup") ? 1 : 0) - (keys.current.has("s") || keys.current.has("arrowdown") ? 1 : 0);
    const keyboardStrafe = (keys.current.has("d") || keys.current.has("arrowright") ? 1 : 0) - (keys.current.has("a") || keys.current.has("arrowleft") ? 1 : 0);
    const forwardAmount = THREE.MathUtils.clamp(keyboardForward + mobileInput.current.forward, -1, 1);
    const sideAmount = THREE.MathUtils.clamp(keyboardStrafe + mobileInput.current.strafe, -1, 1);
    const inputStrength = Math.min(1, Math.hypot(forwardAmount, sideAmount));
    const hasMovementInput = inputStrength > 0.02;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const input = movementVectorFromInput({ x: forward.x, z: forward.z }, { forward: forwardAmount, strafe: sideAmount });
    const crouching = keys.current.has("control") && verticalMotion.current.grounded;
    const speed = crouching ? world.motion.walkSpeed * 0.56 : keys.current.has("shift") ? world.motion.sprintSpeed : world.motion.walkSpeed;
    const control = verticalMotion.current.grounded ? 1 : world.motion.airControl;
    velocity.current = dampPlanarVelocity(
      velocity.current,
      { x: input.x * speed * inputStrength, z: input.z * speed * inputStrength },
      (hasMovementInput ? world.motion.acceleration : world.motion.braking) * control,
      delta
    );
    const resolved = resolvePlanarCollisions(
      { x: camera.position.x, z: camera.position.z },
      { x: camera.position.x + velocity.current.x * delta, z: camera.position.z + velocity.current.z * delta },
      world.bounds,
      world.obstacles,
      0.32,
      world.walkablePolygon
    );
    camera.position.x = resolved.x;
    camera.position.z = resolved.z;
    verticalMotion.current = stepJumpMotion(
      verticalMotion.current,
      jumpQueued.current,
      delta,
      world.motion.floorHeight,
      world.motion.jumpVelocity,
      world.motion.gravity
    );
    jumpQueued.current = false;
    crouchOffset.current = stepCrouchOffset(crouchOffset.current, crouching && verticalMotion.current.grounded, delta);
    camera.position.y = verticalMotion.current.height - crouchOffset.current;
    gl.domElement.dataset.grounded = String(verticalMotion.current.grounded);
    gl.domElement.dataset.cameraStance = crouchOffset.current > 0.04 ? "crouching" : "standing";
    gl.domElement.dataset.cameraEyeHeight = camera.position.y.toFixed(3);
    gl.domElement.dataset.standingEyeHeight = world.motion.floorHeight.toFixed(3);
    cameraMemory.set(world.id, { position: camera.position.clone(), yaw: yaw.current, pitch: pitch.current });
    publishCameraState(gl.domElement, camera, yaw.current, pitch.current);
  });
  return null;
}

function DustField({ world, reducedMotion, quality }: { world: WorldDefinition; reducedMotion: boolean; quality: ResolvedQuality }) {
  const points = useMemo(() => {
    const spaceWorld = world.exterior.kind !== "backplate";
    const count = reducedMotion ? 18 : spaceWorld ? (quality === "cinematic" ? 55 : 28) : quality === "cinematic" ? 170 : 85;
    const positions = new Float32Array(count * 3);
    const random = seededRandom(hashString(world.id));
    const width = world.bounds.maxX - world.bounds.minX;
    const depth = world.bounds.maxZ - world.bounds.minZ;
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = world.bounds.minX + random() * width;
      positions[index * 3 + 1] = 0.7 + random() * 6.2;
      positions[index * 3 + 2] = world.bounds.minZ + random() * depth;
    }
    return positions;
  }, [quality, reducedMotion, world]);
  return (
    <points>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[points, 3]} /></bufferGeometry>
      <pointsMaterial color={world.scene.paper} size={world.id === "modern" ? 0.009 : 0.016} transparent opacity={world.exterior.kind !== "backplate" ? 0.08 : world.id === "modern" ? 0.1 : 0.26} depthWrite={false} />
    </points>
  );
}

type BookAtlas = {
  columns: number;
  rows: number;
  texture: THREE.Texture;
  offsets: Float32Array;
  scales: Float32Array;
  worldId: WorldId;
};

function createBookLabelMaterial(atlas: BookAtlas) {
  return new THREE.ShaderMaterial({
    uniforms: { atlas: { value: atlas.texture } },
    vertexShader: `
      attribute vec2 instanceUvOffset;
      attribute vec2 instanceUvScale;
      varying vec2 atlasUv;
      varying vec2 atlasOffset;
      varying vec2 atlasScale;
      void main() {
        atlasOffset = instanceUvOffset;
        atlasScale = instanceUvScale;
        atlasUv = instanceUvOffset + uv * instanceUvScale;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D atlas;
      varying vec2 atlasUv;
      varying vec2 atlasOffset;
      varying vec2 atlasScale;
      void main() {
        vec2 sampleUv = atlasUv;
        if (!gl_FrontFacing) {
          sampleUv.x = atlasOffset.x + atlasScale.x - (atlasUv.x - atlasOffset.x);
        }
        gl_FragColor = texture2D(atlas, sampleUv);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide
  });
}

function createBookAtlas(books: Book[], world: WorldDefinition, width = 1024, height = 2048, columns = Math.min(40, Math.max(1, books.length))): BookAtlas {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const rows = Math.max(1, Math.ceil(books.length / columns));
  const ctx = canvas.getContext("2d")!;
  const tileWidth = width / columns;
  const tileHeight = height / rows;
  books.forEach((book, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    drawSpine(ctx, column * tileWidth, row * tileHeight, tileWidth, tileHeight, book, world);
  });
  return createBookAtlasTexture(books, world, canvas, width, height, columns);
}

function createBookAtlasTexture(
  books: Book[],
  world: WorldDefinition,
  image: HTMLCanvasElement,
  width: number,
  height: number,
  columns: number
): BookAtlas {
  const rows = Math.max(1, Math.ceil(books.length / columns));
  const offsets = new Float32Array(books.length * 2);
  const scales = new Float32Array(books.length * 2);
  books.forEach((_book, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    offsets[index * 2] = column / columns;
    offsets[index * 2 + 1] = 1 - (row + 1) / rows;
    scales[index * 2] = 1 / columns;
    scales[index * 2 + 1] = 1 / rows;
  });
  const texture = new THREE.CanvasTexture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  texture.userData.atlasDimensions = `${width}x${height}`;
  texture.userData.atlasTileDimensions = `${Math.floor(width / columns)}x${Math.floor(height / rows)}`;
  texture.userData.atlasSource = "canvas";
  return { columns, rows, texture, offsets, scales, worldId: world.id };
}

function createSingleSpineTexture(book: Book, world: WorldDefinition) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1536;
  drawSpine(canvas.getContext("2d")!, 0, 0, canvas.width, canvas.height, book, world);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function drawSpine(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, book: Book, world: WorldDefinition) {
  const leather = world.scene.bookPalette[hashString(book.id) % world.scene.bookPalette.length];
  ctx.fillStyle = leather;
  ctx.fillRect(x, y, width, height);
  const band = Math.max(4, width * 0.055);
  ctx.fillStyle = world.scene.metal;
  ctx.globalAlpha = 0.76;
  ctx.fillRect(x + width * 0.07, y, band, height);
  ctx.fillRect(x + width - width * 0.07 - band, y, band, height);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(3, 5, 7, 0.3)";
  ctx.fillRect(x + width * 0.18, y + height * 0.055, width * 0.64, height * 0.89);
  ctx.strokeStyle = world.scene.metal;
  ctx.lineWidth = Math.max(2, width * 0.02);
  ctx.strokeRect(x + width * 0.15, y + height * 0.045, width * 0.7, height * 0.91);
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(-Math.PI / 2);
  const textWidth = height * 0.76;
  const availableCrossAxis = width * 0.58;
  let size = Math.min(width * 0.28, 38);
  let lines: string[] = [];
  while (size >= 6) {
    ctx.font = `700 ${size}px "Arial Narrow", "Segoe UI", sans-serif`;
    lines = wrapText(ctx, book.title, textWidth);
    if (lines.length * size * 1.02 <= availableCrossAxis) break;
    size -= 1;
  }
  ctx.fillStyle = world.id === "modern" ? "#ffffff" : "#fff4cf";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
  ctx.shadowBlur = Math.max(1, size * 0.08);
  const lineHeight = size * 1.02;
  lines.forEach((line, index) => ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight));
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function ancientLean(id: string) {
  return ((hashString(id) % 9) - 4) * 0.006;
}

function publishCameraState(element: HTMLCanvasElement, camera: THREE.Camera, yaw: number, pitch: number) {
  element.dataset.cameraPosition = `${camera.position.x.toFixed(3)},${camera.position.y.toFixed(3)},${camera.position.z.toFixed(3)}`;
  element.dataset.cameraLook = `${yaw.toFixed(3)},${pitch.toFixed(3)}`;
  updateAmbienceListener(camera.position.x, camera.position.y, camera.position.z, yaw, pitch);
}

function seededRandom(seed: number) {
  let value = seed || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initialAutoQuality(): ResolvedQuality {
  const navigatorWithHints = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    deviceMemory?: number;
  };
  const connection = navigatorWithHints.connection;
  const constrainedNetwork = connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
  const explicitlyCapable = (navigatorWithHints.deviceMemory || 0) >= 8
    && (navigator.hardwareConcurrency || 0) >= 8
    && !window.matchMedia("(pointer: coarse)").matches;
  return !constrainedNetwork && explicitlyCapable ? "balanced" : "lite";
}
