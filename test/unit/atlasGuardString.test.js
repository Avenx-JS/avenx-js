/**
 * @file atlasGuardString.test.js
 * @description A guard given as a name string is not a guard: no registry
 * resolves it, so `avenx atlas` must not report the route as guarded.
 *
 * `guards: ['AuthGuard']` (quoted) and `guards: [AuthGuard]` (the class) look
 * the same after quote-stripping, but only the class can run. The parser
 * keeps the quoted flag, the model refuses the GUARDED_BY edge, records the
 * missing edge as unresolved, and reports AVX_W76 through the normal warning
 * path. The class form keeps working exactly as before.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addRoutesAndGuards, parseRouteTable } from '../../lib/compiler/atlas/routes.js';
import { AppModel, AtlasEdgeKind, AtlasNodeKind, UnresolvedReason, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

// ── parseRouteTable keeps the quoted flag ──────────────────────────────────
{
  const source = `
    app.initRouter({
      '#/secret': { page: 'Secret', guards: ['AuthGuard'] },
      '#/open': { page: 'Open', guards: [AuthGuard] },
    });
  `;
  const routes = parseRouteTable(source);
  assert.strictEqual(routes.length, 2, `expected two routes, got ${routes.length}`);
  const [secret, open] = routes;
  assert.deepStrictEqual(secret.guards, ['AuthGuard']);
  assert.deepStrictEqual(secret.quotedGuards, ['AuthGuard'], 'a quoted guard entry must be flagged');
  assert.deepStrictEqual(open.guards, ['AuthGuard']);
  assert.deepStrictEqual(open.quotedGuards, [], 'an identifier guard entry must not be flagged');
}

// ── addRoutesAndGuards: string guard, no edge, unresolved, AVX_W76 ────────
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-guard-string-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(path.join(srcDir, 'guards'), { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, 'guards', 'auth.guard.js'),
    "import { AvenxGuard } from 'avenx-core/runtime';\nexport default class AuthGuard extends AvenxGuard {}\n",
  );
  fs.writeFileSync(
    path.join(srcDir, 'main.app.js'),
    "import AuthGuard from './guards/auth.guard.js';\n" +
      "const app = new AvenxApp({ target: '#app' });\n" +
      "app.initRouter({ '#/secret': { page: 'Secret', guards: ['AuthGuard'] }, '#/open': { page: 'Open', guards: [AuthGuard] } });\n",
  );

  const model = new AppModel();
  for (const page of ['Secret', 'Open']) {
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

  const secretRouteId = nodeId(AtlasNodeKind.ROUTE, null, '/secret');
  const secretEdges = model.edges.filter(
    (edge) => edge.from === secretRouteId && edge.kind === AtlasEdgeKind.GUARDED_BY,
  );
  assert.strictEqual(secretEdges.length, 0, 'a string guard must not produce a GUARDED_BY edge');

  const openRouteId = nodeId(AtlasNodeKind.ROUTE, null, '/open');
  const openEdges = model.edges.filter(
    (edge) => edge.from === openRouteId && edge.kind === AtlasEdgeKind.GUARDED_BY,
  );
  assert.strictEqual(openEdges.length, 1, 'the guard class still produces a GUARDED_BY edge');
  assert.strictEqual(openEdges[0].to, nodeId(AtlasNodeKind.GUARD, null, 'AuthGuard'));

  const unresolved = model.unresolved.filter((item) => item.name === 'AuthGuard');
  assert.strictEqual(unresolved.length, 1, 'the string guard must be recorded as unresolved');
  assert.strictEqual(unresolved[0].reason, UnresolvedReason.GUARD_AS_STRING);
  assert.strictEqual(unresolved[0].owner, secretRouteId);

  const reported = warnings.filter((message) => message.includes(AvenxErrorCodes.COMPILER_GUARD_AS_STRING));
  assert.strictEqual(
    reported.length,
    1,
    `expected one ${AvenxErrorCodes.COMPILER_GUARD_AS_STRING} warning, got ${reported.length}`,
  );
  assert.ok(reported[0].includes('AuthGuard'), 'the warning names the guard');
  assert.ok(reported[0].includes('/secret'), 'the warning names the route');
  assert.ok(!/\{\d\}/.test(reported[0]), 'no placeholder survived into the warning');
}

console.log('✅ Atlas string-guard tests passed.');
