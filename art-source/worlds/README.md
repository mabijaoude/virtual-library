# Blender working files

`scripts/blender/build_worlds.py` is the authored source of truth for all nine
worlds. Running that script creates local `.blend` working files in this
directory and raw GLB exports under `.asset-cache/`.

The generated `.blend` files are not committed. Blender stores absolute build
paths inside its binary project files, and those machine-local paths are not
appropriate for a reusable public repository. The optimized runtime GLB files
remain versioned under `public/worlds/assets/models/`.
