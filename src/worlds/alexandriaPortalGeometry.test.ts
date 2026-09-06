import { readFileSync } from "node:fs";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import architecture from "./alexandriaArchitecture.json";

type GlbNode = {
  name?: string; mesh?: number; children?: number[]; extras?: { width?: number };
  translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[];
};
type Glb = {
  scene?: number; scenes: Array<{ nodes: number[] }>; nodes: GlbNode[];
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; indices?: number; mode?: number }> }>;
  accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number; extensions?: {
    EXT_meshopt_compression?: { byteOffset: number; byteLength: number; byteStride: number; count: number;
      mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES"; filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL" };
  } }>;
};

// Read the shipped triangles, not names or authored bounding boxes alone. The
// optimizer joins these walls and cabinet surrounds into large material meshes.
async function readPortalModel(tier: string) {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(`public/worlds/assets/models/alexandria-${tier}.glb`);
  let json: Glb | undefined;
  let binary: Uint8Array | undefined;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")) as Glb;
    if (type === 0x004e4942) binary = data;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error("Expected a GLB with JSON and embedded geometry");
  const model = json, payload = binary;
  const objects = model.nodes.map((node) => {
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
  model.nodes.forEach((node, index) => node.children?.forEach((child) => objects[index].add(objects[child])));
  const scene = new Object3D();
  model.scenes[model.scene ?? 0].nodes.forEach((index) => scene.add(objects[index]));
  scene.updateMatrixWorld(true);
  const named = (name: string) => {
    const matches = model.nodes.flatMap((node, index) => node.name === name ? [{ node, object: objects[index] }] : []);
    expect(matches, name).toHaveLength(1);
    return matches[0];
  };
  const decodedViews = new Map<number, Uint8Array>();
  const accessorValues = (index: number) => {
    const accessor = model.accessors[index], view = model.bufferViews[accessor.bufferView];
    const compressed = view.extensions?.EXT_meshopt_compression;
    let data = decodedViews.get(accessor.bufferView);
    if (!data) {
      if (compressed) {
        data = new Uint8Array(compressed.count * compressed.byteStride);
        MeshoptDecoder.decodeGltfBuffer(data, compressed.count, compressed.byteStride,
          payload.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), compressed.mode, compressed.filter);
      } else data = payload.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      decodedViews.set(accessor.bufferView, data);
    }
    const componentCount = accessor.type === "VEC3" ? 3 : accessor.type === "SCALAR" ? 1 : 0;
    if (!componentCount) throw new Error(`Unexpected geometry accessor ${accessor.type}`);
    const componentBytes = accessor.componentType === 5126 || accessor.componentType === 5125 ? 4
      : accessor.componentType === 5122 || accessor.componentType === 5123 ? 2 : 1;
    const values = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const read = (offset: number) => {
      const type = accessor.componentType;
      const value = type === 5126 ? values.getFloat32(offset, true) : type === 5125 ? values.getUint32(offset, true)
        : type === 5123 ? values.getUint16(offset, true) : type === 5122 ? values.getInt16(offset, true)
          : type === 5121 ? values.getUint8(offset) : values.getInt8(offset);
      const divisor = !accessor.normalized ? 1 : type === 5120 ? 127 : type === 5121 ? 255
        : type === 5122 ? 32767 : type === 5123 ? 65535 : 4294967295;
      return Math.max(accessor.normalized ? -1 : -Infinity, value / divisor);
    };
    const stride = view.byteStride ?? compressed?.byteStride ?? componentBytes * componentCount;
    return Array.from({ length: accessor.count * componentCount }, (_, valueIndex) => {
      const element = Math.floor(valueIndex / componentCount), component = valueIndex % componentCount;
      return read((accessor.byteOffset ?? 0) + element * stride + component * componentBytes);
    });
  };
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const surfaces: Mesh[] = [];
  const meshFor = (name: string) => {
    const { node, object } = named(name);
    if (node.mesh === undefined) throw new Error(`${name} has no geometry`);
    return model.meshes[node.mesh].primitives.map((primitive) => {
      expect(primitive.mode ?? 4, `${name} triangle primitive`).toBe(4);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(accessorValues(primitive.attributes.POSITION), 3));
      if (primitive.indices !== undefined) geometry.setIndex(accessorValues(primitive.indices));
      geometry.applyMatrix4(object.matrixWorld);
      const mesh = new Mesh(geometry, material);
      mesh.updateMatrixWorld(true);
      surfaces.push(mesh);
      return mesh;
    });
  };
  return {
    named, plaster: meshFor("East plaster wall"), cedar: meshFor("Cedar coffered roof"),
    dispose: () => { surfaces.forEach((mesh) => mesh.geometry.dispose()); material.dispose(); }
  };
}

describe.each(["lite", "cinematic"])("Alexandria shipped %s entrance geometry", (tier) => {
  let model: Awaited<ReturnType<typeof readPortalModel>>;
  beforeAll(async () => { model = await readPortalModel(tier); });
  afterAll(() => model?.dispose());
  const towardsWall = (x: number, y: number, surfaces: Mesh[]) => new Raycaster(
    new Vector3(x, y, architecture.wallZ - 1.9), new Vector3(0, 0, 1), 0, 2.2
  ).intersectObjects(surfaces, false);

  it("leaves the complete centered door-leaf area clear of the authored wall returns", () => {
    for (const x of [-2.1, -1.05, 0, 1.05, 2.1]) for (const y of [0.5, 1.5, 2.5, 3.5, 4.5]) {
      expect(towardsWall(architecture.centerX + x, y, model.plaster), `door ray x=${x}, y=${y}`).toHaveLength(0);
    }
  });

  it("closes the header up to and beyond the actual coffered-roof underside", () => {
    for (const x of [-2.1, 0, 2.1]) {
      // Sample behind the ends of the lower cedar beams and just inside the
      // plaster wall, so this measures the continuous roof slab itself.
      const roof = new Raycaster(new Vector3(x, 6.9, 10.73), new Vector3(0, 1, 0), 0, 0.9)
        .intersectObjects(model.cedar, false)[0];
      expect(roof, `roof over doorway x=${x}`).toBeDefined();
      expect(roof.point.y).toBeCloseTo(7.43, 2);
      for (const y of [5.1, 5.8, 6.5, 7.2, roof.point.y + 0.05]) {
        const hit = towardsWall(architecture.centerX + x, y, model.plaster)[0];
        expect(hit, `solid header x=${x}, y=${y}`).toBeDefined();
        expect(hit.point.z).toBeCloseTo(architecture.wallZ - architecture.wallDepth / 2, 2);
      }
    }
  });

  it("aligns the rear cabinet's actual carved stiles with its shelf and clearance anchors", () => {
    for (const [name, y] of [["SHELF_BAY_08", 0], ["CLEARANCE_BAY_08", 1.4]] as const) {
      const { object } = model.named(name);
      const position = object.getWorldPosition(new Vector3());
      expect(position.x).toBeCloseTo(architecture.rearShelfCenterX, 3);
      expect(position.y).toBeCloseTo(y, 3);
      expect(position.z).toBeCloseTo(10.35, 3);
      // App +Z is encoded as local +Y in the exported Blender object basis.
      const front = new Vector3(0, 1, 0).transformDirection(object.matrixWorld);
      expect(front.z).toBeCloseTo(-1, 3);
    }
    const halfStileSpacing = 4.15 / 2 + 0.31;
    for (const side of [-1, 1]) {
      const x = architecture.rearShelfCenterX + side * halfStileSpacing;
      const hit = towardsWall(x, 3.02, model.cedar)[0];
      expect(hit, `rear cabinet stile at x=${x}`).toBeDefined();
      expect(hit.point.z).toBeCloseTo(9.93, 2);
    }
    // The old right-hand stile intruded beside the centered entrance.
    expect(towardsWall(-4.3 + halfStileSpacing, 3.02, model.cedar)).toHaveLength(0);
  });
});
