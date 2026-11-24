import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bundle, ResolveError } from '../../lib/bundler/index.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-export-boundary-')));
const write = (relative, source) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
};

try {
  write('node_modules/private/package.json', JSON.stringify({ exports: { '.': './index.js', './blocked': null } }));
  write('node_modules/private/index.js', 'export default "public";');
  write('node_modules/private/secret.js', 'export default "private";');
  write('node_modules/private/blocked.js', 'export default "blocked";');
  for (const specifier of ['private/secret.js', 'private/blocked']) {
    const entry = write('entry.js', `import value from '${specifier}'; globalThis.selected = value;`);
    assert.throws(() => bundle({ entries: [entry], rootDir: root }), (error) => {
      assert.ok(error instanceof ResolveError);
      assert.strictEqual(error.specifier, specifier);
      assert.strictEqual(error.importer, entry);
      assert.ok(error.reason.includes(path.join(root, 'node_modules/private')));
      return true;
    }, specifier);
  }
  // A blocked dependency must not resolve from a different, outer version.
  write('nested/node_modules/private/package.json', JSON.stringify({ exports: { './secret.js': null } }));
  write('node_modules/private/package.json', JSON.stringify({ exports: { './secret.js': './secret.js' } }));
  const nestedEntry = write('nested/entry.js', 'import value from "private/secret.js"; globalThis.selected = value;');
  assert.throws(() => bundle({ entries: [nestedEntry], rootDir: root }), ResolveError);
  // A declared but missing target cannot fall through to the outer version either.
  write('nested/node_modules/private/package.json', JSON.stringify({ exports: { './secret.js': './missing.js' } }));
  assert.throws(() => bundle({ entries: [nestedEntry], rootDir: root }), ResolveError);
  // Legacy packages without exports still support deep imports.
  write('node_modules/legacy/package.json', JSON.stringify({ main: 'index.js' }));
  write('node_modules/legacy/internal.js', 'export default "legacy";');
  const legacyEntry = write('legacy.js', 'import value from "legacy/internal.js"; globalThis.selected = value;');
  assert.ok(bundle({ entries: [legacyEntry], rootDir: root }).code.includes('legacy'));
  // Node treats a top-level null exports field like an absent exports field.
  write('node_modules/legacy/package.json', JSON.stringify({ exports: null }));
  assert.ok(bundle({ entries: [legacyEntry], rootDir: root }).code.includes('legacy'));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Package exports prevent access to private subpaths and outer-package fallback.');
