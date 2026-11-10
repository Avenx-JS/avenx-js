# Avenx-JS Benchmarks

This directory contains performance benchmarks for various parts of the Avenx-JS framework.

## Running Benchmarks

To run all benchmarks, use the following command from the project root:

```bash
node benches/run.js
```

## Available Benchmarks

- **component-parser.bench.js**: Measures the speed of parsing `.component.js` and `.component.css` files into JavaScript classes.
- **style-processor.bench.js**: Measures the speed of processing HTML templates, scoping CSS rules, and applying variables.
- **runtime-render.bench.js**: Measures the speed of the runtime template interpolation (rendering).
- **incremental-rebuild.bench.js**: Measures what the compilation cache saves a watch rebuild, comparing a rebuild after a one-line edit against a cold build of the same project at two sizes.

## Pull-request comparison

On a pull request that touches the renderer, reactivity, expressions or the compiler, `.github/workflows/benchmark-compare.yml` runs this suite on the PR branch and the base branch side by side and comments the per-benchmark change. Benchmarks listed in [`regression-gate.js`](regression-gate.js) fail the check when they regress beyond their threshold. That file documents the thresholds, why they were chosen, and how a maintainer overrides a failure.

To run the same comparison locally against a checkout of `main`:

```bash
git worktree add ../avenx-main main && (cd ../avenx-main && npm ci)
node scripts/bench-compare.js measure --base ../avenx-main --pr . --rounds 5 --out bench-samples.json
node scripts/bench-compare.js compare --samples bench-samples.json --markdown bench-report.md
```

A benchmark's summary figure (the `Average time per …` line, which `run.js --json` records as `avgTime`) is what the comparison uses. Changing what that line measures changes the baseline, so call it out in the pull request.

## Methodology

Each benchmark runs a set number of iterations (e.g., 1000 or 5000) after a warmup phase. It reports the total time, average time per operation, and operations per second (Ops/sec).
