/**
 * @file cleanDryRun.test.js
 * @description Cleaning previews must preserve the build output and project files.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const BIN_PATH = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-clean-dry-run-'));

/**
 * Runs the CLI in an isolated project.
 * @param {string} cwd - Project directory.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number|null, output: string}} The result.
 */
function avenx(cwd, args) {
  const result = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 30000,
  });
  assert.strictEqual(result.error, undefined, `CLI should finish: ${result.error}`);
  return { status: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

/**
 * Captures file contents, modification times and empty directories.
 * @param {string} directory - Directory to snapshot.
 * @returns {object[]} The directory entries.
 */
function snapshotTree(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const file = path.join(directory, entry.name);
      const stat = fs.statSync(file);
      return {
        name: entry.name,
        mtimeMs: stat.mtimeMs,
        contents: entry.isDirectory() ? snapshotTree(file) : fs.readFileSync(file),
      };
    });
}

try {
  console.log('🧪 Testing clean --dry-run...');

  for (const distDir of ['dist', 'build/output files']) {
    const project = fs.mkdtempSync(path.join(root, 'project-'));
    const init = avenx(project, ['init', '-y']);
    assert.strictEqual(init.status, 0, init.output);
    if (distDir !== 'dist') {
      fs.writeFileSync(path.join(project, 'avenx.config.json'), JSON.stringify({ distDir }));
    }
    const build = avenx(project, ['build']);
    assert.strictEqual(build.status, 0, build.output);
    const outputDir = path.join(project, distDir);
    const bundle = path.join(outputDir, 'bundle.js');
    assert.ok(fs.existsSync(bundle), 'the fixture must contain a real built bundle');
    const before = snapshotTree(project);

    for (const flag of ['--dry-run', '-d']) {
      const preview = avenx(project, ['clean', flag]);
      assert.strictEqual(preview.status, 0, preview.output);
      assert.ok(fs.existsSync(bundle), `${flag} must preserve the built bundle`);
      assert.deepStrictEqual(snapshotTree(project), before, `${flag} must not modify project files`);
      assert.ok(preview.output.includes(`[DRY-RUN] Would delete: ${distDir}`), preview.output);
      assert.match(preview.output, /No files were deleted or modified/, preview.output);
      assert.doesNotMatch(preview.output, /Clean complete/, 'a preview must not claim to have cleaned');
    }

    const clean = avenx(project, ['clean']);
    assert.strictEqual(clean.status, 0, clean.output);
    assert.ok(!fs.existsSync(outputDir), 'clean without a flag must still remove the output');
    assert.match(clean.output, /Clean complete/, clean.output);
    assert.ok(fs.existsSync(path.join(project, 'src/main.app.js')), 'source files must remain');

    const afterClean = snapshotTree(project);
    const missing = avenx(project, ['clean', '--dry-run']);
    assert.strictEqual(missing.status, 0, missing.output);
    assert.match(missing.output, /Nothing to clean/, missing.output);
    assert.match(missing.output, /No files were deleted or modified/, missing.output);
    assert.deepStrictEqual(snapshotTree(project), afterClean, 'a missing output directory stays missing');

    fs.mkdirSync(outputDir, { recursive: true });
    const empty = avenx(project, ['clean', '--dry-run']);
    assert.strictEqual(empty.status, 0, empty.output);
    assert.ok(fs.existsSync(outputDir), 'an empty output directory must also survive a preview');
    console.log(`  ✅ ${distDir}: both preview flags preserve output, normal clean still deletes it`);
  }

  console.log('✅ clean --dry-run tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
