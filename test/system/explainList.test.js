/**
 * @file explainList.test.js
 * @description `avenx explain --list` prints every catalogued code, supports
 * its filters, and its --json entries share the single-code payload shape.
 */
import assert from 'assert';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { DIAGNOSTIC_CATALOGUE } from '../../lib/core/diagnostics/catalogue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('Testing avenx explain --list...');

/**
 * Runs `avenx explain` with the given arguments and colors off.
 * @param {string[]} args
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function explain(args) {
  return spawnSync(process.execPath, [cliPath, 'explain', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' },
  });
}

const catalogueCodes = Object.keys(DIAGNOSTIC_CATALOGUE);

const listing = explain(['--list']);
assert.strictEqual(listing.status, 0, listing.stderr);
for (const code of catalogueCodes) {
  assert.ok(listing.stdout.includes(`${code}  `), `--list should print ${code}`);
}
console.log(`  ✅ all ${catalogueCodes.length} catalogue codes appear in --list`);

const categories = [...new Set(catalogueCodes.map((code) => DIAGNOSTIC_CATALOGUE[code].category))];
assert.ok(categories.every((c) => listing.stdout.includes(`${c.toUpperCase()} (`)), 'every category should have a heading');
console.log('  ✅ codes are grouped under their categories');

const json = explain(['--list', '--json']);
assert.strictEqual(json.status, 0, json.stderr);
const entries = JSON.parse(json.stdout);
assert.strictEqual(entries.length, catalogueCodes.length, '--json should emit one entry per code');
const single = JSON.parse(explain(['AVX_W40', '--json']).stdout);
const w40 = entries.find((e) => e.code === 'AVX_W40');
assert.deepStrictEqual(
  Object.keys(w40).filter((k) => k !== 'configurable').sort(),
  Object.keys(single).sort(),
  '--json list entries should share the single-code payload fields',
);
assert.strictEqual(w40.configurable, true, 'AVX_W40 is a configurable warning');
assert.strictEqual(entries.find((e) => e.code === 'AVX_R18').configurable, false, 'runtime errors are not configurable');
console.log('  ✅ --json entries match the single-code shape and report configurable');

const warnings = JSON.parse(explain(['--list', 'W', '--json']).stdout);
assert.ok(warnings.length > 0 && warnings.every((e) => e.code.startsWith('AVX_W')), 'W filters to warning codes');
const errors = JSON.parse(explain(['--list', 'error', '--json']).stdout);
assert.ok(errors.every((e) => e.severity === 'error'), 'severity filter keeps only errors');
const styling = JSON.parse(explain(['--list', '--category', 'styling', '--json']).stdout);
assert.ok(styling.length > 0 && styling.every((e) => e.category === 'styling'), '--category keeps one category');
console.log('  ✅ severity, code-letter and --category filters narrow the list');

const badCategory = explain(['--list', '--category', 'nope']);
assert.strictEqual(badCategory.status, 1, 'an unknown category should exit 1');
assert.ok(/Unknown category 'nope'/.test(badCategory.stderr), badCategory.stderr);
console.log('  ✅ an unknown category is rejected');

const bare = explain([]);
assert.strictEqual(bare.status, 1, 'bare explain should still exit 1');
assert.ok(bare.stderr.includes('avenx explain --list'), 'bare explain should point at --list');
console.log('  ✅ bare explain points at --list');

console.log('✅ avenx explain --list tests passed');
