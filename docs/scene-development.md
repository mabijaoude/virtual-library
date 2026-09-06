# Scene development

Virtual Library has nine scenes: `heritage`, `gothic`, `modern`, `renaissance`, `deco`, `foundry`, `lunar`, `arkship`, and `alexandria`.

Make reusable scene changes in the clean repository first. Keep each change in a focused commit so a private downstream can apply that commit without importing unrelated work.

## Find the source of an object

Do not begin by editing a `.glb` or `.blend` file. First locate the layer that owns the object:

| Layer | Source | Typical contents | Rebuild models? |
| --- | --- | --- | --- |
| Runtime furnishings | `src/worlds/RoomDetails.tsx` | Chairs, benches, lecterns, stools, papers, side tables, tool carts | No |
| Generated architecture and set dressing | `scripts/blender/build_worlds.py` | Walls, floors, built-in tables, imported props, columns, fixtures, semantic anchors | Yes |
| Dynamic React scene elements | `src/worlds/AssetWorld.tsx`, `src/worlds/RoomDetails.tsx`, `src/worlds/*Exterior.tsx`, and the individual world module | Animated exhibits, practical lights, exterior effects, code-generated geometry | No |
| World behavior and placement | `src/worlds/registry.ts` | Spawn point, walkable bounds, obstacles, shelf bays, lighting, asset cache revisions | Only when referenced assets change |

Search by the visible object name, component name, or world function:

```powershell
rg -n "ChairCluster|ModernBench|GothicLectern|ToolCart" src/worlds
rg -n "modern_arm_chair|Reading table|build_modern" scripts/blender/build_worlds.py
```

The `.blend` files under `art-source/worlds/` are reproducible, ignored working outputs of `build_worlds.py`. Blender embeds machine-local build paths in those files, so they are deliberately excluded from the public repository. A direct Blender edit will be overwritten by the next scripted build. Encode a permanent edit in `build_worlds.py`, then regenerate the local `.blend` file and versioned runtime models.

## Example: remove runtime furniture

To remove the two lecterns from Gothic Nocturne:

1. Open `GothicDetails` in `src/worlds/RoomDetails.tsx`.
2. Remove the two `GothicLectern` elements.
3. Remove or reposition dependent chairs and paper only when that is also part of the intended design.
4. Inspect `gothic.obstacles` in `src/worlds/registry.ts`. The current lecterns do not have their own obstacle, so no collision change is required.
5. Run the standard verification commands below.

This is a source-code-only change. Do not rebuild Blender assets, and do not change the world asset cache revision.

## Example: remove Blender-authored furniture

To remove the imported armchairs from the Modern Archive:

1. Open `build_modern()` in `scripts/blender/build_worlds.py`.
2. Remove the relevant `import_prop("modern_arm_chair_01", ...)` calls.
3. If the removed object occupied a blocked area, update both any matching `add_collider(...)` call in the Blender generator and the `obstacles` array for `modern` in `src/worlds/registry.ts`. Runtime walking uses the rectangles in `registry.ts`; visible geometry and collision must agree.
4. Rebuild the source and runtime assets.

On Windows with Blender 4.5 installed:

```powershell
pnpm install --frozen-lockfile
pnpm assets:fetch
& "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe" `
  --background `
  --python scripts/blender/build_worlds.py `
  -- `
  --root (Get-Location).Path
pnpm assets:optimize
pnpm assets:sync-transforms
```

The final reproducibility run builds all nine worlds because `assets:optimize` validates the complete set. During quick iteration, `--world modern` may be added to the Blender command only when valid raw outputs for the other eight worlds already exist in `.asset-cache/worlds/generated-models/`. Use `pnpm assets:optimize --world modern` to recompress only that world while still validating all nine. Repeat `--world` to select several worlds. `--validate-only` refreshes semantic nodes and validates existing compressed outputs without recompression.

The exporter updates Blender's dependency graph before preserving world transforms and parenting objects for glTF orientation. Keep this update: newly created empty anchors otherwise export at the origin. Check composed glTF node transforms, including parents, when testing shelf positions and facing.

Commit the authored source and its required derivatives:

- `scripts/blender/build_worlds.py`
- `public/worlds/assets/models/<world>-cinematic.glb`
- `public/worlds/assets/models/<world>-lite.glb`
- `public/worlds/world-assets.json`
- any intentionally changed material or provenance manifest

Never commit `.asset-cache/` or `*.raw.glb` files.

When a runtime model, environment, backplate, or art asset changes, update that world's `assets` entry in `src/worlds/assetRevisions.json`. Use a new descriptive revision such as `20260811-modern-furniture`. Vite injects this same manifest into the boot document, so the first preload and runtime loader always agree. Runtime-only changes are covered by Vite's hashed JavaScript bundle and do not need an asset revision.

## Navigation and shelf safety

Before accepting a furniture change, check these contracts:

- `SPAWN`, `SHELF_BAY_00` through `SHELF_BAY_08`, and their clearance anchors must remain present in both model tiers.
- The spawn point must not be inside new furniture.
- Every shelf must remain reachable and readable.
- A complete shelf case, including its base and trim, must not intersect an entrance frame, portal, grille, window return, column, or wall reveal.
- Keep a continuous service lane from 0.6 m to 2.8 m in front of every shelf face; movable furniture should include at least 0.35 m of visual clearance from that lane.
- Removed furniture must not leave an invisible obstacle in `src/worlds/registry.ts`.
- New solid furniture that blocks walking needs a matching obstacle rectangle.
- Test both cinematic and lite quality because the Blender `BASE` and `DETAIL` collections produce different tiers.
- Inspect each scene in a full panorama, including the entrance and any exterior visible through windows. A spawn-point screenshot alone is not sufficient visual QA.

Renaissance roof dimensions live in `src/worlds/renaissanceArchitecture.ts`. The square soffit, circular drum and faceted dome must physically overlap in both tiers; keep the ray and triangle-overlap checks in `refinedRooms.test.ts` when adjusting them.

If an asset-contract test describes the old intentional furniture count, update the narrow assertion in `scripts/world-assets.test.mjs` to describe the new intended invariant. Do not weaken unrelated anchor, validation, size, provenance, or remote-URL checks.

## Preview and baseline images

When the scene change is visually meaningful, capture an approved current view and replace:

- `art-source/previews/<world>.jpg` for the World Atlas view, then run `pnpm assets:previews`.
- `art-source/baselines/mobile/<world>.jpg` with a 390 by 844 mobile capture.

If the Atlas preview changes, also update that world's `previews` entry in `src/worlds/assetRevisions.json`. Preview and baseline images are Git LFS assets. Capture the default Auto appearance at normal brightness, without a selected book, debug overlays, or personal content.

## Verify and commit

Run from the clean repository root:

```powershell
pnpm test
pnpm build
pnpm perf:budget
git lfs fsck
git status --short
```

Visually inspect the changed scene at cinematic and lite quality and verify walking, shelf interaction, World Atlas entry, desktop layout, and mobile layout. Then commit only the focused shared change. After it passes CI and is merged into clean `main`, downstream repositories can apply that exact commit.
