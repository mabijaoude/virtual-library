# Open-source release review

Review date: 2026-09-06. Application baseline: `441a451`. This preparation updates documentation and release tooling; it does not change room geometry, application behavior, or hosting.

## Release tree and history

The reusable source tree contains an empty `books/` directory with only `.gitkeep`. The neutral Start Here guide is the sole fallback collection. Shared content outputs, credentials, local caches, and generated Blender working files are excluded from source control.

Historical authoring files can retain machine-specific metadata even when removed from the current tree. The development repository's older LFS assets contain home-directory paths and must not be published with its existing history. The preparation preserves that history and creates a separate source snapshot with a single neutral root commit, materialized current LFS assets, and no remote.

From a clean, reviewed, committed checkout, create a new snapshot:

```bash
pnpm release:snapshot ../virtual-library-release
```

The destination must not already exist. This command copies only tracked files, verifies LFS payload hashes, initializes independent history, and runs the history privacy audit. It does not push, change visibility, modify the original repository's refs, or deploy.

Before publishing, verify a fresh clone of that snapshot with `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm audit --audit-level high`, and `pnpm check:history`. Review the exact initial commit and LFS object set. Do not attach old branches or tags to the new public history.

## Automated checks

The initial run passed all 239 tests across 27 files, the production build, Git LFS integrity, and every performance budget. The dependency audit reported no known vulnerabilities. Frozen-lockfile installation was also checked with the pinned pnpm 11.16.0.

The release workflow covers:

- README links, six materialized JPEGs, image metadata, and the no-em-dash requirement;
- private home paths, local infrastructure, common credential patterns, accidental books, environment files, and authoring files;
- dependency license declarations, distributed project and asset notices, and license-inventory drift;
- ingestion, search, reader utilities, navigation, accessibility helpers, and room asset contracts;
- Git LFS integrity, TypeScript, production compilation, and transfer-size budgets.

The dependency inventory records declarations from installed package metadata; it is not an independent legal review of all transitive package contents. Asset provenance remains in [ASSET_LICENSES.md](../ASSET_LICENSES.md). Privacy patterns supplement manual review and do not decode every compressed format or inspect image pixels.

## Performance baseline

Production build with the neutral one-book collection, measured locally with Node.js 24.19.0:

| Check | Measured | Limit |
| --- | ---: | ---: |
| Catalogue, raw | 3.3 KiB | 976.6 KiB |
| Catalogue shell graph, gzip | 111.7 KiB | 185.5 KiB |
| Scene bootstrap graph, gzip | 427.7 KiB | 439.5 KiB |
| Reader bootstrap graph, gzip | 129.9 KiB | 214.8 KiB |
| Initial styles, gzip | 13.4 KiB | 43.9 KiB |
| Largest compact model | 484.8 KiB | 2,048 KiB |
| Largest complete model | 8,450.5 KiB | 12,288 KiB |
| Largest complete room bundle | 11,521.1 KiB | 16,384 KiB |
| Raw authoring models in the site | 0 | 0 |

All limits pass. The scene bootstrap has approximately 2.7% headroom. Vite still reports a large deferred Three.js chunk; it is included in the explicit scene-graph budget rather than the initial catalogue shell. Do not suppress the warning by increasing limits without investigating a regression.

These measurements describe the neutral release, not a large user collection. They are byte budgets, not a cold/warm latency or frame-rate benchmark. See [Performance](performance.md) for profiling instructions.

## Browser review

The existing reference deployment provides the unchanged application behavior under review. Five rooms and the reader were visually inspected at the default desktop viewport, using only the starter guide. README captures are ordinary Git JPEGs with stripped metadata, totaling less than 500 KB.

The browser review also passed:

- import a disposable Markdown book with neutral frontmatter;
- find its unique passage through full-text search and open the matching reader section;
- reload and verify that the imported book remains in the catalogue;
- inspect the catalogue, book details, and reader at 390 by 844 pixels;
- open the mobile contents drawer and choose a chapter, confirming that the drawer closes and text returns to full width.

Automated unit tests separately cover nested Markdown collections and empty-library fallback behavior. These browser checks used the existing reference deployment because the application code is unchanged; they do not establish that a later deployment contains the new release documentation or tooling.

## Final preflight

The `codex/public-preflight` CI branch runs the exact clean candidate privately before publication. It repeats verification on Linux with Node.js 22 and the pinned pnpm version, builds the stock Docker image, and starts a disposable loopback-only container to verify HTTP service, security headers, catalogue caching, the starter-only collection, a real GLB response, and distributed notices. The startup probe has bounded retries, and the container is removed on both success and failure.

Use the successful CI run for the exact commit being published as the container verification record. Follow-up preflight fixes may add reviewed commits to the fresh release history; no old development branches or tags belong in that history.

## Publication boundary

No website deployment, public repository visibility change, remote history rewrite, or release publication is part of this preparation. Docker execution requires a Docker-capable environment; the CI workflow includes the container build. Real-phone touch behavior, assistive-technology coverage, and repeated cold/warm GPU profiling remain separate release checks.
