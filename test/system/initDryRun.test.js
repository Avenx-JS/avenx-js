import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-init-preview-'));
const run = (cwd, args) => {
  const result = spawnSync(process.execPath, [bin, 'init', ...args, '--yes'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
};
const snapshot = (dir, prefix = '') =>
  fs
    .readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      const relative = prefix + name;
      if (fs.statSync(file).isDirectory()) return [relative + '/', ...snapshot(file, relative + '/')];
      return [[relative, fs.statSync(file).mtimeMs, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
    });

try {
  for (const layout of ['blank', 'routing']) {
    const name = `preview-${layout}`;
    const args = [name, '--layout', layout, '--style', 'sass'];
    const before = snapshot(root);
    const output = run(root, [...args, '--dry-run']);
    assert.deepEqual(snapshot(root), before, 'a preview must not create even the target directory');
    assert.match(output, /\[Dry Run\].*No files were written/);
    assert.doesNotMatch(output, /Project initialized successfully/);

    run(root, args);
    const project = path.join(root, name);
    for (const entry of snapshot(project)) {
      const relative = Array.isArray(entry) ? entry[0] : entry.slice(0, -1);
      // Intermediate directories are implied by the recursively created paths.
      if (Array.isArray(entry)) assert.ok(output.includes(relative), `preview must list ${relative}`);
    }
    const existing = snapshot(project);
    const repeat = run(project, ['--style', 'less', '-d']);
    assert.deepEqual(snapshot(project), existing, 'existing files and mtimes must remain unchanged');
    assert.match(repeat, /\[Dry Run\].*[Uu]pdate.*avenx\.config\.json/);
    assert.match(repeat, /No files were written/);
  }
  console.log('init previews match both scaffolds without creating or modifying files');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
