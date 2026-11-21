/**
 * @file atlasMultiRouter.test.js
 * @description The Atlas models each router's routes separately.
 *
 * Two routers declaring the same pattern are distinct route nodes, keyed by
 * the hash they actually match (prefix applied): both `*` fallbacks exist,
 * `/home` under `/widget` is `route:/widget/home` rather than the host's
 * `/home`, pages and guards resolve per router, and `avenx impact`/`why`
 * find a prefixed route by its hash.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addRoutesAndGuards } from '../../lib/compiler/atlas/routes.js';
import { AppModel, AtlasEdgeKind, AtlasNodeKind, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { resolveSymbol } from '../../lib/compiler/atlas/query.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-multi-router-model-'));
const srcDir = path.join(root, 'src');
fs.mkdirSync(path.join(srcDir, 'guards'), { recursive: true });
fs.writeFileSync(
  path.join(srcDir, 'guards', 'auth.guard.js'),
  'export default class AuthGuard {\n  canActivate() { return true; }\n}\n',
);
fs.writeFileSync(
  path.join(srcDir, 'main.app.js'),
  "import { AvenxApp } from 'avenx-core/runtime';\n" +
    "const hostApp = new AvenxApp({ target: '#app' });\n" +
    "hostApp.initRouter({ '/': 'Home', '*': 'Home' });\n" +
    "const widgetApp = new AvenxApp({ target: '#widget' });\n" +
    "widgetApp.initRouter({ '/home': { page: 'Widgethome', guards: [AuthGuard] }, '*': 'Widgethome' }, { prefix: '/widget' });\n",
);

const model = new AppModel();
for (const page of ['Home', 'Widgethome']) {
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

const routes = model.nodesOfKind(AtlasNodeKind.ROUTE);
assert.strictEqual(routes.length, 4, `expected 4 route nodes, got ${routes.map((node) => node.id).join(', ')}`);

for (const id of ['route:/', 'route:*', 'route:/widget/home', 'route:/widget/*']) {
  assert.ok(model.hasNode(id), `expected route node ${id}`);
}

const route = (id) => model.getNode(id);
assert.strictEqual(route('route:/widget/home').prefix, '/widget', 'the prefixed route records its prefix');
assert.strictEqual(route('route:/widget/home').router, 'widgetApp', 'the prefixed route records its router');
assert.strictEqual(route('route:/widget/home').pattern, '/home', 'the declared pattern is kept');
assert.strictEqual(route('route:/').prefix, null, 'the host route has no prefix');
assert.strictEqual(route('route:/').router, 'hostApp', 'the host route records its router');

/**
 * The page a route resolves to.
 * @param {string} id - The route node id.
 * @returns {string|null} The target page name.
 */
function targetOf(id) {
  const edge = model.outgoing(id).find((item) => item.kind === AtlasEdgeKind.ROUTES_TO);
  if (!edge) return null;
  return model.getNode(edge.to).name;
}

assert.strictEqual(targetOf('route:/'), 'Home');
assert.strictEqual(targetOf('route:*'), 'Home');
assert.strictEqual(targetOf('route:/widget/home'), 'Widgethome');
assert.strictEqual(targetOf('route:/widget/*'), 'Widgethome');

const guarded = model
  .outgoing('route:/widget/home')
  .filter((edge) => edge.kind === AtlasEdgeKind.GUARDED_BY)
  .map((edge) => model.getNode(edge.to).name);
assert.deepStrictEqual(guarded, ['AuthGuard'], 'the guard attaches to the prefixed route');
assert.strictEqual(
  model.outgoing('route:/').filter((edge) => edge.kind === AtlasEdgeKind.GUARDED_BY).length,
  0,
  'the host route has no guard',
);

assert.deepStrictEqual(
  resolveSymbol(model, '/widget/home').map((node) => node.id),
  ['route:/widget/home'],
  'impact/why find the prefixed route by its hash',
);
assert.deepStrictEqual(
  resolveSymbol(model, '/widget/*').map((node) => node.id),
  ['route:/widget/*'],
  'impact/why find the prefixed wildcard by its hash',
);
assert.deepStrictEqual(
  resolveSymbol(model, '*').map((node) => node.id),
  ['route:*'],
  'the bare wildcard still resolves to the host fallback',
);

const reported = warnings.filter((message) => message.includes(AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN));
assert.strictEqual(reported.length, 0, `expected no AVX_W59 warnings, got ${reported.length}`);
