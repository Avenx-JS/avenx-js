# 🚀 Avenx-JS CI/CD Pipelines & Workflows

This document provides a comprehensive overview of all GitHub Actions workflows configured in `.github/workflows/` for the Avenx-JS project.

---

## 📊 Overview

| Workflow                       | File                                             | Trigger                                                                    | Purpose                                               | Output / Target                                              |
| :----------------------------- | :----------------------------------------------- | :------------------------------------------------------------------------- | :---------------------------------------------------- | :----------------------------------------------------------- |
| **CI / CD Pipeline**           | [`ci.yml`](ci.yml)                               | Push/PR to `main`, Release creation                                        | Runs test suite and linter                            | Build & multi-version compatibility verification             |
| **Parser & Minifier Fuzz**     | [`fuzz-nightly.yml`](fuzz-nightly.yml)           | Schedule (`0 2 * * *`), `workflow_dispatch`                                | Runs property-based fuzz tests                        | Template/JS parser & bundle minifier invariants verification |
| **NPM Package Release**        | [`npm-publish.yml`](npm-publish.yml)             | Release creation                                                           | Publishes `avenx-core` and plugins                    | npm registry                                                 |
| **Bundle Size Monitor**        | [`size-check.yml`](size-check.yml)               | Pull Request to `main`                                                     | Monitors JS bundle sizes vs `main`                    | PR comment report                                            |
| **Test Coverage & Area Gates** | [`coverage.yml`](coverage.yml)                   | Pull Request to `main`, Push to `main`, `workflow_dispatch`                | Enforces global and per-area test coverage thresholds | PR comment report, step summary & main artifact              |
| **Compiler Test Coverage**     | [`compiler-coverage.yml`](compiler-coverage.yml) | Pull Request to `main`                                                     | Checks compiler changes have tests                    | PR comment report                                            |
| **Benchmark Comparison**       | [`benchmark-compare.yml`](benchmark-compare.yml) | Pull Request to `main` (measures only on render/reactive/compiler changes) | Gates benchmark regressions vs base                   | PR comment report                                            |
| **GitHub Pages Docs**          | [`static.yml`](static.yml)                       | Push to `main`, `workflow_dispatch`                                        | Deploys Astro documentation site                      | GitHub Pages                                                 |

API reference, test coverage and benchmark history are no longer published from this repository. [`Avenx-JS/dev-dashboard`](https://github.com/Avenx-JS/dev-dashboard) checks it out read-only, runs `npm run docs`, `npm run test:coverage` and `benches/run.js --json`, and publishes the results at [dev.avenx-js.com](https://dev.avenx-js.com). The `npm run test:coverage` script generates HTML output directly into `./coverage/` to support this dashboard integration while enforcing threshold gates.

---

## 🛠️ Detailed Workflow Documentation

### 1. CI/CD Pipeline (`ci.yml`)

- **Triggers**: Push or Pull Request to `main`, or Release creation.
- **Node.js Compatibility Matrix**:
  To guarantee full compatibility with the declared `engines` field (`>=18`), the `test` job executes in parallel across all supported Node.js major versions using `strategy.matrix`:
  - **Node.js 18** (Lowest supported version floor)
  - **Node.js 20**
  - **Node.js 22**
  - **Configuration**: Uses `fail-fast: false` to ensure test results across all versions complete even if one fails.
- **Steps**:
  1. Checks out code.
  2. Configures Node.js (`actions/setup-node@v4`) with `cache: npm` enabled.
  3. Installs dependencies (`npm ci`).
  4. Runs complete test suite (`npm test`).
  5. Checks the compiler snapshots (`npm run test:snapshots`, executed on Node 22 only, since the output does not depend on the Node version).
  6. Executes ESLint (`npm run lint`, executed on Node 20 & 22; skipped on Node 18 as ESLint 10 requires Node >= 20).

### 2. NPM Package Release (`npm-publish.yml`)

- **Triggers**: Release creation (`types: [created]`).
- **Steps**:
  1. **Build Job** (`build`): On Node.js 18, 20 and 22, installs dependencies (`npm ci`), runs the test suite (`npm test`) and the plugin suites (`npm run test:plugins`).
  2. **Core Publish Job** (`publish-npm`): On Node.js 20, publishes `avenx-core` with provenance (`npm publish --provenance`).
  3. **Plugin Publish Job** (`publish-plugins`): Runs only after the core publish succeeded, once per plugin (`@avenx/i18n`, `@avenx/persistence`, `@avenx/charts`, `@avenx/vite`), in parallel:
     - Installs the root dependencies, which provide esbuild for the plugin builds and link `avenx-core` for the plugins' own imports (`scripts/link-plugin-core.js`).
     - Skips the plugin if that exact version is already on npm, so a re-run after a partial failure finishes the rest instead of failing.
     - Builds it (`npm run build --if-present`), which populates the `dist/` that the manifests for i18n, persistence and charts ship.
     - Publishes with `npm publish --provenance --access public --tag <tag>`. The tag is `latest` for a release version and the prerelease identifier otherwise (`1.0.0-rc.2` → `rc`).
- **Versioning**: The plugins are versioned in lockstep with `avenx-core` and require `avenx-core` `^<version>`. `npm version <bump>` runs `scripts/sync-plugin-versions.js` and stages the plugin manifests in the same commit. `test/system/packageIntegrity.test.js` fails if a plugin's version or peer range drifts from the core.
- **Credentials**: The plugin job publishes with the `NPM_TOKEN` repository secret (`NODE_AUTH_TOKEN`). npm trusted publishing is configured per package on npmjs.com and needs the package to exist first, so at least the first publish of each plugin needs the token. The `@avenx` scope must belong to the npm account or organisation the token is for.
- **Integrity**: `test/system/packageIntegrity.test.js` packs each plugin and checks that every `exports` target, including a `types` condition for every subpath, is in the tarball, that `dist/` is built where `files` lists it, and that every module reachable from the entry points resolves inside the tarball or to a declared (peer) dependency, with `avenx-core/*` imports limited to subpaths core exports.

### 3. Bundle Size Monitor (`size-check.yml`)

- **Triggers**: Pull Request to `main`.
- **Steps**: Builds bundle size for both base branch (`main`) and PR branch, compares bundle size deltas, and posts an interactive summary report comment directly on the Pull Request.

### 4. Static GitHub Pages Deployment (`static.yml`)

- **Triggers**: Push to `main`, `workflow_dispatch`.
- **Steps**: Builds the Astro documentation project in `docs/` and deploys static site artifacts to GitHub Pages.

### 5. Template Parser, JavaScript Parser, and Bundle Minifier Fuzz Testing (`fuzz-nightly.yml`)

- **Triggers**:
  - Scheduled cron: `0 2 * * *` (Nightly at 02:00 UTC = 04:00 CEST / 03:00 CET).
  - Manually via `workflow_dispatch` with optional `num_runs` parameter (defaults to 1000).
- **Purpose**:
  Runs property-based fuzz testing using `fast-check` to validate template compiler, JavaScript parser, and bundle minifier safety invariants. Deliberately kept off the standard pull request gate to prevent slowing down PR checks, with fast, bounded versions running on the PR gate in `test/unit/`.
  - **Template Parser Invariants (`test/fuzz/templateParser.test.js`)**: Validates compiler and parser invariants across randomized-but-valid template structures (combinations of `<@for>`, `<@empty>`, slots, conditionals, dynamic bindings, and deep nesting).
  - **JavaScript Parser Differential (`test/fuzz/jsParser.test.js`)**: 20,000 generated programs and 20,000 damaged sources are compared with Acorn on scheduled runs. Deterministic repository and hand-written JavaScript cases remain in `test/unit/jsParserDifferential.test.js` under the normal PR gate.
  - **Bundle Minifier Safety Invariants (`test/fuzz/minify.test.js`)**: Asserts that `lib/bundler/minify.js` strips comments and trims line margins without altering program semantics, line counts, or string/template literal values across synthetic programs mixing escaped strings, regex literals, multiline indentation, and division chains. A fast bounded property suite and deterministic regression cases run on every PR in `test/unit/minifyInvariants.test.js`.
    The manual `num_runs` input overrides `FAST_CHECK_NUM_RUNS` for all steps (manual default: 1,000).
- **Node.js Compatibility Matrix**:
  Executes across all supported major Node.js versions (`[18, 20, 22]`).
- **Template Invariants Verified**:
  1. **Compiler Resilience**: The compiler never throws or crashes on valid syntax.
  2. **Dynamic Binding & Slot Classification**: Dynamic bindings and transclusion slots result in non-static nodes (preventing slot-classification regressions like #200).
  3. **Round-Trip Idempotency & AST Isomorphism**: `serializeHTML(parseHTML(template))` preserves semantics and stabilizes immediately.
  4. **Structural Conservation**: Counts, ordering, and nesting of slots, loops with empty blocks, and conditional chains are conserved in the generated AST and IR.
- **Bundle Minifier Invariants Verified**:
  1. **Line Count Preservation**: `minify(src).split('\n').length === src.split('\n').length`, ensuring development and production build source maps stay aligned.
  2. **Semantic Equivalence**: Both original and minified sources parse cleanly with Acorn and evaluate to identical results in isolated execution contexts.
  3. **AST Literal Value Preservation**: Every string `Literal` and `TemplateElement` in the Acorn AST is byte-identical in value, raw text, and cooked text.
  4. **Idempotence**: `minify(minify(src)) === minify(src)`.
  5. **Non-Increasing Length**: `minify(src).length <= src.length`.
  6. **Complete Comment Removal**: Acorn reports 0 comment tokens in the minified program.

### 6. Compiler Test Coverage (`compiler-coverage.yml`)

- **Triggers**: Pull Request to `main`.
- **Steps**: Diffs the PR against its base. If `lib/compiler/` or `lib/compiler.js` changed, runs the test suite with `c8` coverage instrumentation and posts or updates a PR comment (like the bundle size report) with the test result, overall compiler line/branch coverage, diff size, coverage of changed executable lines, and any uncovered changed lines or branches.
- **Missing tests**: The comment warns when no `*.test.*` or `*.spec.*` file changed, unless the PR description contains `[no-test-needed]`; see [CONTRIBUTING.md](../../CONTRIBUTING.md#compiler-changes-and-regression-tests).
- **Advisory only**: The check never fails the build; the CI/CD Pipeline's test job is the gate. Fork PRs, which get a read-only token, show the report in the job summary instead of a comment.

### 7. Benchmark Comparison (`benchmark-compare.yml`)

The timing counterpart of the Bundle Size Monitor. The [Developer Dashboard](https://github.com/Avenx-JS/dev-dashboard) records absolute numbers weekly; this job answers whether _this_ pull request made an update slower, before it lands.

- **Triggers**: Pull Request to `main`. A new push cancels the run in progress for the same pull request.
- **When it measures**: Only when the diff against the base touches `lib/core/renderer/`, `lib/core/reactive/`, `lib/core/expression/`, `lib/compiler/`, `lib/compiler.js`, `benches/`, or the job's own files (`scripts/bench-compare.js`, this workflow). Otherwise it passes without measuring. Changed-file detection is the same `git diff` used by `compiler-coverage.yml`, not a `paths:` filter, so the check always reports a status.
- **Steps**:
  1. Checks out the PR branch, and the base branch into `base/`, as `size-check.yml` does. Installs dependencies in both.
  2. Runs `node scripts/bench-compare.js measure`, which runs each checkout's own `benches/run.js --json` (the output `npm run bench:report` produces) `BENCH_ROUNDS` times per side (currently **5**).
  3. Runs `node scripts/bench-compare.js compare`, which takes the median of each benchmark's samples and reports base, PR, absolute and relative change, and each side's noise for every benchmark.
  4. Posts or updates a PR comment (`### ⏱️ Benchmark Comparison`), writes the same report to the job summary, and uploads the raw samples as the `bench-samples` artifact.
- **Noise handling**: Both branches run in the same job on the same runner, interleaved (base, PR, PR, base, …) so drift on the shared machine lands on both sides. The figure compared is a median across rounds, and the comment states the number of rounds and each side's spread.
- **What fails the job**: Only the benchmarks listed in [`benches/regression-gate.js`](../../benches/regression-gate.js), when their PR median is slower than the base median by more than their threshold (currently **+25%** for `dom-patching` and `list-rendering`, **+35%** for `reactivity-lookup`), or when one crashes on the PR but ran on the base. Every other benchmark is reported only. The thresholds, the gating set, and the A/A calibration behind them are documented in that file.
- **Override**: A maintainer adds the `benchmark-regression-accepted` label and re-runs the job. Labels are read live from the API, since a re-run replays the original event payload, which predates the label. The report still shows the regression and says it was accepted. The job deliberately does not trigger on `labeled`. A run skipped for an unrelated label would replace a failing check with a passing one.
- **Fork PRs**: The read-only token cannot comment, so the report is in the job summary. The gate still applies.
- **Cost**: About one minute per suite run on a typical runner, so roughly 10–12 minutes with 5 rounds per side, spent only on pull requests that change what the benchmarks measure.

### 8. Test Coverage & Area Gates (`coverage.yml`)

The authoritative test coverage and regression gate for `avenx-core`.

- **Triggers**:
  - Pull Request to `main`.
  - Push to `main`.
  - Manual execution via `workflow_dispatch`.
- **Concurrency**: Cancels in-progress runs for the same pull request on subsequent pushes (`coverage-${{ github.event.pull_request.number || github.ref }}`).
- **Threshold Enforcement**:
  Executes `npm run test:coverage`, which instruments the complete test suite under `c8` and evaluates both global and per-area minimum coverage floors:
  1. **Global Thresholds** (configured in `.c8rc.json` with `all: true` for `lib/**` and `bin/**`):
     - **Lines**: **92%**
     - **Branches**: **84%**
     - **Functions**: **93%**
     - **Statements**: **92%**
  2. **Per-Area Thresholds** (enforced by `scripts/check-coverage.js` via `coverage-thresholds.json`):
     - `lib/compiler`: lines **95%**, branches **85%**, functions **95%**, statements **95%**
     - `lib/core/runtime`: lines **91%**, branches **81%**, functions **88%**, statements **91%**
     - `lib/core/renderer`: lines **92%**, branches **83%**, functions **93%**, statements **92%**
     - `lib/core`: lines **92%**, branches **82%**, functions **91%**, statements **92%**
     - `lib/bundler`: lines **96%**, branches **88%**, functions **99%**, statements **96%**
     - `bin`: lines **82%**, branches **85%**, functions **97%**, statements **82%**
- **Authoritative Gating**:
  Unlike `compiler-coverage.yml` (which is advisory and limited to compiler diffs), `coverage.yml` is an authoritative gate: if the test suite fails or any global or per-area threshold drops below its required floor, the workflow fails.
- **PR Delta Reporting & Changed Source Files**:
  - Compares pull request coverage against the latest `coverage-summary-main` artifact produced on `main` (falling back cleanly to the committed baseline in `coverage-thresholds.json` if no artifact exists or permissions restrict access).
  - Diffs changed files against the base commit and generates a markdown table of changed source files under `lib/` and `bin/`.
  - Posts or updates a sticky comment (`<!-- avenx-coverage-report -->`) on same-repository pull requests, and always appends the full report to `$GITHUB_STEP_SUMMARY`.
  - On pull requests from forks, read-only token restrictions cause the comment step to skip safely while the step summary report and gate checks remain fully active.
- **Main Artifact & Dashboard Compatibility**:
  - On pushes to `main`, `coverage/coverage-summary.json` is uploaded as the `coverage-summary-main` artifact with a 30-day retention period.
  - `npm run test:coverage` generates `./coverage/index.html` to ensure continuous compatibility with [`Avenx-JS/dev-dashboard`](https://github.com/Avenx-JS/dev-dashboard) and [dev.avenx-js.com](https://dev.avenx-js.com).
