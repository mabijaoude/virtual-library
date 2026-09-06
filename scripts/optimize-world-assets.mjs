import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import validator from "gltf-validator";

const root = process.cwd();
const { values: options } = parseArgs({ options: { "validate-only": { type: "boolean" }, world: { type: "string", multiple: true } } });
const validateOnly = options["validate-only"];
const worlds = ["heritage", "gothic", "modern", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria"];
const selectedWorlds = options.world || worlds;
for (const world of selectedWorlds) if (!worlds.includes(world)) throw new Error(`Unknown world: ${world}`);
const hdriByWorld = {
  heritage: "entrance_hall",
  gothic: "blaubeuren_night",
  modern: "glasshouse_interior",
  renaissance: "courtyard",
  deco: "dresden_station_night",
  foundry: "boiler_room",
  lunar: "glasshouse_interior",
  arkship: "dresden_station_night",
  alexandria: "courtyard"
};
const artByWorld = {
  heritage: "heritage",
  gothic: "gothic",
  modern: null,
  renaissance: null,
  deco: null,
  foundry: null,
  lunar: null,
  arkship: null,
  alexandria: "alexandria"
};
const ambientProfiles = {
  heritage: "fire-rain",
  gothic: "cathedral-air",
  modern: "museum-hvac",
  renaissance: "courtyard-water",
  deco: "city-room-tone",
  foundry: "foundry-machinery",
  lunar: "lunar-life-support",
  arkship: "arkship-reactor",
  alexandria: "harbor-wind"
};
const exteriorByWorld = {
  lunar: ["lunar-surface-color.webp", "lunar-surface-height.webp", "earth-blue-marble.webp"],
  arkship: ["arkship-nebula.webp", "arkship-planet.webp"]
};

const modelDir = path.join(root, "public", "worlds", "assets", "models");
const rawModelDir = path.join(root, ".asset-cache", "worlds", "generated-models");
const environmentDir = path.join(root, "public", "worlds", "assets", "environments");
const basisDir = path.join(root, "public", "basis");
const gltfCli = path.join(root, "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
await Promise.all([mkdir(modelDir, { recursive: true }), mkdir(rawModelDir, { recursive: true }), mkdir(environmentDir, { recursive: true }), mkdir(basisDir, { recursive: true })]);

const ktxBin = path.join(process.env.USERPROFILE || "", ".cache", "codex-tools", "KTX-Software-4.4.2-extracted", "bin");
if (existsSync(ktxBin)) process.env.PATH = `${ktxBin}${path.delimiter}${process.env.PATH || ""}`;

for (const file of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
  await copyFile(path.join(root, "node_modules", "three", "examples", "jsm", "libs", "basis", file), path.join(basisDir, file));
}

for (const [world, hdri] of Object.entries(hdriByWorld)) {
  await copyFile(
    path.join(root, ".asset-cache", "worlds", "polyhaven", "hdris", `${hdri}_1k.hdr`),
    path.join(environmentDir, `${world}.hdr`)
  );
}

for (const world of worlds) {
  for (const tier of ["cinematic", "lite"]) {
    const input = path.join(rawModelDir, `${world}-${tier}.raw.glb`);
    const output = path.join(modelDir, `${world}-${tier}.glb`);
    if (!existsSync(input)) throw new Error(`Missing Blender output: ${path.relative(root, input)}`);
    const current = validateOnly || !selectedWorlds.includes(world) || (existsSync(output)
      && (await stat(output)).mtimeMs > (await stat(input)).mtimeMs
      && await hasExpectedTextureEncoding(output, tier));
    if (!current) {
      const intermediates = [];
      let optimizedInput = input;
      try {
        if (tier === "lite") {
          const resized = path.join(rawModelDir, `${world}-lite.pipeline-resized.glb`);
          const webp = path.join(rawModelDir, `${world}-lite.pipeline-webp.glb`);
          intermediates.push(resized, webp);
          runGltfTransform([
            "resize", input, resized,
            "--width", "512",
            "--height", "512"
          ], `${world}-${tier} texture resize`);
          runGltfTransform([
            "webp", resized, webp,
            "--quality", "90",
            "--effort", "80"
          ], `${world}-${tier} WebP encoding`);
          optimizedInput = webp;
        }
        runGltfTransform([
          "optimize", optimizedInput, output,
          "--compress", "meshopt",
          "--meshopt-level", "high",
          "--flatten", "false",
          "--join", world === "alexandria" ? "true" : "false",
          "--simplify", "false",
          "--palette", "false",
          "--texture-compress", tier === "cinematic" ? "ktx2" : "false",
          ...(tier === "cinematic" ? ["--texture-size", "1024"] : [])
        ], `${world}-${tier} optimization`);
      } finally {
        await Promise.all(intermediates.map((file) => rm(file, { force: true })));
      }
    }
  }
}

const manifest = { version: 1, generatedBy: "scripts/optimize-world-assets.mjs", localOnly: true, worlds: {} };
for (const world of worlds) {
  const environmentFile = path.join(environmentDir, `${world}.hdr`);
  const backplateFile = world === "deco" ? null : path.join(root, "public", "worlds", "assets", "backplates", `${world}.webp`);
  const art = artByWorld[world];
  const artFile = art ? path.join(root, "public", "worlds", "assets", "art", `${art}.webp`) : null;
  const exteriorFiles = (exteriorByWorld[world] || []).map((file) => path.join(root, "public", "worlds", "assets", "exteriors", file));
  const shared = {
    environment: `/worlds/assets/environments/${world}.hdr`,
    backplate: backplateFile ? `/worlds/assets/backplates/${world}.webp` : null,
    art: art ? `/worlds/assets/art/${art}.webp` : null,
    exterior: (exteriorByWorld[world] || []).map((file) => `/worlds/assets/exteriors/${file}`),
    audioZones: [ambientProfiles[world]]
  };
  const tiers = {};
  for (const tier of ["cinematic", "lite"]) {
    const file = path.join(modelDir, `${world}-${tier}.glb`);
    const rawFile = path.join(rawModelDir, `${world}-${tier}.raw.glb`);
    let bytes = await readFile(file);
    const semanticResult = preserveSemanticNodes(bytes, await readFile(rawFile));
    if (semanticResult.changed) {
      bytes = semanticResult.buffer;
      await writeFile(file, bytes);
    }
    const report = await validator.validateBytes(new Uint8Array(bytes), {
      uri: path.basename(file),
      format: "glb",
      maxIssues: 100,
      writeTimestamp: false
    });
    if (report.issues.numErrors) {
      const errors = report.issues.messages.filter((message) => message.severity === 0).map((message) => message.code).join(", ");
      throw new Error(`${world}-${tier} failed glTF validation: ${errors}`);
    }
    const json = parseGlbJson(bytes);
    const nodeNames = new Set((json.nodes || []).map((node) => node.name));
    const missing = ["SPAWN", ...Array.from({ length: 9 }, (_, index) => `SHELF_BAY_${String(index).padStart(2, "0")}`)].filter((name) => !nodeNames.has(name));
    if (missing.length) throw new Error(`${world}-${tier} is missing anchors: ${missing.join(", ")}`);
    if (/https?:\/\//i.test(JSON.stringify(json))) throw new Error(`${world}-${tier} contains a remote runtime URL`);
    const textureExtension = tier === "cinematic" ? "KHR_texture_basisu" : "EXT_texture_webp";
    if (!(json.extensionsUsed || []).includes(textureExtension)) throw new Error(`${world}-${tier} did not receive ${tier === "cinematic" ? "KTX2" : "WebP"} textures`);
    if (!(json.extensionsUsed || []).includes("EXT_meshopt_compression")) throw new Error(`${world}-${tier} did not receive Meshopt compression`);
    const metrics = glbMetrics(json);
    const modelBytes = bytes.byteLength;
    const environmentBytes = (await stat(environmentFile)).size;
    const backplateBytes = backplateFile ? (await stat(backplateFile)).size : 0;
    const artBytes = artFile ? (await stat(artFile)).size : 0;
    const exteriorBytes = (await Promise.all(exteriorFiles.map((file) => stat(file)))).reduce((sum, value) => sum + value.size, 0);
    tiers[tier] = {
      model: `/worlds/assets/models/${world}-${tier}.glb`,
      ...shared,
      bytes: modelBytes + environmentBytes + backplateBytes + artBytes + exteriorBytes,
      modelBytes,
      contentHash: sha256(bytes),
      triangles: report.info?.totalTriangleCount ?? metrics.triangles,
      vertices: report.info?.totalVertexCount ?? metrics.vertices,
      nodes: json.nodes?.length || 0,
      materials: report.info?.materialCount ?? metrics.materials,
      drawCalls: report.info?.drawCallCount ?? metrics.drawCalls,
      validatorErrors: report.issues.numErrors || 0,
      validatorWarnings: report.issues.numWarnings || 0
    };
  }
  manifest.worlds[world] = {
    complete: tiers.cinematic,
    fallback: tiers.lite
  };
}

await writeFile(path.join(root, "public", "worlds", "world-assets.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Validated and locked all cinematic world bundles.");

function runGltfTransform(args, label) {
  const result = spawnSync(process.execPath, [gltfCli, ...args], { cwd: root, env: process.env, stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`${label} failed: ${result.error?.message || `exit ${result.status}`}`);
}

async function hasExpectedTextureEncoding(file, tier) {
  try {
    const json = parseGlbJson(await readFile(file));
    const expected = tier === "cinematic" ? "KHR_texture_basisu" : "EXT_texture_webp";
    return (json.extensionsUsed || []).includes(expected);
  } catch {
    return false;
  }
}

function parseGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("Expected a GLB file");
  let offset = 12;
  while (offset < buffer.byteLength) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString("utf8").replace(/\u0000+$/g, ""));
    offset += 8 + length;
  }
  throw new Error("GLB JSON chunk not found");
}

function glbMetrics(json) {
  const accessors = json.accessors || [];
  let triangles = 0;
  let vertices = 0;
  let drawCalls = 0;
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      drawCalls += 1;
      const vertexCount = accessors[primitive.attributes?.POSITION]?.count || 0;
      const elementCount = primitive.indices === undefined
        ? vertexCount
        : accessors[primitive.indices]?.count || 0;
      vertices += vertexCount;
      if (primitive.mode === 5 || primitive.mode === 6) triangles += Math.max(0, elementCount - 2);
      else if (primitive.mode === undefined || primitive.mode === 4) triangles += Math.floor(elementCount / 3);
    }
  }
  return { triangles, vertices, drawCalls, materials: json.materials?.length || 0 };
}

function preserveSemanticNodes(optimizedBuffer, rawBuffer) {
  const optimized = parseGlbJson(optimizedBuffer);
  const raw = parseGlbJson(rawBuffer);
  const semanticPattern = /^(SPAWN|SHELF_BAY_\d{2}|CLEARANCE_BAY_\d{2}|LANDMARK_|COLLIDER_)/;
  const semanticNodes = (raw.nodes || []).filter((node) => semanticPattern.test(node.name || ""));
  optimized.nodes ||= [];
  let changed = false;
  const rootIndex = optimized.nodes.findIndex((node) => node.name === "WORLD_COORDINATE_ROOT");
  let semanticRootIndex = rootIndex;
  if (semanticRootIndex < 0) {
    const sourceRoot = (raw.nodes || []).find((node) => node.name === "WORLD_COORDINATE_ROOT");
    if (!sourceRoot) throw new Error("Raw GLB is missing WORLD_COORDINATE_ROOT");
    const rootNode = Object.fromEntries(Object.entries(sourceRoot).filter(([key]) => !["mesh", "camera", "skin", "children"].includes(key)));
    rootNode.children = [];
    semanticRootIndex = optimized.nodes.length;
    optimized.nodes.push(rootNode);
    const sceneIndex = optimized.scene || 0;
    optimized.scenes ||= [{ nodes: [] }];
    optimized.scenes[sceneIndex] ||= { nodes: [] };
    optimized.scenes[sceneIndex].nodes ||= [];
    optimized.scenes[sceneIndex].nodes.push(semanticRootIndex);
    changed = true;
  }
  const rootNode = optimized.nodes[semanticRootIndex];
  rootNode.children ||= [];
  for (const source of semanticNodes) {
    const node = Object.fromEntries(Object.entries(source).filter(([key]) => !["mesh", "camera", "skin", "children"].includes(key)));
    const existingIndex = optimized.nodes.findIndex((candidate) => candidate.name === source.name);
    if (existingIndex >= 0) {
      const existing = optimized.nodes[existingIndex];
      const next = { ...existing, ...node };
      if (JSON.stringify(existing) !== JSON.stringify(next)) {
        optimized.nodes[existingIndex] = next;
        changed = true;
      }
      continue;
    }
    rootNode.children.push(optimized.nodes.length);
    optimized.nodes.push(node);
    changed = true;
  }
  return changed ? { changed: true, buffer: replaceGlbJson(optimizedBuffer, optimized) } : { changed: false, buffer: optimizedBuffer };
}

function replaceGlbJson(buffer, json) {
  const jsonSource = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - (jsonSource.length % 4)) % 4;
  const jsonChunk = Buffer.alloc(8 + jsonSource.length + jsonPadding, 0x20);
  jsonChunk.writeUInt32LE(jsonSource.length + jsonPadding, 0);
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
  const totalLength = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  return Buffer.concat([header, ...chunks], totalLength);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
