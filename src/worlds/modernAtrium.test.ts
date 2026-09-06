import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetWorld, buildBoundaryParts } from "./AssetWorld";
import { ModernDaylightIndex } from "./ModernDaylightIndex";
import { CampusCyclorama, ModernMuseumExterior } from "./ModernExterior";
import { getWorld } from "./registry";
import { mountTestScene, sceneMeshes, sceneParts, type SceneTestHooks } from "./sceneTestUtils";

const hooks = vi.hoisted(() => ({
  effects: [] as SceneTestHooks["effects"], frames: [] as SceneTestHooks["frames"],
  textures: new Map<string, THREE.Texture>(), modelScene: undefined as THREE.Object3D | undefined
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(), useRef: (current: unknown) => ({ current }),
  useEffect: (effect: SceneTestHooks["effects"][number]) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => [initial, () => undefined],
  useCallback: (callback: unknown) => callback, useContext: () => "lite"
}));
vi.mock("@react-three/fiber", async (original) => ({
  ...await original<typeof import("@react-three/fiber")>(),
  useFrame: (frame: SceneTestHooks["frames"][number]) => { hooks.frames.push(frame); },
  useLoader: (_loader: unknown, url: string) => url.includes(".glb") ? { scene: hooks.modelScene } : textureFor(url),
  useThree: (select: (state: { gl: object }) => unknown) => select({ gl: {} })
}));
vi.mock("@react-three/drei", async (original) => ({
  ...await original<typeof import("@react-three/drei")>(),
  useTexture: (urls: Record<string, string>) => Object.fromEntries(Object.entries(urls)
    .map(([key, url]) => [key, textureFor(url)]))
}));

const world = getWorld("modern");
const cleanups: Array<() => void> = [];
function textureFor(url: string) {
  if (!hooks.textures.has(url)) hooks.textures.set(url, new THREE.Texture());
  return hooks.textures.get(url)!;
}
beforeEach(() => {
  const context = { fillRect: vi.fn(), fillText: vi.fn() };
  vi.stubGlobal("document", { createElement: (tag: string) => {
    if (tag !== "canvas") throw new Error(`Unexpected DOM element ${tag}`);
    return { width: 0, height: 0, getContext: () => context };
  } });
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  hooks.textures.forEach((texture) => texture.dispose());
  hooks.textures.clear();
  hooks.modelScene = undefined;
  vi.unstubAllGlobals();
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
function component(node: ReactNode, name: string) {
  const matches = elements(node).filter((element) => typeof element.type === "function" && element.type.name === name);
  expect(matches, `mounted ${name}`).toHaveLength(1);
  return matches[0];
}
function mount(render: () => ReactNode) {
  const scene = mountTestScene(render, hooks);
  cleanups.push(scene.dispose);
  return scene;
}

// Mount the actual sky's geometry and material directly: the shared geometry
// harness intentionally does not implement arbitrary material primitives.
function sky() {
  hooks.effects.length = hooks.frames.length = 0;
  const source = textureFor("campus under test");
  const element = CampusCyclorama({ backdrop: source });
  const nodes = elements(element);
  const geometryElement = nodes.find((node) => node.type === "sphereGeometry");
  const materialElement = nodes.find((node) => node.type === "primitive" && node.props.attach === "material");
  expect(geometryElement).toBeDefined(); expect(materialElement).toBeDefined();
  const geometry = new THREE.SphereGeometry(...geometryElement!.props.args as ConstructorParameters<typeof THREE.SphereGeometry>);
  const material = materialElement!.props.object as THREE.ShaderMaterial;
  const mesh = new THREE.Mesh(geometry, material);
  const props = element.props;
  if (Array.isArray(props.position)) mesh.position.fromArray(props.position);
  if (Array.isArray(props.rotation)) mesh.rotation.set(...props.rotation as [number, number, number]);
  if (typeof props.scale === "number") mesh.scale.setScalar(props.scale);
  else if (Array.isArray(props.scale)) mesh.scale.fromArray(props.scale);
  mesh.updateMatrixWorld(true);
  const effects = hooks.effects.map((effect) => effect());
  cleanups.push(() => { effects.forEach((dispose) => dispose?.()); geometry.dispose(); });
  return { source, mesh, material };
}

// Evaluate only the actual scalar projection/feather expressions from the GLSL.
// This guards numerical seams without pretending to execute or validate GPU
// shading. Browser captures own colour blending and shader compilation.
function skyProjection(shader: string) {
  const statements = shader.split("\n").map((line) => line.trim())
    .filter((line) => /^float\s+\w+\s*=/.test(line) || /^photograph\s*\*=/.test(line));
  expect(statements.length).toBeGreaterThanOrEqual(5);
  const sample = shader.match(/vec3 campus\s*=\s*texture2D\(sourceMap,\s*clamp\(vec2\(([^,]+),\s*([^\)]+)\)/);
  expect(sample).not.toBeNull();
  const program = statements.join("\n").replace(/\bfloat\b/g, "let")
    .replace(/length\(d\.xz\)/g, "Math.hypot(d.x, d.z)");
  const smoothstep = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // GLSL does not define atan(0, 0); returning NaN here makes a missing pole
  // guard visible instead of relying on JavaScript's more permissive atan2.
  const atan = (y: number, x: number) => x === 0 && y === 0 ? NaN : Math.atan2(y, x);
  const evaluate = new Function("d", "smoothstep", "atan", "mod", "max", `${program}
    return { u: ${sample![1]}, v: ${sample![2]}, photograph };`) as (...args: unknown[]) => { u: number; v: number; photograph: number };
  return (direction: THREE.Vector3) => evaluate(direction.clone().normalize(), smoothstep, atan,
    (a: number, b: number) => ((a % b) + b) % b, Math.max);
}

describe("Modern atrium sky", () => {
  it("covers roof and window rays from arrival and every walking corner inside the far plane", () => {
    const { mesh } = sky();
    const eyes = [world.spawn.position, [-12.18, 1.82, -8.98], [12.18, 1.82, -8.98],
      [-12.18, 1.82, 8.98], [12.18, 1.82, 8.98]];
    const jump = world.motion.jumpVelocity ** 2 / (2 * world.motion.gravity);
    for (const [x, y, z] of eyes) for (const lift of [0, jump]) {
      const eye = new THREE.Vector3(x, y + lift, z);
      const targets = [-11, -5, 0, 5, 11].flatMap((tx) => [-8, -4, 0, 4, 8].map((tz) => new THREE.Vector3(tx, 8.3, tz)));
      targets.push(eye.clone().add(new THREE.Vector3(0, 100, 0)));
      for (const tx of [-12, -6, 0, 6, 12]) for (const ty of [.8, 4, 7.35]) targets.push(new THREE.Vector3(tx, ty, -9.55));
      for (const target of targets) {
        const hit = new THREE.Raycaster(eye, target.sub(eye).normalize(), .06, world.cameraFar).intersectObject(mesh)[0];
        expect(hit, `sky from ${eye.toArray()}`).toBeDefined();
        expect(hit.distance).toBeGreaterThan(60);
        expect(hit.distance).toBeLessThan(world.cameraFar - 10);
      }
    }
  });

  it("keeps the photo upright and removes its contribution at the wrap and roof pole", () => {
    const evaluate = skyProjection(sky().material.fragmentShader);
    const west = evaluate(new THREE.Vector3(-.4, .1, -1)), east = evaluate(new THREE.Vector3(.4, .1, -1));
    expect(west.u).toBeLessThan(.5); expect(east.u).toBeGreaterThan(.5);
    expect(west.photograph).toBeGreaterThan(.99); expect(east.photograph).toBeGreaterThan(.99);
    expect(evaluate(new THREE.Vector3(0, .3, -1)).v).toBeGreaterThan(evaluate(new THREE.Vector3(0, .1, -1)).v);
    for (const direction of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1e-7, 1, 0),
      new THREE.Vector3(-1e-7, 1, 0), new THREE.Vector3(-1e-7, .3, 1), new THREE.Vector3(1e-7, .3, 1)]) {
      const value = evaluate(direction);
      expect(Object.values(value).every(Number.isFinite), `finite sky at ${direction.toArray()}`).toBe(true);
      expect(value.photograph).toBeLessThan(1e-6);
    }
  });

  it("uses one opaque inexpensive background and disposes only its owned material", () => {
    const { mesh, material, source } = sky();
    const ownDisposal = vi.fn(), sourceDisposal = vi.fn();
    material.addEventListener("dispose", ownDisposal); source.addEventListener("dispose", sourceDisposal);
    expect(material.side).toBe(THREE.BackSide); expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(false); expect(material.fog).toBe(false);
    expect(material.uniforms.sourceMap.value).toBe(source);
    expect((mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3).toBeLessThanOrEqual(4600);
    expect(hooks.frames).toHaveLength(0);
    cleanups.splice(0).forEach((cleanup) => cleanup());
    expect(ownDisposal).toHaveBeenCalledOnce(); expect(sourceDisposal).not.toHaveBeenCalled();
  });
});

describe.each(["lite", "cinematic"] as const)("%s Modern glazing ownership", (quality) => {
  it("has one coherent seven-member grid and no second boundary grid through the aperture", () => {
    const exterior = ModernMuseumExterior({ quality, reducedMotion: true, backplateUrl: world.assets.backplate! });
    const { root } = mount(() => component(exterior, "MuseumGlazing"));
    const glazing = root.getObjectByName("Daylight Index glazing")!;
    const slim = sceneParts(glazing).filter(({ box }) => {
      const size = box.getSize(new THREE.Vector3());
      return size.z < .2 && (size.x < .2 && size.y > 6 || size.y < .2 && size.x > 20);
    });
    expect(slim).toHaveLength(7);
    const vertical = slim.filter(({ box }) => box.getSize(new THREE.Vector3()).y > 6);
    expect(vertical.map(({ box }) => box.getCenter(new THREE.Vector3()).x).sort((a, b) => a - b))
      .toEqual([-8.35, -4.18, 0, 4.18, 8.35].map((x) => Math.fround(x)));
    const aperture = new THREE.Box3(new THREE.Vector3(-12, .76, -9.49), new THREE.Vector3(12, 7.37, -9.25));
    const boundaries = buildBoundaryParts(world).map(({ matrix }) => new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5),
      new THREE.Vector3(.5, .5, .5)).applyMatrix4(matrix));
    expect(boundaries.filter((box) => box.intersectsBox(aperture))).toEqual([]);
    const glass = sceneMeshes(glazing).find((mesh) => mesh.geometry instanceof THREE.PlaneGeometry)!;
    expect(glass).toBeDefined();
    expect((glass.material as THREE.MeshPhysicalMaterial).depthWrite).toBe(false);
  });

  it("keeps runtime practicals below the skylight instead of restoring inaccessible galleries", () => {
    const asset = AssetWorld({ world, quality, reducedMotion: true });
    const scene = mount(() => component(asset, "WorldPracticals"));
    expect(scene.root.getObjectByName("Daylight armillary")).toBeDefined();
    const overhead = sceneParts(scene.root).filter(({ box }) => box.max.y > 4.2);
    expect(overhead.map(({ label }) => label)).toEqual([]);
    expect(sceneMeshes(scene.root).every((mesh) => !(mesh.material instanceof THREE.MeshPhysicalMaterial)
      || mesh.material.transmission === 0)).toBe(true);
  });

  it("retires the shipped bridge, duplicate wall and old glowing ring while retaining desk and roof structure", () => {
    const bytes = readFileSync(`public/worlds/assets/models/modern-${quality}.glb`);
    const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
      nodes: Array<{ name?: string; mesh?: number; extras?: Record<string, unknown> }>;
    };
    // Names/extras come from shipped assets. Small placeholder meshes are
    // sufficient here: this tests the real loader's visibility policy, not its
    // geometry decoder, texture loading, or GPU render output.
    const original = new THREE.Group();
    for (const node of model.nodes) {
      const object = node.mesh === undefined ? new THREE.Group()
        : new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
      object.name = node.name ?? ""; object.userData = node.extras ?? {}; original.add(object);
    }
    hooks.modelScene = original;
    const invoke = (element: ReactElement<Record<string, unknown>>, overrides: Record<string, unknown> = {}) =>
      (element.type as (props: Record<string, unknown>) => ReactNode)({ ...element.props, ...overrides });
    const asset = AssetWorld({ world, quality, reducedMotion: true });
    const progressive = invoke(component(asset, "ProgressiveWorldModel"));
    const loaded = invoke(component(progressive, "WorldModel"), { quality,
      url: quality === "lite" ? world.assets.fallbackModel : world.assets.completeModel });
    const rendered = elements(loaded).find((element) => element.type === "primitive")!.props.object as THREE.Object3D;
    cleanups.push(() => {
      for (const mesh of sceneMeshes(rendered)) (mesh.material as THREE.Material).dispose();
      for (const mesh of sceneMeshes(original)) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
    });
    const retired = model.nodes.filter((node) => /^(Glass bridge|Bridge rail|North concrete datum|Cobalt index ring)/.test(node.name ?? ""));
    expect(retired.length).toBeGreaterThanOrEqual(3);
    for (const node of retired) expect(rendered.getObjectByName(node.name!)?.visible, node.name).toBe(false);
    const retained = model.nodes.filter((node) => /^(Central index desk|Skylight mullion|Skylight transom)/.test(node.name ?? ""));
    expect(retained.length).toBeGreaterThan(5);
    for (const node of retained) expect(rendered.getObjectByName(node.name!)?.visible, node.name).toBe(true);
  });
});

// Accessor bounds are the shipped geometry's full envelope. Compose every GLB
// parent and normalize quantized positions; no duplicated authoring dimensions.
function modelDeskBounds(quality: "lite" | "cinematic") {
  const bytes = readFileSync(`public/worlds/assets/models/modern-${quality}.glb`);
  const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
    scene?: number; scenes: Array<{ nodes: number[] }>;
    nodes: Array<{ name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>;
    meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
    accessors: Array<{ min: number[]; max: number[]; normalized?: boolean; componentType: number }>;
  };
  const objects = model.nodes.map((node) => {
    const object = new THREE.Object3D();
    if (node.matrix) { object.matrix.fromArray(node.matrix); object.matrixAutoUpdate = false; }
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  model.nodes.forEach((node, index) => node.children?.forEach((child) => objects[index].add(objects[child])));
  const root = new THREE.Object3D();
  model.scenes[model.scene ?? 0].nodes.forEach((index) => root.add(objects[index])); root.updateMatrixWorld(true);
  return model.nodes.flatMap((node, index) => {
    if (!/^(Central index desk|Index desk inset)$/.test(node.name ?? "") || node.mesh === undefined) return [];
    const box = new THREE.Box3();
    for (const primitive of model.meshes[node.mesh].primitives) {
      const accessor = model.accessors[primitive.attributes.POSITION];
      const divisor = !accessor.normalized ? 1 : accessor.componentType === 5122 ? 32767 : accessor.componentType === 5123 ? 65535 : NaN;
      expect(Number.isFinite(divisor)).toBe(true);
      box.union(new THREE.Box3(new THREE.Vector3(...accessor.min).divideScalar(divisor),
        new THREE.Vector3(...accessor.max).divideScalar(divisor)).applyMatrix4(objects[index].matrixWorld));
    }
    return [{ name: node.name!, box }];
  });
}

describe("Modern daylight instrument", () => {
  it.each(["lite", "cinematic"] as const)("seats on the shipped %s desk with visible dial marks", (quality) => {
    const scene = mount(() => ModernDaylightIndex({ reducedMotion: true }));
    const parts = sceneParts(scene.root);
    const drums = sceneMeshes(scene.root).filter((mesh) => mesh.geometry instanceof THREE.CylinderGeometry
      && mesh.geometry.parameters.radiusBottom > 1);
    const base = drums.map((mesh) => new THREE.Box3().setFromObject(mesh)).sort((a, b) => a.min.y - b.min.y)[0];
    const desks = modelDeskBounds(quality);
    expect(desks.length).toBe(quality === "lite" ? 1 : 2);
    const tabletop = Math.max(...desks.map(({ box }) => box.max.y));
    expect(base.min.y).toBeLessThanOrEqual(tabletop + .003);
    expect(base.max.y).toBeGreaterThan(tabletop + .02);
    if (quality === "lite") expect(base.min.y).toBeGreaterThan(tabletop - .03);
    const dial = drums.find((mesh) => (mesh.geometry as THREE.CylinderGeometry).parameters.height < .03)!;
    const dialTop = new THREE.Box3().setFromObject(dial).max.y;
    const ticks = parts.filter(({ mesh }) => mesh instanceof THREE.InstancedMesh);
    expect(ticks).toHaveLength(60);
    for (const { box } of ticks) {
      expect(box.min.y - dialTop).toBeGreaterThan(.003);
      expect(box.min.y - dialTop).toBeLessThan(.025);
    }
  });

  it("contains a full orbit in the existing blocked island without extra light or refraction passes", () => {
    const scene = mount(() => ModernDaylightIndex({ reducedMotion: false }));
    const meshes = sceneMeshes(scene.root);
    const initialMatrices = meshes.map((mesh) => mesh.matrixWorld.toArray());
    expect(meshes.length).toBeLessThanOrEqual(20);
    const triangles = meshes.reduce((count, mesh) => count + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3
      * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1), 0);
    expect(triangles).toBeLessThanOrEqual(14_500);
    const collider = world.obstacles[0];
    for (let frame = 0; frame < 340; frame++) {
      scene.step(.25, frame * .25);
      if (frame % 12) continue;
      for (const { label, box } of sceneParts(scene.root)) {
        expect(box.min.x, label).toBeGreaterThan(collider.minX); expect(box.max.x, label).toBeLessThan(collider.maxX);
        expect(box.min.z, label).toBeGreaterThan(collider.minZ); expect(box.max.z, label).toBeLessThan(collider.maxZ);
        expect(box.max.y, label).toBeLessThan(4);
      }
    }
    expect(meshes.map((mesh) => mesh.matrixWorld.toArray())).not.toEqual(initialMatrices);
    scene.root.traverse((object) => expect(object instanceof THREE.Light).toBe(false));
    expect(meshes.every((mesh) => !(mesh.material instanceof THREE.MeshPhysicalMaterial) || mesh.material.transmission === 0)).toBe(true);
  });

  it("freezes the instrument for reduced motion and releases its one generated label", () => {
    const scene = mount(() => ModernDaylightIndex({ reducedMotion: true }));
    const meshes = sceneMeshes(scene.root), before = meshes.map((mesh) => mesh.matrixWorld.toArray());
    const labels = meshes.flatMap((mesh) => {
      const map = (mesh.material as THREE.MeshBasicMaterial).map;
      return map instanceof THREE.CanvasTexture ? [map] : [];
    });
    expect(labels).toHaveLength(1);
    const dispose = vi.fn(); labels[0].addEventListener("dispose", dispose);
    expect(labels[0].image.width * labels[0].image.height).toBeLessThanOrEqual(128_000);
    scene.step(30, 30); scene.step(30, 60);
    expect(meshes.map((mesh) => mesh.matrixWorld.toArray())).toEqual(before);
    cleanups.splice(0).forEach((cleanup) => cleanup()); expect(dispose).toHaveBeenCalledOnce();
  });
});
