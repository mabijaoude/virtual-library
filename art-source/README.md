# World art sources

This directory contains reproducible source artwork for the nine library worlds.
Large binary sources are tracked with Git LFS and are excluded from the Docker
build context. Runtime derivatives are generated into `public/worlds/assets`.

- `generated/` contains project-owned image-generation sources and their prompt
  manifest.
- `worlds/` documents the Blender working-file pipeline. The `.blend` files are
  reproducible outputs of the pinned build script and are intentionally ignored
  because Blender records machine-local build paths in them.
- Third-party CC0 downloads are not committed. `asset-lock.json` records exact
  source URLs and hashes so `pnpm assets:fetch` can restore them locally.

