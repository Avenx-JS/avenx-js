import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppModel, AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { addRoutesAndGuards } from '../../lib/compiler/atlas/routes.js';
import { reportAtlasDiagnostics } from '../../lib/compiler/atlas/diagnostics.js';
import { getDiagnostic } from '../../lib/core/diagnostics/catalogue.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-no-entry-'));
const preamble = `import { AvenxApp } from 'avenx-core/runtime';
import Solo from './solo.component.js';
const app = new AvenxApp({target: '#app'});
app.register('Solo', Solo);
`;
function warnings(source, config = {}) {
  fs.writeFileSync(path.join(root, 'main.app.js'), preamble + source);
  const model = new AppModel();
  model.addNode({id: 'component:Solo', name: 'Solo', kind: AtlasNodeKind.COMPONENT});
  model.addNode({id: 'page:Home', name: 'Home', kind: AtlasNodeKind.PAGE});
  addRoutesAndGuards(model, {srcDir: root, rootDir: root, config});
  const captured = [];
  const original = console.warn;
  console.warn = (...args) => captured.push(args.join(' '));
  try { reportAtlasDiagnostics(model, config); }
  finally { console.warn = original; }
  return captured.join('\n');
}
try {
  const output = warnings('// app.mount("Solo");\nconst example = "app.mountPage()";');
  assert.match(output, /AVX_W78/);
  assert.match(output, /Solo/);
  assert.match(output, /Home/);
  assert.doesNotMatch(output, /AVX_W53|\{\d\}/);
  for (const source of [
    'app.mount("Solo");', 'app.mountPage("Home");', 'app.initRouter({"/": "Home"});',
    'if (enabled) app.mount("Solo");', 'app[method]("Solo");',
    'import start from "./start.js"; start(app);', 'import "./bootstrap.js";',
    'const mount = app.mount.bind(app); mount("Solo");',
    'app.initRouter(routes);', 'export {app};',
  ]) assert.doesNotMatch(warnings(source), /AVX_W78/, source);
  assert.doesNotMatch(warnings('start(app);'), /AVX_W53|AVX_W78/);
  assert.equal(warnings('', {warnings: {AVX_W78: 'off'}}), '');
  assert.throws(() => warnings('', {warnings: {AVX_W78: 'error'}}), /AVX_W78/);
  assert.equal(getDiagnostic('w78').name, 'AtlasNoEntryPoint');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
console.log('No-entry diagnostic tests passed.');
