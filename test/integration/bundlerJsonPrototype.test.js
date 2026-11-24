import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bundle } from '../../lib/bundler/index.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-json-proto-')));
try {
  const json = '{"__proto__":{"inherited":true},"nested":[{"__proto__":null}],"text":"quotes \\" and \\\\ slash"}';
  fs.writeFileSync(path.join(root, 'data.json'), json);
  const entry = path.join(root, 'entry.js');
  fs.writeFileSync(entry, 'import data from "./data.json"; globalThis.result = [Object.hasOwn(data, "__proto__"), data.inherited, JSON.stringify(data), Object.getPrototypeOf(data.nested[0]) === Object.prototype];');
  for (const minify of [false, true]) {
    const context = {};
    vm.runInNewContext(bundle({ entries: [entry], rootDir: root, minify }).code, context);
    assert.equal(context.result[0], true, 'JSON __proto__ remains an own data property');
    assert.equal(context.result[1], undefined, 'JSON data must not alter the object prototype');
    assert.equal(context.result[2], JSON.stringify(JSON.parse(json)));
    assert.equal(context.result[3], true, 'nested objects retain ordinary prototypes');
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Bundled JSON retains prototype-named keys as data.');
