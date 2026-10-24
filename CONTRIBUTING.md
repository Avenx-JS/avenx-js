# Contributing to Avenx.js

First of all, thank you for your interest in contributing to Avenx.js!

Avenx.js is an open-source JavaScript framework focused on simplicity, maintainability, and developer experience. Every contribution, whether it's code, documentation, bug reports, or ideas, helps improve the project.

## Before You Start

Before creating a contribution, please:

* Search existing issues and pull requests to avoid duplicates.
* Open an issue for larger changes or new features before implementing them.
* Ensure your proposal aligns with the goals of Avenx.js.

## Architecture & Codebase Overview

Before contributing to the compiler, runtime, or CLI, please read the [Contributor Architecture Guide](https://docs.avenx-js.com/contributing/architecture/) for an in-depth map of the compile pipeline, runtime data flow, and test tiers.

For an in-depth guide on the compiler pipeline passes, node structures, and invariants, see [Compiler Internals](docs/compiler-internals.md).

## Diagnostic Codes

Avenx.js uses stable diagnostic codes for compiler errors, runtime errors, and warnings. The authoritative registry of diagnostic codes is `lib/core/runtime/AvenxError.js`, which exports `AvenxErrorCodes`.

When adding a new diagnostic code:

1. Add the new code to `AvenxErrorCodes` in `lib/core/runtime/AvenxError.js`.
2. Add its human-readable message template to `AvenxErrorMessages` in the same file.
3. Add the corresponding structured entry to `lib/core/diagnostics/catalogue.js`, including its name, severity, category, summary, causes, remedies, and documentation URL.
4. Update the diagnostic documentation in `docs/src/content/docs/troubleshooting/errors.md` when the new code requires user-facing troubleshooting guidance.
5. Add or update tests covering the new diagnostic where appropriate.

Do not maintain a separate manual list of diagnostic codes in root-level documentation. The runtime registry is the source of truth for which codes exist, while the diagnostic catalogue provides their structured descriptions.

For compiler error classes, see `docs/src/content/docs/troubleshooting/errors.md`, which documents `CompilerError`, `TemplateValidationError`, `StyleCompilerError`, and `BuildError`.

## Local Development Workflow

A quick start for working on the codebase:

1. **Clone and install dependencies.** From the repository root, run:

   ```bash
   npm install
   ```

2. **Run the full test suite.** This runs the unit, integration, and system test tiers:

   ```bash
   npm test
   ```

3. **Run a single test tier** when you only need to check one area:

   ```bash
   npm run test:unit
   npm run test:integration
   npm run test:system
   ```

4. **Run a specific test or matching group.** The test runner accepts a file path or a substring:

   ```bash
   node test/run-tests.js test/unit/router.test.js
   node test/run-tests.js router
   ```

   Add `--watch` (or `-w`) to rerun matching tests when files change. Add `--update-snapshots` (or `-u`) to rewrite stored snapshots; review those changes before committing.

5. **Run the browser tests.** Install Chromium once, then run the Playwright suite:

   ```bash
   npx playwright install chromium
   npm run test:e2e
   ```

   See the [E2E test guide](test/e2e/README.md) for the suite's conventions and coverage.

6. **Run the official plugin test suites** with `npm run test:plugins`. See [Plugin tests](#plugin-tests) below for details.

7. **Check code style and formatting:**

   ```bash
   npm run lint
   npm run format
   ```

8. **Create a coverage report** with `npm run test:coverage`. It writes a text summary and an HTML report.

Unit and integration tests belong in their matching `test/unit` and `test/integration` directories. Use E2E tests when the behavior needs a real compiled Avenx app running in a browser; see the E2E guide for the distinction.

### Compiler changes and regression tests

Changes under `lib/compiler/` (or to `lib/compiler.js`) should include a corresponding test file in the same pull request. CI checks the PR diff and posts a non-blocking warning when compiler source changes without a changed `*.test.*` or `*.spec.*` file. For compiler changes, CI also runs the tests with coverage instrumentation and posts or updates a PR comment showing the test result, overall compiler line and branch coverage, diff size, changed-line coverage, and any changed uncovered lines or branches. This report is based on the PR version of the code; changed executable lines not covered by its tests are identified as uncovered. For fork PRs where GitHub does not grant the workflow a write token, the report is available in the CI job summary instead.

For a legitimate change that does not need new or updated tests, such as a pure refactor already covered by existing tests, add `[no-test-needed]` to the pull request description and explain why no test change is needed. This suppresses the reminder; it does not waive the usual expectation to maintain adequate compiler coverage.

## Plugin tests

Official plugins under `plugins/` ship their own suites. From the repository root run:

```bash
npm run test:plugins
```

CI runs this after `npm test`. Prefer fixing a plugin failure against the working-tree core rather than a published `avenx-core`.
