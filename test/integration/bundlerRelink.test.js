import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { bundle } from '../../lib/bundler/index.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-relink-')));
const write = (relative, source) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
};

try {
  for (const name of ['first', 'second']) {
    write(`${name}/package.json`, JSON.stringify({ name: 'linked', main: 'index.js' }));
    write(`${name}/index.js`, `export default '${name}';`);
  }
  const entry = write('app/entry.js', 'import value from "linked"; globalThis.selected = value;');
  fs.mkdirSync(path.join(root, 'app/node_modules'));
  const link = path.join(root, 'app/node_modules/linked');
  fs.symlinkSync(path.join(root, 'first'), link, process.platform === 'win32' ? 'junction' : 'dir');
  const run = () => {
    const context = {};
    vm.runInNewContext(bundle({ entries: [entry], rootDir: root }).code, context);
    return context.selected;
  };
  assert.strictEqual(run(), 'first');
  fs.unlinkSync(link);
  fs.symlinkSync(path.join(root, 'second'), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.strictEqual(run(), 'second', 'a new build resolves the new link target');
  assert.strictEqual(run(), 'second', 'unchanged links still resolve consistently');
  fs.unlinkSync(link);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Rebuilding after relinking a package uses the new package source.');
