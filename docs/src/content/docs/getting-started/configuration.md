---
title: 'Configuration'
description: 'Configure Avenx-JS project paths, template overrides, and the local development server.'
---

Avenx-JS reads optional project settings from `avenx.config.json` in the project root. When the file is missing, the CLI uses the default values below.

```json
{
  "srcDir": "src",
  "distDir": "dist",
  "templatesDir": ".avenxtemplates",
  "server": {
    "port": 3000,
    "host": "localhost",
    "liveReload": true
  },
  "treeShakeComponents": true,
  "voidTags": []
}
```

## Options

| Option         | Type       | Default              | Rules                                                                 |
| -------------- | ---------- | --------------------- | ---------------------------------------------------------------------- |
| `mode`         | `string`   | `"production"`       | Build mode: `"production"` or `"development"`. Overridden by `--dev` / `--prod`; `avenx serve` and `avenx watch` default to development. See [Build modes](#build-mode-mode). |
| `srcDir`       | `string`   | `"src"`              | Non-empty relative path to application source files.                  |
| `distDir`      | `string`   | `"dist"`              | Non-empty relative path where compiled output is written.             |
| `outputName`   | `string`   | `"bundle"`         | Base name used for generated JavaScript and CSS bundles. The compiler generates <outputName>.js and <outputName>.css. Must be a non-empty filename without an extension.|
| `templatesDir` | `string`   | `".avenxtemplates"`  | Non-empty relative path for local generator template overrides.       |
| `server.port`  | `number`   | `3000`                | Valid TCP port from `0` to `65535`.                                    |
| `server.host`  | `string`   | `"localhost"`         | Non-empty host name or address for the local dev server.              |
| `server.liveReload` | `boolean` | `true`              | Enables file watching, automatic browser reloads, and inspection script injection. |
| `enableProfiling` | `boolean` | `false` | Enables performance profiling by wrapping lifecycle hooks, rendering, and DOM patching with browser Performance API marks and measures. |
| `debug.debugReactivity` | `boolean` | `false` | Enables verbose reactivity dependency tracking and watcher execution logging to the browser console during development. |
| `treeShakeComponents` | `boolean` | `true` | Removes unused components from the compiled bundle during compilation. Set to `false` to compile all discovered components. |
| `voidTags`     | `string[]` | `[]`                   | Extra tag names the compiler treats as void (self-closing), in addition to the built-in HTML void tags (`img`, `br`, `input`, etc.). Each entry must be a non-empty string. |
| `warnings`     | `object`   | `{}`                   | Map of compiler warning codes (`AVX_W01`, `AVX_W03`, etc.) to severity overrides (`"off"`, `"ignore"`, `"warn"`, or `"error"`). |

Path options must be relative paths. Absolute paths are rejected during configuration loading.


## Build mode (`mode`)

`avenx build` produces a production build by default: it bundles the minified runtime and writes the CSS source map as a separate linked file. Development builds bundle the readable runtime and inline the CSS source map instead.

Pin the mode in `avenx.config.json` when a project should always build one way:

```json
{
  "mode": "production"
}
```

Resolution order, first match wins:

1. `--dev` / `--prod` on the command line.
2. `mode` in `avenx.config.json`.
3. `NODE_ENV=development`.
4. The command's default — development for `avenx serve` and `avenx watch`, production for everything else.

The active mode is printed in the build header, so it is never ambiguous which one ran:

```text
--- Avenx-JS Compiler (production) ---
```

Both modes compile the same application and ship the same runtime features. Production is that runtime, minified — no feature is stripped and no behaviour differs. See the [deployment guide](/guides/deployment#build-modes) for the full comparison.

## Custom void tags

If your templates use custom or web-component tags that are always self-closing by convention (e.g. `<my-video>` without a trailing slash), list them under `voidTags` so the compiler doesn't wait for a closing tag that will never arrive:

```json
{
  "voidTags": ["my-video", "custom-icon"]
}
```

Tags written with an explicit self-closing slash, like `<my-video />`, are already parsed correctly without any configuration — `voidTags` is only needed for the no-slash convention.

## Tree Shaking Components

By default, Avenx-JS removes components that are not referenced by your application during compilation. This helps reduce the final bundle size and improves application performance.

If your project loads components dynamically or registers components through plugins, you may want to disable component tree shaking.

### Configuration

```json
{
  "treeShakeComponents": false
}
```

### Behavior

When `treeShakeComponents` is:

| Value | Behavior |
| ------ | -------- |
| `true` | Only components referenced by pages or other used components are included in the compiled bundle. |
| `false` | All discovered components are compiled, even if they are not referenced directly. |

In most applications, the default value of `true` should be used. Disable tree shaking only when your application depends on components that cannot be detected during compilation.

## CSS Preprocessor & Style Settings (`style`)

Avenx-JS supports configuring CSS preprocessors and source maps through the `style` object in `avenx.config.json`.

### Configuration

```json
{
  "style": {
    "preprocessor": "scss",
    "sourceMap": true,
    "inlineSourceMap": false
  }
}
```

### Style Options Breakdown

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `style.preprocessor` | `string` | `undefined` | Specifies the CSS preprocessor (`"scss"`, `"sass"`, `"postcss"`, `"less"`). |
| `style.sourceMap` | `boolean \| "inline"` | `false` | Enables CSS source map generation for component styles and global CSS. When set to `true`, writes an external `.map` file (e.g. `bundle.css.map`). When set to `"inline"`, embeds base64 source maps directly into the CSS bundle. |
| `style.inlineSourceMap` | `boolean` | `false` | When `true`, forces source maps to be embedded inline into the output CSS bundle as a base64 Data URL. |
| `style.dev` | `boolean` | `false` | Development mode override flag. When `true`, automatically enables inline source maps during CSS compilation. |

### Supported Preprocessors

The `preprocessor` option accepts one of the following values:

| Value | Description |
| ------ | ----------- |
| `sass` | Uses the Sass indented syntax. |
| `scss` | Uses the SCSS syntax for Sass. |
| `postcss` | Uses PostCSS for CSS transformations. |
| `less` | Uses the Less CSS preprocessor. |

### Fallback Behavior

If the configured preprocessor package is not installed, Avenx-JS falls back to raw CSS processing and emits the `AVX_W24` (`COMPILER_PREPROCESSOR_MISSING`) warning.

## Example

```json
{
  "srcDir": "app",
  "distDir": "public/build",
  "templatesDir": ".avenxtemplates",
  "server": {
    "port": 5173,
    "host": "0.0.0.0",
    "liveReload": false
  },
  "treeShakeComponents": false,
  "voidTags": ["my-video"]
}
```

The configuration is merged with the defaults, so you can override only the settings your project needs.

Set `server.liveReload` to `false` when the dev server should serve HTML without watching for changes or injecting the live-reload and inspection client script.

## Performance Profiling

Avenx-JS can generate high-resolution browser performance timings (marks and measures) for monitoring component rendering, mounting, and DOM patching.

### Activation Modes

Profiling can be enabled in two ways:

1. **Build Configuration (`avenx.config.json`)**:
   Enable profiling project-wide by setting `enableProfiling` to `true`:
   ```json
   {
     "enableProfiling": true
   }
   ```

2. **Dynamic Runtime Flag (`window.__avenx_enable_profiling`)**:
   Activate profiling dynamically in the browser console at runtime without restarting the application:
   ```javascript
   window.__avenx_enable_profiling = true;
   ```

---

### Performance Measure Format & Phases

When profiling is enabled, Avenx-JS wraps operations in native browser `performance.mark()` calls and outputs measures formatted as:

```text
[Avenx] ${componentName} - ${phase}
```

#### Measured Lifecycle Phases

| Phase | Description |
| --- | --- |
| `mount` | Initial mounting of the component instance and attachment to the DOM. |
| `render` | Resolving interpolations, directives, and compiling component templates. |
| `patch` | Reactive DOM diffing and patching when component `state` or `props` change. |
| `onMount` | Execution time for the component's `onMount()` lifecycle hook. |
| `onBeforeUpdate` | Execution time for the `onBeforeUpdate()` lifecycle hook prior to patching. |
| `onUpdate` | Execution time for the `onUpdate()` lifecycle hook post-patching. |
| `onUnmount` | Cleanup execution time during `onUnmount()`. |

---

### Programmatic Querying & Analysis

In addition to inspecting measures in the Chrome or Firefox DevTools **Performance** tab, you can query and analyze measures programmatically in the browser console using the native `Performance` API:

```javascript
// Retrieve all Avenx performance measure entries
const measures = performance.getEntriesByType('measure')
  .filter(entry => entry.name.startsWith('[Avenx]'));

// Display measure summary table in browser console
console.table(
  measures.map(m => ({
    Measure: m.name,
    'Duration (ms)': m.duration.toFixed(3),
    'Start Time (ms)': m.startTime.toFixed(2),
  }))
);

// Calculate total time spent patching DOM
const totalPatchTime = measures
  .filter(m => m.name.endsWith('- patch'))
  .reduce((sum, m) => sum + m.duration, 0);

console.log(`Total DOM Patching Time: ${totalPatchTime.toFixed(2)} ms`);
```

---

## Reactivity Tracing & Debugging (`debug.debugReactivity`)

Avenx-JS provides a reactivity tracing mode for diagnosing state updates, tracking Proxy dependency registrations, and identifying unnecessary component re-renders.

### Configuration (`avenx.config.json`)

Enable reactivity tracing project-wide by setting `debug.debugReactivity` to `true`:

```json
{
  "debug": {
    "debugReactivity": true
  }
}
```

### Runtime & Programmatic Tracing

In addition to `avenx.config.json`, reactivity debugging can be toggled dynamically:

1. **Browser Console Flag**:
   ```javascript
   window.__avenx_debug_reactivity__ = true;
   ```
2. **Programmatic API**:
   ```javascript
   import { setDebugReactivity } from 'avenx-core/runtime';

   setDebugReactivity(true);
   ```

When active, the framework outputs detailed logs to the browser console for Proxy property reads, dependency tracking events, and watcher job executions.



## Logging Options

Avenx-JS includes a configurable logging system that can be customized through the `logging` section in `avenx.config.json`.

This setting only controls the **CLI's build-time output** — the messages printed to your terminal while running commands like `avenx build` or `avenx dev`. It has no effect on logging inside your compiled application (the `logger` calls that run in the browser). To configure logging for your running app, pass a `logging` option to the `AvenxApp` constructor, or use the `AvenxLogger` class directly — see [AvenxLogger](/api-reference/utils/#avenxlogger) in the API reference.

### Configuration

```json
{
  "logging": {
    "level": "info",
    "silent": false
  }
}
```

### Available Options

| Option | Type | Default | Description |
| ------- | ---- | ------- | ----------- |
| `level` | `string` | `"info"` | Sets the minimum log level that will be displayed. |
| `silent` | `boolean` | `false` | Disables all logging output when set to `true`. |

### Supported Log Levels

Log levels are ordered by severity. Messages below the configured level are ignored.

| Level | Description |
| ------- | ----------- |
| `trace` | Very detailed diagnostic information. |
| `debug` | Debugging information useful during development. |
| `info` | General informational messages. |
| `warn` | Warning messages that do not stop execution. |
| `error` | Errors encountered during execution. |
| `fatal` | Critical errors requiring immediate attention. |
| `off` | Disables all logging. |
| `silent` | Alias for `off`. |

---

## Custom Output Bundle Naming (`outputName`)

By default, the Avenx compiler outputs JavaScript and CSS distribution files named `bundle.js` and `bundle.css` in your configured `distDir`.

You can customize the base name of the generated bundle files using the top-level `outputName` property in `avenx.config.json`:

```json
{
  "outputName": "app.bundle"
}
```

### Generated Files

When `outputName` is set to `"app.bundle"`, running `avenx build` generates:

```text
dist/
├── app.bundle.js
├── app.bundle.css
└── app.bundle.css.map (if source maps are enabled)
```

### HTML Entry Point Update

Be sure to update your `index.html` file to reference the customized bundle filenames:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Avenx App</title>
    <link rel="stylesheet" href="dist/app.bundle.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="dist/app.bundle.js"></script>
  </body>
</html>
```

### Example: Enable Debug Logging

```json
{
  "logging": {
    "level": "debug"
  }
}
```

### Example: Disable All Logging

```json
{
  "logging": {
    "silent": true
  }
}
```

When both `silent` and `level` are provided, setting `silent` to `true` suppresses all log output regardless of the configured log level.

---

## Compiler Warning Configurations (`warnings`)

The Avenx compiler allows project maintainers to customize how template validation and build warnings are handled across the project. Using the `warnings` configuration map in `avenx.config.json`, you can override the default severity of specific warning codes (e.g. `AVX_W01`, `AVX_W03`, `AVX_W09`).

### Supported Severity Levels

Each warning code in the `warnings` map accepts one of the following severity string values:

| Severity | Behavior |
| :--- | :--- |
| `"warn"` | *(Default)* Prints a warning message to the console / build logs without halting compilation. |
| `"off"` / `"ignore"` | Suppresses the warning completely. It will not be logged to the console or build output. |
| `"error"` | Elevates the warning to a **fatal compilation error**. The compiler throws an exception and halts the build. |

---

### Configuration Example

```json
{
  "warnings": {
    "AVX_W03": "error",
    "AVX_W01": "off",
    "AVX_W02": "ignore"
  }
}
```

In this example:
- **`AVX_W03` (`COMPILER_UNDECLARED_REFERENCE`)** is elevated to `"error"`. If a template references a variable or method that is not declared in `<state>`, `<computed>`, or `<action>`, the build fails immediately.
- **`AVX_W01` (`COMPILER_BUNDLE_SIZE_EXCEEDED`)** is set to `"off"`, suppressing bundle size budget warnings.
- **`AVX_W02` (`COMPILER_EMPTY_TEMPLATE`)** is set to `"ignore"`, suppressing empty component warnings.

---

### CI/CD Integration & Strict Mode

Promoting specific warnings to `"error"` is a powerful tool for enforcing code quality checks in Continuous Integration (CI/CD) pipelines.

By setting critical warnings (such as undeclared variables `AVX_W03` or invalid preprocessor configs `AVX_W25`) to `"error"`, your automated build checks (e.g. `avenx build` or `npm run build`) fail automatically if any component contains template errors, preventing buggy code from being merged or deployed to production.

---

## Rewind Configuration (`rewind`)

Project-wide defaults for [Avenx Rewind](/core-concepts/rewind), the transaction
behaviour behind `atomic` actions. Both keys are optional; an action may
override `onConflict` for itself.

```json
{
  "rewind": {
    "onConflict": "safe",
    "maxSnapshotItems": 10000
  }
}
```

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `onConflict` | `"safe" \| "force" \| "abort"` | `"safe"` | What a rewind does when a path no longer holds the value the transaction wrote. `safe` leaves the newer value alone and reports `AVX_R29`; `force` restores regardless; `abort` restores what it can, then throws. |
| `maxSnapshotItems` | `number` | `10000` | How many entries an array, `Map` or `Set` may hold before the journal stops taking a savepoint of it. A collection past the limit is reported through `AVX_R29` on rewind rather than truncated silently. |

A project that leaves this section alone emits no configuration into the bundle
at all — the defaults are already in the runtime.

---

## Environment Variable Interpolation

Avenx-JS supports global environment variable interpolation in `avenx.config.json`. This feature allows developers to parameterize project configurations — such as dev server ports, hostnames, output directories, and bundle budgets — dynamically using environment variables from your shell, `.env` files, or CI/CD pipelines.

### Interpolation Syntax

Environment variable expansion supports both basic variable replacement and fallback default values:

| Syntax Pattern | Description | Example | Resolved Value |
| :--- | :--- | :--- | :--- |
| **Basic Syntax**<br>`${VAR_NAME}` or `$VAR_NAME` | Expands to `process.env.VAR_NAME`. If the environment variable is not defined, it resolves to an empty string (`""`). | `"${HOST}"` | `"localhost"` (or `""` if unset) |
| **Fallback Syntax**<br>`${VAR_NAME:-default_value}` | Expands to `process.env.VAR_NAME` if set. If `VAR_NAME` is unset or empty, it uses `default_value`. | `"${PORT:-3000}"` | `"3000"` (if `PORT` is unset) |

### Supported Configuration Fields & Type Conversion

Environment variable expansion is recursively applied across string and numeric values in `avenx.config.json`, including:
- **Server Options**: `server.port`, `server.host`
- **Build & Path Options**: `srcDir`, `distDir`, `templatesDir`, `outputName`
- **Compiler & Style Options**: `style.preprocessor`, `voidTags`, bundle budget limits, and logging settings

#### Automatic Numeric Type Conversion
Config options that expect numeric values (such as `server.port`) are automatically converted to JavaScript `number` types after interpolation if the resolved string contains a numeric value. For instance, `"${PORT:-3000}"` resolves to the numeric value `3000`.

### Sample Parameterized Configuration

The following `avenx.config.json` snippet illustrates how to parameterize server, build outDir, and bundle budget settings with fallback values:

```json
{
  "server": {
    "port": "${PORT:-3000}",
    "host": "${HOST:-localhost}",
    "open": false
  },
  "build": {
    "outDir": "${BUILD_OUT_DIR:-dist}",
    "bundleBudget": {
      "javascript": "${MAX_JS_SIZE:-500}",
      "css": "${MAX_CSS_SIZE:-100}"
    }
  }
}
```

---

### Multi-Environment Setup Examples

Using environment variable interpolation allows a single `avenx.config.json` file to adapt seamlessly across local development, containerized deployments, and automated CI/CD pipelines without modifying configuration source files.

#### 1. Local Development
For day-to-day local development, no environment variables need to be set manually if default fallbacks are provided:
```bash
# Uses fallbacks: port 3000, host localhost, outDir dist
avenx dev
```

#### 2. Docker Containers
When running inside Docker, inject container environment variables via `docker run` or Docker Compose:
```bash
docker run -e HOST=0.0.0.0 -e PORT=8080 -p 8080:8080 my-avenx-app
```

#### 3. Continuous Integration (CI/CD) Pipelines
In CI pipelines (e.g. GitHub Actions, GitLab CI), override build output directories and enforce stricter bundle budgets during automated build checks:
```yaml
# GitHub Actions workflow example
- name: Run Build with Custom Settings
  env:
    BUILD_OUT_DIR: "dist/release"
    MAX_JS_SIZE: "250"
  run: npm run build
```

---

### Security & Best Practices

1. **Do Not Commit Secrets in `avenx.config.json`**: Avoid hardcoding sensitive keys, API credentials, or private tokens in `avenx.config.json` or fallback values.
2. **Use `.env` Files Responsibly**: Store environment secrets in `.env` files and ensure `.env` is included in your `.gitignore`.
3. **Always Provide Default Fallbacks**: Use the `${VAR_NAME:-fallback}` syntax for non-critical options so local development works out of the box without requiring manual environment exports.


