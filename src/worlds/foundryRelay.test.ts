import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlanarCollisions } from "../navigation";
import type { Book, ShelfPlacement } from "../types";
import { FoundryRelayWall } from "./FoundryRelayWall";
import { advanceRelayPhase, FOUNDRY_RELAY, FOUNDRY_RELAY_OBSTACLES } from "./foundryRelayDesign";
import { focusPoseForBook, getShelfTop } from "./layout";
import { getWorld } from "./registry";
import { getShelfKitDimensions } from "./shared";
import { mountTestScene, sceneMeshes as meshes, sceneParts as renderParts } from "./sceneTestUtils";

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void>,
  frames: [] as Array<(state: { clock: { elapsedTime: number } }, delta: number) => void>
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); }
}));
vi.mock("@react-three/fiber", async (original) => ({
  ...await original<typeof import("@react-three/fiber")>(),
  useFrame: (frame: typeof hooks.frames[number]) => { hooks.frames.push(frame); }
}));

const EPSILON = 0.00001;
const CAMERA_RADIUS = 0.32;
const mounted: ReturnType<typeof mountTestScene>[] = [];

function mountRelay(paused = false) {
  const scene = mountTestScene(() => FoundryRelayWall({ reducedMotion: paused }), hooks);
  mounted.push(scene);
  return scene;
}

afterEach(() => { mounted.splice(0).forEach((scene) => scene.dispose()); });
function intersects(a: THREE.Box3, b: THREE.Box3) {
  return ["x", "y", "z"].every((axis) => {
    const key = axis as "x" | "y" | "z";
    return a.max[key] > b.min[key] + EPSILON && b.max[key] > a.min[key] + EPSILON;
  });
}

function shelves() {
  const world = getWorld("foundry");
  return world.bays.map((bay, index) => {
    const { shelfDepth } = getShelfKitDimensions(world, bay.width);
    // The canted crown posts extend slightly farther than the +0.74 m plinth.
    const halfWidth = bay.width / 2 + Math.max(0.37, 0.18 + Math.sin(0.32) * 0.41 + Math.cos(0.32) * 0.06);
    const top = getShelfTop(world) + 0.55 + Math.cos(0.32) * 0.41 + Math.sin(0.32) * 0.06;
    const back = -shelfDepth / 2 - 0.105;
    const front = Math.max((shelfDepth + 0.2) / 2, 0.37 + 0.43 / 2 + 0.03);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...bay.position),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bay.rotationY), new THREE.Vector3(1, 1, 1));
    const box = (near: number, far: number) => new THREE.Box3(new THREE.Vector3(-halfWidth, 0, near),
      new THREE.Vector3(halfWidth, top, far)).applyMatrix4(matrix);
    return { index, case: box(back, front), lane: box(front + 0.6, front + 2.8) };
  });
}

describe("Foundry relay placement", () => {
  it("keeps every rendered part outside the complete door and all nine shelf cases and browsing lanes", () => {
    const scene = mountRelay();
    const world = getWorld("foundry");
    expect(world.bays).toHaveLength(9);
    const portal = new THREE.Box3(new THREE.Vector3(-2.55, 0, 9.82), new THREE.Vector3(2.55, 4.9, 10.72));
    const fixtures = [{ label: "shutter/frame/threshold", box: portal }, ...shelves().flatMap((shelf) => [
      { label: `bay ${shelf.index} full case`, box: shelf.case }, { label: `bay ${shelf.index} full lane`, box: shelf.lane }
    ])];
    for (const part of renderParts(scene.root)) for (const fixture of fixtures) {
      expect(intersects(part.box, fixture.box), `${part.label} / ${fixture.label}`).toBe(false);
    }
  });

  it("covers all projecting machinery with the registered colliders after the wall's half-turn", () => {
    const scene = mountRelay();
    const world = getWorld("foundry");
    expect(FOUNDRY_RELAY_OBSTACLES).toHaveLength(2);
    for (const collider of FOUNDRY_RELAY_OBSTACLES) expect(world.obstacles).toContainEqual(collider);
    for (const { label, box } of renderParts(scene.root)) {
      if (box.min.y > 2.6 || box.min.z >= world.bounds.maxZ - CAMERA_RADIUS) continue;
      expect(FOUNDRY_RELAY_OBSTACLES.some((collider) => box.min.x >= collider.minX - EPSILON
        && box.max.x <= collider.maxX + EPSILON && box.min.z >= collider.minZ - EPSILON
        && box.max.z <= collider.maxZ + EPSILON), label).toBe(true);
    }
    for (const { lane, index } of shelves()) for (const collider of FOUNDRY_RELAY_OBSTACLES) {
      expect(intersects(lane, new THREE.Box3(new THREE.Vector3(collider.minX, 0, collider.minZ),
        new THREE.Vector3(collider.maxX, 2.6, collider.maxZ))), `bay ${index} lane / collider`).toBe(false);
    }
  });

  it("stops approaching cameras ahead of each chamber and preserves the doorway and guided shelf views", () => {
    const world = getWorld("foundry");
    const resolve = (current: { x: number; z: number }, next = current) =>
      resolvePlanarCollisions(current, next, world.bounds, world.obstacles, CAMERA_RADIUS, world.walkablePolygon);
    for (const collider of FOUNDRY_RELAY_OBSTACLES) for (const x of [collider.minX + 0.1, (collider.minX + collider.maxX) / 2, collider.maxX - 0.1]) {
      let position = { x, z: 8.2 };
      for (let i = 0; i < 80; i++) position = resolve(position, { x, z: position.z + 0.05 });
      expect(position.z + CAMERA_RADIUS).toBeLessThanOrEqual(collider.minZ + EPSILON);
      expect(position.z).toBeGreaterThan(8.8);
    }
    for (const x of [-1.8, 0, 1.8]) {
      let position = { x, z: 8.2 };
      for (let i = 0; i < 80; i++) position = resolve(position, { x, z: position.z + 0.05 });
      expect(position.z).toBeCloseTo(world.bounds.maxZ - CAMERA_RADIUS, 5);
    }
    const spawn = { x: world.spawn.position[0], z: world.spawn.position[2] };
    expect(resolve(spawn)).toEqual(spawn);
    for (let bay = 0; bay < 9; bay++) for (const slot of [0, 6, 13]) {
      const placement = { documentId: `neutral-${bay}-${slot}`, shelfId: "neutral", bay, row: 2, slot,
        width: 0.17, height: 0.94, depth: 0.43, accentColor: "#777777", shelfSectionId: "general", importanceScore: 1 } satisfies ShelfPlacement;
      const pose = focusPoseForBook({ id: placement.documentId, placement } as Book, world);
      const point = { x: pose.position.x, z: pose.position.z };
      expect(resolve(point), `bay ${bay}, slot ${slot}`).toEqual(point);
    }
  });

  it("keeps shallow outboard fittings behind the physical walking boundary", () => {
    const scene = mountRelay();
    const outboard = renderParts(scene.root).filter(({ box }) => box.min.x > 8 || box.max.x < -8);
    expect(outboard.length).toBeGreaterThan(0);
    for (const { label, box } of outboard) {
      // A camera at maxZ−0.32 has its full radius against maxZ. Checking only
      // its centre would conceal fittings extending through that envelope.
      expect(box.min.z, label).toBeGreaterThanOrEqual(getWorld("foundry").bounds.maxZ);
    }
  });

  it("keeps all moving parts inside the casing envelope throughout a rotor turn", () => {
    const scene = mountRelay();
    for (let step = 0; step < 1700; step++) {
      scene.step(0.05);
      if (step % 50) continue;
      for (const { label, box } of renderParts(scene.root)) {
        if (box.min.z >= FOUNDRY_RELAY.wallZ - 0.4 || box.min.y > 6.75) continue;
        expect(FOUNDRY_RELAY.centers.some((x) => box.min.x >= x - FOUNDRY_RELAY.halfWidth - EPSILON
          && box.max.x <= x + FOUNDRY_RELAY.halfWidth + EPSILON), label).toBe(true);
        expect(box.min.z, label).toBeGreaterThanOrEqual(FOUNDRY_RELAY.wallZ - FOUNDRY_RELAY.front - EPSILON);
        expect(box.min.y, label).toBeGreaterThanOrEqual(FOUNDRY_RELAY.baseY - EPSILON);
        expect(box.max.y, label).toBeLessThanOrEqual(FOUNDRY_RELAY.topY + EPSILON);
      }
    }
  });
});

describe("Foundry relay motion and rendering cost", () => {
  it("freezes actual meshes and instance transforms when motion is paused", () => {
    const scene = mountRelay(true);
    const before = renderParts(scene.root).map((part) => part.matrix.toArray());
    for (let i = 0; i < 12; i++) scene.step(60, 3600 + i * 60);
    expect(renderParts(scene.root).map((part) => part.matrix.toArray())).toEqual(before);
  });

  it("resumes from the frozen phase, clamps long gaps and wraps both motions continuously", () => {
    const period = Math.PI * 10 / FOUNDRY_RELAY.rotorSpeed;
    const phase = 17.25;
    expect(advanceRelayPhase(phase, 3600, true)).toBe(phase);
    expect(advanceRelayPhase(phase, 1 / 60, false)).toBeCloseTo(phase + 1 / 60, 10);
    expect(advanceRelayPhase(phase, 3600, false)).toBeCloseTo(phase + 0.05, 10);
    expect(advanceRelayPhase(phase, -1, false)).toBe(phase);
    const before = period - 0.02;
    const after = advanceRelayPhase(before, 0.04, false);
    expect(after).toBeCloseTo(0.02, 10);
    for (const speed of [FOUNDRY_RELAY.rotorSpeed, FOUNDRY_RELAY.markerSpeed]) {
      const start = new THREE.Vector2(Math.cos(before * speed), Math.sin(before * speed));
      const end = new THREE.Vector2(Math.cos(after * speed), Math.sin(after * speed));
      expect(start.distanceTo(end)).toBeLessThanOrEqual(speed * 0.04 + EPSILON);
    }
    expect(FOUNDRY_RELAY.markerSpeed * FOUNDRY_RELAY.markerRadius).toBeLessThanOrEqual(0.25);
  });

  it("bounds real mesh batches and triangles without extra lights, shadow casters or transparent passes", () => {
    const scene = mountRelay();
    const rendered = meshes(scene.root);
    const triangles = rendered.reduce((total, mesh) => total + (mesh.geometry.index?.count
      ?? mesh.geometry.getAttribute("position").count) / 3 * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1), 0);
    expect(rendered.length).toBeLessThanOrEqual(24);
    expect(triangles).toBeLessThanOrEqual(15_000);
    const lights: THREE.Light[] = [];
    scene.root.traverse((object) => {
      if (object instanceof THREE.Light) lights.push(object);
      expect(object.castShadow).toBe(false);
    });
    expect(lights).toHaveLength(2);
    for (const mesh of rendered) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      expect(material.transparent).toBe(false);
      expect((material as THREE.MeshPhysicalMaterial).transmission ?? 0).toBe(0);
    }
  });
});
