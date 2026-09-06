import { isValidElement, type ReactNode } from "react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlanarCollisions } from "../navigation";
import { AssetWorld } from "./AssetWorld";
import RenaissanceWorld from "./renaissance";
import { RENAISSANCE_GARDEN } from "./renaissanceGardenDesign";
import { getShelfKitDimensions } from "./shared";
import { getShelfTop } from "./layout";
import { getWorld } from "./registry";
import { mountTestScene, sceneMeshes, sceneParts, type SceneTestHooks } from "./sceneTestUtils";
import type { ResolvedQuality } from "./types";

const hooks = vi.hoisted(() => ({
  effects: [] as SceneTestHooks["effects"], frames: [] as SceneTestHooks["frames"],
  requests: [] as string[], textures: new Map<string, THREE.Texture>()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(), useRef: (current: unknown) => ({ current }),
  useEffect: (effect: SceneTestHooks["effects"][number]) => { hooks.effects.push(effect); }
}));
vi.mock("@react-three/fiber", async (original) => ({
  ...await original<typeof import("@react-three/fiber")>(),
  useFrame: (frame: SceneTestHooks["frames"][number]) => { hooks.frames.push(frame); },
  useLoader: (_loader: unknown, url: string) => textureFor(url)
}));
vi.mock("@react-three/drei", async (original) => ({
  ...await original<typeof import("@react-three/drei")>(),
  useTexture: (urls: Record<string, string>) => Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, textureFor(url)]))
}));

const EPSILON = 0.0001;
const CAMERA_RADIUS = 0.32;
const world = getWorld("renaissance");
const mounted: ReturnType<typeof mountTestScene>[] = [];

function textureFor(url: string) {
  hooks.requests.push(url);
  if (!hooks.textures.has(url)) {
    const texture = new THREE.Texture();
    // Shared runtime textures deliberately have a nondefault UV transform.
    // An exterior must not overwrite another surface's mapping.
    texture.repeat.set(1.7, 2.3);
    texture.offset.set(0.125, 0.0625);
    texture.rotation = 0.08;
    texture.colorSpace = url.endsWith("normal.webp") ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    hooks.textures.set(url, texture);
  }
  return hooks.textures.get(url)!;
}

function mountGarden(quality: ResolvedQuality = "lite") {
  const element = RenaissanceWorld({ quality, reducedMotion: true });
  expect(element.type).toBe(AssetWorld);
  const exterior = (element.props as { exterior: ReactNode }).exterior;
  expect(isValidElement(exterior)).toBe(true);
  const scene = mountTestScene(() => exterior, hooks);
  mounted.push(scene);
  const garden = scene.root.getObjectByName("Renaissance terraced garden")!;
  const gallery = scene.root.getObjectByName("Three studies in stone and bronze")!;
  expect(garden).toBeDefined();
  expect(gallery).toBeDefined();
  return { ...scene, garden, gallery };
}

afterEach(() => {
  mounted.splice(0).forEach((scene) => scene.dispose());
  hooks.textures.forEach((texture) => texture.dispose());
  hooks.textures.clear();
  hooks.requests.length = 0;
});

function overlaps(a: THREE.Box3, b: THREE.Box3) {
  return (["x", "y", "z"] as const).every((axis) => a.max[axis] > b.min[axis] + EPSILON && b.max[axis] > a.min[axis] + EPSILON);
}

function shelfBoxes() {
  return world.bays.flatMap((bay, index) => {
    const { shelfDepth } = getShelfKitDimensions(world, bay.width);
    const halfWidth = (bay.width + 0.7) / 2;
    const front = Math.max((shelfDepth + 0.2) / 2, 0.37 + 0.43 / 2 + 0.03);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...bay.position),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bay.rotationY), new THREE.Vector3(1, 1, 1));
    return [
      { label: `bay ${index} complete crown, case and book labels`, box: new THREE.Box3(
        new THREE.Vector3(-halfWidth, 0, -shelfDepth / 2 - 0.105), new THREE.Vector3(halfWidth, getShelfTop(world) + 0.6, front)).applyMatrix4(matrix) },
      { label: `bay ${index} full browsing lane`, box: new THREE.Box3(
        new THREE.Vector3(-halfWidth, 0, front + 0.6), new THREE.Vector3(halfWidth, getShelfTop(world), front + 2.8)).applyMatrix4(matrix) }
    ];
  });
}

function backdropIn(root: THREE.Object3D) {
  const matches = sceneMeshes(root).filter((mesh) => mesh.material instanceof THREE.MeshBasicMaterial
    && mesh.material.map && mesh.material.side === THREE.BackSide);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe.each(["lite", "cinematic"] as const)("%s Renaissance garden and gallery", (quality) => {
  it("replaces the old nearby image with one distant exterior and reuses only existing image URLs", () => {
    const { garden } = mountGarden(quality);
    const backdrop = backdropIn(garden);
    const material = backdrop.material as THREE.MeshBasicMaterial;
    expect(material.fog).toBe(false);
    expect(material.map).not.toBe(hooks.textures.get(world.assets.backplate!));
    expect(material.map!.repeat.toArray()).toEqual([1, 1]);
    expect(material.map!.offset.toArray()).toEqual([0, 0]);
    expect(material.map!.rotation).toBe(0);
    expect([...new Set(hooks.requests)].sort()).toEqual([
      world.assets.backplate!, "/worlds/assets/materials/marble-color.webp", "/worlds/assets/materials/marble-normal.webp"
    ].sort());
    const landscapeMeshes = sceneMeshes(garden).filter((mesh) => mesh.material instanceof THREE.MeshBasicMaterial
      && mesh.material.map && !(mesh.material.map instanceof THREE.DataTexture));
    const terrain = garden.getObjectByName("Rolling garden ground") as THREE.Mesh;
    expect(landscapeMeshes.map((mesh) => mesh.uuid).sort()).toEqual([backdrop.uuid, terrain.uuid].sort());
    expect((terrain.material as THREE.MeshBasicMaterial).map === material.map).toBe(true);
    expect((terrain.material as THREE.MeshBasicMaterial).side).toBe(THREE.FrontSide);
    for (const texture of hooks.textures.values()) {
      expect(texture.repeat.toArray()).toEqual([1.7, 2.3]);
      expect(texture.offset.toArray()).toEqual([0.125, 0.0625]);
      expect(texture.rotation).toBe(0.08);
    }
    const marble = hooks.textures.get("/worlds/assets/materials/marble-color.webp")!;
    const normal = hooks.textures.get("/worlds/assets/materials/marble-normal.webp")!;
    expect(marble.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(normal.colorSpace).toBe(THREE.NoColorSpace);
    // Color-space changes must reupload eagerly initialized GPU textures once,
    // despite the garden and gallery sharing this hook and the same maps.
    expect(marble.version).toBe(1);
    expect(normal.version).toBe(1);
  });

  it("keeps every outdoor solid beyond the stone returns and the whole backdrop inside camera reach", () => {
    const { garden } = mountGarden(quality);
    const backdrop = backdropIn(garden);
    for (const part of sceneParts(garden)) if (part.mesh !== backdrop) {
      expect(part.box.max.z, part.label).toBeLessThan(RENAISSANCE_GARDEN.window.outerZ - 0.01);
    }
    const positions = backdrop.geometry.getAttribute("position");
    const eyes = [new THREE.Vector3(...world.spawn.position), ...[-10.48, 10.48].flatMap((x) =>
      [-10.48, 10.48].map((z) => new THREE.Vector3(x, 2.8, z)))];
    for (let i = 0; i < positions.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(backdrop.matrixWorld);
      for (const eye of eyes) expect(eye.distanceTo(vertex)).toBeLessThan(world.cameraFar - 0.5);
    }
  });

  it("preserves actual near, middle and far parallax through the open window", () => {
    const { garden } = mountGarden(quality);
    const grove = sceneParts(garden).filter((part) => part.mesh.name === "Cypress grove");
    expect(grove).toHaveLength(8);
    const near = grove.find((part) => Math.abs(new THREE.Vector3().setFromMatrixPosition(part.matrix).z + 16.6) < EPSILON)!.box.getCenter(new THREE.Vector3());
    const middle = grove.find((part) => Math.abs(new THREE.Vector3().setFromMatrixPosition(part.matrix).z + 32.4) < EPSILON)!.box.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.82, -8.8), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(backdropIn(garden), false)[0];
    expect(hit).toBeDefined();
    const targets = [near, middle, hit.point];
    const eyes = [-1, 1].map((x) => new THREE.Vector3(x, 1.82, -8.8));
    const aperture = RENAISSANCE_GARDEN.window;
    for (const eye of eyes) {
      const planar = { x: eye.x, z: eye.z };
      expect(resolvePlanarCollisions(planar, planar, world.bounds, world.obstacles, CAMERA_RADIUS)).toEqual(planar);
      for (const target of targets) {
        const t = (aperture.outerZ - eye.z) / (target.z - eye.z);
        const passage = eye.clone().lerp(target, t);
        expect(passage.x).toBeGreaterThan(aperture.minX);
        expect(passage.x).toBeLessThan(aperture.maxX);
        expect(passage.y).toBeGreaterThan(aperture.bottom);
        expect(passage.y).toBeLessThan(aperture.top);
      }
    }
    const shifts = targets.map((target) => Math.abs(Math.atan2(target.x - eyes[0].x, eyes[0].z - target.z)
      - Math.atan2(target.x - eyes[1].x, eyes[1].z - target.z)));
    expect(shifts[0]).toBeGreaterThan(shifts[1] * 1.5);
    expect(shifts[1]).toBeGreaterThan(shifts[2] * 1.5);
    expect(shifts[0]).toBeGreaterThan(0.1);
  });

  it("covers close and oblique window rays with a continuous distant sky", () => {
    const { garden } = mountGarden(quality);
    const backdrop = backdropIn(garden);
    const aperture = RENAISSANCE_GARDEN.window;
    const eyes = [new THREE.Vector3(0, 1.82, -8.8),
      new THREE.Vector3(-4.7, 1.82, -10.4), new THREE.Vector3(4.7, 2.78, -10.4)];
    for (const eye of eyes) for (const x of [-5.16, -2.58, 0, 2.58, 5.16]) {
      for (const y of [aperture.bottom + 0.04, 2.3, 4.2, aperture.top - 0.04]) {
        const direction = new THREE.Vector3(x, y, aperture.outerZ).sub(eye).normalize();
        const hit = new THREE.Raycaster(eye, direction, 0, world.cameraFar).intersectObject(backdrop, false)[0];
        expect(hit, `open-window sky from ${eye.toArray()} through ${x},${y}`).toBeDefined();
        expect(hit.distance).toBeGreaterThan(30);
        expect(hit.uv?.toArray().every(Number.isFinite)).toBe(true);
      }
    }
    const panorama = RENAISSANCE_GARDEN.backdrop;
    // Match the reused 3840 by 2160 photo's proportions near the horizon.
    const mappedAspect = Math.PI * panorama.radius / panorama.height;
    expect(Math.abs(mappedAspect / (3840 / 2160) - 1)).toBeLessThan(0.08);
    const texture = (backdrop.material as THREE.MeshBasicMaterial).map!;
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    const horizontalUv = [-0.35, 0.35].map((x) => new THREE.Raycaster(new THREE.Vector3(0, 1.82, -8.8),
      new THREE.Vector3(x, 0, -1).normalize()).intersectObject(backdrop, false)[0].uv!.x);
    expect(horizontalUv[0]).toBeLessThan(horizontalUv[1]);
  });

  it("grounds the cypress trunks, low beds and balustrade instead of leaving air under their bases", () => {
    const { garden } = mountGarden(quality);
    const parts = sceneParts(garden);
    const supportingMeshes = sceneMeshes(garden).filter((mesh) => ["BoxGeometry", "PlaneGeometry"].includes(mesh.geometry.type));
    const supportsAt = (x: number, z: number, maxY: number) => new THREE.Raycaster(
      new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0)).intersectObjects(supportingMeshes, false)
      .filter((hit) => hit.point.y <= maxY + EPSILON).map((hit) => hit.point.y);
    const trunks = parts.filter((part) => part.mesh.geometry instanceof THREE.CylinderGeometry && part.mesh.geometry.parameters.radiusTop === 1);
    expect(trunks).toHaveLength(8);
    for (const part of [...trunks, ...parts.filter((part) => part.mesh.name === "Garden balustrade spindles")]) {
      const center = part.box.getCenter(new THREE.Vector3());
      const surfaces = supportsAt(center.x, center.z, 0.2);
      expect(surfaces.length, part.label).toBeGreaterThan(0);
      const support = Math.max(...surfaces);
      expect(part.box.min.y, part.label).toBeLessThanOrEqual(support + 0.002);
      expect(part.box.max.y, part.label).toBeGreaterThan(support + 0.1);
    }
    const terrain = sceneMeshes(garden).find((mesh) => mesh.geometry instanceof THREE.PlaneGeometry)!;
    const terrainY = terrain.getWorldPosition(new THREE.Vector3()).y;
    for (const part of parts.filter((part) => part.mesh.geometry instanceof THREE.BoxGeometry
      && part.box.getCenter(new THREE.Vector3()).z < -25.5 && part.box.min.y < 0.1)) {
      expect(part.box.min.y, `garden bed/path contact: ${part.label}`).toBeLessThanOrEqual(terrainY + 0.002);
    }
    for (const part of parts.filter((part) => part.mesh.geometry instanceof THREE.BoxGeometry
      && part.box.min.z < -21.8 && part.box.max.z > -21.8 && part.box.min.y > -0.2 && part.box.min.y < 0)) {
      expect(part.box.min.y, `balustrade foot: ${part.label}`).toBeLessThanOrEqual(RENAISSANCE_GARDEN.terrace.top + 0.002);
    }
  });

  it("covers oblique lower-window views with irregular terrain while keeping the formal garden level", () => {
    const { garden } = mountGarden(quality);
    const terrain = garden.getObjectByName("Rolling garden ground") as THREE.Mesh;
    expect(terrain).toBeDefined();
    const groundAt = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 6, z),
      new THREE.Vector3(0, -1, 0)).intersectObject(terrain, false)[0];
    for (const x of [-11, -7.1, 0, 7.1, 11]) for (const z of [-16, -28.5, -36.5]) {
      expect(groundAt(x, z)?.point.y).toBeCloseTo(-0.61, 3);
    }
    const skyline = [-60, -45, -25, 25, 45, 60].map((x) => {
      const z = RENAISSANCE_GARDEN.backdrop.centerZ - Math.sqrt(RENAISSANCE_GARDEN.backdrop.radius ** 2 - x ** 2);
      const hit = groundAt(x, z);
      expect(hit, `terrain at backdrop edge ${x},${z}`).toBeDefined();
      return hit.point.y;
    });
    expect(Math.min(...skyline)).toBeGreaterThan(0.3);
    expect(Math.max(...skyline) - Math.min(...skyline)).toBeGreaterThan(0.3);
    const positions = terrain.geometry.getAttribute("position");
    const uv = terrain.geometry.getAttribute("uv");
    const projectionEye = new THREE.Vector3(0, 1.82, RENAISSANCE_GARDEN.backdrop.centerZ);
    let checkedSeamVertices = 0;
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(terrain.matrixWorld);
      const distance = Math.hypot(point.x, point.z - RENAISSANCE_GARDEN.backdrop.centerZ);
      if (distance < 60 || distance > 65) continue;
      const hit = new THREE.Raycaster(projectionEye, point.sub(projectionEye).normalize())
        .intersectObject(backdropIn(garden), false)[0];
      expect(hit?.uv).toBeDefined();
      // Six source-photo pixels of tolerance account for the two actual meshes'
      // tessellation while guarding against mismatched/mirrored field sampling.
      expect(new THREE.Vector2(uv.getX(i), uv.getY(i)).distanceTo(hit.uv!)).toBeLessThan(0.0015);
      checkedSeamVertices++;
    }
    expect(checkedSeamVertices).toBeGreaterThan(20);
    for (const x of [-8, 8]) for (const apertureX of [-4.5, 0, 4.5]) {
      const eye = new THREE.Vector3(x, 1.82, -6);
      const direction = new THREE.Vector3(apertureX, RENAISSANCE_GARDEN.window.bottom + 0.04,
        RENAISSANCE_GARDEN.window.outerZ).sub(eye).normalize();
      const ray = new THREE.Raycaster(eye, direction, 0, world.cameraFar);
      const ground = ray.intersectObject(terrain, false)[0];
      const backdrop = ray.intersectObject(backdropIn(garden), false)[0];
      expect(ground).toBeDefined();
      expect(backdrop).toBeDefined();
      expect(ground.distance).toBeLessThan(backdrop.distance);
    }
  });

  it("keeps all three complete reliefs clear of shelf cases, service lanes, columns and jumping heads", () => {
    const { gallery } = mountGarden(quality);
    expect(RENAISSANCE_GARDEN.reliefs).toHaveLength(3);
    const jumpEye = world.motion.floorHeight + world.motion.jumpVelocity ** 2 / (2 * world.motion.gravity);
    const boxes = shelfBoxes();
    for (const { label, box } of sceneParts(gallery)) {
      expect(box.min.y, label).toBeGreaterThan(jumpEye + CAMERA_RADIUS + 0.025);
      for (const shelf of boxes) expect(overlaps(box, shelf.box), `${label} / ${shelf.label}`).toBe(false);
      for (const [index, obstacle] of world.obstacles.entries()) {
        const obstacleBox = new THREE.Box3(new THREE.Vector3(obstacle.minX, 0, obstacle.minZ),
          new THREE.Vector3(obstacle.maxX, 6.4, obstacle.maxZ));
        expect(overlaps(box, obstacleBox), `${label} / existing furniture or column ${index}`).toBe(false);
      }
      expect(box.max.y, label).toBeLessThan(5.5);
      if (box.max.x < 0) {
        expect(box.max.x, label).toBeLessThanOrEqual(-10.35 + EPSILON);
        expect(box.min.x, label).toBeGreaterThan(-10.71);
      } else {
        expect(box.min.x, label).toBeGreaterThanOrEqual(10.3 - EPSILON);
        expect(box.max.x, label).toBeLessThan(10.71);
      }
    }
    // Complete mounting plates overlap the existing 0.2 m wide pilasters.
    for (const relief of RENAISSANCE_GARDEN.reliefs) {
      const [x, , z] = relief.position;
      const sign = Math.sign(x);
      const pilaster = new THREE.Box3(new THREE.Vector3(sign > 0 ? 10.56 : -10.72, 0.5, z - 0.1),
        new THREE.Vector3(sign > 0 ? 10.72 : -10.56, 6.4, z + 0.1));
      expect(sceneParts(gallery).some((part) => overlaps(part.box, pilaster)), relief.kind).toBe(true);
    }
  });

  it("caps actual draw and triangle cost with one bounded ground decal batch and no added lights or motion", ({ task }) => {
    const scene = mountGarden(quality);
    const rendered = sceneMeshes(scene.root);
    const triangles = rendered.reduce((total, mesh) => total + (mesh.geometry.index?.count
      ?? mesh.geometry.getAttribute("position").count) / 3 * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1), 0);
    Object.assign(task.meta, { sceneCost: { quality, drawBatches: rendered.length, triangles } });
    expect(rendered.length).toBeLessThanOrEqual(28);
    expect(triangles).toBeLessThanOrEqual(32_000);
    expect(hooks.frames).toHaveLength(0);
    scene.root.traverse((object) => {
      expect(object instanceof THREE.Light).toBe(false);
      expect(object.castShadow).toBe(false);
    });
    const blended = rendered.filter((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((material) => material.transparent));
    expect(blended).toHaveLength(1);
    expect(blended[0]).toBeInstanceOf(THREE.InstancedMesh);
    const decals = sceneParts(blended[0]);
    expect(decals.length).toBeLessThanOrEqual(12);
    for (const part of decals) {
      expect(part.box.max.y - part.box.min.y).toBeLessThan(EPSILON);
      expect(part.box.max.z).toBeLessThan(RENAISSANCE_GARDEN.window.outerZ);
      expect(part.box.max.x - part.box.min.x).toBeLessThanOrEqual(3.5);
      expect(part.box.max.z - part.box.min.z).toBeLessThanOrEqual(3.5);
    }
    for (const mesh of rendered) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material.transparent) expect(material.depthWrite).toBe(false);
      expect((material as THREE.MeshPhysicalMaterial).transmission ?? 0).toBe(0);
    }
  });

  it("keeps foliage texture local and disposes owned geometry and textures without disposing cached maps", () => {
    const scene = mountGarden(quality);
    const grove = scene.root.getObjectByName("Cypress grove") as THREE.Mesh;
    const material = grove.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.alphaTest).toBeGreaterThan(0.3);
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    const needles = material.map as THREE.DataTexture;
    expect(needles.image.data!.byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(needles.generateMipmaps).toBe(true);
    const alpha = Array.from(needles.image.data!).filter((_value, index) => index % 4 === 3);
    expect(alpha.some((value) => value === 0)).toBe(true);
    expect(alpha.some((value) => value === 255)).toBe(true);
    const backdrop = backdropIn(scene.garden);
    const clonedPhoto = (backdrop.material as THREE.MeshBasicMaterial).map!;
    const disposed: object[] = [];
    const terrain = scene.garden.getObjectByName("Rolling garden ground") as THREE.Mesh;
    const owned = [grove.geometry, backdrop.geometry, terrain.geometry, needles, clonedPhoto];
    for (const resource of [...owned, ...hooks.textures.values()]) {
      resource.addEventListener("dispose", () => disposed.push(resource));
    }
    mounted.pop();
    scene.dispose();
    for (const resource of owned) expect(disposed.includes(resource)).toBe(true);
    for (const resource of hooks.textures.values()) expect(disposed.includes(resource)).toBe(false);
  });
});
