---
title: 'CLI Commands'
description: 'Explore the command-line interface of Avenx-JS to create, compile, run, and watch projects.'
---

The `avenx` command line interface streamlines your development workflow. It handles application scaffolding, code generation, destruction, building, watching, serving, project architecture inspection, template validation, environment health diagnostics, environment inspection/configuration, and offline diagnostic code explanation.

## Command Syntax

```bash
npx avenx <command> [type] [name] [options]
```

---

## Global Flags & Options

The following flags can be passed globally to `avenx` commands:

| Option | Alias | Description | Supported Commands |
| :--- | :--- | :--- | :--- |
| `--dry-run` | `-d` | Previews file creation, modification, or deletion actions without modifying disk. | `generate`, `destroy` |
| `--force` | `-f` | Forces command execution by bypassing uncommitted Git working tree status checks. | `init`, `generate`, `destroy`, `build` |
| `--dev` | | Builds in development mode: readable runtime, inline CSS source maps. | `build`, `serve`, `watch` |
| `--prod` | | Builds in production mode: minified runtime. The default for `build`. | `build`, `serve`, `watch` |
| `--no-color` | | Disables colored terminal output. | Global |
| `--version` | `-v` | Displays the installed version of the Avenx-JS CLI package. | Global |

## Terminal Formatting & CI Environment

The Avenx-JS CLI features a zero-dependency ANSI styling system (implemented in `bin/colors.js`) that provides color-coded terminal diagnostics, clear section headings, and status badges across all commands (`build`, `serve`, `doctor`, `inspect`, `check`, etc.).

### Automatic TTY & Color Support Detection

By default, the CLI automatically detects whether the active output stream can render ANSI escape sequences using standard terminal detection heuristics:

- **Interactive TTY**: If `process.stdout.isTTY` is `true` and the terminal reports color capability (`stdout.hasColors()`), ANSI colors are enabled automatically.
- **Pipes & Non-TTY Streams**: When output is redirected to a file (e.g. `avenx build > build.log`) or piped to another process (e.g. `avenx build | grep error`), ANSI color codes are automatically stripped to keep the output clean and parseable.
- **Dumb Terminals**: When `TERM=dumb` is detected, ANSI styling is disabled.
- **Machine-Readable Modes**: Commands producing structured output (e.g. `avenx check --json` or `avenx inspect --json`) always emit uncolored, valid JSON regardless of environment settings.

---

### Environment Variables & CI/CD Integration

You can customize or override automatic terminal color detection in automated CI/CD pipelines (such as GitHub Actions, GitLab CI, CircleCI, Jenkins), scripts, and log collectors:

| Variable / Flag | Behavior & Purpose | Examples |
| :--- | :--- | :--- |
| `NO_COLOR` | Disables all ANSI styling according to the [no-color.org](https://no-color.org) standard when set to any non-empty string. | `NO_COLOR=1 avenx build` |
| `FORCE_COLOR` | Forces ANSI color codes on non-TTY streams and CI runners (unless explicitly set to `'0'` or `'false'`). Useful for preserving color output in GitHub Actions log viewers. | `FORCE_COLOR=1 avenx build`<br />`FORCE_COLOR=0 avenx build` (disables) |
| `TERM=dumb` | Disables ANSI escape codes for basic or restricted terminal emulators. | `TERM=dumb avenx serve` |
| `--no-color`<br />`--no-colors` | CLI argument to disable colored output for a single invocation. | `npx avenx build --no-color` |

#### GitHub Actions Workflow Example

Preserve colored build diagnostics in GitHub Actions summary logs:

```yaml
name: Build and Check
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      # Force colored CLI output in CI console logs
      - name: Build Project
        run: npx avenx build
        env:
          FORCE_COLOR: '1'
      # Machine-readable checks without color
      - name: Validate Templates
        run: npx avenx check --json > report.json
```

---

### Programmatic Color API (`bin/colors.js`)

Developers creating custom CLI extensions, pre-build scripts, or build plugins on top of Avenx-JS can import and use the programmatic styling utilities:

```javascript
import {
  detectColorSupport,
  isColorEnabled,
  setColorEnabled,
  bold,
  dim,
  red,
  green,
  yellow,
  blue,
  cyan,
  gray,
  createSeverityFormatter
} from './bin/colors.js';
```

#### API Methods

| Method | Return Type | Description |
| :--- | :--- | :--- |
| `detectColorSupport()` | `boolean` | Re-evaluates CLI flags (`--no-color`), environment variables (`NO_COLOR`, `FORCE_COLOR`, `TERM`), and `stdout.isTTY` to determine color capability. |
| `isColorEnabled()` | `boolean` | Returns whether ANSI color styling is currently active in the process. |
| `setColorEnabled(value?)` | `boolean` | Manually enables (`true`) or disables (`false`) ANSI escape code generation. Calling without arguments re-runs automatic detection. |
| `createSeverityFormatter()` | `function` | Creates a logging formatter for `AvenxLogger` that tints warnings in yellow and errors in red while preserving plain text and objects. |

#### ANSI Styling Helpers

When color styling is active, styling helpers wrap strings with their corresponding ANSI open/close escape codes. When disabled, they return the input string unchanged:

```javascript
import { bold, green, red, yellow, cyan } from './bin/colors.js';

console.log(bold(cyan('=== Avenx Custom Build Step ===')));
console.log(green('✔ Assets compiled successfully.'));
console.log(yellow('⚠ Bundle budget threshold reached.'));
console.log(red('✖ Critical compilation failure.'));
```

#### Custom Script Example

```javascript
import { setColorEnabled, isColorEnabled, green, red } from './bin/colors.js';

// Explicitly configure color emission for custom tool
if (process.argv.includes('--plain')) {
  setColorEnabled(false);
}

function logStatus(taskName, success) {
  const statusBadge = success ? green('PASS') : red('FAIL');
  console.log(`[${statusBadge}] ${taskName}`);
}

logStatus('Linting templates', true);
logStatus('Checking bundle size', false);
```

---

## Available Commands

### 1. `avenx init`

Scaffolds a new Avenx-JS application workspace structure in the current working directory.

#### Interactive Project Wizard (`runWizard`)

When invoked in an interactive terminal, `avenx init` launches an interactive setup wizard prompting for project preferences:

1. **Style Preprocessor Choice:**
   - `1. None (Vanilla CSS)` (Default)
   - `2. Sass (SCSS)`
   - `3. Less`
   - `4. PostCSS`
   *(Writes chosen preprocessor to `avenx.config.json` under `"style": { "preprocessor": "..." }`).*

2. **Layout Template Choice:**
   - `1. Blank (Minimal setup)` (Default)
   - `2. Routing (Basic navigation with Navbar, Home, and About pages)`

#### Generated Structure

- `src/components/`, `src/pages/`, `src/global/`, `src/guards/`, `dist/`
- `index.html`, `src/main.app.js`, `avenx.config.json`, `.vscode/settings.json`, `.vscode/jsconfig.json`

#### Options & Flags

| Flag / Option | Alias | Description |
| :--- | :--- | :--- |
| `-y`, `--yes` | | Bypasses interactive wizard prompts in TTY terminals and uses default choices (`none` preprocessor, `blank` layout). Recommended for CI/CD and automated scaffolding scripts. |
| `-i`, `--interactive` | | Forces interactive wizard prompts to run, even in non-TTY or piped terminal environments. |
| `-f`, `--force` | | Overwrites existing files or bypasses uncommitted Git working tree status checks. |

#### Environment Variables

- **`AVENX_FORCE_INTERACTIVE=true`**: When set in the environment, forces the interactive project wizard prompts to execute regardless of TTY status.

#### Usage Examples

```bash
# Interactive project scaffolding wizard
npx avenx init

# Non-interactive / CI scaffolding with default options
npx avenx init -y

# Force interactive wizard in piped or scripted environments
npx avenx init --interactive --force
```

---

### 2. `avenx generate` (alias: `g`)

Generates boilerplate code for components, pages, global state bridges, and navigation guards. Automatically registers new components and pages in `src/main.app.js`.

#### Subtypes

- **Component (`component`, `c`)**: Creates `src/components/<name>/<name>.component.js` and `.css`, and registers it in `main.app.js`.
- **Page (`page`, `p`)**: Creates `src/pages/<name>.page.js` and `.css` for client-side routing.
- **Bridge (`bridge`)**: Creates a shared reactive state module at `src/global/<name>.bridge.js` built with the `bridge()` factory.
- **Guard (`guard`)**: Creates a navigation guard class at `src/guards/<name>.guard.js` extending `AvenxGuard`.

#### Options

- `--dry-run` / `-d`: Previews generated files without writing to disk.
- `--force` / `-f`: Bypasses Git working tree status checks.

#### Usage Examples

```bash
# Generate component
npx avenx g counter

# Generate page with alias
npx avenx g p dashboard

# Preview page generation without writing to disk
npx avenx g p user-profile --dry-run

# Generate shared reactive bridge
npx avenx g bridge shopping-cart

# Generate route guard
npx avenx g guard auth
```

---

### 3. `avenx destroy` (alias: `d`)

Removes scaffolded component, page, bridge, or guard files and automatically cleans up their import statements and registrations inside `src/main.app.js`.

#### Subtypes

- **Component (`component`, `c`)**: Deletes `src/components/<name>/` and cleans up `main.app.js`.
- **Page (`page`, `p`)**: Deletes `src/pages/<name>.page.js` and `.css`.
- **Bridge (`bridge`)**: Deletes `src/global/<name>.bridge.js`.
- **Guard (`guard`)**: Deletes `src/guards/<name>.guard.js`.

#### Options

- `--dry-run` / `-d`: Previews files that would be removed without deleting anything.
- `--force` / `-f`: Bypasses Git working tree status checks.

#### Usage Examples

```bash
# Delete component and clean up registrations
npx avenx d counter

# Preview page deletion
npx avenx d p dashboard --dry-run
```

---

### 4. `avenx build` (alias: `b`)

Compiles all component templates, scoped stylesheets, page components, and global bridges into single distribution bundle files in `distDir`.

**`avenx build` is a production build.** It bundles the minified runtime and links the CSS source map as a separate file. Pass `--dev` for a development build, which bundles the readable runtime and inlines the CSS source map:

```bash
npx avenx build
```

```bash
npx avenx build --dev
```

The active mode appears in the build header, and can also be set with `mode` in `avenx.config.json` or via `NODE_ENV=development`. See the [deployment guide](/guides/deployment#build-modes) for what the two modes differ in.

**Exit codes.** `avenx build` exits `0` only on a successful build. Any fatal compiler error, a warning escalated to `"error"`, or a failing lifecycle hook exits non-zero, so `avenx build && deploy` never deploys a failed build. See [Build Failures and Exit Codes](/guides/deployment#build-failures-and-exit-codes).

#### Features & Distribution Files

- Compiles `.component.js` files and extracts `<state>`, `<action>`, and `<computed>` tags.
- Bundles and scopes component CSS rules.
- Performs automatic component tree-shaking when `treeShakeComponents: true`.
- Evaluates build-time template validation rules.
- Minifies the bundled runtime in production mode.
- Generates JavaScript (`<outputName>.js`) and CSS (`<outputName>.css`) distribution bundles.

#### Custom Output Bundle Names (`outputName`)

By default, `avenx build` generates `dist/bundle.js` and `dist/bundle.css`. Configure `outputName` in `avenx.config.json` to override filenames:

```json
{
  "outputName": "app.bundle"
}
```

Running `avenx build` with the above configuration produces:

```text
dist/
├── app.bundle.js
├── app.bundle.css
└── app.bundle.css.map
```

Be sure to reference the customized bundle filenames in your `index.html` entry point:

```html
<link rel="stylesheet" href="dist/app.bundle.css" />
<script src="dist/app.bundle.js"></script>
```

#### Output Directory Resolution & Troubleshooting

The build pipeline automatically creates the distribution output directory (`dist/` by default or as configured in `avenx.config.json`) if it does not already exist. If directory creation fails due to insufficient filesystem permissions or an existing blocking file, the compiler logs `[AVX_C01] Could not create dist directory`. See [AVX_C01 Troubleshooting](/troubleshooting/errors/#avx_c01--compiler_dist_creation_failed) for troubleshooting guidelines.

#### Usage Examples

```bash
npx avenx build
```

---

### 5. `avenx watch` (alias: `w`)

Runs an initial build and continuously watches the `src/` directory for code changes, automatically re-building the project distribution files upon every file edit.

Unlike `avenx serve`, `watch` does not launch a local web server or inject live-reload client scripts.

```bash
npx avenx watch
```

Press `Ctrl + C` to terminate watch mode.

---

### 6. `avenx serve`

Launches a local live-reloading development server with automatic file watching and an embedded **Inspection Dashboard**.

#### Options & Flags

- `--port <number>`, `-p <number>` (or positional argument `avenx serve 8080`): Sets the development server TCP port (default: `3000`).
- `--host <string>`, `-h <string>`: Sets the host bind address (default: `localhost`).
- `--no-live-reload` / `--live-reload=false`: Disables file watching, live reload SSE client script injection, and automatic browser refreshes.
- `--trace`: Records a causal trace of the running application. Off by default. See [`avenx trace`](#14-avenx-trace) and the [Avenx Trace guide](/core-concepts/trace/).

#### Visual Inspection Dashboard (`/__avenx-inspect`)

Access `http://localhost:3000/__avenx-inspect` while the dev server is running to inspect active routes, registered components, global bridges, and compiler options in real-time.

```bash
# Start server on default port 3000
npx avenx serve

# Custom port and host
npx avenx serve 8080 --host 0.0.0.0

# Disable live reload script injection
npx avenx serve --no-live-reload
```

---

### 7. `avenx check` (alias: `lint`)

Parses and validates all project templates without writing build outputs to disk. Ideal for Continuous Integration (CI/CD) pipelines.

#### Exit Codes

- `0`: Validation successful (no template warnings or errors detected).
- `1`: Validation failed (template syntax errors or elevated warnings detected).

```bash
npx avenx check
```

For editor-integrated real-time linting and ESLint rule enforcement (PascalCase tag naming), see the [ESLint Template Validation Guide](/guides/eslint).


---

### 8. `avenx inspect` (alias: `i`)

Scans the project `src/` directory and outputs a formatted terminal tree view displaying pages (with mapped route paths), components (annotated with unused warnings), and global state bridges offline without launching a development server.

#### Command Purpose

The `avenx inspect` command analyzes application architecture, route mappings, and component utilization offline. It allows developers to quickly audit project structure, inspect route registrations, and detect orphaned components without launching a development server or browser environment.

#### Terminal Output Hierarchy

`avenx inspect` categorizes the project structure into three tree branches:

- **📄 Pages**: Lists page components (`src/pages/*.page.js`) alongside their mapped route paths (e.g. `/home`, `/user/:id`).
- **🧩 Components**: Lists UI components (`src/components/*`) annotated with `(⚠️ Unused)` warnings when unreferenced.
- **🌉 Bridges**: Lists global reactive state bridges (`src/bridges/*` or `src/global/*.bridge.js`).

#### Unused Component Detection

`avenx inspect` scans application templates, scripts, and `app.mount()` calls. If a component defined in `src/components/` is not referenced in any template tags or mount declarations, `avenx inspect` automatically flags it with `(⚠️ Unused)` in the hierarchy view.

#### Usage Example & Output Sample

```bash
# Print project route and component hierarchy
npx avenx inspect

# Or using the shorthand alias
npx avenx i
```

**Sample Output:**

```text
📦 Avenx Project Hierarchy (src/)
├── 📄 Pages (2)
│   ├── HomePage (/home) -> src/pages/home.page.js
│   └── UserPage (/user/:id) -> src/pages/user.page.js
├── 🧩 Components (2)
│   ├── Header -> src/components/header/header.component.js
│   └── UnusedBtn -> src/components/unused-btn/unused-btn.component.js (⚠️ Unused)
└── 🌉 Bridges (1)
    └── AuthBridge -> src/bridges/auth.bridge.js
```

---

### 9. `avenx doctor`

Runs environment, project configuration, directory structure, and Git working tree diagnostics to ensure your workspace meets Avenx-JS project health requirements.

#### Command Purpose & When to Run

The `avenx doctor` command performs comprehensive diagnostic health checks on your local development environment and project setup. Run this command when:
- Setting up or troubleshooting a newly scaffolded project workspace.
- Verifying environment compatibility and configuration in Continuous Integration (CI/CD) pipelines.
- Debugging unexpected build, styling, or routing issues.

#### Diagnostics Performed

`avenx doctor` checks the following areas:

1. **Node.js Environment**:
   - Verifies that Node.js version is `>= 18.0.0`.
2. **Project Configuration**:
   - Checks presence and JSON validity of `package.json`.
   - Validates `avenx.config.json` schema and emits warnings for unknown or unsupported configuration keys across top-level fields, `server`, `style`, `debug`, and `logging` blocks.
3. **Project Structure**:
   - Validates existence of the source directory (`src/` or custom `srcDir`) and build output directory (`dist/` or custom `distDir`).
   - Checks for recommended subdirectories: `src/components/`, `src/pages/`, and `src/global/`.
   - Verifies presence of `.vscode/jsconfig.json` (editor path aliases) and root `index.html`.
4. **Git Repository Status**:
   - Checks Git status and warns if the working tree has uncommitted local changes.

#### Exit Codes

- `0`: Diagnostic checks passed successfully (or only non-critical warnings were reported).
- `1`: Diagnostic checks failed due to critical errors (e.g., Node.js version lower than required, missing or invalid `package.json`, or malformed configuration).

#### Usage Examples

```bash
# Run environment and project health diagnostics
npx avenx doctor
```

---

### 10. `avenx clean`

Deletes the target build distribution directory (typically `dist/` or configured `distDir`) to ensure a fresh build state.

```bash
npx avenx clean
```

---

### 11. `avenx help`

Prints the CLI usage manual and command reference to the console.

```bash
npx avenx help
```
---


### 12. `avenx stats` (alias: `s`)

Analyzes the project's source files and reports component, page, bridge, and guard footprint metrics, including source file sizes, template sizes, scoped CSS payloads, and reactive state properties.

#### Command Syntax

```bash
npx avenx stats [options]
npx avenx s [options]
```

#### Options

| Flag / Option | Alias | Description |
| --- | --- | --- |
| `--json` | `-j` | Outputs structured JSON containing `summary` and `items` data for CI/CD, automated reporting, and analysis. |

#### What It Analyzes

The command scans JavaScript and TypeScript files under the configured `srcDir` and classifies them as:

- **Component**: Component source files.
- **Page**: Page source files.
- **Bridge**: Shared state bridge files.
- **Guard**: Navigation guard files.
- **other**: Source files that do not match the recognized component, page, bridge, or guard patterns.

For components and pages, `avenx stats` also analyzes template and scoped CSS payloads.

#### Terminal Output

Without `--json`, the command displays a table containing the following columns:

| Column | Description |
| --- | --- |
| **Name** | PascalCase component or class name. |
| **Type** | Source type: `Component`, `Page`, `Bridge`, `Guard`, or `other`. |
| **File Size** | Size of the source file on disk. |
| **Raw Tpl** | Size of the uncompiled template markup. |
| **Comp Tpl** | Size of the compiled/minified template. |
| **CSS Size** | Size of the scoped component CSS. |
| **State** | Number of reactive state properties declared in `<state />`. |

Template and scoped CSS metrics apply to components and pages where those resources are available.

#### Summary Totals

The terminal output includes summary metrics after the file table:

- **Total Files**: Total number of source files analyzed.
- **Components**: Number of component source files.
- **Pages**: Number of page source files.
- **Bridges**: Number of bridge source files.
- **Total Source Size**: Combined size of all analyzed source files.
- **Raw Template Payload**: Combined size of all raw template markup.
- **Compiled Template**: Combined size of compiled templates and the calculated template size reduction.
- **Scoped CSS Payload**: Combined size of scoped component CSS.
- **State Properties**: Total number of reactive state properties detected.

The template reduction percentage is calculated as:

```text
((Raw Template Payload - Compiled Template Payload) / Raw Template Payload) × 100
```

---

### 13. `avenx env`

Inspects the project's environment variables and reports active configuration, separating public variables (which are inlined into the build) from system variables (which are kept private and masked).

#### Command Syntax

```bash
npx avenx env
```

#### Options

The command accepts **no flags or aliases** and does not support structured/machine-readable (`--json`) output.

#### How It Resolves Configuration

The command scans the project root directory and reads configuration files through the following mechanism:
1. It loads local environment variables from the `.env` file using the `loadEnv()` helper against the resolved project root (does not overwrite existing environment variables in `process.env`).
2. It separately parses the project's `.env` file using `parseEnv()` to identify local keys.
3. It compares keys in `.env` with keys in `process.env` to classify each variable as public or private/system.

#### Output Groups

The command organizes variables and file statuses into three distinct groups:

##### 1. Source Files
Reports the path and parsing status of the project's `.env` file:
* **Successful read**: Displays the absolute path of the `.env` file prefixed with a green checkmark (`✔`).
* **Missing file**: Prints a warning prefixed with a yellow warning symbol (`⚠ No .env file found (only process env AVX_PUBLIC_* shown)`).
* **Unparseable/Invalid file**: Displays an error prefixed with a yellow cross (`✖ Failed to read <absolute-path-to-.env>: <error-message>`) and sets a non-zero exit code (`1`).

##### 2. Public Variables
Lists variables prefixed with `AVX_PUBLIC_`.
* **Source**: Collected from all keys in `process.env` (system environment) and keys in the project's `.env` file. Sorted alphabetically.
* **Display**: Values are displayed in full and unmasked.
* **Notes**:
  * `inlined` (gray): Indicates the variable contains a non-empty string and will be stringified and inlined into build outputs.
  * `empty` (yellow): Indicates the variable is empty (`""`).

##### 3. System Variables
Lists private or non-public variables.
* **Source**: Collected **only** from the project's local `.env` file (keys not starting with `AVX_PUBLIC_`). Shell environment variables present in `process.env` but absent from `.env` are excluded from this list. Sorted alphabetically.
* **Display**: Values are masked for security.

#### Security Boundary & Best Practices

Avenx enforces a strict build-time security boundary for environment variables:
* Only variables prefixed with `AVX_PUBLIC_` are exposed to client-side compiled outputs. The compiler replaces occurrences of `process.env.AVX_PUBLIC_<KEY>` in code with their stringified value.
* Any other variables (e.g. database credentials, server API keys) placed in the `.env` file are kept private. They are **not** replaced in code or bundled into compiled assets.
* Developers should run `avenx env` to verify that no sensitive credentials have been accidentally prefixed with `AVX_PUBLIC_`.

#### Secret Masking Rules

For private system variables, Avenx masks the values using a deterministic `maskSecret()` rule:
* **Short Values (4 characters or fewer, including empty values)**: The value is completely replaced with asterisks (`*`), with a minimum of 4 asterisks (e.g., an empty value or `key` is displayed as `****`).
* **Long Values (more than 4 characters)**: The first 4 characters are preserved in plaintext, and the remaining characters are replaced by asterisks up to a maximum of 8. The total output length will be `4 + Math.min(8, value.length - 4)`, resulting in a maximum total output length of 12 characters.

| Original Value | Masked Output | Description |
| :--- | :--- | :--- |
| `""` (empty) | `****` | Length 0, replaced by 4 asterisks. |
| `key` | `****` | Length 3, replaced by 4 asterisks. |
| `pass` | `****` | Length 4, replaced by 4 asterisks. |
| `hello` | `hell*` | Length 5. First 4 characters preserved (`hell`), remaining 1 masked (`*`). |
| `secret` | `secr**` | Length 6. First 4 characters preserved (`secr`), remaining 2 masked (`**`). |
| `my_very_long_password` | `my_v********` | Length 21. First 4 characters preserved (`my_v`), remaining 17 masked (capped at 8 asterisks). |

#### Exit Codes

* **`0`**: Normal execution (even if `.env` is missing).
* **`1`**: A `.env` file exists but failed to parse (e.g. contains syntax errors). If a parsing error occurs, the command sets `process.exitCode = 1` and continues executing to display any available environment details. This behavior is useful in CI pipelines to automatically fail builds if a configuration file is malformed.

#### Sample Output

```text
Avenx Environment
Project: /path/to/avenx-js

Source Files
  ✔ /path/to/avenx-js/.env

Public Variables (AVX_PUBLIC_* — inlined at build time)
  Key                          Value                    Notes
  AVX_PUBLIC_API_URL           https://api.example.com  inlined
  AVX_PUBLIC_APP_NAME                                   empty
  AVX_PUBLIC_EXTERNAL_VAR      external_val             inlined

System Variables (from .env — values masked)
  Key                          Value
  API_KEY                      ****
  DB_PASSWORD                  secr********
```

---

### 14. `avenx trace`

Records why your application did what it did, and turns a recording into a regression test.

Traces are recorded by `avenx serve --trace` and stored in `.avenx/traces/`, one JSON file per recording. See the [Avenx Trace guide](/core-concepts/trace/) for the full picture; this is the command surface.

#### `avenx trace list`

Lists stored traces, newest first.

```bash
npx avenx trace list
```

```text
TRACE ID        AGE     EVENTS   COMPONENTS   STATUS
trace-4f2a      2m      14       3            deterministic
trace-a91c      8m      42       7            best-effort
```

`--json` prints the listing as machine-readable JSON.

**Status** is either `deterministic` (the recording can become a regression test you rely on) or `best-effort` (something escaped the recording boundary; run `avenx trace view` for the reasons).

#### `avenx trace view <id|latest>`

Prints a trace as a causal tree. Every line sits under the thing that caused it.

```bash
npx avenx trace view trace-4f2a
npx avenx trace view latest
```

```text
▸ click <button.qty-inc> CartItem
  └─ action CartItem.incQty()  src/components/cart-item/cart-item.component.js:3
     └─ bridge cart · addQty("a", 1)
        ├─ write cart.items.0.qty 2 → 3
        │  ├─ woke CartItem#render
        │  │  └─ patched <span.qty> text "2" → "3"
        │  └─ woke CartSummary#render
        │     ├─ getter cart.total 36 → 48
        │     └─ patched <strong.total> text "$36.00" → "$48.00"
        └─ emit cart:changed → 0 listeners

Determinism: deterministic — this trace can be exported as a regression test.
```

Options:

- `--json`: Print the raw trace instead of the tree.
- `--roots=<n>`: Show only the first `n` causal roots, for a long session.

Source locations come from `dist/bundle.trace.json`, which the compiler writes beside the bundle. Build the project to get them.

#### `avenx trace export <id|latest>`

Writes an executable regression test for a trace, plus a copy of the trace beside it so a committed test does not depend on `.avenx/traces/`.

```bash
npx avenx trace export latest --out test/cart-qty.test.js
```

Options:

- `--out <file>`, `-o <file>`: Where to write the test. Defaults to `test/<component>-<event>.test.js`.
- `--force`, `-f`: Overwrite an existing file. Without it, an existing file is an error.
- `--dry-run`, `-d`: Print the generated test instead of writing it.

The command warns when a trace is best-effort, when values were redacted, and when a contract violation was observed during the recording.

#### `avenx trace prune`

Removes stored traces.

```bash
npx avenx trace prune              # keep the 20 newest
npx avenx trace prune --keep=5     # keep the 5 newest
npx avenx trace prune trace-4f2a   # remove one
npx avenx trace prune --all        # remove everything
```

`--dry-run` / `-d` reports what would be removed without removing it.

#### Exit Codes

* **`0`**: The command completed.
* **`1`**: The named trace does not exist, a trace file could not be read, an output file already exists without `--force`, or an option value was invalid.

---

### 15. `avenx explain`

Explains a compiler error, runtime exception, or warning code offline, printing what triggered the diagnostic, its common causes, how to fix it, and a link to the full troubleshooting guide. It reads from the built-in diagnostic catalogue, so it works with no project and no network connection.

Codes surfaced by `avenx build`, `avenx check`, and the runtime (e.g. `AVX_C01`, `AVX_R18`, `AVX_W29`) can be passed straight to `avenx explain` to understand and resolve them.

#### Command Syntax

```bash
npx avenx explain <CODE> [options]
```

#### Code Normalization

The code argument is normalized before lookup, so you can type it however it appeared in your terminal:

- **Full code**: `AVX_W29`
- **Shorthand prefix**: `W29`
- **Lowercase**: `w29`

All three resolve to the same diagnostic. Normalization uppercases the input and prepends `AVX_` when it is missing (`w29` → `AVX_W29`, `AVXW29` → `AVX_W29`).

#### Options & Flags

| Flag / Option | Description |
| :--- | :--- |
| `--json` | Outputs the full diagnostic metadata as structured JSON. Ideal for IDE plugins, editor tooling, and CI/CD pipelines that consume diagnostics programmatically. |

#### Terminal Color Output

Human-readable output uses ANSI color: the severity badge is red for `[ERROR]` and yellow for `[WARNING]`, the category and documentation URL are cyan, and section labels are bold. Coloring is applied only when writing to an interactive terminal (`process.stdout.isTTY`) and is disabled when `NO_COLOR` is set or when output is piped or redirected. `--json` output is always uncolored and valid JSON regardless of environment.

#### Command Output Breakdown

Without `--json`, the command prints the following sections:

- **Header**: The code, its name, and a severity badge (`[ERROR]` in red or `[WARNING]` in yellow).
- **Category**: The subsystem the diagnostic belongs to (`compiler`, `runtime`, etc.).
- **Summary**: A concise explanation of what triggered the diagnostic.
- **Common Causes**: A bulleted list of the frequent oversights that produce the code.
- **How to Fix**: Actionable remediation steps.
- **Documentation**: A direct URL (`docsUrl`) to the full troubleshooting entry.

#### Fuzzy Suggestions & Error Handling

When an unknown code is provided, the command lists close matches from the catalogue prefixed with `Did you mean:` and exits non-zero. Partial inputs match every code sharing that prefix (e.g. `C0` suggests `AVX_C01` through `AVX_C06`).

#### Exit Codes

- `0`: A valid diagnostic was found and printed.
- `1`: No code was provided, or the code is unknown (suggestions, if any, are still shown).

#### Usage Examples

```bash
# Explain a warning by full code
npx avenx explain AVX_W29

# Shorthand and lowercase both resolve to the same code
npx avenx explain W29
npx avenx explain w29

# Machine-readable metadata for tooling and CI
npx avenx explain AVX_R18 --json
```

**Sample Output (warning):**

```text
AVX_W29: MissingKeyInLoop [WARNING]
Category: compiler

Summary:
  A repeated list item in <@for> does not specify a unique @key attribute.

Common Causes:
  • <@for ...> rendering dynamic lists without unique tracking keys.

How to Fix:
  • Add a unique @key attribute to the root repeated item (e.g., @key="item.id").

Documentation:
  https://avenx.dev/docs/troubleshooting#avx-w29
```

**Sample Output (`--json`):**

```json
{
  "code": "AVX_R18",
  "name": "ReactivityLoopDetected",
  "severity": "error",
  "category": "runtime",
  "summary": "A circular reactive update loop exceeded the maximum update depth limit.",
  "causes": [
    "An action or effect synchronously mutates state that triggers itself continuously."
  ],
  "remedies": [
    "Break recursive mutations or add termination conditions to reactive watchers."
  ],
  "docsUrl": "https://avenx.dev/docs/troubleshooting#avx-r18"
}
```

**Unknown Code with Suggestions:**

```text
❌ Unknown diagnostic code: 'C0'

Did you mean: AVX_C01, AVX_C02, AVX_C03, AVX_C04, AVX_C05, AVX_C06?
```

The same unknown-code case in `--json` form returns an `error` field and a `suggestions` array:

```json
{
  "error": "Unknown diagnostic code: 'C0'",
  "suggestions": ["AVX_C01", "AVX_C02", "AVX_C03", "AVX_C04", "AVX_C05", "AVX_C06"]
}
```
