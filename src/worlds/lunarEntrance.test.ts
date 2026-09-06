import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePlanarCollisions } from "../navigation";
import type { Book, Shelf } from "../types";
import { AssetWorld } from "./AssetWorld";
import { LunarEntrance } from "./LunarEntrance";
import { RoomDetails } from "./RoomDetails";
import { focusPoseForBook } from "./layout";
import { getWorld } from "./registry";
import { ShelfBays } from "./shared";
import { mountTestScene, sceneMeshes, sceneParts, type SceneTestHooks } from "./sceneTestUtils";
import type { ResolvedQuality } from "./types";

const hooks = vi.hoisted(() => ({
  effects: [] as SceneTestHooks["effects"], frames: [] as SceneTestHooks["frames"],
  textures: new Map<string, THREE.Texture>(), quality: "lite" as ResolvedQuality
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(), useRef: (current: unknown) => ({ current }),
  useEffect: (effect: SceneTestHooks["effects"][number]) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => [initial, () => undefined], useCallback: (callback: unknown) => callback,
  useContext: () => hooks.quality, memo: (component: unknown) => component
}));
vi.mock("@react-three/fiber", async (original) => ({
  ...await original<typeof import("@react-three/fiber")>(),
  useFrame: (frame: SceneTestHooks["frames"][number]) => { hooks.frames.push(frame); },
  useThree: (select: (state: { gl: object }) => unknown) => select({ gl: { domElement: { dataset: {} } } })
}));
vi.mock("@react-three/drei", async (original) => ({
  ...await original<typeof import("@react-three/drei")>(),
  useTexture: (urls: Record<string, string>) => Object.fromEntries(Object.entries(urls).map(([key, url]) => {
    if (!hooks.textures.has(url)) hooks.textures.set(url, new THREE.Texture());
    return [key, hooks.textures.get(url)];
  })),
  Text: () => null,
  // Full declared cushion envelopes suffice for the floor-marking regression;
  // they intentionally do not model Drei's rounded bevel tessellation.
  RoundedBox: ({ args, children, ...props }: { args: number[]; children: ReactNode }) => createElement("mesh",
    props, createElement("boxGeometry", { args }), children)
}));

const world = getWorld("lunar"), CAMERA_RADIUS = .32, EPSILON = 1e-5;
const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.stubGlobal("document", { createElement: (tag: string) => {
    if (tag !== "canvas") throw new Error(`Unexpected DOM element ${tag}`);
    return { width: 0, height: 0, getContext: () => ({ fillRect: vi.fn(), fillText: vi.fn() }) };
  } });
});
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  hooks.textures.forEach((texture) => texture.dispose()); hooks.textures.clear();
  vi.unstubAllGlobals();
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
function geometryTree(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(geometryTree);
  if (!isValidElement(node)) return node;
  const props = node.props as Record<string, unknown>;
  if (typeof node.type === "function") return geometryTree((node.type as (props: Record<string, unknown>) => ReactNode)(props));
  const children = [geometryTree(props.children as ReactNode)];
  if (props.geometry instanceof THREE.BufferGeometry) children.unshift(createElement("primitive", { object: props.geometry, attach: "geometry" }));
  const replacements = typeof props.scale === "number" ? { scale: [props.scale, props.scale, props.scale] } : {};
  return cloneElement(node as ReactElement<Record<string, unknown>>, replacements, ...children);
}
function mount(render: () => ReactNode) {
  const scene = mountTestScene(() => geometryTree(render()), hooks);
  cleanups.push(scene.dispose); return scene;
}
function overlaps(a: THREE.Box3, b: THREE.Box3) {
  return (["x", "y", "z"] as const).every((axis) => a.max[axis] > b.min[axis] + EPSILON && b.max[axis] > a.min[axis] + EPSILON);
}
function resolve(current: { x: number; z: number }, proposed = current) {
  return resolvePlanarCollisions(current, proposed, world.bounds, world.obstacles, CAMERA_RADIUS, world.walkablePolygon);
}

// Union both empty and occupied crowns/back panels from the actual shelf JSX.
// This includes the wider empty crown and every occupied shelf's rear panel.
function shelfEnvelopes(quality: ResolvedQuality) {
  const sets = [false, true].map((occupied) => mount(() => createElement("group", null,
    world.bays.map((_, bayIndex) => {
      const shelf: Shelf = { id: `neutral-${bayIndex}`, label: "Reference", sectionId: "general", sectionLabel: "General",
        bayIndex, rows: 5, slotsPerRow: 14, occupiedRows: occupied ? [0, 1, 2, 3, 4] : [] };
      return createElement("group", { key: bayIndex, name: `shelf-${bayIndex}` },
        ShelfBays({ world, quality, shelves: [shelf], materialsEnabled: false }));
    })
  )));
  return world.bays.map((bay, index) => {
    const box = new THREE.Box3();
    for (const scene of sets) box.union(new THREE.Box3().setFromObject(scene.root.getObjectByName(`shelf-${index}`)!));
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...bay.position),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bay.rotationY), new THREE.Vector3(1, 1, 1));
    const local = box.clone().applyMatrix4(matrix.clone().invert());
    const lane = new THREE.Box3(new THREE.Vector3(local.min.x, 0, local.max.z + .6),
      new THREE.Vector3(local.max.x, 2.6, local.max.z + 2.8)).applyMatrix4(matrix);
    return { index, box, lane };
  });
}

describe.each(["lite", "cinematic"] as const)("%s Lunar aft entrance", (quality) => {
  it("keeps the actual facade, full door frame and hardware clear of all nine shelf cases and service lanes", () => {
    const entrance = mount(() => LunarEntrance({ world }));
    const shelves = shelfEnvelopes(quality);
    expect(shelves).toHaveLength(9);
    for (const { label, box } of sceneParts(entrance.root)) for (const shelf of shelves) {
      expect(overlaps(box, shelf.box), `${label} / shelf ${shelf.index}`).toBe(false);
      expect(overlaps(box, shelf.lane), `${label} / shelf lane ${shelf.index}`).toBe(false);
    }
    const aft = shelves[8].box;
    const wall = sceneParts(entrance.root.getObjectByName("Continuous aft hull finish")!);
    // The overhead cornice may project forward above the crown; only finish
    // sharing the case's height needs to sit behind its back panel.
    for (const { label, box } of wall.filter(({ box }) => box.min.x < aft.max.x && box.max.x > aft.min.x
      && box.min.y < aft.max.y && box.max.y > aft.min.y)) {
      expect(box.min.z - aft.max.z, `${label} behind rear shelf`).toBeGreaterThan(.03);
    }
  });

  it("renders one entrance owner without a corridor, generic doors, or the old aft-floor stripes", () => {
    hooks.quality = quality;
    const asset = AssetWorld({ world, quality, reducedMotion: true });
    const boundary = elements(asset).filter((element) => typeof element.type === "function" && element.type.name === "WorldBoundaryIllusion");
    expect(boundary).toHaveLength(1);
    const scene = mount(() => boundary[0]);
    expect(scene.root.getObjectByName("Lunar habitat entrance")).toBeDefined();
    const entrances: THREE.Object3D[] = [];
    scene.root.traverse((object) => { if (object.name === "Lunar habitat entrance") entrances.push(object); });
    expect(entrances).toHaveLength(1);
    const entrance = entrances[0];
    expect(sceneMeshes(scene.root).every((mesh) => {
      for (let owner: THREE.Object3D | null = mesh; owner; owner = owner.parent) if (owner === entrance) return true;
      return false;
    })).toBe(true);
    scene.root.traverse((object) => expect(object instanceof THREE.Light).toBe(false));
    const details = mount(() => RoomDetails({ world, quality, reducedMotion: true }));
    expect(sceneMeshes(details.root).length).toBeGreaterThan(0);
    const aftFloor = new THREE.Box3(new THREE.Vector3(-10, -.1, 6.5), new THREE.Vector3(10, .1, 10));
    expect(sceneParts(details.root).filter(({ box }) => overlaps(box, aftFloor))).toEqual([]);
  });
});

describe("Lunar pressure-door closure", () => {
  it("covers the full hull width and ceiling seam with one consistent finish behind the rear shelf", () => {
    const scene = mount(() => LunarEntrance({ world }));
    const finish = scene.root.getObjectByName("Continuous aft hull finish")!;
    const objects = sceneMeshes(finish);
    const hitAt = (x: number, y: number) => new THREE.Raycaster(new THREE.Vector3(x, y, 8.2),
      new THREE.Vector3(0, 0, 1), .01, 3).intersectObjects(objects, false)[0];
    for (const x of [-10.53, -9.5, -7.6, -6.41, -6.4, -6.39, -5.1, -2.6, 0, 1.8, 6.2, 8.5, 10.53]) {
      for (const y of [.08, .4, 1.2, 3.2, 5.9, 6.54, 6.57]) {
        const hit = hitAt(x, y);
        expect(hit, `hull ray ${x},${y}`).toBeDefined();
        expect(hit.point.z).toBeGreaterThanOrEqual(10.04);
        expect(hit.point.z).toBeLessThan(10.18);
      }
    }
    const band = [-7.6, -7.4, -6.41, -6.4, -6.39, -5.1, -3, -2.6].map((x) => hitAt(x, 3.2));
    expect(new Set(band.map((hit) => ((hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex())).size).toBe(1);
    expect(Math.max(...band.map((hit) => hit.point.z)) - Math.min(...band.map((hit) => hit.point.z))).toBeLessThan(1e-5);
  });

  it("closes the chamfered aperture with opaque leaves, gasket and inspection ports", () => {
    const scene = mount(() => LunarEntrance({ world }));
    const meshes = sceneMeshes(scene.root);
    const doorX = world.boundary.placements[0].position[0];
    for (const dx of [-1.7, -.88, -.1, 0, .1, .88, 1.7]) for (const y of [.2, .55, 1.6, 3.15, 4.25]) {
      const hits = new THREE.Raycaster(new THREE.Vector3(doorX + dx, y, 8), new THREE.Vector3(0, 0, 1), .01, 3)
        .intersectObjects(meshes, false);
      expect(hits.length, `closed doorway ${dx},${y}`).toBeGreaterThan(0);
      expect(hits[0].point.z).toBeLessThan(10.1);
    }
    const ports = meshes.filter((mesh) => mesh.name === "Inspection port");
    expect(ports).toHaveLength(2);
    for (const mesh of meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      expect(material.transparent).toBe(false); expect(material.opacity).toBe(1);
      if (material instanceof THREE.MeshPhysicalMaterial) expect(material.transmission).toBe(0);
    }
    const leaves = meshes.filter((mesh) => mesh.name === "Sealed airlock leaf")
      .map((mesh) => new THREE.Box3().setFromObject(mesh)).sort((a, b) => a.min.x - b.min.x);
    expect(leaves).toHaveLength(2);
    expect(leaves[1].min.x - leaves[0].max.x).toBeGreaterThan(.01);
    expect(leaves[1].min.x - leaves[0].max.x).toBeLessThan(.1);
  });

  it("stops approaching cameras ahead of all projecting hardware while preserving spawn and shelf focus", () => {
    const scene = mount(() => LunarEntrance({ world }));
    const doorX = world.boundary.placements[0].position[0];
    const collider = world.obstacles.find((rect) => rect.minX < doorX && rect.maxX > doorX && rect.minZ > 8);
    expect(collider).toBeDefined();
    for (const { label, box } of sceneParts(scene.root)) {
      if (box.min.y > 2.6 || box.min.z >= world.bounds.maxZ) continue;
      expect(box.min.x, label).toBeGreaterThanOrEqual(collider!.minX - EPSILON);
      expect(box.max.x, label).toBeLessThanOrEqual(collider!.maxX + EPSILON);
      expect(box.min.z, label).toBeGreaterThanOrEqual(collider!.minZ - EPSILON);
      expect(box.max.z, label).toBeLessThanOrEqual(collider!.maxZ + EPSILON);
    }
    for (const x of [2, 3.12, 4, 4.88, 6]) {
      let point = { x, z: 7.8 };
      for (let i = 0; i < 80; i++) point = resolve(point, { x, z: point.z + .05 });
      expect(point.z + CAMERA_RADIUS).toBeLessThanOrEqual(collider!.minZ + EPSILON);
      expect(point.z).toBeGreaterThan(8.9);
    }
    const spawn = { x: world.spawn.position[0], z: world.spawn.position[2] };
    expect(resolve(spawn)).toEqual(spawn);
    for (let bay = 0; bay < 9; bay++) for (const slot of [0, 6, 13]) {
      const pose = focusPoseForBook({ id: `neutral-${bay}-${slot}`, placement: { documentId: `neutral-${bay}-${slot}`,
        shelfId: "reference", bay, row: 2, slot, width: .17, height: .94, depth: .43, accentColor: "#777777",
        shelfSectionId: "general", importanceScore: 1 } } as Book, world);
      const point = { x: pose.position.x, z: pose.position.z };
      expect(resolve(point), `shelf focus ${bay},${slot}`).toEqual(point);
    }
  });

  it("keeps the static assembly inexpensive, finite and free of extra lighting passes", () => {
    const scene = mount(() => LunarEntrance({ world }));
    const meshes = sceneMeshes(scene.root);
    expect(meshes.length).toBeLessThanOrEqual(22);
    let triangles = 0;
    for (const mesh of meshes) {
      const p = mesh.geometry.getAttribute("position");
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
      triangles += (mesh.geometry.index?.count ?? p.count) / 3 * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1);
    }
    expect(triangles).toBeLessThanOrEqual(4_000);
    expect(hooks.frames).toHaveLength(0);
    scene.root.traverse((object) => expect(object instanceof THREE.Light).toBe(false));
    expect(hooks.textures.size).toBe(0);
  });

  it("releases its two generated geometries and one bounded identification texture", () => {
    hooks.effects.length = hooks.frames.length = 0;
    const nodes = elements(LunarEntrance({ world }));
    const geometries = new Set(nodes.map((node) => node.props.geometry).filter((geometry): geometry is THREE.BufferGeometry => geometry instanceof THREE.BufferGeometry));
    const textures = nodes.map((node) => node.props.map).filter((texture): texture is THREE.CanvasTexture => texture instanceof THREE.CanvasTexture);
    expect(geometries.size).toBe(2); expect(textures).toHaveLength(1);
    expect(textures[0].image.width * textures[0].image.height).toBeLessThanOrEqual(262_144);
    const released = [...geometries, ...textures].map((resource) => {
      const dispose = vi.fn(); resource.addEventListener("dispose", dispose); return dispose;
    });
    const effects = hooks.effects.map((effect) => effect());
    cleanups.push(() => effects.forEach((dispose) => dispose?.()));
    cleanups.splice(0).forEach((dispose) => dispose());
    for (const dispose of released) expect(dispose).toHaveBeenCalledOnce();
  });
});
