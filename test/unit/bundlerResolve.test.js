/**
 * Resolution is where the old build's worst behaviour lived: every specifier
 * that was not the runtime entry was deleted, so an unresolvable import and a
 * perfectly good one were treated identically — as nothing.
 *
 * The invariant these tests hold to is the inverse of that: every specifier
 * either resolves to a module the bundler can read, or raises a ResolveError
 * naming the specifier and the importer. There is no third outcome.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Resolver, ResolveError, isRuntimeSpecifier, AVENX_PACKAGE_ROOT } from '../../lib/bundler/resolve.js';

console.log('🧪 Testing bundler module resolution...');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-resolve-'));

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
  // ------------------------------------------------------------- fixtures ---
  write('src/main.js', '');
  write('src/helpers/format.js', 'export const format = () => {};');
  write('src/helpers/index.js', 'export * from "./format.js";');

  write('node_modules/plain/package.json', JSON.stringify({ name: 'plain', main: 'lib/main.js' }));
  write('node_modules/plain/lib/main.js', 'module.exports = 1;');

  write(
    'node_modules/modern/package.json',
    JSON.stringify({
      name: 'modern',
      main: 'cjs/index.js',
      module: 'esm/index.js',
      exports: { '.': { browser: './browser/index.js', import: './esm/index.js', default: './cjs/index.js' }, './sub': './esm/sub.js' },
    }),
  );
  write('node_modules/modern/browser/index.js', 'export default 1;');
  write('node_modules/modern/esm/index.js', 'export default 2;');
  write('node_modules/modern/cjs/index.js', 'module.exports = 3;');
  write('node_modules/modern/esm/sub.js', 'export default 4;');

  write(
    'node_modules/@scope/pkg/package.json',
    JSON.stringify({ name: '@scope/pkg', module: 'index.mjs' }),
  );
  write('node_modules/@scope/pkg/index.mjs', 'export default 5;');

  write(
    'node_modules/stubbed/package.json',
    JSON.stringify({ name: 'stubbed', main: 'index.js', browser: { './node.js': false } }),
  );
  write('node_modules/stubbed/index.js', 'export { x } from "./node.js";');
  write('node_modules/stubbed/node.js', 'export const x = require("fs");');

  write('node_modules/patterned/package.json', JSON.stringify({ name: 'patterned', exports: { './*': './dist/*.js' } }));
  write('node_modules/patterned/dist/thing.js', 'export default 6;');

  const importer = path.join(root, 'src/main.js');
  const resolver = new Resolver();

  // --------------------------------------------------------------- runtime ---
  {
    assert.equal(isRuntimeSpecifier('avenx-core'), true);
    assert.equal(isRuntimeSpecifier('avenx-core/runtime'), true);
    assert.equal(isRuntimeSpecifier('avenx-core/core'), true);
    assert.equal(isRuntimeSpecifier('avenx-core/testing'), false, 'testing is a separate entry, not the runtime');

    const runtime = resolver.resolve('avenx-core/runtime', importer);
    assert.equal(runtime, path.join(AVENX_PACKAGE_ROOT, 'lib', 'core', 'index.js'));
    assert.ok(fs.existsSync(runtime), 'the runtime entry resolves to a real module');
    console.log('  ✅ The runtime resolves to a module, not a prebuilt blob');
  }

  // ------------------------------------------------------------ local paths ---
  {
    assert.equal(resolver.resolve('./helpers/format.js', importer), path.join(root, 'src/helpers/format.js'));
    assert.equal(resolver.resolve('./helpers/format', importer), path.join(root, 'src/helpers/format.js'), 'extension is optional');
    assert.equal(resolver.resolve('./helpers', importer), path.join(root, 'src/helpers/index.js'), 'a directory resolves to its index');
    console.log('  ✅ Local paths resolve directly, by extension and by directory index');
  }

  // ------------------------------------------------------------ npm packages ---
  {
    assert.equal(resolver.resolve('plain', importer), path.join(root, 'node_modules/plain/lib/main.js'), 'main');
    assert.equal(
      resolver.resolve('modern', importer),
      path.join(root, 'node_modules/modern/browser/index.js'),
      'the browser condition wins over import and default',
    );
    assert.equal(resolver.resolve('modern/sub', importer), path.join(root, 'node_modules/modern/esm/sub.js'), 'subpath exports');
    assert.equal(resolver.resolve('@scope/pkg', importer), path.join(root, 'node_modules/@scope/pkg/index.mjs'), 'scoped, module field');
    assert.equal(resolver.resolve('patterned/thing', importer), path.join(root, 'node_modules/patterned/dist/thing.js'), 'pattern exports');
    console.log('  ✅ Package resolution honours exports, browser, module and main');
  }

  {
    // A package that declares one of its own files empty in a browser must not
    // have the Node version pulled into the bundle.
    const stub = resolver.resolve('stubbed', importer);
    const inner = resolver.resolve('./node.js', stub);
    assert.ok(resolver.isVirtual(inner), 'a browser-stubbed module resolves to an empty virtual module');
    assert.ok(resolver.virtualModules.get(inner).includes('export default {}'), 'and that module is empty');
    console.log('  ✅ A package browser-stubbing its own Node module is honoured');
  }

  // -------------------------------------------------------- virtual modules ---
  {
    const virtualId = path.join(root, 'src/pages/home.page.js');
    const withVirtual = new Resolver({ virtualModules: new Map([[virtualId, 'export default class Home {}']]) });
    assert.equal(withVirtual.resolve('./pages/home.page.js', importer), virtualId, 'by full id');
    assert.equal(withVirtual.resolve('./pages/home', importer), virtualId, 'compiled output wins over the raw template file');
    console.log('  ✅ Compiled component and page modules resolve ahead of their source files');
  }

  // ---------------------------------------------------------------- failures ---
  {
    assert.throws(
      () => resolver.resolve('does-not-exist', importer),
      (error) => error instanceof ResolveError && /no package named "does-not-exist"/.test(error.message),
      'a missing package is an error, never a silent drop',
    );

    assert.throws(
      () => resolver.resolve('./nope.js', importer),
      (error) => error instanceof ResolveError && /no file exists/.test(error.message),
      'a missing local module is an error',
    );

    for (const builtin of ['fs', 'node:path', 'child_process']) {
      assert.throws(
        () => resolver.resolve(builtin, importer),
        (error) => error instanceof ResolveError && /Node\.js builtin/.test(error.message),
        `${builtin} must be rejected for a browser bundle`,
      );
    }

    const error = (() => {
      try {
        resolver.resolve('missing-thing', importer);
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();
    assert.equal(error.specifier, 'missing-thing');
    assert.equal(error.importer, importer, 'the error names who asked for it');
    console.log('  ✅ Every unresolvable specifier fails with the specifier and its importer');
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('✅ All bundler resolution tests passed!');
