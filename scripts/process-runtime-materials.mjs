import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const cache = path.join(root, ".asset-cache", "worlds", "ambientcg");
const output = path.join(root, "public", "worlds", "assets", "materials");
const generated = path.join(root, "art-source", "generated", "materials");
await mkdir(output, { recursive: true });

const definitions = [
  ["Wood051", "Color", "shelf-wood-color.webp"],
  ["Wood051", "NormalGL", "shelf-wood-normal.webp"],
  ["Wood051", "Roughness", "shelf-wood-roughness.webp"],
  ["Concrete034", "Color", "shelf-concrete-color.webp"],
  ["Concrete034", "NormalGL", "shelf-concrete-normal.webp"],
  ["Concrete034", "Roughness", "shelf-concrete-roughness.webp"],
  ["Metal063", "Color", "shelf-metal-color.webp"],
  ["Metal063", "NormalGL", "shelf-metal-normal.webp"],
  ["Metal063", "Roughness", "shelf-metal-roughness.webp"],
  ["Travertine009", "Color", "boundary-stone-color.webp"],
  ["Travertine009", "NormalGL", "boundary-stone-normal.webp"],
  ["Travertine009", "Roughness", "boundary-stone-roughness.webp"],
  ["Marble012", "Color", "marble-color.webp"],
  ["Marble012", "NormalGL", "marble-normal.webp"],
  ["Marble012", "Roughness", "marble-roughness.webp"],
  ["Plaster001", "Color", "dome-plaster-color.webp"],
  ["Plaster001", "NormalGL", "dome-plaster-normal.webp"],
  ["Plaster001", "Roughness", "dome-plaster-roughness.webp"],
  ["Leather037", "NormalGL", "book-leather-normal.webp"],
  ["Leather037", "Roughness", "book-leather-roughness.webp"],
  ["Metal063", "NormalGL", "hardware-metal-normal.webp"],
  ["Metal063", "Roughness", "hardware-metal-roughness.webp"],
  ["Plaster001", "NormalGL", "paper-normal.webp"]
];

const assets = [];
for (const [material, channel, filename] of definitions) {
  const source = path.join(cache, material, `${material}_1K-JPG_${channel}.jpg`);
  const target = path.join(output, filename);
  await sharp(source).resize(512, 512, { kernel: sharp.kernel.lanczos3 }).webp({ quality: 88, effort: 6 }).toFile(target);
  const bytes = await readFile(target);
  assets.push({
    source: `.asset-cache/worlds/ambientcg/${material}/${path.basename(source)}`,
    file: `/worlds/assets/materials/${filename}`,
    width: 512,
    height: 512,
    bytes: (await stat(target)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    license: "CC0-1.0"
  });
}

for (const channel of ["color", "normal", "roughness"]) {
  const filename = `alexandria-papyrus-${channel}.webp`;
  const source = path.join(generated, `alexandria-papyrus-${channel}.png`);
  const target = path.join(output, filename);
  await sharp(source).resize(512, 512, { kernel: sharp.kernel.lanczos3 }).webp({ quality: channel === "color" ? 91 : 88, effort: 6 }).toFile(target);
  const bytes = await readFile(target);
  assets.push({
    source: `art-source/generated/materials/${path.basename(source)}`,
    file: `/worlds/assets/materials/${filename}`,
    width: 512,
    height: 512,
    bytes: (await stat(target)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    license: "Project-generated",
    generatedBy: "scripts/blender/build_worlds.py"
  });
}

await writeFile(path.join(output, "manifest.json"), `${JSON.stringify({ version: 1, generatedBy: "scripts/process-runtime-materials.mjs", assets }, null, 2)}\n`);
console.log(`Processed ${assets.length} runtime material maps.`);
