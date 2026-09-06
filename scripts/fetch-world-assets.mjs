import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

const root = process.cwd();
const cacheRoot = path.join(root, ".asset-cache", "worlds");
const lockPath = path.join(root, "art-source", "asset-lock.json");

const ambientMaterials = [
  "Wood051", "WoodFloor051", "Travertine009", "Plaster001",
  "GlazedTerracotta001", "Metal063", "Leather037", "Concrete034", "Marble012"
];

const polyHavenHdris = {
  heritage: "entrance_hall",
  gothic: "blaubeuren_night",
  modern: "glasshouse_interior",
  renaissance: "courtyard",
  deco: "dresden_station_night",
  foundry: "boiler_room"
};

const polyHavenModels = [
  "ArmChair_01", "Chandelier_01", "GothicCabinet_01", "gothic_statue",
  "modern_arm_chair_01", "modern_ceiling_lamp_01", "marble_bust_01", "WoodenTable_02",
  "mid_century_lounge_chair", "industrial_caged_sconce", "old_drill_press", "power_box_01"
];

await mkdir(cacheRoot, { recursive: true });
const records = [];

for (const id of ambientMaterials) {
  const metadata = await getJson(`https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData,displayData,tagData`);
  const asset = metadata.foundAssets?.[0];
  if (!asset) throw new Error(`ambientCG asset not found: ${id}`);
  const downloads = asset.downloadFolders.default.downloadFiletypeCategories.zip.downloads;
  const download = downloads.find((candidate) => candidate.attribute === "1K-JPG");
  if (!download) throw new Error(`No 1K-JPG download for ${id}`);
  const archivePath = path.join(cacheRoot, "ambientcg", download.fileName);
  const archive = await downloadFile(download.downloadLink, archivePath, download.size);
  const outputDir = path.join(cacheRoot, "ambientcg", id);
  await mkdir(outputDir, { recursive: true });
  const extracted = unzipSync(new Uint8Array(archive));
  const derivatives = [];
  for (const [name, bytes] of Object.entries(extracted)) {
    if (name.endsWith("/") || name.includes("..")) continue;
    const file = path.join(outputDir, path.basename(name));
    await writeFile(file, bytes);
    derivatives.push({ file: relative(file), bytes: bytes.byteLength, sha256: digest(bytes) });
  }
  records.push({
    id,
    kind: "pbr-material",
    provider: "ambientCG",
    title: asset.displayName,
    sourceUrl: asset.shortLink,
    license: "CC0-1.0",
    author: "ambientCG / Lennart Demes",
    archive: { url: download.downloadLink, bytes: archive.byteLength, sha256: digest(archive) },
    derivatives
  });
  console.log(`Fetched ambientCG ${id}`);
}

for (const [world, id] of Object.entries(polyHavenHdris)) {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const source = files.hdri?.["1k"]?.hdr;
  if (!source) throw new Error(`No 1K HDR for ${id}`);
  const file = path.join(cacheRoot, "polyhaven", "hdris", `${id}_1k.hdr`);
  const bytes = await downloadFile(source.url, file, source.size);
  records.push({
    id,
    world,
    kind: "hdri",
    provider: "Poly Haven",
    title: id.replaceAll("_", " "),
    sourceUrl: `https://polyhaven.com/a/${id}`,
    license: "CC0-1.0",
    author: "Poly Haven contributors",
    file: relative(file),
    bytes: bytes.byteLength,
    sha256: digest(bytes),
    upstreamMd5: source.md5
  });
  console.log(`Fetched Poly Haven HDRI ${id}`);
}

for (const id of polyHavenModels) {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const source = files.gltf?.["1k"]?.gltf;
  if (!source) throw new Error(`No 1K glTF for ${id}`);
  const outputDir = path.join(cacheRoot, "polyhaven", "models", id);
  const derivatives = [];
  await mkdir(outputDir, { recursive: true });
  const entries = [[`${id}_1k.gltf`, source], ...Object.entries(source.include || {})];
  for (const [name, descriptor] of entries) {
    const file = path.join(outputDir, name.replaceAll("/", path.sep));
    const bytes = await downloadFile(descriptor.url, file, descriptor.size);
    derivatives.push({ file: relative(file), bytes: bytes.byteLength, sha256: digest(bytes), upstreamMd5: descriptor.md5 });
  }
  records.push({
    id,
    kind: "model",
    provider: "Poly Haven",
    title: id.replaceAll("_", " "),
    sourceUrl: `https://polyhaven.com/a/${id}`,
    license: "CC0-1.0",
    author: "Poly Haven contributors",
    derivatives
  });
  console.log(`Fetched Poly Haven model ${id}`);
}

const lock = {
  version: 1,
  generatedBy: "scripts/fetch-world-assets.mjs",
  policy: "CC0 and project-generated assets only; no runtime remote URLs.",
  records
};
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`Wrote ${records.length} locked asset records.`);

async function getJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "VirtualLibrary/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function downloadFile(url, file, expectedBytes) {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    if (!expectedBytes || (await stat(file)).size === expectedBytes) return readFile(file);
  } catch {
    // Cache miss.
  }
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "VirtualLibrary/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expectedBytes && bytes.byteLength !== expectedBytes) throw new Error(`Unexpected byte count for ${url}: ${bytes.byteLength} != ${expectedBytes}`);
  await writeFile(file, bytes);
  return bytes;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

