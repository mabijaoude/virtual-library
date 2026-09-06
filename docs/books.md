# Adding and organizing books

[Back to the overview](../README.md)

There are two independent ways to populate Virtual Library. They can be used separately or together.

| Mode | Storage location | Visibility | When it appears | Persistence |
| --- | --- | --- | --- | --- |
| **Private browser import** | IndexedDB in one browser profile | Only that browser on that exact site origin | Immediately | Survives normal reloads and browser restarts, but not cleared site data |
| **Shared collection** | Copied into the generated static site | Everyone who can access the deployment | After preparation or a rebuild | Remains part of that deployment until it is rebuilt |

### Private browser imports

Open **Controls → Add & manage books → Add Markdown files**, choose `.md` files, or drag Markdown files anywhere onto the application.

Imported books:

- are parsed, shelved, and added to search immediately;
- remain available when the same browser returns to the same site origin;
- are stored as complete Markdown documents in browser IndexedDB;
- are never uploaded by the clean application;
- can be removed individually or cleared from the browser-library panel.

To keep a browser tab responsive, one import is limited to 500 files, 24 MiB
per Markdown file, and 128 MiB in total. Larger permanent collections should
use the shared build-time collection instead.

Browser imports do not synchronize between devices, browsers, profiles, hostnames, or ports. For example, a book imported at `http://localhost:5587` is separate from one imported at `https://library.example.com`. Private-browsing sessions and cleared site data should be treated as temporary storage.

There is currently no browser-library export, user account, cloud backup, or cross-device synchronization feature.

### Personal shelf organization

Select a book and choose **Move book**, or open **Manage books** and choose **Organize shelves**. The organizer lets a visitor:

- rename any shelf, including an empty one;
- move a selected book to a specific shelf;
- restore a shelf's automatic collection-based title;
- return a moved book to automatic placement.

These preferences are stored in local storage for that browser and site origin. They change the visible layout immediately but do not edit Markdown, alter the shared build, or synchronize elsewhere. Clearing site data removes both browser-imported books and personal shelf organization.

### Shared build-time collections

Place any number of `.md` files anywhere under `books/`:

```text
books/
├── essays/
│   └── an-essay.md
├── reference/
│   └── field-notes.md
└── a-book.md
```

Directories are scanned recursively. Both `pnpm dev` and `pnpm build` run the preparation step automatically. You can also run it directly:

```bash
pnpm prepare-library
```

Preparation generates:

- a compact catalogue manifest;
- per-book metadata records;
- full-text search shards;
- shelf and spine placements;
- a deployable copy of each Markdown source.

Generated files are written under `public/` and are ignored by Git. A production build copies them into `dist/`.

The `books/` directory is intentionally empty in the clean repository, and `books/**/*.md` is ignored by Git. This helps prevent a personal collection from being added accidentally. The neutral **Start Here** guide under `examples/` is bundled only as the empty-library fallback; it is not mixed into a non-empty shared collection.

> Shared books are served to visitors as static Markdown files. Anyone who can access the deployed site can retrieve them. Do not build or publish material you do not have permission to distribute.

### Keep a collection outside the repository

Set `LIBRARY_CONTENT_ROOT` before development or building. The directory may be absolute or relative to the repository.

macOS or Linux:

```bash
LIBRARY_CONTENT_ROOT=/srv/library-books pnpm build
```

PowerShell:

```powershell
$env:LIBRARY_CONTENT_ROOT = 'D:\library-books'
pnpm build
```

This is the recommended pattern when the application source and book collection need different access controls or backup policies. The selected directory must be available to the process performing the build.

Changing a shared collection does not mutate a running static deployment. Rebuild and redeploy after adding, editing, renaming, or removing books.

## Markdown and metadata

Plain Markdown is enough:

```markdown
# A Book Title

The opening paragraph begins here.

## Chapter One

Chapter text...
```

Virtual Library infers a title from the first level-one heading and otherwise from the filename. It can also infer an author and year from a structured filename such as:

```text
Lovelace - Ada - Notes on the Analytical Engine - 1843.md
```

For predictable cataloguing, add YAML frontmatter:

```yaml
---
title: Notes on the Analytical Engine
author: Ada Lovelace
year: 1843
categories:
  - Computing
  - History
tags:
  - Analytical Engine
collection: Foundational Texts
summary: A sentence-length description used in the catalogue when a reader inspects this work.
---
```

Supported fields and aliases:

| Purpose | Preferred field | Accepted aliases |
| --- | --- | --- |
| Title | `title` | First H1 or filename fallback |
| Author | `author` | `authors` |
| Publication year | `year` | Structured filename fallback |
| Categories | `categories` | `category` |
| Tags | `tags` | `tag` |
| Shelf grouping | `collection` | `collections`, `shelf` |
| Description | `summary` | `description`, `synopsis` |

Lists may be YAML arrays or comma-separated strings. A sentence-length summary is recommended; very short summaries fall back to an extract from the book.

Headings become reader sections and search locations. If no collection is supplied, books are grouped primarily by author. Nested directories organize source files but do not replace metadata-based shelving.

### Automatic shelving

The preparation pipeline:

1. sorts books by collection, author, year, and title;
2. assigns each book to a shelf bay, row, and slot;
3. uses the collection name as the shelf title, falling back to the author when no collection is supplied;
4. derives spine dimensions from relative word count;
5. creates additional annex bays when the collection exceeds the original shelf capacity;
6. uses the same logical collection in every world.

The Alexandrian world presents the collection as scrolls; the other worlds use book volumes.

## Search and reading

The clean edition does not require an external search service. During preparation, MiniSearch indexes are split into static shards and loaded progressively in a Web Worker. Browser-imported books receive a separate local index and participate in the same search interface.

Search covers:

- titles and authors;
- categories, tags, and shelf metadata;
- Markdown headings;
- full-text passages.

Book metadata loads separately from full content, and large documents are parsed in a worker and rendered section by section. Markdown-generated HTML is sanitized with DOMPurify before display.
