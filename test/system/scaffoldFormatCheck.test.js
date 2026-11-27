/**
 * @file scaffoldFormatCheck.test.js
 * @description Files written by `avenx init` and `avenx generate` pass `avenx format --check`.
 *
 * `init` writes a `.prettierrc` with `tabWidth: 2`. When the templates were
 * indented with four spaces, a fresh project failed `avenx format --check`, the
 * flag meant for CI, on files the developer had not touched. Scaffolding into a
 * temporary directory and checking keeps the templates and that config in step.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

/**
 * Runs a CLI command in a project directory.
 * @param {string} cwd - The project directory.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, output: string}} The result.
 */
function avenx(cwd, args) {
  const res = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

console.log('🧪 Testing that scaffolded files pass avenx format --check...');

for (const layout of [[], ['--layout', 'routing']]) {
  const name = layout.length ? 'routing layout' : 'default layout';
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-scaffold-format-'));
  try {
    assert.strictEqual(avenx(root, ['init', '--yes', ...layout]).status, 0, `init (${name}) should succeed`);

    const afterInit = avenx(root, ['format', '--check']);
    assert.strictEqual(afterInit.status, 0, `a fresh project (${name}) must pass format --check:\n${afterInit.output}`);

    for (const args of [
      ['generate', 'component', 'Widget', '--with-test'],
      ['generate', 'component', 'Other'],
      ['generate', 'page', 'Contact'],
      ['generate', 'page', 'Profile', '--with-test'],
      ['generate', 'guard', 'admin'],
      ['generate', 'bridge', 'store'],
      ['generate', 'test', 'page', 'Contact'],
      ['generate', 'test', 'guard', 'admin'],
      ['generate', 'test', 'bridge', 'store'],
    ]) {
      const result = avenx(root, [...args, '--force']);
      assert.strictEqual(result.status, 0, `${args.join(' ')} (${name}) should succeed:\n${result.output}`);
    }

    const afterGenerate = avenx(root, ['format', '--check']);
    assert.strictEqual(
      afterGenerate.status,
      0,
      `generated files and the updated main.app.js (${name}) must pass format --check:\n${afterGenerate.output}`,
    );
    console.log(`  ✅ ${name}: init and generate output pass format --check`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('✅ Scaffolded files are formatted');
