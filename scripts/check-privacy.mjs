import { spawn, execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Report categories and repository-relative locations, never matched secrets.
export function privateMarkers(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("latin1") : bytes;
  const normalized = text.replace(/\0/g, "").replace(/\\+/g, "/");
  const rules = [
    ["home-directory path", /(?:[a-z]:\/Users\/|\/(?:home|Users)\/)[a-z0-9_.-][^/\s"'\[\]]*/i],
    ["private infrastructure", /(?:\b192\.168\.\d{1,3}\.\d{1,3}\b|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b|\/volume\d+\/|\b[\w-]+\.local\b)/i],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ["access token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-proj-[A-Za-z0-9_-]{30,})\b/],
    ["URL credentials", /https?:\/\/[^\s/:"']+:[^\s/@"']+@/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label);
}

export function forbiddenPath(file) {
  const normalized = file.replaceAll("\\", "/");
  return /(?:^|\/)\.env(?:\.|$)/i.test(normalized)
    || /(?:^|\/)(?:node_modules|\.asset-cache|\.codex-remote-attachments|server)(?:\/|$)/i.test(normalized)
    || /^books\/(?!\.gitkeep$)/i.test(normalized)
    || /^public\/(?:book-content|book-metadata|library-search-shards)(?:\/|$)/i.test(normalized)
    || /^public\/library-.*\.json$/i.test(normalized)
    || /\.(?:blend\d*|raw\.glb|pem|p12|pfx|key)$/i.test(normalized)
    || /(?:^|\/)(?:id_rsa|id_ed25519)$/i.test(normalized)
    || privateMarkers(normalized).length > 0;
}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
}

export async function checkPrivacy({ history = false } = {}) {
  let checked = 0;
  const failures = new Set();
  const inspect = (bytes, label) => {
    checked++;
    for (const marker of privateMarkers(bytes)) failures.add(`${label}: ${marker}`);
  };
  if (!history) {
    const files = [...new Set(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean))];
    for (const file of files) {
      if (forbiddenPath(file)) {
        failures.add("Source tree contains a forbidden path (inspect the local file list).");
        continue;
      }
      if (!existsSync(file)) { failures.add(`${file}: missing source file`); continue; }
      if (!lstatSync(file).isFile()) { failures.add(`${file}: symlink or non-file source`); continue; }
      const bytes = readFileSync(file);
      if (bytes.subarray(0, 80).toString().startsWith("version https://git-lfs.github.com/spec/v1")) {
        failures.add(`${file}: download Git LFS content before verification`);
      }
      inspect(bytes, file);
    }
  } else {
    if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") throw new Error("History audit requires a full clone.");
    const objects = git(["rev-list", "--objects", "--all"]).trim().split("\n");
    const lfsRoot = path.resolve(git(["rev-parse", "--git-common-dir"]).trim(), "lfs", "objects");
    const seenLfs = new Set();
    for (const object of objects) {
      const separator = object.indexOf(" ");
      if (separator >= 0 && forbiddenPath(object.slice(separator + 1))) failures.add(`Git object ${object.slice(0, 12)}: forbidden historical path`);
    }
    const child = spawn("git", ["cat-file", "--batch"], { stdio: ["pipe", "pipe", "inherit"] });
    const done = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error("Could not read complete Git history.")));
    });
    child.stdin.end(objects.map(line => line.split(" ")[0]).join("\n") + "\n");
    let pending = Buffer.alloc(0);
    let header;
    for await (const chunk of child.stdout) {
      pending = Buffer.concat([pending, chunk]);
      while (true) {
        if (!header) {
          const newline = pending.indexOf(10);
          if (newline < 0) break;
          header = pending.subarray(0, newline).toString().split(" ");
          pending = pending.subarray(newline + 1);
          if (header.length !== 3 || !/^\d+$/.test(header[2])) throw new Error("Unexpected Git object response.");
        }
        const size = Number(header[2]);
        if (pending.length < size + 1) break;
        const bytes = pending.subarray(0, size);
        const label = `Git ${header[1]} ${header[0].slice(0, 12)}`;
        inspect(bytes, label);
        const pointer = bytes.length < 1024 && bytes.toString().match(/^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n?$/);
        if (pointer && !seenLfs.has(pointer[1])) {
          seenLfs.add(pointer[1]);
          const oid = pointer[1];
          const payload = path.join(lfsRoot, oid.slice(0, 2), oid.slice(2, 4), oid);
          if (!existsSync(payload)) failures.add(`LFS ${oid.slice(0, 12)}: unavailable payload; fetch all release LFS objects before auditing`);
          else {
            const content = readFileSync(payload);
            if (content.length !== Number(pointer[2])) failures.add(`LFS ${oid.slice(0, 12)}: size mismatch`);
            inspect(content, `LFS ${oid.slice(0, 12)}`);
          }
        }
        pending = pending.subarray(size + 1);
        header = undefined;
      }
    }
    await done;
    if (header || pending.length) throw new Error("Incomplete Git object stream.");
  }
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.log(`${history ? "History" : "Source"} privacy scan: ${checked} objects checked, ${failures.size} findings. Pattern checks supplement manual review; compressed content and image pixels require separate inspection.`);
  return failures.size === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!await checkPrivacy({ history: process.argv.includes("--history") })) process.exitCode = 1;
}
