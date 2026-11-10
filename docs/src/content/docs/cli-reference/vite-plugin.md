---
title: 'Vite Plugin (@avenx/vite)'
description: 'Official Vite plugin for Avenx-JS providing Single File Component (SFC) & Page compilation, CSS processing, and Hot Module Replacement (HMR).'
---

The `@avenx/vite` package (located in `plugins/avenx-vite`) brings native [Vite](https://vitejs.dev/) integration to Avenx-JS projects. It executes during pre-transformation hooks (`enforce: 'pre'`), parses `.component.js` and `.page.js` files, processes companion CSS stylesheets, and triggers automatic reloads via Vite's Hot Module Replacement (HMR) architecture.

---

## Installation & Plugin Configuration

### Package Installation

`@avenx/vite` is not on npm yet, so `npm install -D @avenx/vite` fails with a
404. Until a release publishes it, build it from a checkout of the Avenx
repository and install the result. These commands assume the checkout sits next
to your project, in the same parent folder:

```bash
# Once: get the repository and the tools its packages build with
git clone https://github.com/avenx-js/avenx-js.git
cd avenx-js
npm ci

# Pack the core and the plugin. Each command prints the .tgz file it wrote.
npm pack
npm pack ./plugins/avenx-vite

# In your project: the core as a dependency, the plugin and Vite as dev dependencies
cd ../my-app
npm install ../avenx-js/avenx-core-<version>.tgz
npm install -D ../avenx-js/avenx-vite-<version>.tgz vite
```

Replace `<version>` with the version in the file names `npm pack` printed.
Install `avenx-core` from the same checkout as the plugin. The plugin compiles
components through `avenx-core/integration`, an entry point the `avenx-core`
release currently on npm does not have yet, and it requires `avenx-core` at its
own version.

Your configuration is the same either way. Once the package is on npm, this step
becomes `npm install -D @avenx/vite vite` and nothing else changes.

### Basic `vite.config.js` Setup

Register `avenxPlugin` (or `avenxVite`) inside the `plugins` array of your Vite configuration file:

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { avenxVite } from '@avenx/vite';

export default defineConfig({
  plugins: [
    avenxVite({
      debug: false,
    }),
  ],
});
```

---

## Plugin Options

The `avenxVite(options)` (or `avenxPlugin(options)`) factory function accepts an optional configuration object:

```typescript
interface AvenxPluginOptions {
  /**
   * Enables detailed debug logging in the Vite dev server console.
   * @default false
   */
  debug?: boolean;

  /**
   * Controls Source Map v3 generation for .component.js and .page.js templates during build & transformation passes.
   * @default true in dev
   */
  sourcemap?: boolean;

  /**
   * Configuration options passed directly to StyleProcessor.
   * @default {}
   */
  style?: object;
}
```

### Options Breakdown

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `debug` | `boolean` | `false` | When enabled, logs file resolution, stylesheet loading, compilation phases (`Compile Component`, `Compile Page`), and HMR events to stdout (`[avenx-vite] ...`). |
| `sourcemap` | `boolean` | `true in dev` | Controls Source Map v3 generation for `.component.js` and `.page.js` templates during build & transformation passes. |
| `style` | `object` | `{}` | Options passed directly to internal `StyleProcessor` for CSS scoping, preprocessor handlers, or style transformations. |

---

## SFC & Page Compilation Lifecycle

`@avenx/vite` intercepts source files in Vite's `transform` and `load` hooks using pre-defined file extensions.

```
Source Files (.component.js / .page.js)
        │
        ▼
   resolveId()  ──►  Check file naming conventions
        │
        ▼
     load()     ──►  Load & strip <@css> tags from .component.css / .page.css
        │
        ▼
   transform()  ──►  ComponentParser & StyleProcessor compilation
        │
        ▼
    wrapper     ──►  Wrap ES Module with default export (wrapComponent / wrapPage)
```

### 1. File Identification & Naming Conventions

The plugin inspects file suffixes using the following strict extensions:

- **Components:** `.component.js`
- **Pages:** `.page.js`
- **Component Styles:** `.component.css`
- **Page Styles:** `.page.css`

---

## Hot Module Replacement (HMR) Architecture

`@avenx/vite` integrates with Vite's HMR system via the `handleHotUpdate(ctx)` hook.

```javascript
// hmr.js
export function handleAvenxHotUpdate(ctx) {
  const { file, server } = ctx;

  if (!isAvenxFile(file)) {
    return;
  }

  console.log('[HMR]', file);

  server.ws.send({
    type: 'full-reload',
  });

  return [];
}
```

### How HMR Works

1. **File Change Detection:** When a `.component.js`, `.page.js`, `.component.css`, or `.page.css` file is updated, Vite triggers `handleHotUpdate`.
2. **WebSocket Notification:** The plugin intercepts the update and sends a `{ type: 'full-reload' }` WebSocket signal to the client browser.
3. **Empty Module Array:** Returning `[]` instructs Vite to bypass standard module invalidation for that file, preventing duplicate re-execution during full reload.

### Vite Dev Server vs. Standalone `avenx dev` CLI

| Feature | `@avenx/vite` (Vite) | `avenx dev` (CLI Dashboard) |
| :--- | :--- | :--- |
| **Development Server** | Vite Connect dev server | Native Node.js CLI server & dashboard |
| **Hot Reloading** | Vite WebSocket full reload (`server.ws`) | Custom SSE / polling reload server |
| **Module Bundling** | ESbuild pre-bundling & Rollup production builds | Avenx CLI compiler output |
| **Plugin Ecosystem** | Full access to Vite plugins (PostCSS, Tailwind, PWA, etc.) | Zero-config standalone environment |

---

## Template Source Maps & DevTools Debugging

`@avenx/vite` includes native Source Map v3 generation for `.component.js` and `.page.js` files. During Vite transformation passes, the plugin constructs VLQ-encoded source maps mapping compiled JavaScript blocks (constructor initialization, action methods, computed property getters, resources, and rendered HTML templates) back to exact line numbers in original template files.

### How Source Mapping Operates

During template compilation (`compileComponent` and `compilePage`), `@avenx/vite` constructs a Source Map v3 compliant mapping object:

- **Constructor & State Initialization:** Maps `constructor()` and `super()` state bindings back to original template `<state>` block lines.
- **Action Methods:** Maps compiled action handlers (`<action name="...">`) to their original template source line indices.
- **Computed Properties:** Maps computed getters (`<computed name="...">`) to their original source definitions.
- **Resource Management:** Links resource hooks (`<resource name="...">`) directly back to original template lines.
- **Template & Expression Interpolations:** Maps transformed HTML template strings and dynamic string interpolations back to original template lines.

### DevTools Integration

Browser developer tools (**Chrome DevTools**, **Firefox Developer Edition**, **Safari Web Inspector**) leverage these VLQ-encoded source maps to map executed runtime ES modules back to your original source code:

- **Line-by-Line Breakpoint Debugging:** Place breakpoints directly inside original `.component.js` or `.page.js` source files within browser DevTools.
- **Precise Stack Traces:** Console errors and warnings display exact line numbers referencing original template source files rather than compiled bundle output.
- **Scope & State Inspection:** Inspect local variables, reactive component state, actions, and computed properties in their original template scope.

### Configuration Example

You can explicitly configure sourcemap generation in your `vite.config.js`:

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { avenxVite } from '@avenx/vite';

export default defineConfig({
  plugins: [
    avenxVite({
      debug: process.env.NODE_ENV === 'development',
      sourcemap: true, // Enable template line mapping for browser DevTools
      style: {
        scoped: true,
      },
    }),
  ],
  build: {
    sourcemap: true, // Also generate JS bundle source maps
  },
});
```

---

## Full `vite.config.js` Boilerplate

Here is a complete, production-ready `vite.config.js` example for building single-page or multi-page Avenx applications:

```javascript
import { defineConfig } from 'vite';
import { avenxVite } from '@avenx/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [
    avenxVite({
      debug: process.env.NODE_ENV === 'development',
      sourcemap: true,
      style: {
        scoped: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
});
```

---

## Troubleshooting Guide

### 1. Component or Page Is Not Compiling

* **Symptom:** Files are served as raw JavaScript or produce unexpected module export errors.
* **Cause:** The file name does not end with `.component.js` or `.page.js`.
* **Fix:** Ensure all component files strictly use `.component.js` and page files strictly use `.page.js`. Generic `.js` files are ignored by the plugin's `enforce: 'pre'` hooks.

### 2. Class Name Derivation Mismatches

* **Symptom:** Import statements or template references fail to find the exported component class.
* **Cause:** Filenames with non-alphanumeric characters or non-standard naming.
* **Fix:** `@avenx/vite` derives class names by stripping extensions and splitting on `-` and `_`. Ensure filenames match expected conventions (e.g. `nav-bar.component.js` generates `NavBar`).

### 3. Duplicate `export default` Syntax Error

* **Symptom:** `SyntaxError: Identifier 'default' has already been declared`.
* **Cause:** Manually adding `export default` inside a `.component.js` or `.page.js` file.
* **Fix:** Do not write explicit `export default` statements inside component or page templates. The plugin automatically appends `export default ClassName` during module wrapping.
