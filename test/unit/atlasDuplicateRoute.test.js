/**
 * @file atlasDuplicateRoute.test.js
 * @description A route pattern declared twice keeps only the last target in the
 * Atlas, and reports AVX_W59 through the normal warning path.
 *
 * `'': 'Home'` and `'/': 'About'` normalize to the same route. The router is
 * last-wins, so the model must keep one ROUTES_TO edge, and the duplicate must
 * be logged rather than silently dropped.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addRoutesAndGuards } from '../../lib/compiler/atlas/routes.js';
import { AppModel, AtlasEdgeKind, AtlasNodeKind, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-dup-route-'));
const srcDir = path.join(root, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(
  path.join(srcDir, 'main.app.js'),
  "const app = new AvenxApp({ target: '#app' });\napp.initRouter({ '': 'Home', '/': 'About' });\n",
);

const model = new AppModel();
for (const page of ['Home', 'About']) {
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

const routeId = nodeId(AtlasNodeKind.ROUTE, null, '/');
const routeEdges = model.edges.filter(
  (edge) => edge.from === routeId && edge.kind === AtlasEdgeKind.ROUTES_TO,
);

assert.strictEqual(
  routeEdges.length,
  1,
  `expected one ROUTES_TO edge for route "/" after last-wins, got ${routeEdges.length}`,
);
assert.strictEqual(
  routeEdges[0].to,
  nodeId(AtlasNodeKind.PAGE, null, 'About'),
  'the surviving edge must point at the last declared page',
);

const reported = warnings.filter((message) => message.includes(AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN));
assert.strictEqual(reported.length, 1, `expected one ${AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN} warning, got ${reported.length}`);
