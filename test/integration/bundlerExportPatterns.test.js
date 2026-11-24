import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { bundle } from '../../lib/bundler/index.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-export-patterns-')));
const write = (relative, source) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
};

try {
  write('node_modules/patterns/package.json', JSON.stringify({ exports: {
    './*': './generic/*.js',
    './features/*': './specific/*.js',
    './features/*.js': './suffix/*.js',
    './repeat/*': './repeated/*/value-*.js',
    './features/exact': './exact.js',
  } }));
  write('node_modules/patterns/generic/features/view.js', 'export default "generic";');
  write('node_modules/patterns/specific/view.js', 'export default "specific";');
  write('node_modules/patterns/generic/features/view.js.js', 'export default "generic-suffix";');
  write('node_modules/patterns/specific/view.js.js', 'export default "specific-suffix";');
  write('node_modules/patterns/suffix/view.js', 'export default "suffix";');
  write('node_modules/patterns/repeated/name/value-name.js', 'export default "repeated";');
  write('node_modules/patterns/repeated/$&/value-$&.js', 'export default "literal-dollar";');
  write('node_modules/patterns/exact.js', 'export default "exact";');
  for (const [specifier, expected] of [
    ['patterns/features/view', 'specific'],
    ['patterns/features/view.js', 'suffix'],
    ['patterns/repeat/name', 'repeated'],
    ['patterns/repeat/$&', 'literal-dollar'],
    ['patterns/features/exact', 'exact'],
  ]) {
    const entry = write('entry.js', `import value from '${specifier}'; globalThis.selected = value;`);
    const result = bundle({ entries: [entry], rootDir: root });
    const context = {};
    vm.runInNewContext(result.code, context);
    assert.strictEqual(context.selected, expected, specifier);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Package export patterns select the most specific target and replace every wildcard.');
