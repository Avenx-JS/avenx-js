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
| `lib/compiler/` | Template parsing, AST transformation, style scoping, and turning compiled units into ES modules (`modules.js`). | Adding template syntax, or changing what a generated module looks like. |
| `lib/bundler/` | Avenx's own bundler: module reading (`parseModule.js`), specifier resolution (`resolve.js`), the dependency graph (`graph.js`), tree shaking (`treeshake.js`), emission and source maps (`emit.js`), minification (`minify.js`). | Changing how modules are resolved, linked, shaken or emitted. Never for anything Avenx-specific — the bundler knows nothing about components. |
| `lib/compiler/atlas/` | The retained semantic model: nodes, edges, expression resolution, source locations, the fragment cache and the two Atlas diagnostics. | Teaching Atlas about a new template construct, or changing what a query reports. |
| `lib/compiler/render/` | Template → render program: the op vocabulary, and the compiler that emits one or reports why it could not. | Teaching the compiled renderer a construct that currently falls back. |
| `lib/core/renderer/program/` | The runtime that executes a render program: skeleton preparation, per-op DOM writes, per-binding effects. | Adding an op kind, or changing what one does to the DOM. |
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
6. **Render program** – Compiles the finished template into a static skeleton plus a list of binding ops (`lib/compiler/render/compileTemplate.js`). Runs last, on exactly the template the runtime will receive, because every rewrite above changes the markup the bindings have to address. A template containing a construct the program runtime does not implement produces no program and is reported as `AVX_W47`.
7. **Module generation** – Frames each compiled class as an ES module: an import of the runtime, the developer's own imports verbatim, and a default export (`lib/compiler/modules.js`). `ComponentParser.parse()` still returns a bare `class X extends AvenxComponent`; how a unit is *linked* is not a reason to change how it is *compiled*, and that output shape is what `avenx-core/testing` and the Vite plugin consume.
8. **Bundling** – `lib/bundler/` resolves every specifier, builds the dependency graph, drops what nothing reaches, and emits `dist/bundle.js` with a source map. The Avenx runtime is an ordinary dependency in that graph, resolved through `avenx-core/runtime`.

### The compiler/bundler boundary

Keep it clean. The compiler owns Avenx semantics — templates, declarations,
expressions, scoped CSS, Atlas, the shape of a generated class. The bundler owns
modules — resolution, the graph, dead-code elimination, format interop, emission.
The moment the bundler needs to know what a `.page.js` is, the two halves have
grown back together.

The compiler communicates through *virtual modules*: a `Map` from a source
file's absolute path to the module source it generated. The bundler resolves
against that table first, so `import './counter.component.js'` reaches the
compiled class rather than the template file, which is not JavaScript.

### What the bundler guarantees

```text
avenx build reports success
  => every import resolved, and every name it imported is exported
```

There is no path through `lib/bundler/graph.js` that drops an edge. This
replaced `rewriteRuntimeImports`, which deleted every import that was not the
runtime entry — the reason a component could import an npm package, build green,
and throw `ReferenceError` in the browser.

Three things the emitter has to get right, each documented at length in
`lib/bundler/emit.js`: **live bindings** (`export let activeWatcher` is
reassigned in `reactive/watcher.js` and read across a module boundary by
`AvenxComponent`, so it is hoisted to bundle scope rather than copied),
**cycles** (only function declarations may cross one, exactly as in the
language), and **line fidelity** (rewritten declarations are padded back to the
line count they replaced, which is what makes the source map exact and keeps it
valid across minification).

`AvenxCompiler.analyze()` runs steps 1–5 without emitting anything. `avenx atlas`, `avenx impact`, `avenx why`, `avenx inspect`, `avenx stats` and `avenx check` all use it, which is what keeps them from disagreeing with a build.

---

## 3. Runtime Data Flow (State Mutation → DOM)

There are two paths, chosen per component at build time. See
[How Rendering Works](/core-concepts/rendering) for the full account.

### Compiled path (a component with a render program)

1. **State Mutation** – A property is set (e.g., `state.count++`).
2. **Proxy Trap** – `ProxyHandlerFactory` (`lib/core/reactive/proxyHandler.js`) intercepts it and `trigger()` wakes the watchers registered for that target and key.
3. **Per‑binding wake** – Each woken watcher is one binding's effect. It marks itself dirty and queues its own job.
4. **Microtask Batching** – `scheduler.js` drains the queue in one flush, ordered by component uid so parents run before children.
5. **Write** – Each job re‑evaluates its expression through `DynamicEvaluator` and writes to exactly one node (`lib/core/renderer/program/bindings.js`).
6. **Coalesced lifecycle** – `onUpdate`, `avenx:update` and injected‑child notification fire once per flush, not once per binding.

Nothing is serialised, parsed or diffed. `DomPatcher` is not involved.

### String path (a component that did not compile)

1–4 as above, except that the whole component is one reactive unit, so any
dependency of any binding schedules one component‑level job.

5. **Re‑evaluate** – `TemplateRenderer` (`lib/core/renderer/renderTemplate.js`) interpolates the whole template into an HTML string.
6. **DOM Patch** – `DomPatcher` (`lib/core/renderer/domPatch.js`) parses that string and diffs the result against the live DOM, with `ListManager`, `DeferManager`, and `DeadlockManager` handling special cases.

---

## 4. "Where Do I Add X?" Decision Table

| I Want To Add... | Primary Target Files / Directories |
| :--- | :--- |
| **New template directive / tag** | `lib/compiler/ComponentParser.js`, `lib/compiler/templateEvents.js` (so Atlas sees it too), `lib/core/renderer/`, and `lib/compiler/render/compileTemplate.js` — a new construct must either compile to an op or be added to the blocking list, never be silently ignored |
| **New render op** | `lib/compiler/render/program.js` (the vocabulary), `compileTemplate.js` (emit it), `lib/core/renderer/program/bindings.js` (apply it), `TemplateInstance.js` (dispatch it) |
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
- `node scripts/size-check.js --action build --repo . --out sizes.json` – Measure the scaffolded project's bundle (also run in CI).
- `npm run docs` – Generate JSDoc output to `dev-docs/`.
- `npm run lint` / `npm run format` – Lint and format the codebase.

To try your local changes against a scratch project:
1. `npm link` – Link the package globally.
2. In your test project: `npm link avenx-core` and test your changes.

There is no build step for the framework itself. The runtime is source, resolved
and linked into each application's own bundle, so a change to `lib/core/` takes
effect on the next `avenx build`.

---

## 6. House Rules for Contributors (CI‑Enforced)

1. **Zero Runtime Dependencies** – Code inside `lib/core/` must remain pure JavaScript without adding external npm dependencies.
2. **Stable Diagnostic Codes** – Errors must be registered through `AvenxErrorCodes` / `AvenxError` rather than throwing untracked raw `new Error`.
3. **Strict JSDoc** – Public APIs must be fully annotated with JSDoc to satisfy `eslint-plugin-jsdoc`.
4. **Atlas Never Guesses** – A relationship the analyser cannot follow is recorded as an `unresolved` entry with its reason and location. It is never dropped silently and never assumed. Any diagnostic that makes an absence claim must first check that record.
