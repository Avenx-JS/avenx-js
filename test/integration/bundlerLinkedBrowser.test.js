import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { bundle } from '../../lib/bundler/index.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-linked-browser-')));
const write = (relative, source) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
};

try {
  write('workspace/package.json', JSON.stringify({ name: 'linked', main: 'index.js', browser: {
    './platform.js': './browser.js',
    './node-only.js': false,
    './nested/platform.js': './browser.js',
    './scoped/platform.js': './browser.js',
  } }));
  write('workspace/index.js', 'import value from "./platform.js"; import "./node-only.js"; import "./nested/use.js"; import "./scoped/use.js"; export default value;');
  write('workspace/platform.js', 'export default "node";');
  write('workspace/browser.js', 'export default "browser";');
  write('workspace/node-only.js', 'globalThis.nodeOnlyLoaded = true;');
  write('workspace/nested/use.js', 'import value from "./platform.js"; globalThis.nested = value;');
  write('workspace/nested/platform.js', 'export default "nested-node";');
  write('workspace/scoped/package.json', JSON.stringify({ browser: { './platform.js': './own.js' } }));
  write('workspace/scoped/use.js', 'import value from "./platform.js"; globalThis.scoped = value;');
  write('workspace/scoped/platform.js', 'export default "scoped-node";');
  write('workspace/scoped/own.js', 'export default "scoped-browser";');
  write('app/package.json', JSON.stringify({ browser: { './local.js': false } }));
  write('app/local.js', 'globalThis.local = true;');
  const entry = write('app/entry.js', 'import value from "linked"; import "./local.js"; globalThis.selected = value;');
  fs.mkdirSync(path.join(root, 'app/node_modules'));
  const link = path.join(root, 'app/node_modules/linked');
  fs.symlinkSync(path.join(root, 'workspace'), link, process.platform === 'win32' ? 'junction' : 'dir');
  const context = {};
  vm.runInNewContext(bundle({ entries: [entry], rootDir: root }).code, context);
  assert.strictEqual(context.selected, 'browser', 'linked packages use their browser remappings');
  assert.strictEqual(context.nodeOnlyLoaded, undefined, 'false mappings stay empty after canonicalization');
  assert.strictEqual(context.nested, 'browser', 'package mappings apply below directories without manifests');
  assert.strictEqual(context.scoped, 'scoped-browser', 'a nested manifest owns its mappings');
  assert.strictEqual(context.local, true, 'application browser mappings remain opt-in through package resolution');
  fs.unlinkSync(link);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Workspace links preserve relative browser remappings and stubs.');
