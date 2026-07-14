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

#### Command Options

- **`--dry-run`** (alias: **`-d`**)  
  Preview the files and changes that would be created without writing anything to disk.

**Example:**

```bash
npx avenx g counter --dry-run
```

This command previews the generated files without actually creating them.

### 3. `avenx destroy` (alias: `d`)

Removes scaffolded files and cleans up their imports and registrations inside `src/main.app.js`.

- **Component**: `npx avenx d counter` Deletes `src/components/counter/` and removes its registration and import from `src/main.app.js`.

- **Page**: `npx avenx d p dashboard` Deletes `src/pages/dashboard.page.js` and `.css`, and cleans up its imports.

- **Bridge**: `npx avenx d bridge settings` Deletes the global state bridge file at `src/global/settings.bridge.js`.

- **Guard**: `npx avenx d guard admin` Deletes the routing guard file at `src/guards/admin.guard.js`.

#### Command Options

- **`--dry-run`** (alias: **`-d`**)  
  Preview the files and changes that would be removed without deleting anything.

**Example:**

```bash
npx avenx d counter --dry-run
```

This command previews which files would be removed without actually deleting them.

### 4. `avenx build` (alias: `b`)

Compiles all components, styles, pages, and bridges into `dist/bundle.js` and `dist/bundle.css`. It strips out runtime imports/exports to create a clean, single-file bundle that can be loaded in browsers directly.

### 5. `avenx serve [port]`

Starts a local hot-reloading development server (default port: 3000). It watches the `src/` directory for changes, automatically triggers a rebuild, and sends a live reload event to connected browser instances via a Server-Sent Events (SSE) bridge.

### 6. `avenx check` (alias: `lint`)

Validates your project's templates without triggering a full production build.

#### Description

The `check` command parses all local templates to catch potential runtime errors early. It analyzes the template structure to detect:

- Undeclared or missing variables
- Incorrectly referenced computed properties
- Unregistered or malformed actions

#### Exit Codes

- **`0`**: Success. All templates successfully parsed with no validation errors or warnings.
- **`1`**: Validation Failure. The command will exit with code 1 if any template warnings or errors are detected, making it ideal for CI/CD linting pipelines.