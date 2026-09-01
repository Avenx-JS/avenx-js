# Avenx-JS Documentation

This directory is the source of the Avenx-JS documentation site, published at [docs.avenx-js.com](https://docs.avenx-js.com). It is built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build), and it is a **standalone npm project**, independent of the repository root. Running `npm install` at the repo root does **not** install the docs dependencies — you install and run everything from inside this `docs/` directory.

You don't need any knowledge of the Avenx-JS compiler or runtime to contribute here.

## Local Setup

```bash
cd docs
npm ci
npm run dev
```

The dev server starts at `localhost:4321` by default and live-reloads as you edit Markdown files.

> **Note:** The commands and Node version below are drawn from the boilerplate and the general Astro/Starlight convention. Confirm the exact Node version and any CI-specific flags against `.github/workflows/static.yml` before relying on them — that workflow is the canonical source for how the site is actually built and deployed.

## Commands

All commands below are run from inside `docs/`:

| Command | Action |
| :--- | :--- |
| `npm ci` | Installs dependencies (use this over `npm install` for a clean, reproducible install matching CI) |
| `npm run dev` | Starts the local dev server at `localhost:4321` |
| `npm run build` | Builds the production site to `docs/dist/` |
| `npm run preview` | Serves the production build locally so you can check it before deploying |

Run `npm run build` before opening a pull request — it catches broken internal links and invalid frontmatter that the dev server won't always flag.

## Where Content Lives

Pages live under `docs/src/content/docs/`, organized into sections that mirror the sidebar:

- `getting-started/`
- `core-concepts/`
- `cli-reference/`
- `migration/`
- `guides/`
- `api-reference/`
- `troubleshooting/`
- `best-practices/`

A page's URL is derived from its path inside `docs/src/content/docs/`, with the `.md` extension dropped. For example, a file at `core-concepts/reactivity.md` is served at `/core-concepts/reactivity/`.

## Frontmatter

Every page requires `title` and `description` in its frontmatter. The schema is enforced by `docsSchema()`, defined in `docs/src/content.config.ts` — check that file if you need the full list of optional fields (e.g. `sidebar` ordering overrides, `hero`, etc.).

Example:

```md
---
title: Reactivity Basics
description: How Avenx-JS tracks and updates reactive state.
---

Page content starts here...
```

> Pull a real frontmatter block from an existing page in `docs/src/content/docs/` when writing your own — match the style already in use rather than inventing a new shape.

## Adding a New Page

1. Create the Markdown file in the correct section directory under `docs/src/content/docs/` (see the list above).
2. Add the required frontmatter (`title`, `description`, plus any relevant optional fields).
3. Write the page content, following the house style below.
4. **Register the page in the sidebar array** in `docs/astro.config.mjs`, adding a `label` and the matching `slug`. The slug is the page's path without the `.md` extension.
5. Run `npm run dev` and confirm the page renders and appears correctly in the sidebar.

> ⚠️ **Don't skip step 4.** A page that isn't added to the sidebar array ships as an orphaned page — reachable by direct URL only, invisible in navigation. This exact mistake has already happened once in this repo (see issue #1162) and is the most common way a new docs page goes unnoticed.

## Before Opening a Pull Request

- Run `npm run build` from inside `docs/` and confirm it completes with no errors — this catches broken links and invalid frontmatter.
- Check your change in the dev server (`npm run dev`) to confirm it renders and reads the way you expect.
- Confirm any new page is reachable from the sidebar, not just by direct URL.

## House Style

A few conventions drawn from the existing pages:

- Use sentence case in headings ("Getting started with routing", not "Getting Started With Routing").
- Tag fenced code blocks with a language (` ```js `, ` ```bash `, etc.) — untagged blocks don't get syntax highlighting.
- Use tables for listing options, flags, or command references.
- Prefix CLI examples with `avenx` (e.g. `avenx build`, `avenx create`) to match the naming used elsewhere in the docs.

> Skim two or three existing pages under `docs/src/content/docs/` before writing — the fastest way to match house style is to copy the shape of something that's already there.
> 
