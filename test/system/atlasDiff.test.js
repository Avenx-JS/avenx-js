/**
 * @file atlasDiff.test.js
 * @description System tests for `avenx atlas diff`.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');
const fixture = path.join(repoRoot, 'test/fixtures/atlas-app');
const golden = path.join(repoRoot, 'test/fixtures/atlas-app.golden.json');

console.log('🧪 Testing the avenx atlas diff CLI...');

/**
 * Runs the CLI in a project directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} [cwd] - Working directory.
 * @returns {{status: number, stdout: string, stderr: string}} The result.
 */
function avenx(args, cwd = fixture) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

/**
 * Runs the CLI and parses its JSON output.
 * @param {string[]} args - CLI arguments.
 * @param {string} [cwd] - Working directory.
 * @returns {object} The parsed JSON document.
 */
function avenxJson(args, cwd = fixture) {
  const result = avenx(args, cwd);
  const start = result.stdout.indexOf('{');
  assert.ok(start !== -1, `expected JSON from "avenx ${args.join(' ')}", got:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.slice(start));
}

const tempDirs = [];

try {
  // ── 1. Unchanged project reports 0 differences and exits 0 ──────────────
  {
    const result = avenx(['atlas', 'diff', golden]);
    assert.strictEqual(result.status, 0, `avenx atlas diff failed:\n${result.stderr}`);
    assert.ok(result.stdout.includes('No differences.'), 'unchanged model reports No differences.');
  }

  // ── 2. Unchanged project with --fail-on-change still exits 0 ────────────
  {
    const result = avenx(['atlas', 'diff', golden, '--fail-on-change']);
    assert.strictEqual(result.status, 0, `--fail-on-change should exit 0 when no diffs:\n${result.stderr}`);
    assert.ok(result.stdout.includes('No differences.'));
  }

  // ── 3. Unchanged project with --json ────────────────────────────────────
  {
    const payload = avenxJson(['atlas', 'diff', golden, '--json']);
    assert.strictEqual(payload.differences, 0);
    assert.strictEqual(payload.summary.total, 0);
    assert.strictEqual(payload.summary.nodes, 0);
    assert.strictEqual(payload.summary.edges, 0);
    assert.strictEqual(payload.summary.routes, 0);
    assert.strictEqual(payload.summary.unresolved, 0);
    assert.deepStrictEqual(payload.nodes.added, []);
    assert.deepStrictEqual(payload.nodes.removed, []);
    assert.deepStrictEqual(payload.nodes.modified, []);
  }

  // ── 4. Missing baseline file diagnostic (no stack trace, exits 1) ────────
  {
    const result = avenx(['atlas', 'diff', 'non-existent-baseline.atlas.json']);
    assert.strictEqual(result.status, 1, 'missing file must exit 1');
    assert.ok(result.stderr.includes('❌ Baseline file not found: non-existent-baseline.atlas.json'));
    assert.ok(!result.stderr.includes('at '), 'must not print a stack trace');
  }

  // ── 5. Unparseable JSON diagnostic (no stack trace, exits 1) ─────────────
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-diff-bad-json-'));
    tempDirs.push(tempDir);
    const badJsonFile = path.join(tempDir, 'invalid.atlas.json');
    fs.writeFileSync(badJsonFile, 'not-json{{{', 'utf8');

    const result = avenx(['atlas', 'diff', badJsonFile]);
    assert.strictEqual(result.status, 1, 'unparseable JSON must exit 1');
    assert.ok(result.stderr.includes('❌ Failed to parse baseline:'));
    assert.ok(!result.stderr.includes('at '), 'must not print a stack trace');
  }

  // ── 6. Version skew diagnostic (no stack trace, exits 1) ─────────────────
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-diff-version-skew-'));
    tempDirs.push(tempDir);
    const skewFile = path.join(tempDir, 'skew.atlas.json');
    fs.writeFileSync(skewFile, JSON.stringify({ atlasVersion: 999, nodes: [] }), 'utf8');

    const result = avenx(['atlas', 'diff', skewFile]);
    assert.strictEqual(result.status, 1, 'mismatched atlasVersion must exit 1');
    assert.ok(result.stderr.includes('❌ Baseline atlasVersion (999) does not match current version'));
    assert.ok(result.stderr.includes('Please regenerate the baseline artifact.'));
    assert.ok(!result.stderr.includes('at '), 'must not print a stack trace');
  }

  // ── 7. No baseline argument given ────────────────────────────────────────
  {
    const result = avenx(['atlas', 'diff']);
    assert.strictEqual(result.status, 1, 'missing argument must exit 1');
    assert.ok(result.stderr.includes('Usage: avenx atlas diff <baseline.atlas.json>'));
  }

  // ── 8. Change a component in a fixture copy, assert reported difference ─
  {
    const tempApp = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-diff-app-'));
    tempDirs.push(tempApp);
    fs.cpSync(fixture, tempApp, { recursive: true });

    // Step A: Save baseline artifact
    const baseline = avenxJson(['atlas', '--json'], tempApp);
    const baselinePath = path.join(tempApp, '.atlas-baseline.json');
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2), 'utf8');

    // Step B: Verify 0 differences initially
    const initialCheck = avenx(['atlas', 'diff', '.atlas-baseline.json'], tempApp);
    assert.strictEqual(initialCheck.status, 0);
    assert.ok(initialCheck.stdout.includes('No differences.'));

    // Step C: Modify cart-summary component: add a new state key `discount`
    const compFile = path.join(tempApp, 'src/components/cart-summary/cart-summary.component.js');
    const compSource = fs.readFileSync(compFile, 'utf8');
    const modifiedSource = compSource.replace('<state open="false" />', '<state open="false" discount="0" />');
    assert.notStrictEqual(compSource, modifiedSource, 'replacement must succeed');
    fs.writeFileSync(compFile, modifiedSource, 'utf8');

    // Step D: Run diff without --fail-on-change: should exit 0 and report the added node and edge
    const diffResult = avenx(['atlas', 'diff', '.atlas-baseline.json'], tempApp);
    assert.strictEqual(diffResult.status, 0, 'diff exits 0 without --fail-on-change');
    assert.ok(diffResult.stdout.includes('Nodes'), 'reports Nodes category');
    assert.ok(diffResult.stdout.includes('+ state:component:CartSummary.discount'), 'reports added state key');
    assert.ok(diffResult.stdout.includes('src/components/cart-summary/cart-summary.component.js'), 'reports location');
    assert.ok(diffResult.stdout.includes('Edges'), 'reports Edges category');
    assert.ok(
      diffResult.stdout.includes('+ component:CartSummary declares state:component:CartSummary.discount certain'),
      'reports added declares edge',
    );
    assert.ok(diffResult.stdout.includes('2 differences (1 node, 1 edge)'), 'reports summary');

    // Step E: Run diff with --fail-on-change: should exit 1 because of changes
    const failResult = avenx(['atlas', 'diff', '.atlas-baseline.json', '--fail-on-change'], tempApp);
    assert.strictEqual(failResult.status, 1, '--fail-on-change must exit 1 when differences exist');

    // Step F: Run diff with --json: verify structured payload
    const jsonResult = avenxJson(['atlas', 'diff', '.atlas-baseline.json', '--json'], tempApp);
    assert.strictEqual(jsonResult.differences, 2);
    assert.strictEqual(jsonResult.summary.total, 2);
    assert.strictEqual(jsonResult.summary.nodes, 1);
    assert.strictEqual(jsonResult.summary.edges, 1);
    assert.ok(
      jsonResult.nodes.added.some((n) => n.id === 'state:component:CartSummary.discount'),
      'added node in structured json',
    );
    assert.ok(
      jsonResult.edges.added.some(
        (e) => e.from === 'component:CartSummary' && e.to === 'state:component:CartSummary.discount',
      ),
      'added edge in structured json',
    );
  }

  console.log('✅ All avenx atlas diff system tests passed!');
} finally {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
