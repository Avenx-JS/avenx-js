/**
 * @file regression-gate.js
 * @description Which benchmarks fail a pull request when they regress, and by
 * how much they may regress first.
 *
 * Read by `scripts/bench-compare.js` in the `benchmark-compare.yml` workflow.
 * Every benchmark is measured and reported on every run; only the ones listed in
 * `gating` can fail the job. The rest are in the comment for a reviewer to read,
 * and a benchmark moves into `gating` once it has shown it can hold still.
 *
 * ## How the numbers are produced
 *
 * Both branches run on the same runner, in the same job, interleaved
 * (base, PR, PR, base, base, PR, ...) so a slow stretch on a shared machine
 * lands on both sides rather than on whichever branch happened to run during
 * it. Each benchmark's figure is the median of its samples across rounds. The
 * comparison is the PR median against the base median; neither absolute number
 * means much on a shared runner, but their ratio does -- the same reasoning
 * `size-check.yml` relies on when it builds both branches side by side.
 *
 * ## Why these thresholds
 *
 * Calibrated by an A/A run: the same commit measured against itself with the
 * workflow's round count, where every difference is noise by construction. A
 * threshold has to sit well clear of the largest A/A difference, or the gate
 * fires on pull requests that changed nothing it measures -- and a gate that
 * fires on everything gets ignored, which is what happened to the original
 * 50 KB bundle ceiling.
 *
 * Calibration run (5 rounds per side, interleaved, one machine; 2026-11-10,
 * i7-1360P, Node 24). A/A median difference, and half the sample range:
 *
 *     dom-patching       -1.8%   ±6%
 *     list-rendering     +5.9%   ±8-17%
 *     reactivity-lookup  +10.2%  ±12%   (samples sit at two levels, ~11 and ~13-14 ms)
 *
 * - **25%** for `dom-patching` and `list-rendering`: four times the largest
 *   A/A difference, which leaves room for a noisier CI runner while still
 *   catching the regressions that matter here. The fallback that re-renders a
 *   whole template instead of patching one binding costs multiples, not
 *   percentages.
 * - **35%** for `reactivity-lookup`. It drifted 10% against itself, so 25%
 *   would leave a margin a shared runner could eat; 35% keeps the same
 *   roughly 3x headroom.
 * - In the same A/A run, `render-paths`, `render-phases`, `render-scenarios`,
 *   `rewind-overhead` and `lru_cache_memory` moved 14-35% against themselves,
 *   and `reactivity`, `router`, `security`, `virtual-list` and
 *   `trace-overhead` showed ±10-40% spread. They report only. Their summary
 *   figure is a microsecond-scale operation that one GC pause moves by a
 *   quarter, and gating on them would need a threshold so wide it catches
 *   nothing. `update-scaling` (-2.1%, ±9%) is the first candidate to add once
 *   CI data confirms it holds still there too.
 * - Build-time benchmarks (`atlas-build`, `incremental-rebuild`,
 *   `component-parser`) are stable but measure the compiler, not an update.
 *   They report only, so the gate stays about what the issue that introduced
 *   it was about: what an update costs.
 *
 * Revisit after a few weeks of real pull-request data: the comment shows each
 * side's spread, and a benchmark whose spread stays small can join `gating`.
 *
 * ## Overriding a failure
 *
 * A maintainer adds the `benchmark-regression-accepted` label to the pull
 * request. The job re-runs, still reports the regression, and passes. Use it
 * for a deliberate trade (a correctness fix that costs time) and say why in
 * the pull request; do not raise a threshold to get one pull request through.
 * @module benches/regression-gate
 */

/**
 * Benchmark file name to the largest relative slowdown, in percent, it may show
 * before the job fails.
 * @type {Record<string, number>}
 */
export const gating = {
  'dom-patching.bench.js': 25,
  'list-rendering.bench.js': 25,
  'reactivity-lookup.bench.js': 35,
};

/** The label that lets a maintainer accept a reported regression. */
export const overrideLabel = 'benchmark-regression-accepted';
