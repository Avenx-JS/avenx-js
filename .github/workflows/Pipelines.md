# 🚀 Avenx-JS CI/CD Pipelines & Workflows

This document provides a comprehensive overview of all GitHub Actions workflows configured in `.github/workflows/` for the Avenx-JS project.

---

## 📊 Overview

| Workflow                        | File                                             | Trigger                                                                   | Purpose                            | Output / Target                                                                                                                      |
| :------------------------------ | :----------------------------------------------- | :------------------------------------------------------------------------ | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Development Docs Publishing** | [`dev-docs.yml`](dev-docs.yml)                   | Push to `main`, `workflow_dispatch`                                       | Generates JSDoc documentation      | [`avenx-js/dev-docs`](https://github.com/avenx-js/dev-docs)                                                                          |
| **Quality & Benchmarks**        | [`quality-results.yml`](quality-results.yml)     | Schedule (Saturdays 12:00 Swiss time / `0 10 * * 6`), `workflow_dispatch` | Generates coverage & benchmarks    | [`avenx-js/test-cov`](https://github.com/avenx-js/test-cov)<br>[`avenx-js/bench-results`](https://github.com/avenx-js/bench-results) |
| **CI / CD Pipeline**            | [`ci.yml`](ci.yml)                               | Push/PR to `main`, Release creation                                       | Runs test suite and linter         | Build & multi-version compatibility verification                                                                                     |
| **Template Parser Fuzz**        | [`fuzz-nightly.yml`](fuzz-nightly.yml)           | Schedule (`0 2 * * *`), `workflow_dispatch`                               | Runs property-based fuzz tests     | Template parser & compiler invariants verification                                                                                   |
| **NPM Package Release**         | [`npm-publish.yml`](npm-publish.yml)             | Release creation                                                          | Publishes `avenx-core` and plugins | npm registry                                                                                                                         |
| **Bundle Size Monitor**         | [`size-check.yml`](size-check.yml)               | Pull Request to `main`                                                    | Monitors JS bundle sizes vs `main` | PR comment report                                                                                                                    |
| **Compiler Test Coverage**      | [`compiler-coverage.yml`](compiler-coverage.yml) | Pull Request to `main`                                                    | Checks compiler changes have tests | PR comment report                                                                                                                    |
| **Benchmark Comparison**        | [`benchmark-compare.yml`](benchmark-compare.yml) | Pull Request to `main` (measures only on render/reactive/compiler changes) | Gates benchmark regressions vs base | PR comment report                                                                                                                   |
| **GitHub Pages Docs**           | [`static.yml`](static.yml)                       | Push to `main`, `workflow_dispatch`                                       | Deploys Astro documentation site   | GitHub Pages                                                                                                                         |

---

## 🛠️ Detailed Workflow Documentation

### 1. Development Documentation Publishing (`dev-docs.yml`)

- **Triggers**:
  - Automatically on `push` events targeting the `main` branch.
  - Manually via `workflow_dispatch`.
- **Steps**:
  1. Checks out the main repository.
  2. Sets up Node.js 20 and installs dependencies (`npm ci`).
  3. Executes `npm run docs` (`jsdoc -c jsdoc.json`) to generate HTML documentation.
  4. Checks out the target repository `avenx-js/dev-docs`.
  5. Syncs generated `./dev-docs/` files to target repository using `rsync` (excluding `.git`).
  6. Inspects `git diff`. If changes exist, commits as `github-actions[bot]` with message `chore: update generated development docs` and pushes to `avenx-js/dev-docs`.

### 2. Quality Results: Coverage & Benchmarks (`quality-results.yml`)

- **Triggers**:
  - Scheduled cron: `0 10 * * 6` (Saturdays at 10:00 UTC = 12:00 CEST Swiss summer time / 11:00 CET winter time).
  - Manually via `workflow_dispatch`.
- **Job 1: Test Coverage (`test-coverage`)**:
  1. Executes `npm run test:coverage` (`c8 --reporter=text --reporter=html npm test`).
  2. Syncs generated `./coverage/` files to target repository `avenx-js/test-cov`.
  3. Commits (`chore: update test coverage report`) as `github-actions[bot]` if changed and pushes to `avenx-js/test-cov`.
- **Job 2: Benchmarks (`benchmarks`)**:
  1. Executes `mkdir -p bench-results && npm run bench:report` (`node benches/run.js --json > bench-results/results.json`).
  2. Syncs generated `./bench-results/` files to target repository `avenx-js/bench-results`.
  3. Commits (`chore: update benchmark results`) as `github-actions[bot]` if changed and pushes to `avenx-js/bench-results`.

### 3. CI/CD Pipeline (`ci.yml`)

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

### 4. NPM Package Release (`npm-publish.yml`)

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

### 5. Bundle Size Monitor (`size-check.yml`)

- **Triggers**: Pull Request to `main`.
- **Steps**: Builds bundle size for both base branch (`main`) and PR branch, compares bundle size deltas, and posts an interactive summary report comment directly on the Pull Request.

### 6. Static GitHub Pages Deployment (`static.yml`)

- **Triggers**: Push to `main`, `workflow_dispatch`.
- **Steps**: Builds the Astro documentation project in `docs/` and deploys static site artifacts to GitHub Pages.

### 7. Template and JavaScript Parser Fuzz Testing (`fuzz-nightly.yml`)

- **Triggers**:
  - Scheduled cron: `0 2 * * *` (Nightly at 02:00 UTC = 04:00 CEST / 03:00 CET).
  - Manually via `workflow_dispatch` with optional `num_runs` parameter (defaults to 1000).
- **Purpose**:
  Runs property-based fuzz testing using `fast-check` to validate template compiler and parser invariants across randomized-but-valid template structures (combinations of `<@for>`, `<@empty>`, slots, conditionals, dynamic bindings, and deep nesting). Deliberately kept off the standard pull request gate to prevent slowing down PR checks.
  A separate step runs `test/fuzz/jsParser.test.js`: 20,000 generated programs
  and 20,000 damaged sources are compared with Acorn on scheduled runs. The
  manual `num_runs` input overrides `FAST_CHECK_NUM_RUNS` for both steps (manual
  default: 1,000). Deterministic repository and hand-written JavaScript cases
  remain in `test/unit/jsParserDifferential.test.js` under the normal PR gate.
- **Node.js Compatibility Matrix**:
  Executes across all supported major Node.js versions (`[18, 20, 22]`).
- **Invariants Verified**:
  1. **Compiler Resilience**: The compiler never throws or crashes on valid syntax.
  2. **Dynamic Binding & Slot Classification**: Dynamic bindings and transclusion slots result in non-static nodes (preventing slot-classification regressions like #200).
  3. **Round-Trip Idempotency & AST Isomorphism**: `serializeHTML(parseHTML(template))` preserves semantics and stabilizes immediately.
  4. **Structural Conservation**: Counts, ordering, and nesting of slots, loops with empty blocks, and conditional chains are conserved in the generated AST and IR.

### 8. Compiler Test Coverage (`compiler-coverage.yml`)

- **Triggers**: Pull Request to `main`.
- **Steps**: Diffs the PR against its base. If `lib/compiler/` or `lib/compiler.js` changed, runs the test suite with `c8` coverage instrumentation and posts or updates a PR comment (like the bundle size report) with the test result, overall compiler line/branch coverage, diff size, coverage of changed executable lines, and any uncovered changed lines or branches.
- **Missing tests**: The comment warns when no `*.test.*` or `*.spec.*` file changed, unless the PR description contains `[no-test-needed]`; see [CONTRIBUTING.md](../../CONTRIBUTING.md#compiler-changes-and-regression-tests).
- **Advisory only**: The check never fails the build; the CI/CD Pipeline's test job is the gate. Fork PRs, which get a read-only token, show the report in the job summary instead of a comment.

### 9. Benchmark Comparison (`benchmark-compare.yml`)

The timing counterpart of the Bundle Size Monitor. `quality-results.yml` publishes absolute numbers weekly; this job answers whether _this_ pull request made an update slower, before it lands.

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

---

## 🔒 Security & Authentication Setup

### Target Repository Cross-Publishing (`PAT_TOKEN`)

Cross-repository pushing from `avenx-js/avenx-js` to `avenx-js/dev-docs`, `avenx-js/test-cov`, and `avenx-js/bench-results` requires a GitHub Personal Access Token (PAT) with write access (`repo` scope).

The token can be configured as either:

- **Repository Secret**: Configured under **Settings > Secrets and variables > Actions** as `PAT_TOKEN`.
- **Organization Secret**: Configured under **Organization Settings > Secrets and variables > Actions** as `PAT_TOKEN` and shared with the `avenx-js` repository.

### Automated Committer Identity

Automated commits in target repositories are configured with official GitHub Actions bot credentials:

- **Name**: `github-actions[bot]`
- **Email**: `41898282+github-actions[bot]@users.noreply.github.com`

### Idempotency & Clean Workspace

- Workflows check `git diff --staged --quiet` before committing to prevent empty or redundant commits.
- Main repository working trees remain 100% clean; all generated build directories (`dev-docs/`, `coverage/`, `bench-results/`) are kept as transient build artifacts in runner storage and are **never** pushed back to the main repository.

---

## 🕒 Cron Schedule & Timezone Information

GitHub Actions schedules natively use **Coordinated Universal Time (UTC)** and do not adjust for Daylight Saving Time (DST) automatically.

- **Swiss Time**: Switzerland uses **CEST (UTC+2)** in summer and **CET (UTC+1)** in winter.
- **Cron Definition**: `0 10 * * 6` (Saturdays at 10:00 UTC).
  - During **CEST (Summer)**: 10:00 UTC = **12:00 CEST** (Exact noon execution).
  - During **CET (Winter)**: 10:00 UTC = **11:00 CET** (11:00 AM execution).
