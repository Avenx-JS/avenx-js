/**
 * @file atlasMultiRouterDuplicate.test.js
 * @description AVX_W59 is scoped to the router that declares a pattern.
 *
 * Two routers may each declare a `*` fallback, and a `/home` under a
 * `/widget` prefix is not the host's `/home`: neither arrangement is a
 * duplicate. A pattern repeated inside one `initRouter` call still warns,
 * and so does the same effective (prefix-applied) pattern declared by two
 * routers sharing a prefix.
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
 * Builds a model from a `main.app.js` source and returns the AVX_W59
 * warnings it produced.
 * @param {string} source - The `main.app.js` contents.
 * @returns {string[]} The AVX_W59 warning messages.
 */
function warningsFor(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-multi-router-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'main.app.js'), source);

  const model = new AppModel();
  for (const page of ['Home', 'Widgethome', 'About']) {
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

// Two routers each declaring `*` produce no AVX_W59.
assert.strictEqual(
  warningsFor(
    "const hostApp = new AvenxApp({ target: '#app' });\n" +
      "hostApp.initRouter({ '/': 'Home', '*': 'Home' });\n" +
      "const widgetApp = new AvenxApp({ target: '#widget' });\n" +
      "widgetApp.initRouter({ '/home': 'Widgethome', '*': 'Widgethome' }, { prefix: '/widget' });\n",
  ).length,
  0,
  'two routers with their own `*` fallback must not report AVX_W59',
);

// The same pattern under a prefix is not the host's pattern.
assert.strictEqual(
  warningsFor(
    "const hostApp = new AvenxApp({ target: '#app' });\n" +
      "hostApp.initRouter({ '/home': 'Home' });\n" +
      "const widgetApp = new AvenxApp({ target: '#widget' });\n" +
      "widgetApp.initRouter({ '/home': 'Widgethome' }, { prefix: '/widget' });\n",
  ).length,
  0,
  "'/home' under '/widget' must not collide with the host's '/home'",
);

// A pattern declared twice inside one `initRouter` call still reports.
const withinCall = warningsFor(
  "const app = new AvenxApp({ target: '#app' });\n" + "app.initRouter({ '/home': 'Home', '/home': 'About' });\n",
);
assert.strictEqual(withinCall.length, 1, `expected one AVX_W59 warning, got ${withinCall.length}`);
assert.ok(withinCall[0].includes('"/home"'), 'the warning names the duplicated pattern');

// The same effective prefixed pattern across calls is a genuine conflict.
const acrossCalls = warningsFor(
  "const oneApp = new AvenxApp({ target: '#one' });\n" +
    "oneApp.initRouter({ '/home': 'Home' }, { prefix: '/widget' });\n" +
    "const twoApp = new AvenxApp({ target: '#two' });\n" +
    "twoApp.initRouter({ '/home': 'Widgethome' }, { prefix: '/widget' });\n",
);
assert.strictEqual(acrossCalls.length, 1, `expected one AVX_W59 warning, got ${acrossCalls.length}`);
assert.ok(
  acrossCalls[0].includes('"/widget/home"'),
  'the warning names the effective (prefixed) pattern that collides',
);
