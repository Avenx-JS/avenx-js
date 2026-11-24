import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { bundle } from '../../lib/bundler/index.js';

const root = path.resolve('virtual-external-static');
for (const statement of [
  'import { value } from "./dep.js";',
  'import { value } from "./barrel.js";',
  'const value = require("./dep.cjs");',
]) {
  const entry = path.join(root, 'entry.js');
  const virtualModules = new Map([
    [entry, `${statement} globalThis.result = value;`],
    [path.join(root, 'dep.js'), 'export const value = 42;'],
    [path.join(root, 'barrel.js'), 'export { value } from "./dep.js";'],
    [path.join(root, 'dep.cjs'), 'module.exports = 42;'],
  ]);
  const result = bundle({ entries: [entry], rootDir: root, virtualModules, externalDynamicImports: ['./'] });
  const context = {};
  vm.runInNewContext(result.code, context);
  assert.equal(context.result, 42, statement);
}
const entry = path.join(root, 'dynamic.js');
const virtualModules = new Map([[entry, 'globalThis.load = () => import("external-package");']]);
const result = bundle({ entries: [entry], rootDir: root, virtualModules, externalDynamicImports: ['external-package'] });
assert.ok(result.code.includes('import("external-package")'), 'external dynamic imports retain their native loader');
console.log('External dynamic import settings preserve static import and require dependencies.');
