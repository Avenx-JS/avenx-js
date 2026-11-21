/**
 * @file atlasDuplicateRoutePrefixed.test.js
 * @description Two routers may each declare a `*` fallback, and the same
 * pattern may appear under different prefixes, without AVX_W59 firing: the
 * duplicate check is scoped by the router's prefix, because route patterns
 * are written relative to it. A pattern duplicated within one `initRouter`
 * call, or the same effective (prefixed) pattern across two calls, still
 * reports AVX_W59.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addRoutesAndGuards } from '../../lib/compiler/atlas/routes.js';
import { AppModel, AtlasNodeKind, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

/**
 * Runs addRoutesAndGuards against a main.app.js source and returns the
 * AVX_W59 warnings it reported.
 * @param {string} source - The main.app.js contents.
 * @param {Array<string>} pages - Page names to register in the model.
 * @returns {Array<string>} The reported AVX_W59 warning messages.
 */
function runFixture(source, pages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-dup-route-prefixed-'));
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

// 1. The issue's reproduction: a host router and a prefixed widget router
// each declare a `*` fallback. Nothing is shadowed, so no AVX_W59.
assert.strictEqual(
  runFixture(
    "const hostApp = new AvenxApp({ target: '#app' });\n"
      + "hostApp.initRouter({ '/': 'Home', '*': 'Home' });\n"
      + "const widgetApp = new AvenxApp({ target: '#widget' });\n"
      + "widgetApp.initRouter({ '/home': 'WidgetHome', '*': 'WidgetHome' }, { prefix: '/widget' });\n",
    ['Home', 'WidgetHome'],
  ).length,
  0,
  'two routers each declaring * must not report AVX_W59',
);

// 2. The same pattern under different prefixes is not a duplicate either.
assert.strictEqual(
  runFixture(
    "const hostApp = new AvenxApp({ target: '#app' });\n"
      + "hostApp.initRouter({ '/home': 'Home' });\n"
      + "const widgetApp = new AvenxApp({ target: '#widget' });\n"
      + "widgetApp.initRouter({ '/home': 'WidgetHome' }, { prefix: '/widget' });\n",
    ['Home', 'WidgetHome'],
  ).length,
  0,
  "'/home' under /widget and a host '/home' must not report AVX_W59",
);

// 3. A pattern declared twice inside one initRouter call still reports.
const withinCall = runFixture(
  "const app = new AvenxApp({ target: '#app' });\napp.initRouter({ '/dup': 'Home', '/dup': 'About' });\n",
  ['Home', 'About'],
);
assert.strictEqual(withinCall.length, 1, `expected one ${AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN} warning, got ${withinCall.length}`);
assert.ok(withinCall[0].includes('"/dup"'), 'the warning must name the duplicated pattern');

// 4. The same effective prefixed pattern across two calls still reports.
const acrossCalls = runFixture(
  "const first = new AvenxApp({ target: '#a' });\n"
    + "first.initRouter({ '/home': 'Home' }, { prefix: '/widget' });\n"
    + "const second = new AvenxApp({ target: '#b' });\n"
    + "second.initRouter({ '/home': 'About' }, { prefix: '/widget' });\n",
  ['Home', 'About'],
);
assert.strictEqual(acrossCalls.length, 1, `expected one ${AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN} warning, got ${acrossCalls.length}`);
assert.ok(acrossCalls[0].includes('"/widget/home"'), 'the warning must name the effective prefixed pattern');
