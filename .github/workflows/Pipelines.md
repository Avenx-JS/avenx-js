# 🚀 Avenx-JS CI/CD Pipelines & Workflows

This document provides a comprehensive overview of all GitHub Actions workflows configured in `.github/workflows/` for the Avenx-JS project.

---

## 📊 Overview

| Workflow                         | File                                         | Trigger                                                                   | Purpose                            | Output / Target                                                                                                                        |
| :------------------------------- | :------------------------------------------- | :------------------------------------------------------------------------ | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **Development Docs Publishing** | [`dev-docs.yml`](dev-docs.yml)               | Push to `main`, `workflow_dispatch`                                       | Generates JSDoc documentation      | [`avenx-js/dev-docs`](https://github.com/avenx-js/dev-docs)                                                                            |
| **Quality & Benchmarks**        | [`quality-results.yml`](quality-results.yml) | Schedule (Saturdays 12:00 Swiss time / `0 10 * * 6`), `workflow_dispatch` | Generates coverage & benchmarks    | [`avenx-js/test-cov`](https://github.com/avenx-js/test-cov)<br>[`avenx-js/bench-results`](https://github.com/avenx-js/bench-results) |
| **CI / CD Pipeline**            | [`ci.yml`](ci.yml)                           | Push/PR to `main`, Release creation                                       | Runs test suite and linter         | Build & multi-version compatibility verification                                                                                       |
| **NPM Package Release**         | [`npm-publish.yml`](npm-publish.yml)         | Release creation                                                          | Publishes `avenx-core` to npm      | npm registry                                                                                                                           |
| **Bundle Size Monitor**         | [`size-check.yml`](size-check.yml)           | Pull Request to `main`                                                    | Monitors JS bundle sizes vs `main` | PR comment report                                                                                                                      |
| **GitHub Pages Docs**           | [`static.yml`](static.yml)                   | Push to `main`, `workflow_dispatch`                                       | Deploys Astro documentation site   | GitHub Pages                                                                                                                           |

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
  5. Executes ESLint (`npm run lint`, executed on Node 20 & 22; skipped on Node 18 as ESLint 10 requires Node >= 20).

### 4. NPM Package Release (`npm-publish.yml`)

- **Triggers**: Release creation (`types: [created]`).
- **Pre-Publish & Release Runtime**:
  - Executes build verification (`build` job) and publication (`publish-npm` job) using **Node.js 18** (the minimum supported version requirement) with `cache: npm`.
- **Steps**:
  1. **Build Job**: Validates the codebase on Node.js 18 by installing dependencies (`npm ci`) and executing the test suite (`npm test`).
  2. **Publish Job**: Sets up Node.js 18 with npm registry credentials, reinstalls dependencies, and publishes `avenx-core` to the npm registry with provenance tracking (`npm publish --provenance`).

### 5. Bundle Size Monitor (`size-check.yml`)

- **Triggers**: Pull Request to `main`.
- **Steps**: Builds bundle size for both base branch (`main`) and PR branch, compares bundle size deltas, and posts an interactive summary report comment directly on the Pull Request.

### 6. Static GitHub Pages Deployment (`static.yml`)

- **Triggers**: Push to `main`, `workflow_dispatch`.
- **Steps**: Builds the Astro documentation project in `docs/` and deploys static site artifacts to GitHub Pages.

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
  