# Clean upstream and private downstream

Keep reusable application code in this repository and personal collections in a separate private downstream repository. The clean repository is the upstream source of truth for worlds, controls, readers, search, performance, and generic Markdown ingestion.

## One-time downstream setup

Clone this repository for the private edition, then give the remotes distinct roles:

```bash
git remote rename origin upstream
git remote add origin https://github.com/your-account/your-private-library.git
git push -u origin main
```

Keep private branding and service integration in downstream-only modules. Point `VIRTUAL_LIBRARY_CONFIG` at the downstream edition module. Keep the Markdown collection outside the clean checkout and select it with `LIBRARY_CONTENT_ROOT` during preparation or deployment.

## Shared fixes

Make world, control, reader, search, and generic ingestion fixes in the clean upstream first. After the fix is reviewed and merged there, bring it into the private downstream:

```bash
git fetch upstream
git switch main
git merge --no-ff upstream/main
git push origin main
```

Resolve conflicts only in the small downstream customization surface. Avoid copying whole shared source directories into the private layer because doing so makes future merges unnecessarily difficult.

## Private-only changes

Commit collection metadata, private services, private deployment configuration, and edition-specific presentation only to the private remote. Before any upstream push, inspect both the staged file list and staged content:

```bash
git diff --cached --name-only
git diff --cached
```

The clean repository ignores `books/**/*.md`; the neutral example lives under `examples/` so an accidental broad add does not publish a personal collection.

## Release rhythm

Use the clean `main` branch for verified shared releases and a development branch for work in progress. Sync a verified upstream commit into the private downstream, test the private edition, and promote each deployment independently. Making the clean GitHub repository public is a separate visibility change and should happen only after a final history and asset-license audit.
