/**
 * @file testRunnerConcurrency.test.js
 * @description Verifies bounded worker pool concurrency, --concurrency / -c flag handling,
 * deterministic summary ordering, serial marker isolation, and attributable buffered output.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runnerPath = path.resolve(__dirname, '../run-tests.js');

console.log('🧪 Testing test runner concurrency and bounded worker pool...');

// Helper to run runner with arguments
function runRunner(args, env = {}) {
  return spawnSync(process.execPath, [runnerPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

// 1. Verify --concurrency 1 enables serial mode
{
  console.log('  Testing --concurrency 1 / -c 1 serial mode flag...');
  const res1 = runRunner(['test/fuzz', '--concurrency', '1']);
  assert.strictEqual(res1.status, 0, '--concurrency 1 should exit 0');
  assert.ok(res1.stdout.includes('(serial mode)'), 'should output serial mode notice');

  const res2 = runRunner(['test/fuzz', '-c', '1']);
  assert.strictEqual(res2.status, 0, '-c 1 should exit 0');
  assert.ok(res2.stdout.includes('(serial mode)'), 'should output serial mode notice for -c 1');
  console.log('  ✅ Serial mode flag verified.');
}

// 2. Verify --concurrency 2 sets concurrency to 2
{
  console.log('  Testing --concurrency 2 / -c=2 bounded worker pool...');
  const res = runRunner(['test/fuzz', '--concurrency', '2']);
  assert.strictEqual(res.status, 0, '--concurrency 2 should exit 0');
  assert.ok(res.stdout.includes('(concurrency: 2)'), 'should output concurrency: 2 notice');

  const resEq = runRunner(['test/fuzz', '-c=2']);
  assert.strictEqual(resEq.status, 0, '-c=2 should exit 0');
  assert.ok(resEq.stdout.includes('(concurrency: 2)'), 'should output concurrency: 2 notice for -c=2');
  console.log('  ✅ Concurrency flag verified.');
}

// 3. Verify deterministic summary ordering
{
  console.log('  Testing deterministic alphabetical summary ordering...');
  const res = runRunner(['test/fuzz', '--concurrency', '3']);
  assert.strictEqual(res.status, 0);

  const summaryIndex = res.stdout.indexOf('Test Run Summary');
  assert.ok(summaryIndex !== -1, 'summary exists');
  const summaryText = res.stdout.slice(summaryIndex);

  const passLines = summaryText
    .split('\n')
    .filter((line) => line.includes('PASSED:'))
    .map((line) => line.replace(/.*PASSED:\s*/, '').trim());

  assert.ok(passLines.length >= 2, 'multiple tests executed');
  const sorted = [...passLines].sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(passLines, sorted, 'Summary lines must be sorted deterministically by path');
  console.log('  ✅ Deterministic summary ordering verified.');
}

// 4. Verify @avenx-serial marker isolation
{
  console.log('  Testing @avenx-serial marker isolation and execution...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-runner-test-'));
  const testSubdir = path.join(__dirname, 'scratch-runner-test');
  fs.mkdirSync(testSubdir, { recursive: true });

  const testFile1 = path.join(testSubdir, 'a_parallel.test.js');
  const testFile2 = path.join(testSubdir, 'b_serial.test.js');

  fs.writeFileSync(
    testFile1,
    `console.log('Running parallel test 1');\nprocess.exit(0);\n`,
  );
  fs.writeFileSync(
    testFile2,
    `// @avenx-serial\nconsole.log('Running serial test 2');\nprocess.exit(0);\n`,
  );

  try {
    const res = runRunner([path.relative(path.resolve(__dirname, '../..'), testSubdir), '--concurrency', '2']);
    assert.strictEqual(res.status, 0, 'both tests should pass');
    assert.ok(res.stdout.includes('Running parallel test 1'), 'parallel test output included');
    assert.ok(res.stdout.includes('Running serial test 2'), 'serial test output included');
    assert.ok(res.stdout.includes('PASSED: test/unit/scratch-runner-test/a_parallel.test.js'));
    assert.ok(res.stdout.includes('PASSED: test/unit/scratch-runner-test/b_serial.test.js'));
    console.log('  ✅ @avenx-serial marker handling verified.');
  } finally {
    fs.rmSync(testSubdir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 5. Verify failure reporting and non-zero exit code
{
  console.log('  Testing failure exit code and attributable error output...');
  const testSubdir = path.join(__dirname, 'scratch-runner-fail');
  fs.mkdirSync(testSubdir, { recursive: true });
  const failFile = path.join(testSubdir, 'fail.test.js');
  fs.writeFileSync(
    failFile,
    `process.stderr.write('Deliberate test error\\n', () => process.exit(42));\n`,
  );

  try {
    const res = runRunner([path.relative(path.resolve(__dirname, '../..'), testSubdir), '--concurrency', '2']);
    assert.strictEqual(res.status, 1, 'overall runner should exit 1 on failure');
    assert.ok(res.stdout.includes('FAILED: test/unit/scratch-runner-fail/fail.test.js (Exit code: 42)'));
    assert.ok(res.stdout.includes('Deliberate test error'), 'captured stderr in buffered output');
    console.log('  ✅ Failure reporting and exit code verified.');
  } finally {
    fs.rmSync(testSubdir, { recursive: true, force: true });
  }
}

console.log('🎉 All test runner concurrency tests passed successfully!\n');
