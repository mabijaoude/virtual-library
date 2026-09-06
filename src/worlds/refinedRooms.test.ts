import { readFileSync } from "node:fs";
import { BackSide, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D, Path, Raycaster, Shape, ShapeGeometry, SphereGeometry, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { resolvePlanarCollisions, type CollisionRect, type PlanarVector } from "../navigation";
import type { Book, ShelfPlacement } from "../types";
import { focusPoseForBook, getBayAnchor, resolveBookTransform } from "./layout";
import { getWorld } from "./registry";
import { RENAISSANCE_COLUMN_Z, RENAISSANCE_DOME, RENAISSANCE_SOFFIT } from "./renaissanceArchitecture";
import { getShelfKitDimensions } from "./shared";
import type { BayAnchor, WorldDefinition } from "./types";

type Footprint = { label: string; center: PlanarVector; yaw: number; width: number; depth: number };
const EPSILON = 0.0001;
// NavigationController uses 0.32 m; testing a smaller radius misses edge clipping.
const CAMERA_RADIUS = 0.32;
const MAX_BOOK = { width: 0.17, height: 0.94, depth: 0.43 };
const MAX_LEAN = 4 * 0.006;
const SELECTED_SCALE = 1.045;

function box(label: string, x: number, z: number, width: number, depth: number, yaw = 0): Footprint {
  return { label, center: { x, z }, yaw, width, depth };
}

function axes(footprint: Footprint) {
  return [
    { x: Math.cos(footprint.yaw), z: -Math.sin(footprint.yaw) },
    { x: Math.sin(footprint.yaw), z: Math.cos(footprint.yaw) }
  ];
}

function corners(footprint: Footprint): PlanarVector[] {
  const [tangent, front] = axes(footprint);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, end]) => ({
    x: footprint.center.x + side * tangent.x * footprint.width / 2 + end * front.x * footprint.depth / 2,
    z: footprint.center.z + side * tangent.z * footprint.width / 2 + end * front.z * footprint.depth / 2
  }));
}

function overlaps(a: Footprint, b: Footprint) {
  return [...axes(a), ...axes(b)].every((axis) => {
    const projected = (shape: Footprint) => corners(shape).map((point) => point.x * axis.x + point.z * axis.z);
    const aValues = projected(a);
    const bValues = projected(b);
    return Math.max(...aValues) > Math.min(...bValues) + EPSILON
      && Math.max(...bValues) > Math.min(...aValues) + EPSILON;
  });
}

function pointSegmentDistance(point: PlanarVector, start: PlanarVector, end: PlanarVector) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(point.x - start.x - fraction * dx, point.z - start.z - fraction * dz);
}

function distance(a: Footprint, b: Footprint) {
  if (overlaps(a, b)) return 0;
  const aCorners = corners(a);
  const bCorners = corners(b);
  const distances = (points: PlanarVector[], polygon: PlanarVector[]) => points.flatMap((point) =>
    polygon.map((start, index) => pointSegmentDistance(point, start, polygon[(index + 1) % polygon.length]))
  );
  return Math.min(...distances(aCorners, bCorners), ...distances(bCorners, aCorners));
}

function atBay(bay: BayAnchor, label: string, width: number, back: number, front: number): Footprint {
  const offset = (back + front) / 2;
  return box(label, bay.position[0] + Math.sin(bay.rotationY) * offset,
    bay.position[2] + Math.cos(bay.rotationY) * offset, width, front - back, bay.rotationY);
}

function shelfFootprints(world: WorldDefinition) {
  return world.bays.map((bay, index) => {
    const { shelfDepth } = getShelfKitDimensions(world, bay.width);
    // ShelfBay's back panel/base and each room's widest ShelfCrown. Include
    // the protruding book label, rather than starting the lane at the anchor.
    const back = Math.min(-shelfDepth / 2 - 0.105, -(shelfDepth + 0.2) / 2);
    const front = Math.max((shelfDepth + 0.2) / 2, 0.37 + MAX_BOOK.depth / 2 + 0.03);
    const width = bay.width + (world.id === "deco" ? 0.72 : 0.7);
    return {
      case: atBay(bay, `bay ${index} complete case`, width, back, front),
      lane: atBay(bay, `bay ${index} service lane`, width, front + 0.6, front + 2.8)
    };
  });
}

function obstacleBox(rect: CollisionRect, index: number) {
  return box(`collision ${index}`, (rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2,
    rect.maxX - rect.minX, rect.maxZ - rect.minZ);
}

function entranceParts(world: WorldDefinition) {
  return world.boundary.placements.flatMap((placement) => {
    const local = (label: string, x: number, z: number, width: number, depth: number) => {
      const sin = Math.sin(placement.rotationY);
      const cos = Math.cos(placement.rotationY);
      return box(label, placement.position[0] + x * cos + z * sin,
        placement.position[2] - x * sin + z * cos, width, depth, placement.rotationY);
    };
    if (world.id === "deco") return [
      local("solid stepped door surround and threshold", 0, 0.0425, 3.99, 0.475),
      ...[-1, 1].map((side) => local(`entrance sconce ${side}`, side * 2.7, 0.12, 0.58, 0.48))
    ];
    // RefinedEntrances: the full marble head/threshold, facade plinths and
    // projecting corner returns, not merely the central nominal opening.
    return [
      local("stone portal and door hardware", 0, 0.14, 4.96, 0.52),
      ...[-1, 1].flatMap((side) => [
        local(`plaster wing ${side}`, side * 6.3, -0.08, 8.6, 0.34),
        local(`facade plinth ${side}`, side * 6.5, 0.08, 8.05, 0.22),
        local(`facade return ${side}`, side * 10.44, -0.4, 0.4, 1.05)
      ])
    ];
  });
}

function isWalkable(world: WorldDefinition, point: PlanarVector) {
  if (world.obstacles.some((rect) => point.x > rect.minX - CAMERA_RADIUS && point.x < rect.maxX + CAMERA_RADIUS
    && point.z > rect.minZ - CAMERA_RADIUS && point.z < rect.maxZ + CAMERA_RADIUS)) return false;
  const resolved = resolvePlanarCollisions(point, point, world.bounds, [], CAMERA_RADIUS, world.walkablePolygon);
  return Math.hypot(resolved.x - point.x, resolved.z - point.z) < EPSILON;
}

function maximumPlacement(bay: number, row: number, slot: number): ShelfPlacement {
  return { documentId: `neutral-${bay}-${row}-${slot}`, shelfId: `display-bay-${bay + 1}`, bay, row, slot,
    ...MAX_BOOK, accentColor: "#777777", shelfSectionId: "general", importanceScore: 1 };
}

function readModel(id: string, tier: string) {
  const bytes = readFileSync(`public/worlds/assets/models/${id}-${tier}.glb`);
  const jsonLength = bytes.readUInt32LE(12);
  const binary = bytes.subarray(28 + jsonLength);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    scene?: number;
    scenes: Array<{ nodes: number[] }>;
    nodes: Array<{ name?: string; mesh?: number; extras?: { width?: number }; children?: number[];
      translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }>;
    meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; normalized?: boolean }>;
    bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number;
      extensions?: { EXT_meshopt_compression?: { byteOffset: number; byteLength: number; byteStride: number;
        count: number; mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES"; filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL" } } }>;
  };
  // Compose the actual glTF hierarchy, including its Blender coordinate root.
  // Checking extras/names alone cannot detect collapsed anchors at the origin.
  const objects = json.nodes.map((node) => {
    const object = new Object3D();
    if (node.matrix) {
      object.matrix.fromArray(node.matrix);
      object.matrixAutoUpdate = false;
    } else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  json.nodes.forEach((node, index) => node.children?.forEach((child) => objects[index].add(objects[child])));
  const scene = new Object3D();
  json.scenes[json.scene ?? 0].nodes.forEach((index) => scene.add(objects[index]));
  scene.updateMatrixWorld(true);
  const anchor = (name: string) => {
    const matches = json.nodes.flatMap((node, index) => node.name === name ? [{ node, object: objects[index] }] : []);
    expect(matches, name).toHaveLength(1);
    return matches[0];
  };
  const decodedViews = new Map<number, Uint8Array>();
  const positions = async (name: string) => {
    await MeshoptDecoder.ready;
    const { node, object } = anchor(name);
    expect(node.mesh, `${name} mesh`).toBeDefined();
    return json.meshes[node.mesh!].primitives.flatMap((primitive) => {
      const accessor = json.accessors[primitive.attributes.POSITION];
      const view = json.bufferViews[accessor.bufferView];
      const compressed = view.extensions?.EXT_meshopt_compression;
      let data = decodedViews.get(accessor.bufferView);
      if (!data) {
        if (compressed) {
          data = new Uint8Array(compressed.count * compressed.byteStride);
          MeshoptDecoder.decodeGltfBuffer(data, compressed.count, compressed.byteStride,
            binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), compressed.mode, compressed.filter);
        } else data = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        decodedViews.set(accessor.bufferView, data);
      }
      const values = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const componentBytes = accessor.componentType === 5126 || accessor.componentType === 5125 ? 4
        : accessor.componentType === 5122 || accessor.componentType === 5123 ? 2 : 1;
      const read = (offset: number) => {
        const type = accessor.componentType;
        const value = type === 5126 ? values.getFloat32(offset, true) : type === 5125 ? values.getUint32(offset, true)
          : type === 5123 ? values.getUint16(offset, true) : type === 5122 ? values.getInt16(offset, true)
            : type === 5121 ? values.getUint8(offset) : values.getInt8(offset);
        const divisor = !accessor.normalized ? 1 : type === 5120 ? 127 : type === 5121 ? 255
          : type === 5122 ? 32767 : type === 5123 ? 65535 : 4294967295;
        return Math.max(accessor.normalized ? -1 : -Infinity, value / divisor);
      };
      const stride = view.byteStride ?? compressed?.byteStride ?? componentBytes * 3;
      return Array.from({ length: accessor.count }, (_, index) => {
        const offset = (accessor.byteOffset ?? 0) + index * stride;
        return new Vector3(read(offset), read(offset + componentBytes), read(offset + componentBytes * 2)).applyMatrix4(object.matrixWorld);
      });
    });
  };
  return { anchor, positions };
}

describe.each(["renaissance", "deco"] as const)("%s refined room clearances", (id) => {
  const world = getWorld(id);

  it("keeps all nine full cases separate and inside the room", () => {
    expect(world.bays).toHaveLength(9);
    const shelves = shelfFootprints(world);
    for (const [index, shelf] of shelves.entries()) {
      expect(getBayAnchor(world, index)).toBe(world.bays[index]);
      for (const other of shelves.slice(index + 1)) {
        expect(overlaps(shelf.case, other.case), `${shelf.case.label} / ${other.case.label}`).toBe(false);
      }
      for (const point of corners(shelf.case)) {
        const resolved = resolvePlanarCollisions(point, point, world.bounds, [], 0, world.walkablePolygon);
        expect(Math.hypot(resolved.x - point.x, resolved.z - point.z), shelf.case.label).toBeLessThan(EPSILON);
      }
    }
  });

  it("keeps the entire 0.6–2.8 m browsing lanes clear of other cases, portals and solid fixtures", () => {
    const shelves = shelfFootprints(world);
    const fixtures = [...entranceParts(world), ...world.obstacles.map(obstacleBox)];
    if (id === "renaissance") for (const x of [-5.25, 5.25]) for (const z of RENAISSANCE_COLUMN_Z) {
      // Capitals are wider than the walking collider and the column shaft.
      fixtures.push(box(`marble capital ${x},${z}`, x, z, 0.84, 0.84));
    }
    for (const [index, shelf] of shelves.entries()) {
      for (const fixture of fixtures) for (const shape of [shelf.case, shelf.lane]) {
        expect(overlaps(shape, fixture), `${shape.label} / ${fixture.label}`).toBe(false);
      }
      for (const [otherIndex, other] of shelves.entries()) if (otherIndex !== index) {
        expect(overlaps(shelf.lane, other.case), `${shelf.lane.label} / ${other.case.label}`).toBe(false);
      }
      for (const point of corners(shelf.lane)) {
        const resolved = resolvePlanarCollisions(point, point, world.bounds, [], 0, world.walkablePolygon);
        expect(Math.hypot(resolved.x - point.x, resolved.z - point.z), shelf.lane.label).toBeLessThan(EPSILON);
      }
    }
  });

  it("fits 630 maximum-size neutral volumes, including lean and selected-book enlargement", () => {
    for (let bay = 0; bay < 9; bay += 1) for (let row = 0; row < 5; row += 1) {
      const placements = Array.from({ length: 14 }, (_, slot) => maximumPlacement(bay, row, slot));
      const transforms = placements.map((placement) => resolveBookTransform(placement, world));
      for (const [slot, transform] of transforms.entries()) {
        const label = `bay ${bay}, row ${row}, slot ${slot}`;
        const leanedWidth = transform.width * Math.cos(MAX_LEAN) + MAX_BOOK.height * Math.sin(MAX_LEAN);
        expect(transform.width, label).toBeGreaterThan(0);
        expect(transform.width, label).toBeLessThanOrEqual(placements[slot].width);
        if (slot > 0) {
          const previous = transforms[slot - 1];
          const previousWidth = previous.width * Math.cos(MAX_LEAN) + MAX_BOOK.height * Math.sin(MAX_LEAN);
          const occupiedWidth = (leanedWidth * SELECTED_SCALE + previousWidth) / 2;
          expect(transform.position.distanceTo(previous.position) - occupiedWidth, label).toBeGreaterThan(0.005);
        }
        const anchor = world.bays[bay];
        const { uprightCenter, uprightWidth } = getShelfKitDimensions(world, anchor.width);
        const localX = (transform.position.x - anchor.position[0]) * Math.cos(anchor.rotationY)
          - (transform.position.z - anchor.position[2]) * Math.sin(anchor.rotationY);
        expect(Math.abs(localX) + leanedWidth * SELECTED_SCALE / 2, label).toBeLessThan(uprightCenter - uprightWidth / 2);
        expect(placements[slot].width, "display fitting must preserve catalog dimensions").toBe(MAX_BOOK.width);
      }
    }
  });

  it("keeps the spawn and every outermost guided book view clear at the actual camera radius", () => {
    expect(isWalkable(world, { x: world.spawn.position[0], z: world.spawn.position[2] })).toBe(true);
    for (let bay = 0; bay < 9; bay += 1) for (const slot of [0, 6, 13]) {
      const placement = maximumPlacement(bay, 2, slot);
      const book = { id: placement.documentId, placement } as Book;
      const pose = focusPoseForBook(book, world);
      expect(isWalkable(world, { x: pose.position.x, z: pose.position.z }), `bay ${bay}, slot ${slot}`).toBe(true);
    }
  });

  it.each(["cinematic", "lite"] as const)("preserves the spawn and all nine shelf transforms in the %s model", (tier) => {
    const { anchor } = readModel(id, tier);
    const spawn = anchor("SPAWN").object.getWorldPosition(new Vector3());
    expect(spawn.distanceTo(new Vector3(...world.spawn.position)), "authored/runtime spawn").toBeLessThan(EPSILON);
    for (let bay = 0; bay < 9; bay += 1) {
      const suffix = String(bay).padStart(2, "0");
      const expected = world.bays[bay];
      for (const [prefix, height] of [["SHELF", expected.position[1]], ["CLEARANCE", 1.4]] as const) {
        const { object } = anchor(`${prefix}_BAY_${suffix}`);
        const position = object.getWorldPosition(new Vector3());
        expect(position.distanceTo(new Vector3(expected.position[0], height, expected.position[2])),
          `bay ${bay} ${prefix} world position`).toBeLessThan(EPSILON);
        // Blender's app +Z is encoded as local +Y in the glTF object basis.
        const front = new Vector3(0, 1, 0).transformDirection(object.matrixWorld);
        const expectedFront = new Vector3(Math.sin(expected.rotationY), 0, Math.cos(expected.rotationY));
        expect(front.distanceTo(expectedFront), `bay ${bay} ${prefix} facing`).toBeLessThan(EPSILON);
      }
      expect(anchor(`CLEARANCE_BAY_${suffix}`).node.extras?.width,
        `bay ${bay} authored/runtime width`).toBeCloseTo(expected.width, 4);
    }
  });
});

it.each(["cinematic", "lite"] as const)("covers every authored Deco wall corner with the %s floor and ceiling", async (tier) => {
  const model = readModel("deco", tier);
  const surfaces = await Promise.all(["Octagonal marble floor", "Continuous octagonal ceiling"].map(model.positions));
  const walls = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    model.positions(index === 0 ? "South entrance jamb 1" : `Ebony wall ${index}`)));
  const planes = walls.map((vertices, index) => {
    const normal = { x: Math.sin(index * Math.PI / 4), z: Math.cos(index * Math.PI / 4) };
    return { normal, distance: Math.min(...vertices.map((point) => point.x * normal.x + point.z * normal.z)) };
  });
  const wallCorners = planes.map((a, index) => {
    const b = planes[(index + 1) % planes.length];
    const determinant = a.normal.x * b.normal.z - b.normal.x * a.normal.z;
    return { x: (a.distance * b.normal.z - b.distance * a.normal.z) / determinant,
      z: (a.normal.x * b.distance - b.normal.x * a.distance) / determinant };
  });
  const cross = (a: PlanarVector, b: PlanarVector, c: PlanarVector) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const [surfaceIndex, vertices] of surfaces.entries()) {
    // Decode real positions rather than using mesh AABBs, which conceal the
    // 22.5-degree phase mismatch and its triangular floor/ceiling gaps.
    const points = [...new Map(vertices.map((point) => [`${point.x.toFixed(5)},${point.z.toFixed(5)}`, point])).values()]
      .sort((a, b) => a.x - b.x || a.z - b.z);
    const halfHull = (ordered: PlanarVector[]) => {
      const half: PlanarVector[] = [];
      for (const point of ordered) {
        while (half.length > 1 && cross(half[half.length - 2], half[half.length - 1], point) <= 0.000001) half.pop();
        half.push(point);
      }
      return half.slice(0, -1);
    };
    const hull = [...halfHull(points), ...halfHull([...points].reverse())];
    for (const [cornerIndex, corner] of wallCorners.entries()) {
      const clearance = Math.min(...hull.map((start, index) => {
        const end = hull[(index + 1) % hull.length];
        return cross(start, end, corner) / Math.hypot(end.x - start.x, end.z - start.z);
      }));
      expect(clearance, `${surfaceIndex === 0 ? "floor" : "ceiling"} underlaps wall corner ${cornerIndex}`)
        .toBeGreaterThan(0.05);
    }
  }
});

it("keeps Deco movable seating at least 0.35 m outside every browsing lane", () => {
  // Conservative enclosing footprints for RoomDetails' curved chairs and round tables.
  const furniture = [box("west chair", -2.65, -2.65, 1.65, 1.35, Math.PI / 4),
    box("east chair", 2.65, -2.65, 1.65, 1.35, -Math.PI / 4),
    box("west table", -3.85, -1.65, 1, 1), box("east table", 3.85, -1.65, 1, 1)];
  for (const { lane } of shelfFootprints(getWorld("deco"))) for (const fixture of furniture) {
    expect(distance(lane, fixture), `${lane.label} / ${fixture.label}`).toBeGreaterThanOrEqual(0.35);
  }
});

it("blocks walking into the closed Deco door before the camera reaches its handles", () => {
  const world = getWorld("deco");
  const placement = world.boundary.placements[0];
  expect(Math.cos(placement.rotationY)).toBeCloseTo(-1, 6);
  const handleFront = placement.position[2] - 0.28;
  for (const x of [-1.75, 0, 1.75]) {
    let position = { x: placement.position[0] + x, z: 8 };
    for (let step = 0; step < 80; step += 1) {
      position = resolvePlanarCollisions(position, { ...position, z: position.z + 0.05 },
        world.bounds, world.obstacles, CAMERA_RADIUS, world.walkablePolygon);
    }
    expect(position.z + CAMERA_RADIUS).toBeLessThanOrEqual(handleFront + EPSILON);
    expect(position.z).toBeGreaterThan(8.4);
  }
});

it("gives every retained Renaissance column a walking collision and leaves the landscape clear", () => {
  const world = getWorld("renaissance");
  expect(RENAISSANCE_COLUMN_Z).toHaveLength(6);
  for (const x of [-5.25, 5.25]) for (const z of RENAISSANCE_COLUMN_Z) {
    expect(world.obstacles.some((rect) => rect.minX <= x - 0.39 + EPSILON && rect.maxX >= x + 0.39 - EPSILON
      && rect.minZ <= z - 0.39 + EPSILON && rect.maxZ >= z + 0.39 - EPSILON), `column ${x},${z}`).toBe(true);
  }
  const landscapeView = box("landscape sightline", 0, -8.3, 10.4, 4.2);
  for (const { case: shelf } of shelfFootprints(world)) expect(overlaps(shelf, landscapeView), shelf.label).toBe(false);
});

it.each(["lite", "cinematic"] as const)("seals the Renaissance dome rim from central and gallery eyes with %s tessellation", (tier) => {
  const design = RENAISSANCE_DOME;
  const soffit = RENAISSANCE_SOFFIT;
  const [widthSegments, heightSegments] = design.segments[tier];
  const domeMaterial = new MeshBasicMaterial({ side: BackSide });
  const joinMaterial = new MeshBasicMaterial({ side: DoubleSide });
  const dome = new Mesh(new SphereGeometry(design.radius, widthSegments, heightSegments, 0, Math.PI * 2,
    design.openingAngle, Math.PI / 2 - design.openingAngle), domeMaterial);
  dome.position.y = design.springY;
  dome.scale.y = design.verticalScale;
  const shape = new Shape();
  shape.moveTo(-soffit.halfSpan, -soffit.halfSpan);
  shape.lineTo(soffit.halfSpan, -soffit.halfSpan);
  shape.lineTo(soffit.halfSpan, soffit.halfSpan);
  shape.lineTo(-soffit.halfSpan, soffit.halfSpan);
  shape.closePath();
  const opening = new Path();
  opening.absarc(0, 0, soffit.openingRadius, 0, Math.PI * 2, true);
  shape.holes.push(opening);
  const ceiling = new Mesh(new ShapeGeometry(shape, soffit.curveSegments), joinMaterial);
  ceiling.position.y = soffit.height;
  ceiling.rotation.x = Math.PI / 2;
  const drum = new Mesh(new CylinderGeometry(design.drum.radius, design.drum.radius, design.drum.height,
    design.drum.radialSegments, 1, true), joinMaterial);
  drum.position.y = design.drum.centerY;
  const roof = [dome, ceiling, drum];
  roof.forEach((mesh) => mesh.updateMatrixWorld(true));
  try {
    const origins = [new Vector3(0, 1.82, 4), new Vector3(-7.5, 1.82, 0), new Vector3(7.5, 1.82, 0),
      new Vector3(0, 1.82, -8), new Vector3(0, 1.82, 8.8)];
    // Sample every sphere edge/mid-face and every drum mid-face. Analytic
    // radii alone miss openings between differently tessellated surfaces.
    const angles = [
      ...Array.from({ length: widthSegments * 2 }, (_, index) => index * Math.PI / widthSegments),
      ...Array.from({ length: design.drum.radialSegments }, (_, index) => (index + 0.5) * Math.PI * 2 / design.drum.radialSegments)
    // A ray exactly on a shared triangle edge is numerically ambiguous.
    // Test both sides, about 0.1 mm apart at the drum, instead of that edge.
    ].flatMap((angle) => [angle - 0.00001, angle + 0.00001]);
    const heights = [soffit.height - 0.09, soffit.height + 0.01, design.springY + 0.17, design.springY + 0.3,
      design.drum.centerY + design.drum.height / 2 + 0.03];
    const ray = new Raycaster();
    const innerDrumRadius = design.drum.radius * Math.cos(Math.PI / design.drum.radialSegments);
    expect(innerDrumRadius).toBeGreaterThan(soffit.openingRadius);
    expect(design.drum.centerY - design.drum.height / 2).toBeLessThan(soffit.height - 0.01);
    for (const angle of angles) {
      ray.set(new Vector3(Math.sin(angle) * innerDrumRadius, soffit.height, Math.cos(angle) * innerDrumRadius),
        new Vector3(0, 1, 0));
      const hits = ray.intersectObject(dome, false);
      expect(hits.length, `dome above drum at ${angle}`).toBeGreaterThan(0);
      expect(hits[0].point.y, `drum overlaps the actual dome facet at ${angle}`)
        .toBeLessThan(design.drum.centerY + design.drum.height / 2 - 0.02);
    }
    const misses: string[] = [];
    for (const origin of origins) for (const angle of angles) for (const height of heights) {
      const target = new Vector3(Math.sin(angle) * design.drum.radius, height, Math.cos(angle) * design.drum.radius);
      ray.set(origin, target.sub(origin).normalize());
      if (![drum, ceiling, dome].some((mesh) => ray.intersectObject(mesh, false).length)) {
        misses.push(`eye ${origin.toArray()}, angle ${angle}, height ${height}`);
      }
    }
    expect(misses).toEqual([]);

    // Negative control: without the connecting drum, this ray escapes between
    // the horizontal soffit and the dome's open lower edge.
    const origin = new Vector3(0, 1.82, 0);
    ray.set(origin, new Vector3(0.001, design.springY - 0.05, -design.drum.radius).sub(origin).normalize());
    expect(ray.intersectObjects([dome, ceiling], false)).toHaveLength(0);
    expect(ray.intersectObjects(roof, false).length).toBeGreaterThan(0);
  } finally {
    roof.forEach((mesh) => mesh.geometry.dispose());
    domeMaterial.dispose();
    joinMaterial.dispose();
  }
});
