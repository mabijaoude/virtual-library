import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const required = ["LICENSE", "LICENSE-ASSETS.md", "ASSET_LICENSES.md", "THIRD_PARTY_NOTICES.md", "FORKING.md", "SECURITY.md", "docs/books.md", "docs/self-hosting.md", "docs/release-readiness.md", "public/DEPENDENCY_LICENSES.json"];
for (const file of required) if (!existsSync(file)) throw new Error(`Missing release file: ${file}`);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.license !== "MIT" || pkg.engines.node !== ">=22.12.0") throw new Error("Keep package licensing and minimum Vite-compatible Node version explicit.");
const readme = readFileSync("README.md", "utf8");
if (readme.includes("\u2014")) throw new Error("README.md must not contain em dashes.");
const files = ["README.md", ...required.filter(file => file.endsWith(".md")), "docs/images/README.md"];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split("#")[0]);
    if (!existsSync(path.resolve(path.dirname(file), target))) throw new Error(`${file}: missing linked file ${target}`);
  }
}
const screenshots = [...new Set([...readme.matchAll(/!\[[^\]]+\]\((docs\/images\/[^)]+\.jpg)\)/g)].map(match => match[1]))];
if (screenshots.length < 6) throw new Error("Include five reviewed rooms and the reader in the README.");
for (const file of screenshots) {
  const bytes = readFileSync(file);
  const meta = await sharp(bytes).metadata();
  if (meta.format !== "jpeg" || bytes.length > 600_000 || !meta.width || meta.width < 1000) throw new Error(`Invalid or oversized release screenshot: ${file}`);
  if (meta.exif || meta.xmp || meta.iptc) throw new Error(`Strip private image metadata: ${file}`);
  const attributes = execFileSync("git", ["check-attr", "filter", "--", file], { encoding: "utf8" });
  if (attributes.includes(": lfs")) throw new Error(`README image must be ordinary Git: ${file}`);
}
const noticePairs = [
  ["LICENSE", "public/PROJECT_LICENSE.txt"],
  ["LICENSE-ASSETS.md", "public/LICENSE-ASSETS.md"],
  ["ASSET_LICENSES.md", "public/ASSET_LICENSES.md"],
  ["THIRD_PARTY_NOTICES.md", "public/THIRD_PARTY_NOTICES.md"],
  ["LICENSES/Apache-2.0.txt", "public/LICENSES/Apache-2.0.txt"],
];
for (const [source, copy] of noticePairs) {
  const expected = readFileSync(source, "utf8").replaceAll("\r\n", "\n").replaceAll("(public/DEPENDENCY_LICENSES.json)", "(DEPENDENCY_LICENSES.json)");
  if (!existsSync(copy) || expected !== readFileSync(copy, "utf8").replaceAll("\r\n", "\n")) throw new Error(`Refresh the distributed notice: ${copy}`);
}
console.log(`Release documents, local links, six screenshots, and distributed notices verified.`);
