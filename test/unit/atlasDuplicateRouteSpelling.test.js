/**
 * @file atlasDuplicateRouteSpelling.test.js
 * @description AVX_W59 names both declared route keys as written when two
 * spellings normalize to the same route (e.g. `'/'` and `'#/'`), explains
 * that a leading `#` is not part of the pattern, and still reports which page
 * shadows which when two different pages collide.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addRoutesAndGuards } from '../../lib/compiler/atlas/routes.js';
import { AppModel, AtlasNodeKind, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { DIAGNOSTIC_CATALOGUE } from '../../lib/core/diagnostics/catalogue.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

/**
 * Runs addRoutesAndGuards on a temporary main.app.js and returns AVX_W59 messages.
 * @param {string} source - The main.app.js contents.
 * @param {string[]} pages - Page names to register in the model.
 * @returns {string[]} The reported AVX_W59 warning messages.
 */
function runDuplicateCheck(source, pages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-dup-spelling-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'main.app.js'), source);

  const model = new AppModel();
  for (const page of pages) {
    model.addNode({ id: nodeId(AtlasNodeKind.PAGE, null, page), kind: AtlasNodeKind.PAGE, name: page });
  }

  const warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (message) => warnings.push(String(message));
  try {
    addRoutesAndGuards(model, { srcDir, rootDir: root, config: {} });
  } finally {
    logger.warn = originalWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }

  return warnings.filter((message) => message.includes(AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN));
}

// 1. '/' and '#/' targeting the same page: names both spellings and '#' hint, no self-shadowing.
{
  const reported = runDuplicateCheck(
    "const app = new AvenxApp({ target: '#app' });\napp.initRouter({ '/': 'Home', '#/': 'Home' });\n",
    ['Home'],
  );
  assert.strictEqual(reported.length, 1, `expected 1 AVX_W59 warning, got ${reported.length}`);
  assert.ok(reported[0].includes('"#/"'), `expected "#/" in message: ${reported[0]}`);
  assert.ok(reported[0].includes('"/"'), `expected "/" in message: ${reported[0]}`);
  assert.ok(reported[0].includes('leading "#" is not part of the pattern'), `expected "#" hint: ${reported[0]}`);
  assert.ok(reported[0].includes('Both target page "Home"'), `expected same-page note: ${reported[0]}`);
  assert.ok(!reported[0].includes('shadows "Home"'), `must not say Home shadows Home: ${reported[0]}`);
}

// 2. '/foo' and '#/foo' targeting different pages: names both spellings, '#' hint, and which page wins.
{
  const reported = runDuplicateCheck(
    "const app = new AvenxApp({ target: '#app' });\napp.initRouter({ '/foo': 'Home', '#/foo': 'About' });\n",
    ['Home', 'About'],
  );
  assert.strictEqual(reported.length, 1, `expected 1 AVX_W59 warning, got ${reported.length}`);
  assert.ok(reported[0].includes('"#/foo"'), `expected "#/foo" in message: ${reported[0]}`);
  assert.ok(reported[0].includes('"/foo"'), `expected "/foo" in message: ${reported[0]}`);
  assert.ok(reported[0].includes('leading "#" is not part of the pattern'), `expected "#" hint: ${reported[0]}`);
  assert.ok(reported[0].includes('targeting page "About" shadows "Home"'), `expected shadow info: ${reported[0]}`);
}

// 3. Genuine duplicate with identical key and two different pages: names both pages and which wins.
{
  const reported = runDuplicateCheck(
    "const app = new AvenxApp({ target: '#app' });\napp.initRouter({ '/dup': 'Home', '/dup': 'About' });\n",
    ['Home', 'About'],
  );
  assert.strictEqual(reported.length, 1, `expected 1 AVX_W59 warning, got ${reported.length}`);
  assert.ok(reported[0].includes('Duplicate route pattern "/dup"'), `expected pattern in message: ${reported[0]}`);
  assert.ok(reported[0].includes('targeting page "About" shadows "Home"'), `expected shadow info: ${reported[0]}`);
}

// 4. Diagnostic catalogue mentions hash-prefixed keys as a cause.
{
  const causesText = DIAGNOSTIC_CATALOGUE.AVX_W59.causes.join('\n');
  assert.ok(causesText.includes('#/foo'), 'AVX_W59 catalogue causes must mention hash-prefixed keys');
}

console.log('✅ AVX_W59 duplicate route spelling tests passed!');
