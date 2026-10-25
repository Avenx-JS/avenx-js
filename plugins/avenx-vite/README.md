# @avenx/vite

Official [Vite](https://vitejs.dev/) plugin for [Avenx.js](https://github.com/avenx-js/avenx-js).

`@avenx/vite` integrates Avenx Single-File Components (SFCs), pages, scoped styles, and Hot Module Replacement (HMR) into the Vite build toolchain. It runs as a pre-transform plugin (`enforce: 'pre'`), compiling Avenx templates and companion stylesheets into standard ES modules during development and production builds.

---

## Features

- **Pre-transform compilation**: Compiles `.component.js` and `.page.js` files before Vite processes them.
- **Scoped CSS processing**: Extracts and scopes `<@css>` blocks from co-located `.component.css` and `.page.css` stylesheets.
- **Hot Module Replacement (HMR)**: Listens for component and stylesheet changes, dispatching reload signals to the browser through Vite's WebSocket server.
- **Template Source Maps**: Generates VLQ-encoded Source Map v3 data so browser DevTools can map compiled JavaScript lines directly back to original template lines.
- **Vite ecosystem access**: Seamlessly combines with other Vite plugins, PostCSS, Tailwind CSS, path aliases, and modern bundler tooling.

---

## Installation

Install `@avenx/vite` and `vite` as development dependencies in your project:

```bash
npm install -D @avenx/vite vite
```

### Peer Dependencies

`@avenx/vite` requires the following peer dependencies declared in `package.json`:

| Package      | Supported Version Range |
| :----------- | :---------------------- |
| `vite`       | `^7.0.0 \|\| ^8.0.0`    |
| `avenx-core` | `>=0.4.0`               |

---

## Quick Start

Register the plugin in your `vite.config.js`:

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { avenxVite } from '@avenx/vite';

export default defineConfig({
  plugins: [avenxVite()],
});
```

> **Note:** Both named imports (`avenxVite`, `avenxPlugin`) and the default
> export (`import avenxVite from '@avenx/vite'`) are supported.

---

## Plugin Options

`avenxVite(options)` accepts an optional configuration object:

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { avenxVite } from '@avenx/vite';

export default defineConfig({
  plugins: [
    avenxVite({
      debug: false,
      sourcemap: true,
      csp: { strict: true },
      style: {
        scoped: true,
      },
    }),
  ],
});
```

| Option      | Type      | Default       | Description                                                                                                                      |
| :---------- | :-------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------- |
| `debug`     | `boolean` | `false`       | When `true`, outputs `[avenx-vite]` logs to the terminal for file resolution, style loading, compilation phases, and HMR events. |
| `sourcemap` | `boolean` | `true in dev` | Generates Source Map v3 mappings for component and page templates to assist DevTools breakpoint debugging.                       |
| `style`     | `object`  | `{}`          | Configuration object forwarded directly to Avenx's internal `StyleProcessor` for style scoping and transformation rules.         |
| `csp`       | `object`  | `{}`          | `{ strict: true }` fails the transform (AVX_C31) for a module whose expressions did not all compile to functions, instead of leaving them to the runtime interpreter — which is what would need `script-src 'unsafe-eval'`. The same option as `csp.strict` in `avenx.config.json`, and read from a config object passed as `config` too. |

---

## File Conventions

The plugin detects and processes Avenx files based on standard naming conventions:

| File Type           | Recognized Suffixes / Patterns                          | Description                                                                                         |
| :------------------ | :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------- |
| **Component**       | `*.component.js`, `*.component.html`, `*.component.avx` | Compiled via `ComponentParser` and wrapped as an ES module exporting the generated component class. |
| **Page**            | `*.page.js`, `*.page.html`, `*.page.avx`                | Compiled as a page module and wrapped with `AvenxPage` runtime imports.                             |
| **Component Style** | `*.component.css`                                       | Co-located stylesheet whose `<@css>` blocks are scoped to the matching component.                   |
| **Page Style**      | `*.page.css`                                            | Co-located stylesheet whose `<@css>` blocks are scoped to the matching page.                        |

> **Important:** Do not write explicit `export default` statements inside
> `.component.js` or `.page.js` source files. The plugin automatically generates
> and appends `export default ClassName;` during compilation.

---

## Example Project

A complete, runnable Vite application using `@avenx/vite` is located in [`example/`](./example).

To run the example:

```bash
cd plugins/avenx-vite/example
npm install
npm run dev
```

---

## Documentation

For full architectural details, compiler lifecycle explanations, and advanced debugging tips, refer to the [Vite Plugin Reference Guide](https://docs.avenx-js.com/cli-reference/vite-plugin/) in the official documentation.

---

## License

MIT © Avenx Team
