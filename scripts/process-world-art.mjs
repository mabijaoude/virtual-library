import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceRoot = path.join(root, "art-source", "generated");
const outputRoot = path.join(root, "public", "worlds", "assets");
const backplateRoot = path.join(outputRoot, "backplates");
const artRoot = path.join(outputRoot, "art");

const definitions = [
  ["heritage-backplate.png", "backplates/heritage.webp", 3840, 2160],
  ["gothic-backplate.png", "backplates/gothic.webp", 3840, 2160],
  ["modern-backplate.png", "backplates/modern.webp", 3840, 2160],
  ["renaissance-backplate.png", "backplates/renaissance.webp", 3840, 2160],
  ["deco-backplate.png", "backplates/deco.webp", 3840, 2160],
  ["foundry-backplate.png", "backplates/foundry.webp", 3840, 2160],
  ["alexandria-backplate.png", "backplates/alexandria.webp", 3840, 2160],
  ["heritage-art.png", "art/heritage.webp", 2560, 1280],
  ["gothic-art.png", "art/gothic.webp", 2048, 2048],
  ["renaissance-art.png", "art/renaissance.webp", 2560, 1280],
  ["deco-art.png", "art/deco.webp", 2560, 1280],
  ["foundry-art.png", "art/foundry.webp", 2560, 1280],
  ["alexandria-art.png", "art/alexandria.webp", 2560, 1280]
];

await mkdir(backplateRoot, { recursive: true });
await mkdir(artRoot, { recursive: true });

const assets = [];
for (const [sourceName, relativeOutput, width, height] of definitions) {
  const source = path.join(sourceRoot, sourceName);
  const output = path.join(outputRoot, relativeOutput);
  await sharp(source)
    .resize(width, height, { fit: "cover", position: "centre", kernel: sharp.kernel.lanczos3 })
    .webp({ quality: relativeOutput.startsWith("backplates/") ? 84 : 88, smartSubsample: true, effort: 6 })
    .toFile(output);
  const bytes = (await stat(output)).size;
  const sha256 = createHash("sha256").update(await readFile(output)).digest("hex");
  assets.push({ source: `art-source/generated/${sourceName}`, file: `assets/${relativeOutput.replaceAll("\\", "/")}`, width, height, bytes, sha256 });
}

const manifest = {
  version: 1,
  generator: "scripts/process-world-art.mjs",
  license: "Project-generated",
  assets
};
await writeFile(path.join(root, "public", "worlds", "generated-art-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Processed ${assets.length} generated world assets.`);

