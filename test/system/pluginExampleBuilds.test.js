/**
 * @file pluginExampleBuilds.test.js
 * @description Every official Avenx plugin example must build cleanly with
 * zero `AVX_W` or `AVX_C` diagnostics, and its `'/'` route must match both
 * an empty hash (`""`) and `"#/"`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '../..');
const BIN_PATH = path.join(REPO_ROOT, 'bin/avenx.js');

const EXAMPLES = [
  'plugins/avenx-i18n/example',
  'plugins/avenx-charts/example',
  'plugins/avenx-persistence/example',
];

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-plugin-examples-'));

try {
  for (const rel of EXAMPLES) {
    const srcDir = path.join(REPO_ROOT, rel);
    const project = path.join(root, path.basename(path.dirname(rel)));
    fs.cpSync(srcDir, project, { recursive: true });

    const res = spawnSync(process.execPath, [BIN_PATH, 'build'], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    const output = (res.stdout || '') + (res.stderr || '');
    assert.strictEqual(res.status, 0, `${rel} build failed:\n${output}`);

    const diagnostics = output.match(/^\[AVX_[WC]\d+\].*$/gm) || [];
    assert.strictEqual(
      diagnostics.length,
      0,
      `${rel} emitted ${diagnostics.length} diagnostic(s):\n${diagnostics.join('\n')}`,
    );
    console.log(`  ✅ ${rel} builds with 0 diagnostics`);
  }

  // Verify empty hash and '#/' both normalize to '#/' and match '/'
  assert.strictEqual(RouteMatcher.normalizeHash(''), '#/');
  assert.strictEqual(RouteMatcher.normalizeHash('#/'), '#/');
  assert.strictEqual(RouteMatcher.matchRoute({ '/': 'Storefront' }, '')?.matchedRoute?.definition, 'Storefront');
  assert.strictEqual(RouteMatcher.matchRoute({ '/': 'Storefront' }, '#/')?.matchedRoute?.definition, 'Storefront');
  console.log('  ✅ empty hash and "#/" both match the "/" route');

  console.log('✅ All plugin example build tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
