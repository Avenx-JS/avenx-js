/**
 * @file harness.js
 * @description Timing helpers shared by the renderer benchmarks.
 *
 * Two properties matter for a benchmark that is meant to detect an
 * architectural change rather than decorate a README:
 *
 * 1. **Warm-up is separate from measurement.** The first evaluation of an
 *    expression parses it; the first render of a template compiles it. Folding
 *    those one-time costs into a per-update average hides the steady-state
 *    number, which is the one the architecture is judged on.
 * 2. **The reported figure is a median of repeated samples**, not a single
 *    mean. A garbage-collection pause inside one sample moves a mean by more
 *    than most of the improvements worth detecting.
 * @module benches/support/harness
 */

/**
 * Runs an async operation repeatedly and returns milliseconds per iteration.
 * @param {number} iterations - How many times to run it.
 * @param {function(number): (void|Promise<void>)} body - The operation.
 * @returns {Promise<number>} Milliseconds per iteration.
 */
export async function time(iterations, body) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await body(i);
  }
  return (performance.now() - start) / iterations;
}

/**
 * Warms an operation up, then measures it several times and returns the median.
 *
 * The median rather than the minimum: a minimum reports the luckiest sample,
 * which flatters an implementation whose *typical* cost is worse. The median is
 * what a user experiences.
 * @param {object} options - Measurement options.
 * @param {number} [options.warmup] - Iterations to run before measuring.
 * @param {number} [options.iterations] - Iterations per sample.
 * @param {number} [options.samples] - How many samples to take.
 * @param {function(number): (void|Promise<void>)} options.body - The operation.
 * @returns {Promise<number>} Median milliseconds per iteration.
 */
export async function measure({ warmup = 5, iterations = 20, samples = 5, body }) {
  for (let i = 0; i < warmup; i++) {
    await body(i);
  }

  const runs = [];
  for (let s = 0; s < samples; s++) {
    runs.push(await time(iterations, body));
  }
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];
}

/**
 * Formats milliseconds for a fixed-width column.
 * @param {number} value - The measured milliseconds.
 * @param {number} [width] - Column width.
 * @returns {string} The padded value.
 */
export function ms(value, width = 9) {
  return `${value.toFixed(4)}`.padStart(width);
}

/**
 * Prints one row of a scenario table.
 * @param {string} label - The scenario name.
 * @param {number} value - Milliseconds.
 * @param {string} [note] - Trailing commentary.
 */
export function row(label, value, note = '') {
  console.log(`  ${label.padEnd(38)} ${ms(value)} ms  ${note}`);
}

/**
 * Measures how much heap one operation allocates.
 *
 * Allocation rate is the half of the render cost a millisecond figure hides. A
 * render-to-string architecture allocates the whole serialised template and the
 * whole reparsed tree on every update, which shows up as GC pressure long
 * before it shows up as wall time -- and, at large component sizes, as an
 * out-of-memory abort rather than a slow benchmark.
 * @param {object} options - Measurement options.
 * @param {number} [options.iterations] - How many operations to average over.
 * @param {function(number): (void|Promise<void>)} options.body - The operation.
 * @returns {Promise<number>} Bytes allocated per operation, approximately.
 */
export async function measureAllocation({ iterations = 10, body }) {
  // Warm the path so one-time allocations (parsed expressions, compiled
  // templates) are not attributed to the steady state.
  for (let i = 0; i < 3; i++) {
    await body(i);
  }
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < iterations; i++) {
    await body(i);
  }
  const after = process.memoryUsage().heapUsed;
  return Math.max(0, (after - before) / iterations);
}

/**
 * Formats a byte count for a fixed-width column.
 * @param {number} value - The measured bytes.
 * @returns {string} A padded, human-readable size.
 */
export function bytes(value) {
  if (value >= 1048576) return `${(value / 1048576).toFixed(2)} MB`.padStart(10);
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`.padStart(10);
  return `${Math.round(value)} B`.padStart(10);
}

/**
 * Emits the trailing block `benches/run.js` parses for its JSON report.
 * @param {object} summary - Reportable totals.
 * @param {number} summary.totalMs - Total measured time.
 * @param {number} summary.avgMs - Representative per-operation time.
 * @param {string} [summary.unit] - What one operation is.
 */
export function report({ totalMs, avgMs, unit = 'operation' }) {
  console.log(`\nTotal time: ${totalMs.toFixed(2)}ms`);
  console.log(`Average time per ${unit}: ${avgMs.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / Math.max(avgMs, 0.000001))}`);
}
