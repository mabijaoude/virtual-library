import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = process.cwd();
const distRoot = path.join(root, "dist");
const cataloguePath = path.join(root, "public", "library-manifest.json");
const limits = {
  catalogueRaw: 1_000_000,
  catalogueGzip: 200_000,
  initialScriptGzip: 190_000,
  initialStyleGzip: 45_000,
  sceneBootstrapGzip: 450_000,
  readerBootstrapGzip: 220_000,
  fallbackModelBytes: 2 * 1024 * 1024,
  completeModelBytes: 12 * 1024 * 1024,
  completeRoomBytes: 16 * 1024 * 1024
};

const catalogue = await readFile(cataloguePath);
const indexHtml = await readFile(path.join(distRoot, "index.html"), "utf8");
const initialAssets = Array.from(indexHtml.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+\.(?:js|css))"/g), (match) => match[1]);
const uniqueAssets = Array.from(new Set(initialAssets));
const scripts = uniqueAssets.filter((asset) => asset.endsWith(".js"));
const styles = uniqueAssets.filter((asset) => asset.endsWith(".css"));

const scriptGzip = await gzipTotal(scripts);
const styleGzip = await gzipTotal(styles);
const viteManifest = JSON.parse(await readFile(path.join(distRoot, ".vite", "manifest.json"), "utf8"));
const shellGraph = manifestGraph(viteManifest, Object.keys(viteManifest).filter((key) => viteManifest[key].isEntry));
const sceneEntry = Object.keys(viteManifest).find((key) => key.endsWith("src/components/LibraryScene.tsx") || key.endsWith("components/LibraryScene.tsx"));
const readerEntry = Object.keys(viteManifest).find((key) => key.endsWith("src/components/Reader.tsx") || key.endsWith("components/Reader.tsx"));
const shellGraphGzip = await gzipTotal(shellGraph.filter((asset) => asset.endsWith(".js")));
const sceneGraphGzip = sceneEntry ? await gzipTotal(manifestGraph(viteManifest, [sceneEntry]).filter((asset) => asset.endsWith(".js"))) : Number.POSITIVE_INFINITY;
const readerGraphGzip = readerEntry ? await gzipTotal(manifestGraph(viteManifest, [readerEntry]).filter((asset) => asset.endsWith(".js"))) : Number.POSITIVE_INFINITY;
const rawModels = (await readdir(path.join(distRoot, "worlds", "assets", "models"))).filter((file) => file.endsWith(".raw.glb"));
const liteModels = (await readdir(path.join(distRoot, "worlds", "assets", "models"))).filter((file) => file.endsWith("-lite.glb"));
const largestLiteModel = Math.max(0, ...await Promise.all(liteModels.map(async (file) => (await stat(path.join(distRoot, "worlds", "assets", "models", file))).size)));
const worldAssets = JSON.parse(await readFile(path.join(root, "public", "worlds", "world-assets.json"), "utf8"));
const completeBundles = Object.values(worldAssets.worlds).map((world) => world.complete);
const largestCompleteModel = Math.max(0, ...completeBundles.map((bundle) => bundle.modelBytes));
const largestCompleteRoom = Math.max(0, ...completeBundles.map((bundle) => bundle.bytes));
const results = [
  budget("catalogue raw", catalogue.byteLength, limits.catalogueRaw),
  budget("catalogue gzip", gzipSync(catalogue).byteLength, limits.catalogueGzip),
  budget("initial scripts gzip", scriptGzip, limits.initialScriptGzip),
  budget("catalogue shell graph gzip", shellGraphGzip, limits.initialScriptGzip),
  budget("scene bootstrap graph gzip", sceneGraphGzip, limits.sceneBootstrapGzip),
  budget("reader bootstrap graph gzip", readerGraphGzip, limits.readerBootstrapGzip),
  budget("initial styles gzip", styleGzip, limits.initialStyleGzip),
  budget("largest fallback world model", largestLiteModel, limits.fallbackModelBytes),
  budget("largest complete world model", largestCompleteModel, limits.completeModelBytes),
  budget("largest complete room bundle", largestCompleteRoom, limits.completeRoomBytes),
  { label: "raw source models in dist", value: rawModels.length, limit: 0, pass: rawModels.length === 0 }
];

for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.label}: ${format(result.value)} / ${format(result.limit)}`);
if (results.some((result) => !result.pass)) process.exitCode = 1;

async function gzipTotal(assets) {
  let total = 0;
  for (const asset of assets) {
    const file = path.join(distRoot, asset.replace(/^\//, ""));
    await stat(file);
    total += gzipSync(await readFile(file)).byteLength;
  }
  return total;
}

function manifestGraph(manifest, entryKeys) {
  const seenKeys = new Set();
  const files = new Set();
  const visit = (key) => {
    if (seenKeys.has(key) || !manifest[key]) return;
    seenKeys.add(key);
    const entry = manifest[key];
    if (entry.file) files.add(entry.file);
    for (const imported of entry.imports || []) visit(imported);
  };
  entryKeys.forEach(visit);
  return [...files];
}

function budget(label, value, limit) {
  return { label, value, limit, pass: value <= limit };
}

function format(value) {
  return value === 0 ? "0" : `${(value / 1024).toFixed(1)} KiB`;
}
