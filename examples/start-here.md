---
title: "Start Here: Explore Your Virtual Library"
author: Virtual Library contributors
year: 2026
categories:
  - Getting Started
  - Documentation
tags:
  - Controls
  - Reading
  - Search
  - Markdown
  - Privacy
collection: Start Here
summary: A practical in-world guide to finding books, opening the reader, searching the collection, and adding your own Markdown volumes.
---

# Start Here: Explore Your Virtual Library

This guide is placed on the shelf so a new library is never just an impressive empty room. By opening it, you have already completed the most important interaction: finding a volume, selecting it, and entering the reader.

## Find and inspect a volume

Drag to look around, then use `WASD` or the arrow keys to walk. Hold `Shift` to sprint, press `Space` to jump, and use `Ctrl` to crouch. Select a book with a click; in immersive mode, aim the reticle at a spine and press `E`. On a touch device, use the movement pad, drag to look, and tap a volume. The inspector shows the title, author, summary, topics, location, and an action for opening the complete text.

## Read and navigate

The reader opens with a table of contents built from Markdown headings. Choose a heading to move directly to that section, collapse the contents panel when you want more reading space, and use **Find in this book** to step through matching words. Virtual Library remembers reading progress in this browser, so returning to a volume resumes near the previous location. The **Shelf** action closes the reader and points back to the book's physical place in the current world.

## Search the whole library

Use the search field in the top bar or press `Ctrl+K` (`Cmd+K` on macOS). Search covers titles, authors, categories, tags, headings, and passages—not only catalogue metadata. Try the distinctive phrase **amber waypoint**. A passage result should lead back to this section and open the reader near the match. Search runs locally from indexes generated with the shared collection and a separate index for books imported into this browser.

## Add books privately in this browser

Open the browser-library control and choose one or more `.md` files, or drag Markdown files onto the application. These imports are stored in IndexedDB for this browser profile and this exact site address. They are not uploaded by the clean application and do not synchronize to another device, browser, hostname, or port. Browser storage is convenient, but it is not a backup: keep the original files somewhere you control.

The same panel can remove the bundled starter book when you want an empty room for your own collection. The choice stays in this browser and a **Restore starter book** action remains available.

Select any volume and choose **Move book** to place it on a particular shelf. The shelf organizer can also rename each shelf, restore its automatic collection-based title, or return a moved book to automatic placement. Names and placements are saved only in this browser and do not edit the original Markdown.

## Build a shared collection

Maintainers can place distributable Markdown files anywhere under `books/`, or point `LIBRARY_CONTENT_ROOT` at a separate directory before running the development or production build. The preparation step discovers files recursively, extracts metadata, assigns shelf positions, builds search shards, and copies the source text into the static deployment. Shared books are downloadable by anyone who can access that deployment, so include only material you are permitted to distribute.

## Change worlds and keep exploring

Open the World Atlas to move among nine environments. Every world presents the same logical collection with its own architecture, lighting, furnishings, and shelf layout. Your selected world and several interface preferences are remembered locally. The repository README contains installation, metadata, deployment, customization, privacy, and maintenance details; this book is the short tour designed for readers already standing inside the library.

## About this starter book

The clean repository deliberately keeps `books/` empty to prevent a private collection from entering reusable source history. When no shared Markdown files are configured, the build uses this guide from `examples/`. Adding even one shared book replaces the starter fallback on the next preparation or build, leaving the resulting library entirely under its maintainer's control.
