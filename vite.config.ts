import { spawn } from "node:child_process";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import assetRevisions from "./src/worlds/assetRevisions.json";

export function worldBootManifest(): Plugin {
  return {
    name: "world-boot-manifest",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replace("__WORLD_ASSET_REVISIONS__", JSON.stringify(assetRevisions).replace(/</g, "\\u003c"))
    }
  };
}

function libraryContentWatcher(): Plugin {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let regenerating = false;
  let regenerateAgain = false;

  return {
    name: "library-content-watcher",
    configureServer(server) {
      const contentRoot = path.resolve(process.env.LIBRARY_CONTENT_ROOT || "books");
      const examplesRoot = path.resolve("examples");
      server.watcher.add([contentRoot, examplesRoot]);

      const regenerate = () => {
        if (regenerating) {
          regenerateAgain = true;
          return;
        }
        regenerating = true;
        const child = spawn(process.execPath, [path.resolve("scripts/prepare-library.mjs")], {
          cwd: process.cwd(),
          env: process.env,
          stdio: "inherit"
        });
        child.on("exit", (code) => {
          regenerating = false;
          if (code === 0) server.ws.send({ type: "full-reload" });
          if (regenerateAgain) {
            regenerateAgain = false;
            regenerate();
          }
        });
      };

      server.watcher.on("all", (_event, changedPath) => {
        const resolvedPath = path.resolve(changedPath);
        const watchedRoots = [contentRoot, examplesRoot];
        const belongsToWatchedRoot = watchedRoots.some((watchedRoot) => {
          const relative = path.relative(watchedRoot, resolvedPath);
          return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
        });
        if (!resolvedPath.toLowerCase().endsWith(".md") || !belongsToWatchedRoot) return;
        clearTimeout(timer);
        timer = setTimeout(regenerate, 180);
      });
    }
  };
}

export default defineConfig(() => {
  const configModule = process.env.VIRTUAL_LIBRARY_CONFIG || "src/editions/generic.ts";

  return {
  resolve: {
    alias: {
      "@edition": path.resolve(configModule)
    }
  },
  plugins: [react(), worldBootManifest(), libraryContentWatcher()],
  build: {
    manifest: true,
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/@react-three/postprocessing/") || normalized.includes("/node_modules/postprocessing/")) return "scene-effects";
          if (normalized.includes("/node_modules/react/") || normalized.includes("/node_modules/react-dom/") || normalized.includes("/node_modules/scheduler/")) return "react";
          if (normalized.includes("/node_modules/lucide-react/")) return "icons";
          return undefined;
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
  };
});
