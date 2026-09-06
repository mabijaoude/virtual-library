import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const modelRoot = path.join(root, "public", "worlds", "assets", "models");
const rawModelRoot = path.join(root, ".asset-cache", "worlds", "generated-models");
const worlds = ["heritage", "gothic", "modern", "renaissance", "deco", "foundry"];
let synced = 0;

for (const world of worlds) {
  for (const tier of ["cinematic", "lite"]) {
    const rawBuffer = await readFile(path.join(rawModelRoot, `${world}-${tier}.raw.glb`));
    const optimizedPath = path.join(modelRoot, `${world}-${tier}.glb`);
    const optimizedBuffer = await readFile(optimizedPath);
    const raw = parseGlbJson(rawBuffer);
    const optimized = parseGlbJson(optimizedBuffer);
    const rawTransforms = new Map(
      (raw.nodes || [])
        .filter((node) => node.extras?.syncTransform)
        .map((node) => [node.name, node])
    );
    for (const node of optimized.nodes || []) {
      const source = rawTransforms.get(node.name);
      if (!source) continue;
      if (source.translation) node.translation = source.translation;
      if (source.rotation) node.rotation = source.rotation;
      else delete node.rotation;
      const sourceScale = source.scale || [1, 1, 1];
      const reconstruction = reconstructionScale(raw, source, optimized, node);
      node.scale = sourceScale.map((value, index) => value * reconstruction[index]);
      delete node.matrix;
      synced += 1;
    }
    await writeFile(optimizedPath, replaceGlbJson(optimizedBuffer, optimized));
  }
}

console.log(`Synchronized ${synced} optimized primitive transforms from Blender.`);

function reconstructionScale(raw, rawNode, optimized, optimizedNode) {
  const rawPrimitive = raw.meshes?.[rawNode.mesh]?.primitives?.[0];
  const optimizedPrimitive = optimized.meshes?.[optimizedNode.mesh]?.primitives?.[0];
  if (!rawPrimitive || !optimizedPrimitive) return [1, 1, 1];
  const rawAccessor = raw.accessors?.[rawPrimitive.attributes?.POSITION];
  const optimizedAccessor = optimized.accessors?.[optimizedPrimitive.attributes?.POSITION];
  if (!rawAccessor?.min || !rawAccessor?.max || !optimizedAccessor?.min || !optimizedAccessor?.max) return [1, 1, 1];
  const optimizedMin = decodeAccessorBounds(optimizedAccessor, optimizedAccessor.min);
  const optimizedMax = decodeAccessorBounds(optimizedAccessor, optimizedAccessor.max);
  return [0, 1, 2].map((axis) => {
    const rawExtent = rawAccessor.max[axis] - rawAccessor.min[axis];
    const optimizedExtent = optimizedMax[axis] - optimizedMin[axis];
    return optimizedExtent ? rawExtent / optimizedExtent : 1;
  });
}

function decodeAccessorBounds(accessor, values) {
  if (!accessor.normalized) return values;
  const divisor = accessor.componentType === 5120 ? 127
    : accessor.componentType === 5121 ? 255
      : accessor.componentType === 5122 ? 32767
        : accessor.componentType === 5123 ? 65535
          : accessor.componentType === 5125 ? 4294967295
            : 1;
  const signed = accessor.componentType === 5120 || accessor.componentType === 5122;
  return values.map((value) => signed ? Math.max(-1, value / divisor) : value / divisor);
}

function parseGlbJson(buffer) {
  let offset = 12;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString("utf8").replace(/\u0000+$/g, ""));
    offset += 8 + length;
  }
  throw new Error("GLB JSON chunk not found");
}

function replaceGlbJson(buffer, json) {
  const jsonSource = Buffer.from(JSON.stringify(json));
  const padding = (4 - (jsonSource.length % 4)) % 4;
  const jsonChunk = Buffer.alloc(8 + jsonSource.length + padding, 0x20);
  jsonChunk.writeUInt32LE(jsonSource.length + padding, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  jsonSource.copy(jsonChunk, 8);
  const chunks = [jsonChunk];
  let offset = 12;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (type !== 0x4e4f534a) chunks.push(buffer.subarray(offset, offset + 8 + length));
    offset += 8 + length;
  }
  const total = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, ...chunks], total);
}
