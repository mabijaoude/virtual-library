import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LunarExterior } from "./SpaceExteriors";
import { lunarSurfaceSampler } from "./lunarTerrain";
import { getWorld } from "./registry";
import { mountTestScene, sceneMeshes, type SceneTestHooks } from "./sceneTestUtils";

const hooks = vi.hoisted(() => ({
  effects: [] as SceneTestHooks["effects"], frames: [] as SceneTestHooks["frames"],
  textures: new Map<string, THREE.Texture>()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(), useRef: (current: unknown) => ({ current }),
  useEffect: (effect: SceneTestHooks["effects"][number]) => { hooks.effects.push(effect); }
}));
vi.mock("@react-three/fiber", async (original) => ({
  ...await original<typeof import("@react-three/fiber")>(),
  useFrame: (frame: SceneTestHooks["frames"][number]) => { hooks.frames.push(frame); },
  useThree: (select: (state: { camera: THREE.PerspectiveCamera }) => unknown) => select({ camera })
}));
vi.mock("@react-three/drei", async (original) => ({
  ...await original<typeof import("@react-three/drei")>(),
  useTexture: (urls: Record<string, string>) => Object.fromEntries(Object.entries(urls).map(([key, url]) => {
    if (!hooks.textures.has(url)) hooks.textures.set(url, new THREE.Texture());
    return [key, hooks.textures.get(url)];
  }))
}));

const camera = new THREE.PerspectiveCamera();
const world = getWorld("lunar");
const UP = new THREE.Vector3(0, 1, 0);

// Reuse the scene harness for the actual JSX meshes and instance matrices. These
// adapters add geometry props, scalar scales and two primitive types; sky points
// and lights are outside this CPU surface/contact test.
function geometryTree(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(geometryTree);
  if (!isValidElement(node)) return node;
  const props = node.props as Record<string, unknown>;
  if (typeof node.type === "function") return geometryTree((node.type as (props: Record<string, unknown>) => ReactNode)(props));
  const type = String(node.type);
  if (type === "points" || type.endsWith("Light")) return null;
  if (type === "dodecahedronGeometry" || type === "coneGeometry") {
    const Constructor = type === "dodecahedronGeometry" ? THREE.DodecahedronGeometry : THREE.ConeGeometry;
    return createElement("primitive", { object: new Constructor(...(props.args as [])), attach: "geometry" });
  }
  const replacements: Record<string, unknown> = typeof props.scale === "number"
    ? { scale: [props.scale, props.scale, props.scale] } : {};
  const children: ReactNode[] = [geometryTree(props.children as ReactNode)];
  if (props.geometry instanceof THREE.BufferGeometry) children.unshift(createElement("primitive", { object: props.geometry, attach: "geometry" }));
  return cloneElement(node as ReactElement<Record<string, unknown>>, replacements, ...children);
}

function vertex(geometry: THREE.BufferGeometry, index: number, target = new THREE.Vector3()) {
  return target.fromBufferAttribute(geometry.getAttribute("position"), index);
}

function renderedTriangles(mesh: THREE.Mesh) {
  return (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3
    * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1);
}

// Legacy cost: two displaced ground planes, the old 26/48/84 rocks (36
// triangles each), and two flat track quads. New contact shading is included.
const REPLACED_TRIANGLE_BUDGET = { lite: 17_324, balanced: 45_252, cinematic: 106_452 } as const;

describe.each(["lite", "balanced", "cinematic"] as const)("%s lunar exterior terrain", (quality) => {
  let scene: ReturnType<typeof mountTestScene>;
  let ground: THREE.Mesh<THREE.PlaneGeometry>;
  let tracks: THREE.Mesh;
  let contacts: THREE.Mesh;
  let rocks: THREE.InstancedMesh;
  let sample: ReturnType<typeof lunarSurfaceSampler>;

  beforeAll(() => {
    scene = mountTestScene(() => geometryTree(LunarExterior({ world, quality, reducedMotion: true })), hooks);
    ground = scene.root.getObjectByName("Continuous lunar ground") as typeof ground;
    tracks = scene.root.getObjectByName("Survey rover wheel trails") as THREE.Mesh;
    contacts = scene.root.getObjectByName("Regolith rock contact shading") as THREE.Mesh;
    rocks = sceneMeshes(scene.root).find((mesh) => mesh instanceof THREE.InstancedMesh
      && mesh.geometry instanceof THREE.DodecahedronGeometry) as THREE.InstancedMesh;
    expect(ground).toBeDefined();
    expect(tracks).toBeDefined();
    expect(contacts).toBeDefined();
    expect(rocks).toBeDefined();
    sample = lunarSurfaceSampler(ground.geometry);
  });
  afterAll(() => {
    scene?.dispose();
    hooks.textures.forEach((texture) => texture.dispose());
    hooks.textures.clear();
  });

  function groundRay(eye: THREE.Vector3, target: THREE.Vector3) {
    const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0.06, world.cameraFar);
    ray.layers.enableAll();
    return ray.intersectObject(ground, false)[0];
  }

  it("covers lower-window rays from the close centre, both corners and arrival", () => {
    // Window aperture from the authored shell: x ±8.2, sill top .76,
    // exterior wall face z -10.59. Include the reachable lunar jump peak.
    const jump = world.motion.jumpVelocity ** 2 / (2 * world.motion.gravity);
    for (const [x, z] of [[0, -9.78], [-7.8, -9.78], [7.8, -9.78], [3.2, 7.8]]) {
      for (const y of [1.82, 1.82 + jump]) {
        const eye = new THREE.Vector3(x, y, z);
        for (const targetX of [-8, -4, 0, 4, 8]) for (const targetY of [.8, 1.15, 1.55]) {
          const hit = groundRay(eye, new THREE.Vector3(targetX, targetY, -10.6));
          expect(hit, `visible ground from ${eye.toArray()} through ${targetX},${targetY}`).toBeDefined();
          expect(hit.point.z).toBeLessThan(-10.59);
        }
      }
    }
    // Test the formerly missing apron directly, independent of rays that could
    // skip an edge and hit more distant ground.
    for (const x of [-8.2, -4, 0, 4, 8.2]) for (const z of [-10.59, -11, -12, -14.8]) {
      const hit = groundRay(new THREE.Vector3(x, 3, z), new THREE.Vector3(x, -3, z));
      expect(hit, `ground immediately outside sill at ${x},${z}`).toBeDefined();
      expect(hit.point.y).toBeLessThan(.76);
      expect(hit.point.y).toBeGreaterThan(-2.5);
    }
    // Raising terrain to fill the gap must not hide the retained Earth.
    const earth = new THREE.Vector3(9.2, 11.7, -126);
    for (const x of [-7.8, 0, 7.8]) {
      const eye = new THREE.Vector3(x, 1.82, -9.78);
      const hit = groundRay(eye, earth);
      expect(!hit || hit.distance > eye.distanceTo(earth)).toBe(true);
    }
  });

  it("samples the actual indexed triangles on both sides of grid diagonals", () => {
    const geometry = ground.geometry, indices = geometry.getIndex()!;
    const cells = indices.count / 6;
    let maxError = 0;
    // Choose distributed cells, including the outermost faces. Expected height
    // comes from actual triangle barycentrics, not the sampler's cell formula.
    const selected = new Set([0, 1, cells - 2, cells - 1]);
    for (let i = 0; i < 120; i++) selected.add(Math.floor((i + .37) / 120 * cells));
    for (const cell of selected) for (const triangle of [0, 1]) {
      const offset = cell * 6 + triangle * 3;
      const a = vertex(geometry, indices.getX(offset));
      const b = vertex(geometry, indices.getX(offset + 1));
      const c = vertex(geometry, indices.getX(offset + 2));
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.7, .2, .1], [.1, .2, .7]]) {
        const p = a.clone().multiplyScalar(weights[0]).addScaledVector(b, weights[1]).addScaledVector(c, weights[2]);
        maxError = Math.max(maxError, Math.abs(sample(p.x, p.z) - p.y));
      }
    }
    expect(maxError).toBeLessThan(.00001);
  });

  it("has upward nondegenerate faces, finite unit normals and bounded terrain cost", () => {
    const geometry = ground.geometry, indices = geometry.getIndex()!;
    const normal = geometry.getAttribute("normal"), p = geometry.getAttribute("position");
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let minAreaY = Infinity, minNormalY = Infinity, maxNormalError = 0, farthest = 0;
    for (let i = 0; i < indices.count; i += 3) {
      vertex(geometry, indices.getX(i), a);
      vertex(geometry, indices.getX(i + 1), b).sub(a);
      vertex(geometry, indices.getX(i + 2), c).sub(a);
      minAreaY = Math.min(minAreaY, b.cross(c).dot(UP));
    }
    for (let i = 0; i < p.count; i++) {
      a.fromBufferAttribute(normal, i);
      minNormalY = Math.min(minNormalY, a.y);
      maxNormalError = Math.max(maxNormalError, Math.abs(a.length() - 1));
      farthest = Math.max(farthest, vertex(geometry, i, b).distanceTo(new THREE.Vector3(...world.spawn.position)));
    }
    expect(minAreaY).toBeGreaterThan(0);
    expect(minNormalY).toBeGreaterThan(0);
    expect(maxNormalError).toBeLessThan(.00001);
    expect(farthest).toBeLessThan(world.cameraFar - 1);
    expect([ground, rocks, tracks, contacts].reduce((total, mesh) => total + renderedTriangles(mesh), 0))
      .toBeLessThanOrEqual(REPLACED_TRIANGLE_BUDGET[quality]);
  });

  it("keeps all four rendered rover tires on the graded route", () => {
    const rover = scene.root.getObjectByName("Lunar survey rover")!;
    const wheels = sceneMeshes(rover).filter((mesh) => mesh.geometry instanceof THREE.CylinderGeometry
      && mesh.geometry.parameters.radiusTop > .3 && mesh.geometry.parameters.height < .4);
    expect(wheels).toHaveLength(4);
    const supportHeights: number[] = [];
    for (const wheel of wheels) {
      const p = wheel.geometry.getAttribute("position");
      let bottom = new THREE.Vector3(0, Infinity, 0);
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(wheel.matrixWorld);
        if (v.y < bottom.y) bottom = v;
      }
      const hit = groundRay(bottom.clone().addScaledVector(UP, 1), bottom.clone().addScaledVector(UP, -2));
      expect(hit).toBeDefined();
      // Polygonal tire tread need not contain a vertex exactly at its analytic
      // radius; allow 3 cm, while rejecting visible hovering or deep burial.
      expect(bottom.y - hit.point.y).toBeGreaterThanOrEqual(-.03);
      expect(bottom.y - hit.point.y).toBeLessThanOrEqual(.03);
      supportHeights.push(hit.point.y);
      const axle = new THREE.Vector3(0, 1, 0).transformDirection(wheel.matrixWorld);
      const chassisAcross = new THREE.Vector3(1, 0, 0).transformDirection(rover.matrixWorld);
      expect(Math.abs(axle.dot(chassisAcross))).toBeCloseTo(1, 5);
    }
    expect(Math.max(...supportHeights) - Math.min(...supportHeights)).toBeLessThan(.03);
  });

  it("conforms the actual wheel-trail vertices and triangle interiors to the surface", () => {
    const geometry = tracks.geometry, p = geometry.getAttribute("position"), index = geometry.getIndex()!;
    let minGap = Infinity, maxGap = -Infinity;
    const check = (v: THREE.Vector3) => {
      v.applyMatrix4(tracks.matrixWorld);
      const gap = v.y - sample(v.x, v.z);
      minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap);
    };
    for (let i = 0; i < p.count; i++) check(vertex(geometry, i));
    for (let i = 0; i < index.count; i += 3) {
      check(vertex(geometry, index.getX(i)).add(vertex(geometry, index.getX(i + 1)))
        .add(vertex(geometry, index.getX(i + 2))).multiplyScalar(1 / 3));
    }
    expect(minGap).toBeGreaterThanOrEqual(-.01);
    expect(maxGap).toBeLessThanOrEqual(.05);
    const material = tracks.material as THREE.MeshStandardMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.polygonOffset).toBe(true);
  });

  it("seats every rotated rock and keeps contact shading close to the terrain", () => {
    const p = rocks.geometry.getAttribute("position"), matrix = new THREE.Matrix4();
    for (let i = 0; i < rocks.count; i++) {
      rocks.getMatrixAt(i, matrix); matrix.premultiply(rocks.matrixWorld);
      let minGap = Infinity, maxGap = -Infinity;
      for (let v = 0; v < p.count; v++) {
        const point = new THREE.Vector3().fromBufferAttribute(p, v).applyMatrix4(matrix);
        const gap = point.y - sample(point.x, point.z);
        minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap);
      }
      expect(minGap, `rock ${i} has a support point`).toBeLessThanOrEqual(.001);
      expect(minGap, `rock ${i} is not deeply buried`).toBeGreaterThan(-.12);
      expect(maxGap, `rock ${i} remains visible`).toBeGreaterThan(.01);
    }
    const contactPositions = contacts.geometry.getAttribute("position");
    let maxError = 0;
    for (let i = 0; i < contactPositions.count; i++) {
      const point = vertex(contacts.geometry, i).applyMatrix4(contacts.matrixWorld);
      maxError = Math.max(maxError, Math.abs(point.y - sample(point.x, point.z) - .025));
    }
    expect(maxError).toBeLessThan(.0001);
    expect((contacts.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
  });
});
