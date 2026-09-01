---
title: 'Deployment & Production Builds'
description: 'Build, configure, and deploy Avenx-JS applications for production environments.'
---

Avenx-JS applications can be built into static JavaScript and CSS assets and served from a static hosting service or production web server. This guide explains how to create a production build, configure build-time settings and environment variables, deploy the generated files, and configure hosting for production.

---

## Build Modes

Avenx builds in one of two modes.

| | Development | Production |
| :--- | :--- | :--- |
| Command | `npx avenx build --dev` | `npx avenx build` |
| Also used by | `avenx serve`, `avenx watch` | — |
| Runtime bundled | `runtime.js`, readable | `runtime.min.js`, minified |
| CSS source map | Inline, for the browser devtools | Emitted as `bundle.css.map` and linked |
| Hello World bundle | ~403 KB | ~154 KB |

**Production is the default.** `npx avenx build` is what a deploy script runs, so it produces optimised output without a flag. `avenx serve` and `avenx watch` build in development mode, because a readable stack trace matters more than size while you are working. Either default can be overridden with `--dev` or `--prod`, or pinned in `avenx.config.json`:

```json
{
  "mode": "production"
}
```

`NODE_ENV=development` also selects development mode. The active mode is printed in the build header:

```text
--- Avenx-JS Compiler (production) ---
```

### What the production build does

- **Bundles the minified runtime.** Both runtime variants are built from the same module graph, so they cannot differ in behaviour — only in readability.
- **Excludes development infrastructure.** The testing utilities (`avenx-core/testing`) and the lint and build helpers (`avenx-core/tooling`) are separate entry points and are never part of an application bundle. Neither are Node built-ins: the runtime graph is browser-only and needs no `fs` or `path` shim.
- **Keeps the global surface small.** See below.

Nothing is removed from the runtime in production. Both modes ship the same features; production is the same code, minified.

### What the bundle puts on `globalThis`

A compiled application is one concatenated script, so the runtime has to publish itself somewhere the generated code can reach. It installs:

- **`Avenx`** — a namespace carrying the complete runtime surface. Anything the runtime exports is available as `Avenx.<name>`.
- **Seven named globals** — `AvenxComponent`, `AvenxPage`, `defineBridgeName`, `AvenxApp`, `AvenxGuard`, `AvenxRouter` and `bridge`. The first three are emitted into generated code; the rest are authoring entry points a project may reference without importing.

Your own `import` statements keep working regardless of that list. The compiler rewrites runtime imports into destructuring from the namespace, so

```javascript
import { logger, LruCache } from 'avenx-core/runtime';
```

becomes `const { logger, LruCache } = Avenx;` in the bundle. Import what you use; nothing depends on a name happening to be global.

If your page loads other scripts, note that these eight names are the only ones Avenx claims.

## Build Failures and Exit Codes

`avenx build` exits `0` only when the application compiled and the output was written. Any fatal error exits non-zero, so a chained deployment step never runs after a failed build:

```bash
npx avenx build && ./deploy.sh
```

If compilation fails, `deploy.sh` does not execute and CI marks the job as failed.

### What fails the build

| Condition | Code |
| :--- | :--- |
| The source directory is missing | `AVX_C02` |
| Two components compile to the same class name | `AVX_C03` |
| A bridge cannot be resolved, is duplicated, is circular, or is not a `bridge()` module | `AVX_C07`–`AVX_C12` |
| A warning escalated to `"error"` in `avenx.config.json` | that warning's code |
| A `prebuild` or `postbuild` hook exits non-zero | `AVX_C14` |
| The output directory cannot be written | `AVX_C01` |
| Any unexpected error during compilation | — |

Warnings that are not escalated stay warnings: they are printed and the build still exits `0`. To make one fatal, set its severity in `avenx.config.json`:

```json
{
  "warnings": {
    "AVX_W03": "error"
  }
}
```

### What a failure looks like

```text
--- Avenx-JS Compiler (production) ---

✖ Build failed

[AVX_C03] Duplicate component name(s) detected. These files compile to the same class name:
  "Card":
    - src/components/card/card.component.js
    - src/components/widgets/card.component.js
Fix by renaming or moving one of the files.

The command exits with a non-zero status.
```

A diagnosed error prints its message alone; an unexpected error prints its stack, because that is the only useful thing it carries.

### Output is written atomically

Artifacts are compiled in full, written to a staging directory inside `distDir`, and renamed into place only once the entire build succeeds. A build that fails at any point — including after the artifacts are staged — promotes nothing, so `distDir` never holds a mix of a new script and a stale stylesheet.

A failed build does **not** delete the previous output. The exit code is what stops the deployment; removing a working bundle would break anything still serving it. The previous artifacts stay exactly as they were, byte for byte.

:::caution
This guarantee depends on your pipeline respecting the exit code. `npm run build && deploy` and any CI job that fails on a non-zero step are safe. A pipeline that ignores the exit code — `npm run build || true`, or a deploy job that runs regardless of whether the build job passed — can still publish the previous bundle.
:::

### `serve` and `watch` are the exception

`avenx serve` and `avenx watch` keep running when a rebuild fails. The error is printed, the browser is not reloaded so it keeps showing the last good build, and watching continues — the next save usually fixes it. Neither command gates a deployment, and neither sets a failing exit code for a rebuild error.

## Anatomy of a Production Build

By default, the compiler uses the following configuration:

- **`srcDir`**: `"src"`
- **`distDir`**: `"dist"`
- **`outputName`**: `"bundle"`

This produces the following generated structure:

```text
dist/
├── bundle.js
├── bundle.css
└── bundle.css.map
```

- **`bundle.js`**: The generated JavaScript bundle.
- **`bundle.css`**: The generated CSS bundle.
- **`bundle.css.map`**: A CSS source-map artifact useful for debugging. It is not required for the application to function.

The `index.html` file is **not** copied into `dist/` by `npx avenx build`. It remains in the project root and must be deployed alongside the generated `dist/` assets.

A minimal `index.html` for the default output looks like this:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Avenx App</title>
  <link rel="stylesheet" href="dist/bundle.css">
</head>
<body>
  <div id="app"></div>
  <script src="dist/bundle.js"></script>
</body>
</html>
```

### Customizing `outputName`

Changing the `outputName` in your `avenx.config.json`:

```json
{
  "outputName": "app"
}
```

Produces the following assets instead:

```text
dist/app.js
dist/app.css
dist/app.css.map
```

Avenx-JS does not automatically update your `index.html` file when the `outputName` changes. You must manually update `index.html` to reference the matching filenames.

---

## Build-Time Configuration

### `srcDir` and `distDir`

The `srcDir` option controls the application source directory, while `distDir` controls the build output directory. Both are configurable in `avenx.config.json`. By default, they are set to `src` and `dist`.

```json
{
  "srcDir": "src",
  "distDir": "dist"
}
```

### Environment Variable Interpolation

Avenx-JS supports `${ENV_VAR}` interpolation within `avenx.config.json`.

```json
{
  "distDir": "${BUILD_DIR}"
}
```

The environment variable is resolved from the process environment before the configuration validation runs.

### Build Lifecycle Hooks

You can define synchronous shell commands that execute before and after the compiler runs. The `hooks.prebuild` command runs before the compiler build, and `hooks.postbuild` runs after the compiler build returns successfully. Both commands execute from the project base directory.

```json
{
  "hooks": {
    "prebuild": "npm run prepare",
    "postbuild": "npm run verify"
  }
}
```

The execution lifecycle follows this exact sequence:

`prebuild` → `compiler build` → `postbuild`

---

## Environment Variables & Security

Avenx-JS loads project environment configuration at build time. Variables that use the `AVX_PUBLIC_` mechanism are intended specifically for client-side exposure.

### `.env` Loading

Avenx-JS loads the `.env` file from the project root directory. The file is parsed and its values are loaded into the Node.js `process.env` object.

- Existing `process.env` variables are **not** overwritten by values from the `.env` file.
- Loading the `.env` file does **not** mean every variable is exposed to the browser.

```text
AVX_PUBLIC_API_URL=https://api.example.com
API_INTERNAL_URL=https://internal.example.com
```

### The `AVX_PUBLIC_` Prefix Rule

During the build process, Avenx replaces references to `process.env.AVX_PUBLIC_*` with their corresponding values from `process.env`. These values are stringified and inlined into the generated client-side JavaScript bundle.

```javascript
const apiUrl = process.env.AVX_PUBLIC_API_URL;
```

**Never put secrets in an `AVX_PUBLIC_` variable.** Values referenced through `process.env.AVX_PUBLIC_*` are replaced at build time and can become part of the generated client-side JavaScript bundle, so they should be treated as public.

Never use this prefix for passwords, database credentials, private API keys, private access tokens, authentication secrets, or other confidential values.

### Verifying Environment Configuration

```bash
avenx env
```

To see exactly what the compiler is exposing, run the `avenx env` command. This tool displays the `AVX_PUBLIC_*` variables as public and masks all other non-public variables loaded from your `.env` file.

---

## Static Hosting

Avenx-JS production builds produce entirely static assets. They require no server-side runtime and can be served by any static hosting provider or traditional web server.

Because Avenx-JS uses the `BrowserNavigationDelegate` to read `window.location.hash`, all application routes are stored in the URL hash fragment. For example, if you serve your application from a sub-path, the URL will look like `/my-app/#/dashboard`.

When a user visits `/my-app/#/dashboard`, the server only receives a request for `/my-app/`, not `/my-app/#/dashboard`, because the fragment is handled entirely by the browser. Therefore, the server only needs to serve the application entry point and your static assets. You **do not** need to configure SPA rewrite rules, fallback rules (such as Nginx `try_files`), Apache rewrites, or `_redirects` files for Avenx-JS routing.

### GitHub Pages

To deploy to GitHub Pages, build your application using:

```bash
npm ci
npx avenx build
```

When deploying to a project repository, GitHub Pages will automatically serve your site from a sub-path, such as `https://username.github.io/my-app/`. Because Avenx-JS uses hash routing, it naturally handles sub-paths. You do **not** need to configure a `base`, `publicPath`, or deployment sub-path setting in your `avenx.config.json`—no such option exists. (Note: The internal `baseDir` configuration is for local filesystem resolution, not deployment URLs).

Simply ensure that both your root `index.html` file and your generated `dist/` directory are included in the GitHub Pages artifact.

#### GitHub Actions

GitHub Pages can also be deployed automatically with GitHub Actions. The complete workflow is documented in the "CI/CD Integration" section.

### Netlify

To deploy to Netlify, set your build command to `npx avenx build`. Because your `index.html` remains in the project root while the compiled assets are in `dist/`, you must configure your publish directory to a location that preserves this structure:

```text
index.html
dist/
├── bundle.js
├── bundle.css
└── bundle.css.map
```

You do **not** need to add a `_redirects` file for application routing.

### Nginx / Apache

To host your application on Nginx, Apache, or another static web server, copy your `index.html` file and the `dist/` directory to your static web root (e.g., `/var/www/html/my-app/`).

You do not need to configure any catch-all rewrite directives. The server's default configuration for serving static files is completely sufficient.

---

## Caching & Security Headers

Avenx-JS does not automatically configure production cache headers or Content Security Policy headers. These must be configured by the hosting provider or web server.

### Caching Generated Assets

Avenx-JS does **not** generate content-hashed filenames. The default generated filenames are:
- `bundle.js`
- `bundle.css`
- `bundle.css.map`

```text
dist/
├── bundle.js
├── bundle.css
└── bundle.css.map
```

While the `outputName` configuration option can change the filename, the filename itself does not automatically change based on file contents. Therefore, users should avoid assuming that a static filename such as `bundle.js` provides automatic cache busting.

Production hosting environments should use appropriate cache validation and revalidation behavior for these static assets. By utilizing mechanisms such as ETags or Last-Modified headers, you can ensure that clients do not unnecessarily keep stale versions of the application after a new deployment.

### CSS Source Maps

The `bundle.css.map` file is a debugging and source-map artifact. It is **not** required for production runtime execution. You can include it in your production deployments when source-map debugging is desired, or you may safely omit it if production source maps are not wanted. Removing it will not break the application.

### Content Security Policy (CSP)

Because the Avenx-JS dynamic reactivity engine utilizes `new Function()` for expression evaluation and statement execution, it has specific Content Security Policy implications.

If you choose to implement a Content Security Policy for your production application, you **must** include the `'unsafe-eval'` directive within your `script-src` policy. Without it, the browser will block dynamic reactivity, and the framework will not function.

```text
Content-Security-Policy: script-src 'self' 'unsafe-eval';
```

This is an example showing the unsafe-eval requirement and is not a complete production CSP.

### Hosting Configuration

Avenx-JS does not automatically configure production cache headers or Content Security Policy headers. These headers must be configured by the production hosting platform, CDN, reverse proxy, or web server.

---

## CI/CD Integration

Avenx-JS applications can be built and deployed automatically through CI/CD pipelines.

The basic production pipeline consists of the following steps:
1. Install dependencies with `npm ci`.
2. Build the Avenx application with `npx avenx build`.
3. Prepare a deployment artifact containing the root `index.html` and the generated `dist/` directory.
4. Deploy that artifact to the selected static hosting platform.

### GitHub Actions

GitHub Actions can automate the production build and deployment of an Avenx application.

The following workflow example demonstrates a deployment to GitHub Pages. Because Avenx-JS keeps `index.html` outside of the `dist/` directory, the workflow creates a temporary `_site` directory to prepare the final artifact.

```yaml
name: Deploy Avenx App

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build Avenx application
        run: npx avenx build

      - name: Configure GitHub Pages
        uses: actions/configure-pages@v5

      - name: Prepare Pages artifact
        run: |
          mkdir -p _site
          cp index.html _site/
          cp -r dist _site/

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: _site

      - name: Deploy to GitHub Pages
        uses: actions/deploy-pages@v4
```

The resulting artifact structure uploaded to GitHub Pages will be:

```text
index.html
dist/
├── bundle.js
├── bundle.css
└── bundle.css.map
```

Note that the `bundle.css.map` file is optional and is not required for deployment, as explained in the Caching & Security Headers section.

### CI Build Without Deployment

The same CI process can be used solely for validation and build verification without deploying to a hosting provider.

```bash
npm ci
npx avenx build
```

This allows continuous integration systems to verify that the application dependencies can be installed and that the project successfully compiles without errors.

### Deployment Artifact

When deploying to any environment, the deployment artifact must preserve the relationship between `index.html` and `dist/`.

Because `index.html` references the generated assets at `dist/bundle.js` and `dist/bundle.css`, the deployed artifact must maintain that exact directory structure. You should not move or modify `index.html` in relation to the `dist/` directory unless specifically required by a specialized hosting platform.

---

## Why Not `avenx serve`?

The `avenx serve` command is designed exclusively for local development and should not be used as the production deployment mechanism.

### Development Features

`avenx serve` provides development-oriented functionality such as live reload.

It provides an active Server-Sent Events (SSE) endpoint used by the development server's live-reload functionality:

```text
/__avenx_live_reload__
```

It also exposes a developer-oriented inspection dashboard that is part of the development server:

```text
/__avenx-inspect
```

### Production Deployment

Production deployments should use:

```bash
npx avenx build
```

The build generates the static application assets, which can then be served by a production static host, CDN, reverse proxy, or web server.

The `avenx serve` command does not provide production-oriented features such as gzip/Brotli compression or TLS.

### Development vs Production

| Use Case | Command | Purpose |
| :--- | :--- | :--- |
| Local development | `avenx serve` | Development server with live reload and inspection tools |
| Production build | `npx avenx build` | Generates static assets for production hosting |
