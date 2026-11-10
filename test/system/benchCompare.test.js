import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { compare, measure, median, renderMarkdown, COMMENT_MARKER } from '../../scripts/bench-compare.js';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '../..');
const BENCH_COMPARE = path.join(rootDir, 'scripts', 'bench-compare.js');

const gate = { gating: { 'gated.bench.js': 25 }, overrideLabel: 'benchmark-regression-accepted' };

/**
 * Builds a measurement as `measure` would return it.
 * @param {object} base - Samples per file on the base side.
 * @param {object} pr - Samples per file on the PR side.
 * @param {object} [failed] - Failure counts per side.
 * @returns {object} The measurement.
 */
function measured(base, pr, failed = {}) {
  return {
    rounds: 3,
    environment: { node: 'v22', platform: 'linux x64', cpu: 'test', cpus: 4 },
    base: { samples: base, failed: failed.base || {} },
    pr: { samples: pr, failed: failed.pr || {} },
  };
}

/**
 * A fake checkout whose `benches/run.js` reports fixed figures and logs its
 * own invocation, so the test can see the order the sides ran in.
 * @param {string} dir - Where to create it.
 * @param {string} side - Name written to the order log.
 * @param {string} log - Path of the shared order log.
 * @param {object} options - What the stub reports.
 * @param {number} options.avg - avgTime for `gated.bench.js`.
 * @param {boolean} [options.crash] - Whether `broken.bench.js` fails.
 */
function fakeCheckout(dir, side, log, { avg, crash = false }) {
  fs.mkdirSync(path.join(dir, 'benches'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'benches', 'run.js'), `
    import fs from 'fs';
    fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(side)} + '\\n');
    console.log(JSON.stringify([
      { file: 'gated.bench.js', avgTime: ${avg} },
      { file: 'broken.bench.js', avgTime: 0 },
    ]));
    if (${crash}) {
      console.error('\\n1 benchmark(s) failed:\\n  broken.bench.js (exit 1)\\n    Error: boom');
      process.exit(1);
    }
  `);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
}

/**
 * The median is the middle sample, and the mean of the middle two for an even count.
 */
function testMedian() {
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
  console.log('  ✅ median picks the middle sample.');
}

/**
 * A gating benchmark fails beyond its threshold, passes within it, and a
 * report-only benchmark never fails however far it moves.
 */
function testGate() {
  const within = compare(measured({ 'gated.bench.js': [1, 1, 1] }, { 'gated.bench.js': [1.2, 1.2, 1.2] }), gate);
  assert.strictEqual(within.failures.length, 0, '+20% is inside a 25% threshold');
  assert.strictEqual(within.rows[0].status, 'ok');

  const beyond = compare(measured({ 'gated.bench.js': [1, 1, 1] }, { 'gated.bench.js': [1.3, 1.3, 9] }), gate);
  assert.strictEqual(beyond.failures.length, 1, '+30% is beyond a 25% threshold');
  assert.strictEqual(beyond.rows[0].status, 'regressed');
  assert.ok(Math.abs(beyond.rows[0].change - 30) < 1e-9, 'the change is computed from medians, so one outlier does not move it');

  const reportOnly = compare(measured({ 'other.bench.js': [1] }, { 'other.bench.js': [5] }), gate);
  assert.strictEqual(reportOnly.failures.length, 0, 'a report-only benchmark never fails the job');
  assert.strictEqual(reportOnly.rows[0].change, 400);

  const faster = compare(measured({ 'gated.bench.js': [2] }, { 'gated.bench.js': [1] }), gate);
  assert.strictEqual(faster.failures.length, 0, 'an improvement never fails');
  console.log('  ✅ The gate fails only gating benchmarks beyond their threshold.');
}

/**
 * A gating benchmark that crashes on the PR but ran on the base fails the
 * gate: a regression bad enough to crash must not pass as "no figure".
 * One that already failed on the base has no baseline and does not.
 */
function testCrashes() {
  const crashed = compare(measured({ 'gated.bench.js': [1] }, {}, { pr: { 'gated.bench.js': 3 } }), gate);
  assert.strictEqual(crashed.rows[0].status, 'crashed');
  assert.strictEqual(crashed.failures.length, 1);

  const noBase = compare(measured({}, { 'gated.bench.js': [1] }, { base: { 'gated.bench.js': 3 } }), gate);
  assert.strictEqual(noBase.rows[0].status, 'no-base');
  assert.strictEqual(noBase.failures.length, 0);

  const noFigure = compare(measured({ 'gated.bench.js': [0] }, { 'gated.bench.js': [0] }), gate);
  assert.strictEqual(noFigure.rows[0].status, 'no-figure', 'a benchmark with no summary figure is not compared');
  console.log('  ✅ Crashes and missing baselines are classified.');
}

/**
 * The report carries the marker the workflow updates in place, the number of
 * rounds, and says when a maintainer accepted a failure.
 */
function testMarkdown() {
  const m = measured({ 'gated.bench.js': [1] }, { 'gated.bench.js': [2] });
  const comparison = compare(m, gate);
  const failing = renderMarkdown(m, comparison, { override: false, overrideLabel: gate.overrideLabel });
  assert.ok(failing.startsWith(COMMENT_MARKER));
  assert.ok(failing.includes('Median of **3** runs'), 'the comment states how many repetitions it used');
  assert.ok(failing.includes('❌ 1 gating benchmark(s) regressed'));
  const accepted = renderMarkdown(m, comparison, { override: true, overrideLabel: gate.overrideLabel });
  assert.ok(accepted.includes('Accepted by a maintainer'));
  console.log('  ✅ The report states repetitions and override.');
}

/**
 * `measure` interleaves the sides, keeps the figures of benchmarks that ran
 * when another crashed, and records the crash.
 */
function testMeasure() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-bench-compare-'));
  try {
    const log = path.join(dir, 'order.log');
    fakeCheckout(path.join(dir, 'base'), 'base', log, { avg: 1, crash: true });
    fakeCheckout(path.join(dir, 'pr'), 'pr', log, { avg: 2 });

    const result = measure({ base: path.join(dir, 'base'), pr: path.join(dir, 'pr'), rounds: 4 });
    const order = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.deepStrictEqual(order, ['base', 'pr', 'pr', 'base', 'base', 'pr', 'pr', 'base'], 'rounds alternate which side runs first');
    assert.deepStrictEqual(result.base.samples['gated.bench.js'], [1, 1, 1, 1], 'a crash elsewhere keeps this baseline');
    assert.strictEqual(result.base.samples['broken.bench.js'], undefined, 'a crashed run records no sample');
    assert.strictEqual(result.base.failed['broken.bench.js'], 4);
    assert.deepStrictEqual(result.pr.samples['gated.bench.js'], [2, 2, 2, 2]);
    assert.strictEqual(result.rounds, 4);

    // End to end through the CLI: the regression fails the command, the override passes it.
    const samples = path.join(dir, 'samples.json');
    const gatePath = path.join(dir, 'gate.mjs');
    fs.writeFileSync(samples, JSON.stringify(result));
    fs.writeFileSync(gatePath, `export const gating = { 'gated.bench.js': 25 }; export const overrideLabel = 'x';`);
    const cli = (extra) => spawnSync(process.execPath, [BENCH_COMPARE, 'compare', '--samples', samples, '--markdown', path.join(dir, 'r.md'), '--gate', gatePath, ...extra], { encoding: 'utf8' });
    assert.strictEqual(cli([]).status, 1, 'a gating regression exits 1');
    assert.strictEqual(cli(['--override', 'false']).status, 1, '--override false does not override');
    assert.strictEqual(cli(['--override', 'true']).status, 0, 'the override exits 0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  ✅ measure interleaves sides and survives a crashing benchmark.');
}

/**
 * Every gating benchmark exists, so a rename cannot silently ungate it.
 */
async function testGateConfig() {
  const config = await import('../../benches/regression-gate.js');
  for (const [file, threshold] of Object.entries(config.gating)) {
    assert.ok(fs.existsSync(path.join(rootDir, 'benches', file)), `gating benchmark ${file} exists`);
    assert.ok(threshold > 0, `${file} has a positive threshold`);
  }
  assert.ok(config.overrideLabel, 'an override label is configured');
  console.log('  ✅ The gate configuration names real benchmarks.');
}

/**
 * Runs the suite.
 */
async function run() {
  console.log('🧪 Testing the benchmark comparison...');
  testMedian();
  testGate();
  testCrashes();
  testMarkdown();
  testMeasure();
  await testGateConfig();
  console.log('\n✅ All benchmark comparison tests passed!');
}

run().catch((error) => {
  console.error('❌ Benchmark comparison tests failed:', error);
  process.exit(1);
});
