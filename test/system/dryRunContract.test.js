import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
function run(root, args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', GIT_CEILING_DIRECTORIES: path.dirname(root) },
    timeout: 60000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Include directories, bytes and timestamps: checking file existence alone misses
// empty folders, rewrites with identical contents, and edits of existing files.
function snapshot(root, relative = '') {
  const target = path.join(root, relative);
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) {
    return [[relative, 'directory', stat.mtimeMs], ...fs.readdirSync(target).sort()
      .flatMap((name) => snapshot(root, path.join(relative, name)))];
  }
  assert.ok(stat.isFile(), `unexpected fixture entry: ${target}`);
  return [[relative, 'file', stat.size, stat.mtimeMs,
    createHash('sha256').update(fs.readFileSync(target)).digest('hex')]];
}

// Add one row whenever another command advertises --dry-run. The two known
// defects remain visible until their separate fixes land; see #1893 and #1894.
const cases = [
  ...['component', 'page', 'bridge', 'guard'].map((kind) => ({
    name: `generate ${kind}`, args: ['generate', kind, 'Previewed'],
  })),
  ...['component', 'page', 'bridge', 'guard'].map((kind) => ({
    name: `destroy ${kind}`, args: ['destroy', kind, 'Existing', '--force'],
    prepare: (root) => {
      const generated = run(root, ['generate', kind, 'Existing']);
      assert.equal(generated.status, 0, generated.output);
    },
  })),
  {
    name: 'format', args: ['format'],
    prepare: (root) => fs.writeFileSync(path.join(root, 'format-me.js'), 'const  answer=42;\n'),
  },
  {
    name: 'doctor --fix', args: ['doctor', '--fix'], status: 1,
    // The deliberately untracked fixture still fails the Git health check in
    // both modes; scaffold repair must still preview and apply correctly.
    prepare: (root) => fs.unlinkSync(path.join(root, '.gitignore')),
  },
  { name: 'clean', args: ['clean'], skip: '#1894: clean currently deletes output even with --dry-run' },
  { name: 'init in existing project', args: ['init', '--yes'], skip: '#1893: init currently writes even with --dry-run' },
  { name: 'init in fresh sibling', args: ['init', 'fresh', '--yes'], skip: '#1893: init currently writes even with --dry-run' },
];

for (const entry of cases) {
  test(`dry-run filesystem contract: ${entry.name}`, { skip: entry.skip }, () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-dry-run-contract-'));
    try {
      for (const args of [['init', '--yes'], ['build']]) {
        const result = run(root, args);
        assert.equal(result.status, 0, result.output);
      }
      entry.prepare?.(root);
      const before = snapshot(root);
      for (const flag of ['--dry-run', '-d']) {
        const preview = run(root, [...entry.args, flag]);
        assert.equal(preview.status, entry.status ?? 0, preview.output);
        assert.match(preview.output, /dry[- ]run|\bwould\b/i, 'preview must identify its planned actions');
        assert.deepEqual(snapshot(root), before, `${entry.name} ${flag} changed the filesystem`);
      }
      const applied = run(root, entry.args);
      assert.equal(applied.status, entry.status ?? 0, applied.output);
      assert.notDeepEqual(snapshot(root), before, 'the same command without dry-run must perform real work');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
