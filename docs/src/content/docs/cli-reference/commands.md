---
title: 'CLI Commands'
description: 'Explore the command-line interface of Avenx-JS to create, compile, run, and watch projects.'
---

The `avenx` command line tool streamlines your workflow. It handles application scaffolding, file generation, building, and serving.

## Command Syntax

```bash
npx avenx <command> [type] [name]
```

## Available Commands

### 1. `avenx init`

Scaffolds a new project structure in the current working directory. It creates subdirectories (components, pages, global, guards, dist) and sets up standard configuration files (`index.html`, `src/main.app.js`, `.vscode/settings.json`).

### 2. `avenx generate` (alias: `g`)

Generates boilerplate code for components, pages, bridges, and guards.

- **Component**: `npx avenx g counter` Creates `src/components/counter/counter.component.js` and `.css`, and registers it in `main.app.js`.

- **Page**: `npx avenx g p dashboard` Creates `src/pages/dashboard.page.js` and `.css` for routing.

- **Bridge**: `npx avenx g bridge settings` Creates a global state bridge at `src/global/settings.bridge.js`.

- **Guard**: `npx avenx g guard admin` Creates a routing guard at `src/guards/admin.guard.js`.

### 3. `avenx build` (alias: `b`)

Compiles all components, styles, pages, and bridges into `dist/bundle.js` and `dist/bundle.css`. It strips out runtime imports/exports to create a clean, single-file bundle that can be loaded in browsers directly.

### 4. `avenx serve [port]`

Starts a local hot-reloading development server (default port: 3000). It watches the `src/` directory for changes, automatically triggers a rebuild, and sends a live reload event to connected browser instances via a Server-Sent Events (SSE) bridge.
