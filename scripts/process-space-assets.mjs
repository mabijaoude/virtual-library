import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const cache = path.join(root, ".asset-cache", "worlds", "nasa");
const exteriorDir = path.join(root, "public", "worlds", "assets", "exteriors");
const backplateDir = path.join(root, "public", "worlds", "assets", "backplates");
const previewSourceDir = path.join(root, "art-source", "previews");
const mobileBaselineDir = path.join(root, "art-source", "baselines", "mobile");
await Promise.all([cache, exteriorDir, backplateDir, previewSourceDir, mobileBaselineDir].map((directory) => mkdir(directory, { recursive: true })));

const nasaUsage = {
  rights: "NASA content generally is not subject to copyright in the United States; use is subject to the NASA Images and Media Usage Guidelines.",
  rightsUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/"
};

const sources = [
  {
    id: "lroc-color",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg",
    page: "https://svs.gsfc.nasa.gov/4720/",
    credit: "NASA Scientific Visualization Studio / LRO WAC",
    ...nasaUsage
  },
  {
    id: "lroc-height",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg",
    page: "https://svs.gsfc.nasa.gov/4720/",
    credit: "NASA Scientific Visualization Studio / LOLA and Kaguya Terrain Camera",
    ...nasaUsage
  },
  {
    id: "blue-marble",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-2048.png",
    page: "https://svs.gsfc.nasa.gov/2915/",
    credit: "NASA Earth Observatory / Scientific Visualization Studio",
    ...nasaUsage
  }
];

for (const source of sources) {
  source.cacheFile = path.join(cache, path.basename(new URL(source.url).pathname));
  if (!existsSync(source.cacheFile)) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Unable to download ${source.url}: ${response.status}`);
    await writeFile(source.cacheFile, Buffer.from(await response.arrayBuffer()));
  }
  source.sourceSha256 = sha256(await readFile(source.cacheFile));
}

const colorSource = sources.find((source) => source.id === "lroc-color").cacheFile;
const heightSource = sources.find((source) => source.id === "lroc-height").cacheFile;
const earthSource = sources.find((source) => source.id === "blue-marble").cacheFile;
const output = {
  lunarColor: path.join(exteriorDir, "lunar-surface-color.webp"),
  lunarHeight: path.join(exteriorDir, "lunar-surface-height.webp"),
  earth: path.join(exteriorDir, "earth-blue-marble.webp"),
  nebula: path.join(exteriorDir, "arkship-nebula.webp"),
  planet: path.join(exteriorDir, "arkship-planet.webp")
};

await sharp(colorSource)
  .resize(1536, 1536, { fit: "cover", position: "south" })
  .modulate({ brightness: 0.82, saturation: 0.28 })
  .sharpen({ sigma: 0.8 })
  .webp({ quality: 80, effort: 6, smartSubsample: true })
  .toFile(output.lunarColor);

await sharp(heightSource)
  .resize(1536, 1536, { fit: "cover", position: "south" })
  .greyscale()
  .linear(1.38, -46)
  .blur(0.35)
  .webp({ quality: 84, effort: 6 })
  .toFile(output.lunarHeight);

await sharp(earthSource)
  .resize(1536, 768, { fit: "fill" })
  .webp({ quality: 84, effort: 6, smartSubsample: true })
  .toFile(output.earth);

await sharp(createNebula(1536, 768, 24112079), { raw: { width: 1536, height: 768, channels: 4 } })
  .blur(2.2)
  .webp({ quality: 80, effort: 6, smartSubsample: true })
  .toFile(output.nebula);

await sharp(createPlanet(1024, 512, 14031972), { raw: { width: 1024, height: 512, channels: 4 } })
  .webp({ quality: 84, effort: 6, smartSubsample: true })
  .toFile(output.planet);

const lunarBackplate = path.join(backplateDir, "lunar.webp");
const arkshipBackplate = path.join(backplateDir, "arkship.webp");
await sharp(output.lunarColor).resize(1536, 864, { fit: "cover", position: "center" }).webp({ quality: 72, effort: 6 }).toFile(lunarBackplate);
await sharp(output.nebula).resize(1536, 864, { fit: "cover" }).webp({ quality: 72, effort: 6 }).toFile(arkshipBackplate);

// These images make first-run Atlas cards and tests resilient before the
// browser-capture task replaces them with approved scene screenshots.
for (const [world, backplate] of [["lunar", lunarBackplate], ["arkship", arkshipBackplate]]) {
  const preview = path.join(previewSourceDir, `${world}.jpg`);
  if (!existsSync(preview)) await sharp(backplate).resize(1440, 810, { fit: "cover" }).jpeg({ quality: 88 }).toFile(preview);
  const mobile = path.join(mobileBaselineDir, `${world}.jpg`);
  if (!existsSync(mobile)) await sharp(backplate).resize(390, 844, { fit: "cover" }).jpeg({ quality: 86 }).toFile(mobile);
}

const derivatives = [];
for (const file of Object.values(output).concat([lunarBackplate, arkshipBackplate])) {
  derivatives.push({
    file: path.relative(root, file).replaceAll("\\", "/"),
    bytes: (await stat(file)).size,
    sha256: sha256(await readFile(file))
  });
}
await writeFile(path.join(exteriorDir, "space-assets.json"), `${JSON.stringify({
  version: 1,
  generatedBy: "scripts/process-space-assets.mjs",
  runtimeRemoteUrls: false,
  sources: sources.map(({ cacheFile, ...source }) => ({ ...source, cacheFile: path.relative(root, cacheFile).replaceAll("\\", "/") })),
  derivatives
}, null, 2)}\n`);

console.log("Processed NASA lunar references and project-generated deep-space textures.");

function createNebula(width, height, seed) {
  const data = Buffer.alloc(width * height * 4);
  const random = seededRandom(seed);
  const wisps = Array.from({ length: 20 }, (_, index) => ({
    x: random() * width,
    y: random() * height,
    rx: width * (0.08 + random() * 0.23),
    ry: height * (0.04 + random() * 0.18),
    tint: index % 3
  }));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 2;
      let g = 4;
      let b = 10;
      for (const wisp of wisps) {
        const dx = (x - wisp.x) / wisp.rx;
        const dy = (y - wisp.y) / wisp.ry;
        const strength = Math.exp(-(dx * dx + dy * dy) * 2.2);
        if (wisp.tint === 0) { r += 58 * strength; b += 96 * strength; }
        else if (wisp.tint === 1) { g += 55 * strength; b += 92 * strength; }
        else { r += 82 * strength; g += 35 * strength; b += 64 * strength; }
      }
      const grain = random() * 8;
      const offset = (y * width + x) * 4;
      data[offset] = Math.min(255, r + grain);
      data[offset + 1] = Math.min(255, g + grain * 0.7);
      data[offset + 2] = Math.min(255, b + grain);
      data[offset + 3] = 255;
    }
  }
  return data;
}

function createPlanet(width, height, seed) {
  const data = Buffer.alloc(width * height * 4);
  const random = seededRandom(seed);
  const phase = Array.from({ length: 13 }, () => random() * Math.PI * 2);
  for (let y = 0; y < height; y += 1) {
    const latitude = y / height;
    const band = Math.sin(latitude * Math.PI * 13 + phase[y % phase.length]) * 0.5 + 0.5;
    for (let x = 0; x < width; x += 1) {
      const storm = Math.sin(x / width * Math.PI * 10 + latitude * 19) * 0.5 + 0.5;
      const detail = random() * 14;
      const offset = (y * width + x) * 4;
      data[offset] = 74 + band * 54 + storm * 18 + detail;
      data[offset + 1] = 92 + band * 62 + storm * 12 + detail;
      data[offset + 2] = 112 + band * 70 + detail;
      data[offset + 3] = 255;
    }
  }
  return data;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
