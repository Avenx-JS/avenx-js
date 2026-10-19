/**
 * @file persistenceExampleStyles.test.js
 * @description The `@avenx/persistence` example must build without AVX_W49
 * and must ship its stylesheet.
 *
 * Its todo-list stylesheet was written as CSS selectors (`.card { ... }`). An
 * Avenx style block is a named block, so every rule was declared under a name
 * no `@css` directive could reach: the build warned AVX_W49 for each of the
 * template's blocks and emitted a bundle.css holding only the header.
 *
 * This builds a copy of the example and asserts both halves: the build is
 * silent, and the emitted bundle.css carries the example's rules.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '../..');
const BIN_PATH = path.join(REPO_ROOT, 'bin/avenx.js');
const EXAMPLE_DIR = path.join(REPO_ROOT, 'plugins/avenx-persistence/example');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'avenx-persistence-example-'));

try {
  console.log('🧪 Testing the @avenx/persistence example build...');

  const project = path.join(root, 'example');
  fs.cpSync(EXAMPLE_DIR, project, { recursive: true });

  const res = spawnSync(process.execPath, [BIN_PATH, 'build'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const output = (res.stdout || '') + (res.stderr || '');
  assert.strictEqual(res.status, 0, `example build failed:\n${output}`);

  const warnings = output.match(/^\[AVX_W49\].*$/gm) || [];
  assert.strictEqual(
    warnings.length,
    0,
    `example emitted ${warnings.length} AVX_W49 warning(s):\n${warnings.join('\n')}`,
  );
  console.log('  ✅ the example builds without AVX_W49');

  const css = fs.readFileSync(path.join(project, 'dist', 'bundle.css'), 'utf8');
  assert.ok(
    /max-width:\s*32rem/.test(css) && /font-size:\s*1\.5rem/.test(css),
    `bundle.css must contain the example's rules, not only the header. Got:\n${css}`,
  );
  console.log('  ✅ bundle.css contains the example\'s rules');

  console.log('✅ persistence example style tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
