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
| `lib/compiler/ir/` | The typed template IR: the node vocabulary, the builder that reads a template into it, and the lowering pass that turns it into a render program. | Teaching the compiler a construct that currently falls back. |
| `lib/compiler/render/` | The render program format and the op vocabulary. | Adding an op kind. |
| `lib/compiler/codegen/` | Expression and action bodies → JavaScript: the scan that finds every expression an application will evaluate (`collect.js`), the expression generator (`expression.js`), the acorn-based action compiler (`actions.js`), and the tables they are emitted into (`table.js`). | Changing what an expression compiles to, or teaching the scan about a new place an expression can hide. |
| `lib/core/expression/` | What a compiled expression calls at run time (`ops.js`), where the interpreter plugs in (`fallback.js`), and the development-only interpreter itself (`interpreter.js`, plus `parser.js`, `evaluator.js`, `compile.js`). | Changing a security guard, or the development fallback. `ops.js` ships to production; nothing else here does. |
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
6. **Template IR** – Reads the *semantic* template — after styles and two-way bindings, before any directive rewrite — into typed nodes (`lib/compiler/ir/build.js`). `<@for row in rows key="row.id">` becomes a node with a list expression, a binding name, a key and a body fragment, so nothing downstream has to re-read markup to find out what it was. A construct the IR does not model is refused by name.
7. **Lowering** – Turns the IR into a render program: a skeleton, a list of ops, and a list of blocks for control flow (`lib/compiler/ir/lower.js`). Expressions are interned and addressed by index. A template that could not be built or lowered produces no program and is reported as `AVX_W47`.
8. **Expression codegen** – Compiles the interned sources into positional closure tables (`lib/compiler/codegen/table.js`). If any of them will not compile, the whole program is withdrawn: an index names a closure and nothing else, so a missing entry would be a binding the runtime could neither evaluate nor name.
7. **Module generation** – Frames each compiled class as an ES module: an import of the runtime, the developer's own imports verbatim, and a default export (`lib/compiler/modules.js`). `ComponentParser.parse()` still returns a bare `class X extends AvenxComponent`; how a unit is *linked* is not a reason to change how it is *compiled*, and that output shape is what `avenx-core/testing` and the Vite plugin consume.
8. **Bundling** – `lib/bundler/` resolves every specifier, builds the dependency graph, drops what nothing reaches, and emits `dist/bundle.js` with a source map. The Avenx runtime is an ordinary dependency in that graph, resolved through `avenx-core/runtime`.

### The compiler/runtime boundary

The rule is that the compiler does the work and the runtime does as little as it
can. Concretely, everything executable is turned into a real JavaScript function
at build time:

```text
count * 2                ->  ($s) => (axGet($s, "count") * 2)
item.qty                 ->  ($s) => axRead(axGet($s, "item"), "qty", false)
if (!text) { return; }   ->  ($s) => { if (!axGet($s, "text")) { return; } … }
```

Those functions are written into the component's module and linked like any
other code, so the browser's engine compiles them. Three things follow:

- **No dynamic evaluation.** Nothing in a production bundle calls `eval`,
  constructs a function from a string, or uses `with`. The parser, the
  tree-walking evaluator and the source-text sandbox are development-only and
  are not reachable from a production entry, so the bundler drops them.
- **The security boundary did not move.** A member read is emitted as a call to
  `readMember` with the key already resolved, exactly where the interpreter made
  the same call, so `x['const'+'ructor']` still meets one check as one string.
  Naming a restricted global or writing a forbidden key is refused at build time
  instead.
- **Trace is unaffected.** What the recorder needs is the *substitution point*
  for globals, not the interpreter: a compiled expression naming `Date` emits a
  call to the same resolver, so recording and deterministic replay work as they
  did.

What still travels as data rather than as code is the scope — the object a
compiled closure is handed, which decides what its names resolve to
(`lib/core/runtime/ComponentScope.js`).

The one place the compiler *cannot* answer statically is which expressions exist
at all, because they hide in template text, in `data-ax-*` attributes and in
authored `@event` attributes. That scan lives in `lib/compiler/codegen/collect.js`,
its failure mode is an absence rather than an error, and
`test/system/expressionCoverage.test.js` exists solely to catch it: it compiles
every fixture application and requires zero uncompiled expressions.

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
5. **Write** – Each job re‑evaluates its expression through `DynamicEvaluator.evaluateIndexed` and writes to exactly one node (`lib/core/renderer/program/bindings.js`), or reconciles a DOM range (`blocks.js`, for `<@if>`, `<@for>`, `<slot>` and `<@defer>`).
6. **Coalesced lifecycle** – `onUpdate`, `avenx:update` and injected‑child notification fire once per flush, not once per binding.

Nothing is serialised, parsed or diffed. `DomPatcher` is not involved.

### String path (a component that did not compile)

The string renderer is only linked into a bundle when at least one component in
the build fell back. `lib/core/renderer/stringRenderer.js` is the registry that
makes that possible, and `installStringRenderer.js` is the module the compiler
adds to the entry graph. Both are migration scaffolding: when the last
unmodelled construct lowers, the string renderer goes and they go with it.

1–4 as above, except that the whole component is one reactive unit, so any
dependency of any binding schedules one component‑level job.

5. **Re‑evaluate** – `TemplateRenderer` (`lib/core/renderer/renderTemplate.js`) interpolates the whole template into an HTML string.
6. **DOM Patch** – `DomPatcher` (`lib/core/renderer/domPatch.js`) parses that string and diffs the result against the live DOM, with `ListManager`, `DeferManager`, and `DeadlockManager` handling special cases.

---

## 4. "Where Do I Add X?" Decision Table

| I Want To Add... | Primary Target Files / Directories |
| :--- | :--- |
| **New template directive / tag** | `lib/compiler/ir/nodes.js` (a node kind, or a refusal reason), `lib/compiler/ir/build.js` (read it), `lib/compiler/ir/lower.js` (emit it), `lib/compiler/templateEvents.js` (so Atlas sees it too) — a new construct must either lower to an op or be refused by name, never be silently ignored |
| **New render op** | `lib/compiler/render/program.js` (the vocabulary), `lib/compiler/ir/lower.js` (emit it), `lib/core/renderer/program/bindings.js` (apply it, for a leaf op) or `blocks.js` (for one that owns a DOM range), `TemplateInstance.js` (dispatch it) |
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
