/**
 * One file must be one module.
 *
 * A module's identity in the graph is the path the resolver returned. When two
 * specifiers reach the same file by different paths -- which is what a symlink
 * does, and what `npm link`, a `file:` dependency, a pnpm store and a workspace
 * all produce -- the bundler used to emit that file twice under two ids.
 *
 * Duplicated source is the visible half of that. The half that breaks
 * applications is state: a module holding a registry, a cache or a counter
 * becomes two registries, and a writer filling one is invisible to a reader
 * consulting the other. `lib/core/renderer/stringRenderer.js` is exactly such a
 * module, and splitting it is what made a component with an IR-refused template
 * render nothing at all.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Resolver } from '../../lib/bundler/resolve.js';

console.log('🧪 Testing bundler module identity across symlinks...');

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-identity-')));

/**
 * Writes a file, creating parent directories.
 * @param {string} relative - Path relative to the fixture root.
 * @param {string} contents - File contents.
 * @returns {string} The absolute path written.
 */
function write(relative, contents) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

try {
  // A package that lives outside the project, the way a linked checkout does.
  write('packages/widget/package.json', JSON.stringify({ name: 'widget', main: 'index.js' }));
  const realTarget = write('packages/widget/index.js', 'export const registry = {};');
  write('app/src/main.js', '');

  // ...and the symlink an install creates for it.
  fs.mkdirSync(path.join(root, 'app/node_modules'), { recursive: true });
  fs.symlinkSync(path.join(root, 'packages/widget'), path.join(root, 'app/node_modules/widget'), process.platform === 'win32' ? 'junction' : 'dir');

  const resolver = new Resolver({});
  const importer = path.join(root, 'app/src/main.js');

  const viaPackage = resolver.resolve('widget', importer);
  const viaRelative = resolver.resolve('../../packages/widget/index.js', importer);

  assert.strictEqual(
    viaPackage,
    viaRelative,
    'the same file reached through a symlinked package and through a relative path must resolve to one module id',
  );
  assert.strictEqual(viaPackage, realTarget, 'the shared id should be the real path of the file');
  console.log('  ✅ a symlinked package resolves to the same id as the real path');

  // The same property one level in: a file the linked package imports itself.
  write('packages/widget/deep/state.js', 'export let value = null;');
  const deepReal = path.join(root, 'packages/widget/deep/state.js');
  const deepViaLink = resolver.resolve('./deep/state.js', path.join(root, 'app/node_modules/widget/index.js'));
  assert.strictEqual(
    deepViaLink,
    deepReal,
    'a relative import made from inside a symlinked package must resolve to the real path too',
  );
  console.log('  ✅ imports made from inside a symlinked package keep the real identity');

  // A resolution that involves no symlink must be unchanged.
  const plain = resolver.resolve('./helpers.js', write('app/src/helpers.js', 'export const x = 1;'));
  assert.ok(typeof plain === 'string', 'ordinary resolution still returns a path');
  console.log('  ✅ ordinary resolution is unaffected');

  console.log('✅ All bundler module identity tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
