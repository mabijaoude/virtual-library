import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceDir = path.join(root, "art-source", "previews");
const outputDir = path.join(root, "public", "worlds", "previews");
const worlds = ["heritage", "gothic", "modern", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria"];

await mkdir(outputDir, { recursive: true });

const assets = [];
for (const world of worlds) {
  const source = path.join(sourceDir, `${world}.jpg`);
  const output = path.join(outputDir, `${world}.webp`);
  await sharp(source)
    .resize(960, 540, { fit: "cover" })
    .webp({ quality: 74, effort: 6, smartSubsample: true })
    .toFile(output);
  const bytes = (await stat(output)).size;
  const sha256 = createHash("sha256").update(await readFile(output)).digest("hex");
  assets.push({ world, file: `previews/${world}.webp`, bytes, sha256 });
}

await writeFile(
  path.join(root, "public", "worlds", "asset-manifest.json"),
  `${JSON.stringify({ version: 1, generator: "Virtual Library Three.js scene capture", license: "Project-generated", assets }, null, 2)}\n`
);

console.log(`Processed ${assets.length} World Atlas previews.`);
