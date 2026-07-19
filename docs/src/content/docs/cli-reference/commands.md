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

### 5. `avenx watch` (alias: `w`)

Compiles the project once and then continues running in the background, watching the `src/` directory for changes.

Whenever a file in the `src/` directory changes, Avenx automatically rebuilds the project and updates the generated files in the `dist/` directory. This keeps your compiled output up to date without manually running `avenx build` after every change.

Unlike `avenx serve`, the `watch` command does not start a local development server or provide browser live reloading. It only watches for file changes and continuously rebuilds the project in the background.

**Example:**

```bash
npx avenx watch
```

Press **Ctrl + C** to stop watching.

### 6. `avenx serve [port]`

Starts a local live-reloading development server (default port: 3000). 

#### Description

The development server watches the `src/` directory for code modifications and automatically triggers a project rebuild. It utilizes a Server-Sent Events (SSE) bridge to instantly dispatch a reload event to all connected browser instances upon a successful compilation.

> **Note on Reloading Behavior:** When a code change is detected, the development server triggers a full page refresh (`window.location.reload()`) in the connected browsers to apply the updates. This is a **Live Reloading** mechanism rather than Hot Module Replacement (HMR); as a result, transient local application state will be reset when the page refreshes.

### 7. `avenx check` (alias: `lint`)

Validates your project's templates without triggering a full production build.

#### Description

The `check` command parses all local templates to catch potential runtime errors early. It analyzes the template structure to detect:

- Undeclared or missing variables
- Incorrectly referenced computed properties
- Unregistered or malformed actions

#### Exit Codes

- **`0`**: Success. All templates successfully parsed with no validation errors or warnings.
- **`1`**: Validation Failure. The command will exit with code 1 if any template warnings or errors are detected, making it ideal for CI/CD linting pipelines.

### 8. `avenx clean`

Clears out compiled distribution outputs to prepare for a fresh build.

#### Description

The `clean` command deletes the compiled distribution directory to ensure no stale files persist in your build environment. This is highly useful for CI/CD build pipelines to guarantee a clean state before executing production builds.

#### Default Behavior

Upon execution, it securely deletes the default distribution directory (typically `dist/`).

#### Configuration

The target folder deleted by this command is determined by the output directories specified in your `avenx.config.json` file.

