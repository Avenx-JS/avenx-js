import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-existing-'));
const run = (args) =>
  spawnSync(process.execPath, [bin, 'init', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
const snapshot = (dir, prefix = '') =>
  fs
    .readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) return [prefix + name + '/', ...snapshot(file, prefix + name + '/')];
      return [
        [prefix + name, fs.statSync(file).mtimeMs, createHash('sha256').update(fs.readFileSync(file)).digest('hex')],
      ];
    });

try {
  assert.equal(run(['--yes', '--style', 'sass']).status, 0);
  const before = snapshot(root);
  for (const args of [[], ['--yes']]) {
    const refused = run(args);
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /avenx\.config\.json/);
    assert.match(refused.stderr, /--force/);
    assert.match(refused.stderr, /avenx init <name>/);
    assert.deepEqual(snapshot(root), before);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'avenx.config.json'))).style.preprocessor, 'sass');
  }
  assert.equal(run(['fresh', '--yes']).status, 0, 'a new named child project is still allowed');
  assert.equal(run(['--yes', '--force']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'avenx.config.json'))).style.preprocessor, 'none');
  console.log('existing configurations are preserved unless force is explicit');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
