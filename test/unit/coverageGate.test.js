import assert from 'node:assert';
import {
  normalizeRepoPath,
  aggregateAreas,
  evaluateThresholds,
  computeDeltas,
  formatMarkdownReport,
} from '../../scripts/check-coverage.js';

console.log('🧪 Testing coverage gate and area threshold enforcement...');

const mockRootDir = '/workspace/project';

// 1. Path normalization
{
  assert.strictEqual(
    normalizeRepoPath('/workspace/project/lib/compiler/index.js', mockRootDir),
    'lib/compiler/index.js',
  );
  assert.strictEqual(
    normalizeRepoPath('C:\\workspace\\project\\lib\\core\\runtime\\AvenxApp.js', 'C:/workspace/project'),
    'lib/core/runtime/AvenxApp.js',
  );
  assert.strictEqual(normalizeRepoPath('bin\\cli.js', mockRootDir), 'bin/cli.js');
  console.log('  ✅ POSIX and Windows path normalization verified.');
}

// 2. Area aggregation & nested directory inheritance
{
  const mockSummary = {
    total: {
      lines: { total: 200, covered: 180 },
      statements: { total: 200, covered: 180 },
      functions: { total: 20, covered: 19 },
      branches: { total: 50, covered: 45 },
    },
    [`${mockRootDir}/lib/core/runtime/AvenxApp.js`]: {
      lines: { total: 100, covered: 95 },
      statements: { total: 100, covered: 95 },
      functions: { total: 10, covered: 10 },
      branches: { total: 20, covered: 18 },
    },
    [`${mockRootDir}/lib/core/renderer/domPatch.js`]: {
      lines: { total: 50, covered: 45 },
      statements: { total: 50, covered: 45 },
      functions: { total: 5, covered: 4 },
      branches: { total: 15, covered: 13 },
    },
    [`${mockRootDir}\\bin\\cli.js`]: {
      lines: { total: 50, covered: 40 },
      statements: { total: 50, covered: 40 },
      functions: { total: 5, covered: 5 },
      branches: { total: 15, covered: 14 },
    },
  };

  const areaKeys = ['lib/core', 'lib/core/runtime', 'lib/core/renderer', 'bin'];
  const aggregated = aggregateAreas(mockSummary, areaKeys, mockRootDir);

  // Global totals
  assert.strictEqual(aggregated.global.lines.pct, 90);
  assert.strictEqual(aggregated.global.branches.pct, 90);

  // Nested inheritance: lib/core should contain both runtime and renderer (100 + 50 = 150 lines, 95 + 45 = 140 covered)
  assert.strictEqual(aggregated['lib/core'].lines.total, 150);
  assert.strictEqual(aggregated['lib/core'].lines.covered, 140);
  assert.strictEqual(aggregated['lib/core'].lines.pct, 93.33);

  // Specific runtime area
  assert.strictEqual(aggregated['lib/core/runtime'].lines.total, 100);
  assert.strictEqual(aggregated['lib/core/runtime'].lines.covered, 95);
  assert.strictEqual(aggregated['lib/core/runtime'].lines.pct, 95);
  assert.strictEqual(aggregated['lib/core/runtime'].branches.pct, 90);

  // bin area with Windows backslash path
  assert.strictEqual(aggregated.bin.lines.total, 50);
  assert.strictEqual(aggregated.bin.lines.covered, 40);
  assert.strictEqual(aggregated.bin.lines.pct, 80);

  console.log('  ✅ Area aggregation and nested inheritance verified.');
}

// 3. Threshold evaluation (Passing vs Failing)
{
  const mockAggregated = {
    global: {
      lines: { pct: 93.5 },
      branches: { pct: 85.5 },
      functions: { pct: 94.0 },
      statements: { pct: 93.5 },
    },
    'lib/core/runtime': {
      lines: { pct: 92.0 },
      branches: { pct: 80.0 }, // Below floor of 81%
      functions: { pct: 89.0 },
      statements: { pct: 92.0 },
    },
    'lib/core': {
      lines: { pct: 92.5 },
      branches: { pct: 83.0 },
      functions: { pct: 92.0 },
      statements: { pct: 92.5 },
    },
  };

  const thresholdsConfig = {
    global: { lines: 92, branches: 84, functions: 93, statements: 92 },
    areas: {
      'lib/core/runtime': { lines: 91, branches: 81, functions: 88, statements: 91 },
      'lib/core': { lines: 92, branches: 82, functions: 91, statements: 92 },
    },
  };

  const evalFail = evaluateThresholds(mockAggregated, thresholdsConfig);
  assert.strictEqual(evalFail.passed, false);
  assert.strictEqual(evalFail.violations.length, 1);
  assert.deepStrictEqual(evalFail.violations[0], {
    area: 'lib/core/runtime',
    metric: 'branches',
    measured: 80.0,
    floor: 81,
  });

  // Now fix runtime branches to 82%
  mockAggregated['lib/core/runtime'].branches.pct = 82.0;
  const evalPass = evaluateThresholds(mockAggregated, thresholdsConfig);
  assert.strictEqual(evalPass.passed, true);
  assert.strictEqual(evalPass.violations.length, 0);

  console.log('  ✅ Threshold evaluation (isolated per-area failure and passing) verified.');
}

// 4. Delta computation
{
  const current = {
    global: { lines: { pct: 93.5 }, branches: { pct: 85.0 }, functions: { pct: 94.0 }, statements: { pct: 93.5 } },
    'lib/compiler': {
      lines: { pct: 96.0 },
      branches: { pct: 86.0 },
      functions: { pct: 96.0 },
      statements: { pct: 96.0 },
    },
  };

  const baseline = {
    global: { lines: 93.19, branches: 85.07, functions: 94.02, statements: 93.19 },
    'lib/compiler': { lines: 95.83, branches: 86.5, functions: 95.58, statements: 95.83 },
  };

  const deltas = computeDeltas(current, baseline, ['lib/compiler']);

  assert.strictEqual(deltas.global.lines.delta, 0.31);
  assert.strictEqual(deltas.global.lines.formatted, '+0.31%');

  assert.strictEqual(deltas['lib/compiler'].branches.delta, -0.5);
  assert.strictEqual(deltas['lib/compiler'].branches.formatted, '-0.50%');

  console.log('  ✅ Delta computation (+ / - formatted deltas) verified.');
}

// 5. Markdown report formatting
{
  const current = {
    global: {
      lines: { pct: 93.19 },
      branches: { pct: 85.07 },
      functions: { pct: 94.02 },
      statements: { pct: 93.19 },
    },
    'lib/compiler': {
      lines: { pct: 95.83 },
      branches: { pct: 85.89 },
      functions: { pct: 95.58 },
      statements: { pct: 95.83 },
    },
  };

  const thresholds = {
    global: { lines: 92, branches: 84, functions: 93, statements: 92 },
    areas: {
      'lib/compiler': { lines: 95, branches: 85, functions: 95, statements: 95 },
    },
  };

  const deltas = computeDeltas(current, thresholds.baseline || current, ['lib/compiler']);

  const mdPass = formatMarkdownReport({
    currentAggregated: current,
    thresholdsConfig: thresholds,
    deltas,
    violations: [],
    changedFilesCoverage: [
      { file: 'lib/compiler/parser.js', statements: 98.5, branches: 88.0, functions: 100, lines: 98.5 },
    ],
  });

  assert.ok(mdPass.includes('<!-- avenx-coverage-report -->'));
  assert.ok(mdPass.includes('### 📊 Test Coverage & Area Gates Report'));
  assert.ok(mdPass.includes('Coverage Gate Passed'));
  assert.ok(mdPass.includes('`lib/compiler`'));
  assert.ok(mdPass.includes('Changed Source Files Coverage'));
  assert.ok(mdPass.includes('lib/compiler/parser.js'));

  const mdFail = formatMarkdownReport({
    currentAggregated: current,
    thresholdsConfig: thresholds,
    deltas,
    violations: [{ area: 'lib/compiler', metric: 'lines', measured: 94.2, floor: 95 }],
  });

  assert.ok(mdFail.includes('Coverage Gate Failed'));
  assert.ok(mdFail.includes('Threshold Violations'));
  assert.ok(mdFail.includes('measured **94.20%**, floor **95%**'));

  console.log('  ✅ Markdown report generation and sticky marker verified.');
}

console.log('\n✅ All coverage gate unit tests passed successfully!');
