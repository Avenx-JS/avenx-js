/**
 * @file atlasDiff.test.js
 * @description Unit tests for the Atlas diff comparison algorithm and formatter.
 */

import assert from 'assert';
import { ATLAS_VERSION } from '../../lib/compiler/atlas/AppModel.js';
import { diffAtlas, formatAtlasDiff } from '../../lib/compiler/atlas/diff.js';

console.log('🧪 Testing Atlas diff comparison and formatting...');

// ── 1. Unchanged models report 0 differences ──────────────────────────────
{
  const baseline = {
    atlasVersion: ATLAS_VERSION,
    generatedAt: '2026-11-20T10:00:00.000Z',
    nodes: [
      { id: 'component:Cart', kind: 'component', name: 'Cart', loc: { file: 'src/cart.js', line: 1 } },
      {
        id: 'state:component:Cart.items',
        kind: 'state',
        name: 'items',
        owner: 'component:Cart',
        loc: { file: 'src/cart.js', line: 2 },
      },
    ],
    edges: [{ from: 'component:Cart', to: 'state:component:Cart.items', kind: 'declares', confidence: 'certain' }],
    unresolved: [],
  };

  const current = {
    atlasVersion: ATLAS_VERSION,
    generatedAt: '2026-11-24T15:00:00.000Z', // Different timestamp
    // Shuffled nodes and edges
    nodes: [
      {
        id: 'state:component:Cart.items',
        kind: 'state',
        name: 'items',
        owner: 'component:Cart',
        loc: { file: 'src/cart.js', line: 2 },
      },
      { id: 'component:Cart', kind: 'component', name: 'Cart', loc: { file: 'src/cart.js', line: 1 } },
    ],
    edges: [{ from: 'component:Cart', to: 'state:component:Cart.items', kind: 'declares', confidence: 'certain' }],
    unresolved: [],
  };

  const diff = diffAtlas(baseline, current);
  assert.strictEqual(diff.differences, 0, 'no differences on identical content');
  assert.strictEqual(diff.summary.total, 0);
  assert.strictEqual(diff.summary.nodes, 0);
  assert.strictEqual(diff.summary.edges, 0);
  assert.strictEqual(diff.summary.routes, 0);
  assert.strictEqual(diff.summary.unresolved, 0);

  const report = formatAtlasDiff(diff);
  assert.strictEqual(report, 'No differences.');
}

// ── 2. Nodes: added, removed, and modified by location ────────────────────
{
  const baseline = {
    atlasVersion: ATLAS_VERSION,
    nodes: [
      {
        id: 'action:component:CartSummary.applyCoupon',
        kind: 'action',
        name: 'applyCoupon',
        loc: { file: 'src/cart.js', line: 11 },
      },
      { id: 'state:component:CartSummary.count', kind: 'state', name: 'count', loc: { file: 'src/cart.js', line: 5 } },
    ],
    edges: [],
    unresolved: [],
  };

  const current = {
    atlasVersion: ATLAS_VERSION,
    nodes: [
      // Removed applyCoupon
      // Modified count location: line 5 -> line 8
      { id: 'state:component:CartSummary.count', kind: 'state', name: 'count', loc: { file: 'src/cart.js', line: 8 } },
      // Added discount
      {
        id: 'state:component:CartSummary.discount',
        kind: 'state',
        name: 'discount',
        loc: { file: 'src/cart.js', line: 2 },
      },
    ],
    edges: [],
    unresolved: [],
  };

  const diff = diffAtlas(baseline, current);
  assert.strictEqual(diff.differences, 3, '3 node differences');
  assert.strictEqual(diff.nodes.added.length, 1);
  assert.strictEqual(diff.nodes.added[0].id, 'state:component:CartSummary.discount');
  assert.strictEqual(diff.nodes.removed.length, 1);
  assert.strictEqual(diff.nodes.removed[0].id, 'action:component:CartSummary.applyCoupon');
  assert.strictEqual(diff.nodes.modified.length, 1);
  assert.strictEqual(diff.nodes.modified[0].id, 'state:component:CartSummary.count');

  const report = formatAtlasDiff(diff);
  assert.ok(report.includes('+ state:component:CartSummary.discount src/cart.js:2'));
  assert.ok(report.includes('- action:component:CartSummary.applyCoupon (was src/cart.js:11)'));
  assert.ok(report.includes('~ state:component:CartSummary.count src/cart.js:8 (was src/cart.js:5)'));
  assert.ok(report.includes('3 differences (3 nodes)'));
}

// ── 3. Edges: added, removed, and confidence degradation ─────────────────
{
  const baseline = {
    atlasVersion: ATLAS_VERSION,
    nodes: [],
    edges: [
      {
        from: 'binding:component:CartSummary@21:6',
        to: 'state:component:CartSummary.total',
        kind: 'reads',
        confidence: 'certain',
      },
      { from: 'action:bridge:cart.addQty', to: 'state:bridge:cart.items', kind: 'writes', confidence: 'certain' },
    ],
    unresolved: [],
  };

  const current = {
    atlasVersion: ATLAS_VERSION,
    nodes: [],
    edges: [
      // Removed binding@21:6
      // Added binding@18:6
      {
        from: 'binding:component:CartSummary@18:6',
        to: 'state:component:CartSummary.discount',
        kind: 'reads',
        confidence: 'certain',
      },
      // Confidence degraded: certain -> possible
      { from: 'action:bridge:cart.addQty', to: 'state:bridge:cart.items', kind: 'writes', confidence: 'possible' },
    ],
    unresolved: [],
  };

  const diff = diffAtlas(baseline, current);
  assert.strictEqual(diff.differences, 3, '3 edge differences');
  assert.strictEqual(diff.edges.added.length, 1);
  assert.strictEqual(diff.edges.removed.length, 1);
  assert.strictEqual(diff.edges.modified.length, 1);
  assert.strictEqual(diff.edges.modified[0].confidence, 'possible');
  assert.strictEqual(diff.edges.modified[0].wasConfidence, 'certain');

  const report = formatAtlasDiff(diff);
  assert.ok(report.includes('+ binding:component:CartSummary@18:6 reads state:component:CartSummary.discount certain'));
  assert.ok(report.includes('- binding:component:CartSummary@21:6 reads state:component:CartSummary.total certain'));
  assert.ok(report.includes('~ action:bridge:cart.addQty writes state:bridge:cart.items now possible (was certain)'));
}

// ── 4. Routes: added, removed, guard change, target change ───────────────
{
  const baseline = {
    atlasVersion: ATLAS_VERSION,
    nodes: [
      { id: 'route:/cart', kind: 'route', name: '/cart', loc: { file: 'src/main.app.js', line: 8 } },
      { id: 'route:/old', kind: 'route', name: '/old', loc: { file: 'src/main.app.js', line: 10 } },
      { id: 'page:Cart', kind: 'page', name: 'Cart' },
      { id: 'guard:AuthGuard', kind: 'guard', name: 'AuthGuard' },
    ],
    edges: [
      { from: 'route:/cart', to: 'page:Cart', kind: 'routes-to', confidence: 'certain' },
      { from: 'route:/old', to: 'page:Old', kind: 'routes-to', confidence: 'certain' },
    ],
    unresolved: [],
  };

  const current = {
    atlasVersion: ATLAS_VERSION,
    nodes: [
      // /cart now guarded by AuthGuard
      { id: 'route:/cart', kind: 'route', name: '/cart', loc: { file: 'src/main.app.js', line: 8 } },
      // Added /new
      { id: 'route:/new', kind: 'route', name: '/new', loc: { file: 'src/main.app.js', line: 12 } },
      { id: 'page:Cart', kind: 'page', name: 'Cart' },
      { id: 'page:New', kind: 'page', name: 'New' },
      { id: 'guard:AuthGuard', kind: 'guard', name: 'AuthGuard' },
    ],
    edges: [
      { from: 'route:/cart', to: 'page:Cart', kind: 'routes-to', confidence: 'certain' },
      { from: 'route:/cart', to: 'guard:AuthGuard', kind: 'guarded-by', confidence: 'certain' },
      { from: 'route:/new', to: 'page:New', kind: 'routes-to', confidence: 'certain' },
    ],
    unresolved: [],
  };

  const diff = diffAtlas(baseline, current);
  assert.strictEqual(diff.routes.modified.length, 1);
  assert.strictEqual(diff.routes.modified[0].name, '/cart');
  assert.deepStrictEqual(diff.routes.modified[0].changes, ['now guarded by AuthGuard']);

  assert.strictEqual(diff.routes.added.length, 1);
  assert.strictEqual(diff.routes.added[0].name, '/new');

  assert.strictEqual(diff.routes.removed.length, 1);
  assert.strictEqual(diff.routes.removed[0].name, '/old');

  const report = formatAtlasDiff(diff);
  assert.ok(report.includes("~ '/cart' now guarded by AuthGuard"));
  assert.ok(report.includes("+ '/new' → New src/main.app.js:12"));
  assert.ok(report.includes("- '/old' → Old (was src/main.app.js:10)"));
}

// ── 5. Unresolved: added and removed ─────────────────────────────────────
{
  const baseline = {
    atlasVersion: ATLAS_VERSION,
    nodes: [],
    edges: [],
    unresolved: [{ reason: 'unknown-identifier', expr: '$old', owner: 'action:component:Old.test' }],
  };

  const current = {
    atlasVersion: ATLAS_VERSION,
    nodes: [],
    edges: [],
    unresolved: [{ reason: 'unknown-identifier', expr: '$coupon', owner: 'action:component:CartSummary.applyCoupon' }],
  };

  const diff = diffAtlas(baseline, current);
  assert.strictEqual(diff.unresolved.added.length, 1);
  assert.strictEqual(diff.unresolved.removed.length, 1);

  const report = formatAtlasDiff(diff);
  assert.ok(report.includes('+ unknown-identifier $coupon in action:component:CartSummary.applyCoupon'));
  assert.ok(report.includes('- unknown-identifier $old in action:component:Old.test'));
}

// ── 6. Full reproduction of example in issue #1649 ────────────────────────
{
  const baseline = {
    atlasVersion: ATLAS_VERSION,
    nodes: [
      {
        id: 'action:component:CartSummary.applyCoupon',
        kind: 'action',
        name: 'applyCoupon',
        loc: { file: 'src/components/cart-summary/cart-summary.component.js', line: 11 },
      },
      { id: 'route:/cart', kind: 'route', name: '/cart', loc: { file: 'src/main.app.js', line: 8 } },
      { id: 'page:Cart', kind: 'page', name: 'Cart' },
      { id: 'guard:AuthGuard', kind: 'guard', name: 'AuthGuard' },
    ],
    edges: [
      {
        from: 'binding:component:CartSummary@21:6',
        to: 'state:component:CartSummary.total',
        kind: 'reads',
        confidence: 'certain',
      },
      { from: 'route:/cart', to: 'page:Cart', kind: 'routes-to', confidence: 'certain' },
    ],
    unresolved: [],
  };

  const current = {
    atlasVersion: ATLAS_VERSION,
    nodes: [
      {
        id: 'state:component:CartSummary.discount',
        kind: 'state',
        name: 'discount',
        loc: { file: 'src/components/cart-summary/cart-summary.component.js', line: 2 },
      },
      { id: 'route:/cart', kind: 'route', name: '/cart', loc: { file: 'src/main.app.js', line: 8 } },
      { id: 'page:Cart', kind: 'page', name: 'Cart' },
      { id: 'guard:AuthGuard', kind: 'guard', name: 'AuthGuard' },
    ],
    edges: [
      {
        from: 'binding:component:CartSummary@18:6',
        to: 'state:component:CartSummary.discount',
        kind: 'reads',
        confidence: 'certain',
      },
      { from: 'route:/cart', to: 'page:Cart', kind: 'routes-to', confidence: 'certain' },
      { from: 'route:/cart', to: 'guard:AuthGuard', kind: 'guarded-by', confidence: 'certain' },
    ],
    unresolved: [{ reason: 'unknown-identifier', expr: '$coupon', owner: 'action:component:CartSummary.applyCoupon' }],
  };

  const diff = diffAtlas(baseline, current);
  assert.strictEqual(diff.differences, 6);
  assert.strictEqual(diff.summary.nodes, 2);
  assert.strictEqual(diff.summary.edges, 2);
  assert.strictEqual(diff.summary.routes, 1);
  assert.strictEqual(diff.summary.unresolved, 1);

  const report = formatAtlasDiff(diff);
  assert.ok(
    report.includes('+ state:component:CartSummary.discount src/components/cart-summary/cart-summary.component.js:2'),
  );
  assert.ok(
    report.includes(
      '- action:component:CartSummary.applyCoupon (was src/components/cart-summary/cart-summary.component.js:11)',
    ),
  );
  assert.ok(report.includes('+ binding:component:CartSummary@18:6 reads state:component:CartSummary.discount certain'));
  assert.ok(report.includes('- binding:component:CartSummary@21:6 reads state:component:CartSummary.total certain'));
  assert.ok(report.includes("~ '/cart' now guarded by AuthGuard"));
  assert.ok(report.includes('+ unknown-identifier $coupon in action:component:CartSummary.applyCoupon'));
  assert.ok(report.includes('6 differences (2 nodes, 2 edges, 1 route, 1 unresolved)'));
}

// ── 7. Version skew and document validation ──────────────────────────────
{
  assert.throws(
    () => diffAtlas({ atlasVersion: 999, nodes: [] }, { atlasVersion: 1, nodes: [] }),
    /Baseline atlasVersion \(999\) does not match current version \(1\)/,
  );

  assert.throws(() => diffAtlas(null, { atlasVersion: 1, nodes: [] }), /Not an Avenx Atlas document/);

  assert.throws(() => diffAtlas({ atlasVersion: 1 }, { atlasVersion: 1, nodes: [] }), /Not an Avenx Atlas document/);
}

console.log('✅ All Atlas diff unit tests passed!');
