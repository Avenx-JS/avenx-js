import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '../..');
const SIZE_CHECK = path.join(rootDir, 'scripts', 'size-check.js');

/**
 * Runs `scripts/size-check.js --action build` from a fresh working directory,
 * which is where the script creates its temporary project.
 * @param {string} cwd - Working directory for the run.
 * @param {string} repo - Value for --repo.
 * @returns {{status: number|null, output: string}} The result.
 */
function runBuildAction(cwd, repo) {
  const result = spawnSync(
    process.execPath,
    [SIZE_CHECK, '--action', 'build', '--repo', repo, '--out', path.join(cwd, 'sizes.json')],
    { cwd, encoding: 'utf8' },
  );
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

/**
 * Lists the temporary projects a run left in the working directory.
 * @param {string} cwd - Working directory of the run.
 * @returns {string[]} Names of the leftover directories.
 */
function leftovers(cwd) {
  return fs.readdirSync(cwd).filter((entry) => entry.startsWith('temp-size-check-'));
}

/**
 * A failed build step fails the command and removes the temporary project.
 */
function testFailedBuildCleansUp() {
  console.log('🧪 Testing that a failed size check leaves no temporary project...');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-size-check-'));
  try {
    // No bin/avenx.js under this path, so the build step throws.
    const result = runBuildAction(cwd, path.join(cwd, 'no-such-repo'));
    assert.strictEqual(result.status, 1, `a failed size check must exit 1, got ${result.status}`);
    assert.ok(result.output.includes('CLI not found'), 'the failure is reported');
    assert.deepStrictEqual(leftovers(cwd), [], 'no temp-size-check-* directory survives a failure');
    assert.ok(!fs.existsSync(path.join(cwd, 'sizes.json')), 'a failed run writes no metrics');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  console.log('  ✅ A failed size check exits 1 and cleans up.');
}

/**
 * A successful size check still writes its metrics and leaves nothing behind.
 */
function testSuccessfulBuildCleansUp() {
  console.log('🧪 Testing that a successful size check leaves no temporary project...');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-size-check-'));
  try {
    const result = runBuildAction(cwd, rootDir);
    assert.strictEqual(result.status, 0, `a size check must exit 0, got ${result.status}\n${result.output}`);
    const metrics = JSON.parse(fs.readFileSync(path.join(cwd, 'sizes.json'), 'utf8'));
    assert.ok(metrics.total.minified > 0, 'the metrics are written');
    assert.deepStrictEqual(leftovers(cwd), [], 'no temp-size-check-* directory survives a success');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  console.log('  ✅ A successful size check writes metrics and cleans up.');
}

/**
 * Runs the suite.
 */
function run() {
  testFailedBuildCleansUp();
  testSuccessfulBuildCleansUp();
  console.log('\n✅ All size-check cleanup tests passed!');
}

try {
  run();
} catch (error) {
  console.error('❌ Size-check cleanup tests failed:', error);
  process.exit(1);
}
