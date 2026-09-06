# Self-hosting Virtual Library

[Back to the overview](../README.md)

## Production build

Create the static site:

```bash
pnpm build
pnpm perf:budget
```

The complete deployable site is written to `dist/`. It contains the application, optimized world assets, catalogue, book metadata, search shards, and every shared Markdown source.

## Deploy with Docker Compose

Docker and Docker Compose are optional; Node and pnpm are not required on the final host when the image is built elsewhere.

The stock Compose service builds the collection from `books/`, creates the static application, serves it with Nginx, and includes a health check.

```bash
docker compose up -d --build
```

Open <http://localhost:5587>.

To choose a stable project name and host port, create an uncommitted `.env` file:

```dotenv
COMPOSE_PROJECT_NAME=my-virtual-library
HOST_PORT=8080
```

Then rebuild:

```bash
docker compose up -d --build
```

Useful container commands:

```bash
docker compose ps
docker compose logs --follow web
docker compose down
```

After changing shared books, run `docker compose up -d --build` again. The books, catalogue, and search indexes are built into the image; they are not a runtime database or writable container volume.

Browser-imported books remain in each visitor's IndexedDB and are not stored inside the container. Preserve the deployment's hostname, protocol, and port if visitors need to keep access to an existing browser-local collection.

### External collections and the stock Dockerfile

`LIBRARY_CONTENT_ROOT` works when `pnpm dev`, `pnpm prepare-library`, or `pnpm build` can read the selected directory. The stock Dockerfile intentionally copies only `books/` from its build context, so an arbitrary host or network directory is not automatically available inside `docker compose build`.

For a permanent external collection, use one of these patterns:

1. synchronize the collection into the Git-ignored `books/` directory before building the stock image;
2. run `pnpm build` with `LIBRARY_CONTENT_ROOT` outside Docker and publish the resulting `dist/` directory;
3. maintain books in a separate private content repository and stage both repositories in a CI build;
4. create a downstream Docker build that deliberately makes the protected collection available only to its build stage.

A runtime bind mount into the Nginx container is not sufficient: new Markdown must first be processed into catalogue, metadata, search, and content artifacts.

### Reverse proxy and HTTPS

The image exposes HTTP on container port `80`. In production, place it behind a reverse proxy that provides HTTPS and a stable hostname. The supplied `nginx.conf` includes single-page-application fallback routes, content types, compression, and cache rules for generated assets.

The clean build currently expects to be served at the root of a hostname or subdomain. Hosting under an arbitrary URL subpath requires corresponding Vite and asset-path changes.

## Deploy as a static site

Docker is not required. Upload the contents of `dist/` to any static host that can:

- serve the application at the site root;
- fall back to `index.html` for application routes;
- serve Markdown, JSON, WebP, GLB, KTX2, and HDR files with appropriate content types;
- avoid long-lived caching for `index.html` and `library-manifest.json`;
- cache hashed application assets, book content, world assets, and search shards aggressively.

Use `nginx.conf` as a reference configuration. Rebuild and upload `dist/` whenever the shared collection changes.
