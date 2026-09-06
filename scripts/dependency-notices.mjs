import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const cli = process.env.npm_execpath;
const args = ["licenses", "list", "--prod", "--json"];
const command = cli && /\.(?:c|m)?js$/i.test(cli) ? process.execPath : cli || (process.platform === "win32" ? "cmd.exe" : "pnpm");
const commandArgs = cli && /\.(?:c|m)?js$/i.test(cli) ? [cli, ...args] : !cli && process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd licenses list --prod --json"] : args;
const result = spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
if (result.status !== 0) throw new Error("Cannot inspect the installed dependency licenses. Install the frozen lockfile first.");
const report = JSON.parse(result.stdout);
const allowed = new Set(["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Zlib", "CC-BY-4.0", "(MPL-2.0 OR Apache-2.0)"]);
const inventory = new Map();
for (const [license, entries] of Object.entries(report)) {
  if (!allowed.has(license)) throw new Error(`Review newly introduced license: ${license}`);
  for (const entry of entries) {
    // Platform-specific build binaries share their parent project's license.
    const name = entry.name.replace(/^@esbuild\/.+$/, "@esbuild/*").replace(/^@rollup\/rollup-.+$/, "@rollup/rollup-*");
    for (const version of entry.versions) inventory.set(`${name}@${version}`, { name, version, license });
  }
}
const entries = [...inventory.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"));
const destination = new URL("../public/DEPENDENCY_LICENSES.json", import.meta.url);
const serialized = JSON.stringify(entries, null, 2) + "\n";
if (process.argv.includes("--write")) writeFileSync(destination, serialized);
else if (readFileSync(destination, "utf8").replaceAll("\r\n", "\n") !== serialized) throw new Error("Dependency inventory is stale. Run pnpm notices:update and review the license changes.");
console.log(`Verified ${entries.length} dependency/version license declarations. Inventory contains no package-manager installation paths.`);
