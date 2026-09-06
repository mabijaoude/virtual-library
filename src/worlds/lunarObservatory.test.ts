import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LunarEarthwatchProjection } from "./AssetWorld";
import { RoomDetails } from "./RoomDetails";
import { createStarField, LunarExterior } from "./SpaceExteriors";
import { getWorld } from "./registry";
import { getShelfKitDimensions } from "./shared";
import { mountTestScene, sceneMeshes, sceneParts, type SceneTestHooks } from "./sceneTestUtils";
import type { ResolvedQuality } from "./types";

const hooks = vi.hoisted(() => ({
  effects: [] as SceneTestHooks["effects"], frames: [] as SceneTestHooks["frames"],
  textures: new Map<string, THREE.Texture>()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(), useRef: (current: unknown) => ({ current }),
  useEffect: (effect: SceneTestHooks["effects"][number]) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: SceneTestHooks["effects"][number]) => { hooks.effects.push(effect); },
  useImperativeHandle: () => undefined
}));
vi.mock("@react-three/fiber", async (original) => ({
  ...await original<typeof import("@react-three/fiber")>(),
  useFrame: (frame: SceneTestHooks["frames"][number]) => { hooks.frames.push(frame); },
  useThree: (select: (state: { camera: THREE.PerspectiveCamera }) => unknown) => select({ camera })
}));
vi.mock("@react-three/drei", async (original) => ({
  ...await original<typeof import("@react-three/drei")>(),
  useTexture: (urls: string | Record<string, string>) => typeof urls === "string" ? textureFor(urls)
    : Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, textureFor(url)])),
  // The declared RoundedBox dimensions are a conservative full envelope for
  // clearance checks. Browser QA owns its bevel/crease appearance.
  RoundedBox: ({ args, children, ...props }: { args: number[]; children: ReactNode }) => createElement("mesh",
    { ...props, userData: { roundedEnvelope: true } }, createElement("boxGeometry", { args }), children)
}));

const camera = new THREE.PerspectiveCamera();
const world = getWorld("lunar");
const cleanups: Array<() => void> = [];
function textureFor(url: string) {
  if (!hooks.textures.has(url)) hooks.textures.set(url, new THREE.Texture());
  return hooks.textures.get(url)!;
}
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  hooks.textures.forEach((texture) => texture.dispose());
  hooks.textures.clear();
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

function runtimeStars(quality: ResolvedQuality) {
  hooks.effects.length = hooks.frames.length = 0;
  const element = LunarExterior({ world, quality, reducedMotion: true });
  const points = elements(element).filter((node) => node.type === "points");
  expect(points).toHaveLength(1);
  const geometry = points[0].props.geometry as THREE.BufferGeometry;
  const disposals = hooks.effects.map((effect) => effect());
  cleanups.push(() => disposals.forEach((dispose) => dispose?.()));
  return geometry;
}

// Mount the actual furnishing/projection JSX, with full rounded-chair envelopes.
// The shared harness needs ring/cone geometry and scalar-scale adapters here.
function geometryTree(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(geometryTree);
  if (!isValidElement(node)) return node;
  const props = node.props as Record<string, unknown>;
  if (typeof node.type === "function") return geometryTree((node.type as (props: Record<string, unknown>) => ReactNode)(props));
  const type = String(node.type);
  const constructors = { ringGeometry: THREE.RingGeometry, coneGeometry: THREE.ConeGeometry };
  if (type in constructors) {
    const Constructor = constructors[type as keyof typeof constructors] as unknown as new (...args: unknown[]) => THREE.BufferGeometry;
    const geometry = new Constructor(...(props.args as unknown[]));
    if (props.ref) (props.ref as { current: THREE.BufferGeometry }).current = geometry;
    return createElement("primitive", { object: geometry, attach: "geometry" });
  }
  const replacements = typeof props.scale === "number" ? { scale: [props.scale, props.scale, props.scale] } : {};
  return cloneElement(node as ReactElement<Record<string, unknown>>, replacements, geometryTree(props.children as ReactNode));
}

function mountObservatory(quality: ResolvedQuality, reducedMotion = true) {
  const scene = mountTestScene(() => geometryTree(createElement("group", null,
    createElement("group", { name: "Furnishings under test" }, RoomDetails({ world, quality, reducedMotion })),
    createElement("group", { name: "Projection under test" }, LunarEarthwatchProjection({ reducedMotion }))
  )), hooks);
  cleanups.push(scene.dispose);
  return scene;
}

describe.each(["lite", "balanced", "cinematic"] as const)("%s Lunar observation sky", (quality) => {
  it("covers corner and elevated angular views without a central rectangular boundary", () => {
    const geometry = runtimeStars(quality), positions = geometry.getAttribute("position");
    const azimuths = [-88, -60, -30, 0, 30, 60, 88];
    const elevations = [0, 15, 35, 65, 80];
    for (const origin of [[0, 1.82, -9.78], [-7.8, 1.82, -9.78], [7.8, 1.82, -9.78], [3.2, 1.82, 7.8]]) {
      const eye = new THREE.Vector3(...origin);
      const sectors = Array.from({ length: 6 }, () => [0, 0, 0, 0]);
      let closest = Infinity, farthest = 0;
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(positions, i).sub(eye);
        closest = Math.min(closest, p.length()); farthest = Math.max(farthest, p.length());
        const azimuth = THREE.MathUtils.radToDeg(Math.atan2(p.x, -p.z));
        const elevation = THREE.MathUtils.radToDeg(Math.atan2(p.y, Math.hypot(p.x, p.z)));
        const column = azimuths.findIndex((edge, index) => index < 6 && azimuth >= edge && azimuth < azimuths[index + 1]);
        const row = elevations.findIndex((edge, index) => index < 4 && elevation >= edge && elevation < elevations[index + 1]);
        if (column >= 0 && row >= 0) sectors[column][row]++;
      }
      for (let column = 0; column < 6; column++) for (let row = 0; row < 4; row++) {
        expect(sectors[column][row], `sky sector ${column},${row} from ${origin}`).toBeGreaterThanOrEqual(row === 3 ? 2 : 8);
      }
      expect(closest).toBeGreaterThan(480);
      expect(farthest).toBeLessThan(world.cameraFar - 50);
    }
  });

  it("keeps the displayed starfield deterministic and within a small point budget", () => {
    const actual = runtimeStars(quality), count = actual.getAttribute("position").count;
    const seed = world.exterior.kind === "lunar" ? world.exterior.starSeed : 0;
    const repeated = createStarField(seed, count, true).geometry;
    const different = createStarField(seed + 1, count, true).geometry;
    cleanups.push(() => repeated.dispose(), () => different.dispose());
    expect(count).toBeLessThanOrEqual({ lite: 1100, balanced: 2000, cinematic: 3500 }[quality]);
    for (const attribute of ["position", "color"]) {
      expect(actual.getAttribute(attribute).array).toEqual(repeated.getAttribute(attribute).array);
    }
    expect(actual.getAttribute("position").array).not.toEqual(different.getAttribute("position").array);
  });
});

describe.each(["lite", "cinematic"] as const)("%s Lunar observatory furniture", (quality) => {
  it("faces the actual chairs toward the window while keeping table and shelf approaches clear", () => {
    const { root } = mountObservatory(quality);
    const chairs: THREE.Group[] = [];
    root.traverse((object) => {
      if (object instanceof THREE.Group && object.children.filter((child) => child instanceof THREE.Mesh
        && child.userData.roundedEnvelope).length === 2) chairs.push(object);
    });
    expect(chairs).toHaveLength(2);
    // The unchanged authored research tabletop, including its actual depth.
    const table = new THREE.Box3(new THREE.Vector3(-1.5, .70, -.475), new THREE.Vector3(1.5, .86, .875));
    const lanes = world.bays.map((bay) => {
      const dimensions = getShelfKitDimensions(world, bay.width);
      const front = Math.max((dimensions.shelfDepth + .2) / 2, .65);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...bay.position),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bay.rotationY), new THREE.Vector3(1, 1, 1));
      return new THREE.Box3(new THREE.Vector3(-(bay.width + .7) / 2, 0, front + .6),
        new THREE.Vector3((bay.width + .7) / 2, 2.6, front + 2.8)).applyMatrix4(matrix).expandByScalar(.35);
    });
    for (const chair of chairs) {
      const cushions = chair.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh
        && child.userData.roundedEnvelope).map((mesh) => {
          mesh.geometry.computeBoundingBox();
          return { mesh, height: mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).y };
        }).sort((a, b) => a.height - b.height);
      const seat = cushions[0].mesh.getWorldPosition(new THREE.Vector3());
      const back = cushions[1].mesh.getWorldPosition(new THREE.Vector3());
      const forward = seat.clone().sub(back).setY(0).normalize();
      const window = new THREE.Vector3(0, 0, -10.42).sub(seat).setY(0).normalize();
      expect(forward.dot(window)).toBeGreaterThan(.97);
      const box = new THREE.Box3().setFromObject(chair);
      expect(box.intersectsBox(table)).toBe(false);
      expect(box.min.z - table.max.z).toBeGreaterThan(.3);
      for (const lane of lanes) expect(box.intersectsBox(lane)).toBe(false);
      expect(box.min.y).toBeGreaterThanOrEqual(-.001);
    }
    expect(new THREE.Box3().setFromObject(chairs[0]).intersectsBox(new THREE.Box3().setFromObject(chairs[1]))).toBe(false);
  });

  it("keeps solid furniture out of the animated holographic globe", () => {
    const scene = mountObservatory(quality, false);
    const projection = scene.root.getObjectByName("Projection under test")!;
    const globes = sceneMeshes(projection).filter((mesh) => mesh.geometry instanceof THREE.SphereGeometry
      && mesh.geometry.parameters.radius > .3 && !(mesh.material as THREE.MeshBasicMaterial).wireframe);
    expect(globes).toHaveLength(1);
    const globe = globes[0];
    globe.geometry.computeBoundingSphere();
    for (const elapsed of [0, 3, 12, 40]) {
      scene.step(.25, elapsed);
      const volume = globe.geometry.boundingSphere!.clone().applyMatrix4(globe.matrixWorld);
      const opaque = sceneParts(scene.root).filter(({ mesh }) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .some((material) => material.visible && material.opacity > 0 && (!material.transparent || material.opacity >= .999)));
      const obstructions = opaque.filter(({ box }) => box.intersectsSphere(volume));
      expect(obstructions.map(({ label }) => label), `opaque geometry through hologram at ${elapsed}s`).toEqual([]);
      // Negative control: the former signal slab must be detected by this
      // geometry guard, independent of its component name or rendering order.
      expect(new THREE.Box3(new THREE.Vector3(-1.175, 1.03, .16), new THREE.Vector3(1.175, 1.53, .24))
        .intersectsSphere(volume)).toBe(true);
    }
  });
});
