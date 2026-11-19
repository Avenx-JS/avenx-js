/**
 * @file atlasGuardNaming.test.js
 * @description A guard is identified by the class its module exports and the
 * binding the route table names, not by its filename.
 *
 * `auth.guard.js` exporting `class Auth` and imported as `Auth` must produce a
 * GUARDED_BY edge, with no unknown-identifier left unresolved.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addRoutesAndGuards } from '../../lib/compiler/atlas/routes.js';
import { AppModel, AtlasEdgeKind, AtlasNodeKind, nodeId } from '../../lib/compiler/atlas/AppModel.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-guard-naming-'));
const srcDir = path.join(root, 'src');
fs.mkdirSync(path.join(srcDir, 'guards'), { recursive: true });
fs.writeFileSync(
  path.join(srcDir, 'guards', 'auth.guard.js'),
  "import { AvenxGuard } from 'avenx-core/runtime';\nexport default class Auth extends AvenxGuard {}\n",
);
fs.writeFileSync(
  path.join(srcDir, 'main.app.js'),
  "import Auth from './guards/auth.guard.js';\n" +
    "const app = new AvenxApp({ target: '#app' });\n" +
    "app.initRouter({ '#/secret': { page: 'Secret', guards: [Auth, Nope] } });\n",
);

const model = new AppModel();
model.addNode({ id: nodeId(AtlasNodeKind.PAGE, null, 'Secret'), kind: AtlasNodeKind.PAGE, name: 'Secret' });

try {
  addRoutesAndGuards(model, { srcDir, rootDir: root, config: {} });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const guardId = nodeId(AtlasNodeKind.GUARD, null, 'Auth');
assert.ok(model.hasNode(guardId), 'the guard must be named by its exported class, Auth');
assert.ok(!model.hasNode(nodeId(AtlasNodeKind.GUARD, null, 'AuthGuard')), 'no filename-derived node may remain');

const routeId = nodeId(AtlasNodeKind.ROUTE, null, '/secret');
const guardEdges = model.edges.filter((edge) => edge.from === routeId && edge.kind === AtlasEdgeKind.GUARDED_BY);
assert.strictEqual(guardEdges.length, 1, `expected one GUARDED_BY edge, got ${guardEdges.length}`);
assert.strictEqual(guardEdges[0].to, guardId, 'the GUARDED_BY edge must point at the Auth guard');

const unknown = model.unresolved.filter((item) => item.name === 'Auth');
assert.strictEqual(unknown.length, 0, 'the referenced guard Auth must not be reported as unresolved');
