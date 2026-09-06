import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { checkPrivacy, forbiddenPath } from "./check-privacy.mjs";

// Deliberately creates a separate repository. Never rewrites or publishes refs.
const destination = process.argv[2] && path.resolve(process.argv[2]);
if (!destination || existsSync(destination)) throw new Error("Provide a new, nonexistent snapshot directory.");
const root = process.cwd();
const git = (args, cwd = root, encoding = "utf8") => execFileSync("git", args, { cwd, encoding, maxBuffer: 32 * 1024 * 1024 });
if (git(["status", "--porcelain"]).trim()) throw new Error("Commit the reviewed source changes before creating a snapshot.");
if (!await checkPrivacy()) throw new Error("Source privacy review must pass before snapshot creation.");
const files = git(["ls-tree", "-r", "--name-only", "-z", "HEAD"]).split("\0").filter(Boolean);
// Verify everything before creating the destination, including materialized LFS bytes.
for (const file of files) {
  if (forbiddenPath(file) || !lstatSync(file).isFile()) throw new Error("Unexpected private or non-file path in snapshot source.");
  const committed = git(["show", `HEAD:${file}`], root, "buffer");
  const pointer = committed.toString().match(/^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n?$/);
  if (pointer) {
    const content = readFileSync(file);
    if (content.length !== Number(pointer[2]) || createHash("sha256").update(content).digest("hex") !== pointer[1]) throw new Error(`Unmaterialized or changed LFS source: ${file}`);
  }
}
mkdirSync(destination, { recursive: true });
for (const file of files) {
  const target = path.resolve(destination, file);
  if (!target.startsWith(destination + path.sep)) throw new Error("Snapshot target escaped its directory.");
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(file, target);
}
git(["init", "--initial-branch=main"], destination);
git(["lfs", "install", "--local"], destination);
git(["add", "--all"], destination);
git(["-c", "user.name=Virtual Library contributors", "-c", "user.email=virtual-library@users.noreply.github.com", "commit", "-m", "Initialize content-neutral Virtual Library release"], destination);
git(["lfs", "fsck"], destination);
execFileSync(process.execPath, ["scripts/check-privacy.mjs", "--history"], { cwd: destination, stdio: "inherit" });
console.log(`Created a ${files.length}-file snapshot with one root commit and no remote. Existing source history remains intact.`);
