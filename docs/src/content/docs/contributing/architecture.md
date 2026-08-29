---
title: Contributor Architecture Guide
description: Technical architecture, compilation pipeline, runtime module map and test tiers for Avenx‑JS contributors.
sidebar:
  order: 1
---

This guide provides a structural breakdown of the Avenx‑JS codebase to help contributors understand how compilation, runtime reactivity, and testing are organized across the repository.

---

## 1. Repository Directory Map

| Directory | Purpose | When You Would Touch It |
| :--- | :--- | :--- |
| `lib/compiler/` | Template parsing, AST transformation, style scoping, and bundle packaging. | Adding template syntax, changing bundling, or optimizing CSS hashing. |
| `lib/compiler/atlas/` | The retained semantic model: nodes, edges, expression resolution, source locations, the fragment cache and the two Atlas diagnostics. | Teaching Atlas about a new template construct, or changing what a query reports. |
| `lib/core/` | Zero‑dependency client runtime (`reactive/`, `renderer/`, `runtime/`, `events/`, `security/`, `validation/`, `tooling/`, `utils/`). | Modifying reactivity proxies, DOM patcher, component lifecycle, or error codes. |
| `bin/` | CLI command entry points and dispatch logic (`avenx generate`, `build`, `doctor`, etc.). | Adding or modifying CLI flags, subcommands, or scaffolding behavior. |
| `plugins/` | Build tool integration plugins (e.g., Vite plugin). | Fixing development server hooks or HMR behaviors in third‑party bundlers. |
| `templates/` | Default code templates used by `avenx generate` for components, pages, guards, and bridges. | Updating boilerplate generator code or testing templates. |
| `test/` | Automated test suites across all 4 tiers (unit, integration, system, e2e). | Writing regression tests for bug fixes or test coverage for new features. |
| `benches/` | Micro‑benchmarks for compilation throughput and runtime rendering speed. | Profiling performance bottlenecks in parser or patch algorithms. |
| `docs/` | Documentation website built with Starlight/Astro. | Adding user guides, API reference, or troubleshooting entries. |

---

## 2. Compile Pipeline Walkthrough

When `avenx build` executes, `lib/compiler/compiler.js` orchestrates the source‑to‑bundle process:

1. **Source Discovery** – Reads component files and companion stylesheets (`.component.js`, `.component.css`).
2. **ComponentParser** – Extracts `<state>`, `<computed>`, `<action>`, `<resource>`, `<contract>` and template markup into an intermediate representation (`lib/compiler/ComponentParser.js`).
3. **StyleProcessor** – Parses companion CSS files, generates deterministic scope IDs, and hashes class names for CSS isolation (`lib/compiler/StyleProcessor.js`).
4. **ContractValidator** – Performs static analysis against declared state variables, action definitions, and template expressions, using `AvenxErrorCodes` for diagnostics (`lib/compiler/ContractValidator.js`).
5. **Atlas** – Retains what the parser just produced as a semantic model (`lib/compiler/atlas/`). Nothing is re‑parsed: `addComponentUnit` receives the same objects step 2 produced. The model is emitted as `dist/bundle.atlas.json` and never referenced by the bundle.
6. **AvenxCompiler / Bundler** – Resolves component dependencies, tree‑shakes unreferenced elements, and packages compiled classes together with the minimal client runtime into a single IIFE bundle inside `dist/bundle.js`.

`AvenxCompiler.analyze()` runs steps 1–5 without emitting anything. `avenx atlas`, `avenx impact`, `avenx why`, `avenx inspect`, `avenx stats` and `avenx check` all use it, which is what keeps them from disagreeing with a build.

---

## 3. Runtime Data Flow (State Mutation → DOM Patch)

State updates follow a predictable microtask‑batched lifecycle:

1. **State Mutation** – A property is set (e.g., `state.count++`).
2. **Proxy Trap** – `ProxyHandlerFactory` / `StateFactory` (in `lib/core/reactive/proxy-handler.js`) intercepts the mutation.
3. **Schedule Update** – `AvenxComponent.scheduleUpdate()` (in `lib/core/runtime/component.js`) flags the component as dirty.
4. **Microtask Batching** – `scheduler.js` (in `lib/core/reactive/scheduler.js`) deduplicates updates and batches re‑renders into a single microtask.
5. **Re‑evaluate** – `TemplateRenderer` (in `lib/core/renderer/renderer.js`) uses `DynamicEvaluator` / `AvenxSandbox` (in `lib/core/security/`) to re‑evaluate bindings.
6. **DOM Patch** – `DomPatcher` (in `lib/core/renderer/patcher.js`) computes the minimal diff and applies atomic updates, with `ListManager`, `DeferManager`, and `DeadlockManager` handling special cases.

---

## 4. "Where Do I Add X?" Decision Table

| I Want To Add... | Primary Target Files / Directories |
| :--- | :--- |
| **New template directive / tag** | `lib/compiler/ComponentParser.js`, `lib/compiler/templateEvents.js` (so Atlas sees it too) and `lib/core/renderer/` |
| **New component instance method / API** | `lib/core/runtime/component.js` and `lib/core/index.d.ts` |
| **New CLI command or option flag** | `bin/commands/<command>.js`, `bin/cli.js`, and `bin/commands/help.js` |
| **New diagnostic error / warning code** | `lib/core/runtime/AvenxError.js` (code + message template), `lib/core/diagnostics/catalogue.js` (so `avenx explain` answers), plus `docs/src/content/docs/troubleshooting/errors.md` |
| **A relationship Atlas should record** | `lib/compiler/atlas/resolve.js` (how the expression is read) and `lib/compiler/atlas/build.js` (what edge it becomes). Regenerate the golden model with `UPDATE_ATLAS_GOLDEN=1` and read the diff. |
| **New template generator boilerplate** | `templates/` and `bin/commands/generate.js` |

---

## 5. Test Tiers & Local Development Workflow

### Test Suite Structure

Avenx‑JS uses a 4‑tier testing strategy:

| Tier | Directory | Environment | Run Command |
| :--- | :--- | :--- | :--- |
| **Unit** | `test/unit/` | Node.js + `happy-dom` (via the runner's `--import` hook) | `node test/run-tests.js unit` |
| **Integration** | `test/integration/` | Node.js + `happy-dom` | `node test/run-tests.js integration` |
| **System** | `test/system/` | Node.js + `happy-dom` | `node test/run-tests.js system` |
| **E2E** | `test/e2e/` | Playwright (real browsers) | `npm run test:e2e` |

To run a **single test file**, use:  
`node test/run-tests.js unit path/to/file.test.js` (or the corresponding tier).

### Standard Development Commands

- `npm test` – Run all unit, integration, and system tests.
- `npm run test:coverage` – Generate code coverage reports.
- `npm run bench` – Run compiler and runtime benchmark suites (`benches/`).
- `node scripts/size-check.js` – Verify bundle footprint constraints (also run in CI).
- `npm run docs` – Generate JSDoc output to `dev-docs/`.
- `npm run lint` / `npm run format` – Lint and format the codebase.

To try your local changes against a scratch project:
1. `npm run build` – Build the distribution.
2. `npm link` – Link the package globally.
3. In your test project: `npm link avenx-js` and test your changes.

---

## 6. House Rules for Contributors (CI‑Enforced)

1. **Zero Runtime Dependencies** – Code inside `lib/core/` must remain pure JavaScript without adding external npm dependencies.
2. **Stable Diagnostic Codes** – Errors must be registered through `AvenxErrorCodes` / `AvenxError` rather than throwing untracked raw `new Error`.
3. **Strict JSDoc** – Public APIs must be fully annotated with JSDoc to satisfy `eslint-plugin-jsdoc`.
4. **Atlas Never Guesses** – A relationship the analyser cannot follow is recorded as an `unresolved` entry with its reason and location. It is never dropped silently and never assumed. Any diagnostic that makes an absence claim must first check that record.
