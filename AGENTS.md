# Virtual Library clean repository instructions

## Purpose and privacy

- This repository is the content-neutral upstream for the reusable Virtual Library engine.
- Keep it free of personal books, private metadata, personal branding, private service integrations, NAS paths or addresses, and ideology-specific references.
- `books/` must remain empty except for `.gitkeep`; use only neutral examples under `examples/`.
- Before committing or pushing, inspect staged paths and staged content for private material.

## Scene development

- This repository is the source of truth for reusable changes to all nine worlds, controls, navigation, reader behavior, search, performance, and generic Markdown ingestion.
- Follow `docs/scene-development.md` for furniture, architecture, collision, asset regeneration, cache revisions, previews, and verification.
- Determine the owning layer before editing: runtime furniture in `src/worlds/RoomDetails.tsx`, generated architecture and imported props in `scripts/blender/build_worlds.py`, dynamic scene elements in `src/worlds/AssetWorld.tsx` or exterior components, and movement/placement contracts in `src/worlds/registry.ts`.
- Do not treat `.blend`, optimized `.glb`, previews, or manifests as the sole source of truth. Update the authored source and regenerate required derivatives.
- Preserve spawn, all nine shelf anchors, all clearance anchors, navigation safety, cinematic and lite quality behavior, asset provenance, and performance budgets.
- Keep each reusable change in a focused commit so private downstream repositories can cherry-pick it safely.

## Required checks

- Run the relevant asset-generation pipeline when authored assets change.
- Run `pnpm test`, `pnpm build`, `pnpm perf:budget`, and `git lfs fsck` before treating a shared scene change as verified.
- A successful change does not authorize NAS deployment, production promotion, repository visibility changes, or publication. Obtain explicit user authorization for those actions.
