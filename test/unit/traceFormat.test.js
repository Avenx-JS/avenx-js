import assert from 'assert';
import { formatTrace, formatNode, formatDeterminism, summarizeTrace } from '../../lib/core/trace/format.js';
import { TraceNodeType, Determinism, NonDeterminismReason, createTrace } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing trace formatting...');

// --- Individual node lines --------------------------------------------------

assert.strictEqual(
  formatNode({ type: TraceNodeType.EVENT, eventType: 'click', target: { selector: 'button.inc', nth: 0 }, component: 'CartItem' }),
  'click <button.inc> CartItem',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.EVENT, eventType: 'input', target: { selector: 'input', nth: 2 }, value: 'ada' }),
  'input <input[2]> value="ada"',
  'a typed value is shown, because it is what replay feeds back',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.ACTION, name: 'incQty', component: 'CartItem' }),
  'action CartItem.incQty()',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.BRIDGE_ACTION, bridge: 'cart', name: 'addQty', args: ['a', 1] }),
  'bridge cart · addQty("a", 1)',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.BRIDGE_EMIT, bridge: 'cart', event: 'changed', listeners: 1 }),
  'emit cart:changed → 1 listener',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.BRIDGE_EMIT, bridge: 'cart', event: 'changed', listeners: 0 }),
  'emit cart:changed → 0 listeners',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.WRITE, path: 'cart.items.2.qty', from: 1, to: 2 }),
  'write cart.items.2.qty 1 → 2',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.WRITE, path: 'items', op: 'push', size: 3 }),
  'write items (push, size 3)',
);
assert.strictEqual(formatNode({ type: TraceNodeType.WATCHER, name: 'CartItem#render' }), 'woke CartItem#render');
assert.strictEqual(
  formatNode({ type: TraceNodeType.COMPUTED, kind: 'getter', name: 'total', bridge: 'cart', from: 24, to: 36 }),
  'getter cart.total 24 → 36',
);
assert.strictEqual(
  formatNode({
    type: TraceNodeType.COMPUTED,
    kind: 'computed',
    name: 'subtotal',
    component: 'Totals',
    from: 20,
    to: 30,
    expression: 'qty * price',
  }),
  'computed Totals.subtotal 20 → 30  [qty * price]',
  'the expression source is shown — Avenx still has it at runtime',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.DOM, op: 'text', target: { selector: 'span.qty', nth: 0 }, from: '1', to: '2' }),
  'patched <span.qty> text "1" → "2"',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.DOM, op: 'attr', name: 'title', target: { selector: 'a', nth: 0 }, from: 'x', to: 'y' }),
  'patched <a> @title "x" → "y"',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.DOM, op: 'remove-attr', name: 'disabled', target: { selector: 'button', nth: 0 } }),
  'patched <button> removed @disabled',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.RESOURCE, phase: 'pending', name: 'users' }),
  'resource users requested',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.RESOURCE, phase: 'settled', status: 'rejected', name: 'users', error: { message: 'offline' } }),
  'resource users failed: offline',
);
assert.strictEqual(
  formatNode({ type: TraceNodeType.NAVIGATION, from: '#/', to: '#/cart', page: 'Cart' }),
  'navigate #/ → #/cart  [Cart]',
);
assert.strictEqual(formatNode({ type: TraceNodeType.GLOBAL, source: 'Date.now' }), 'read Date.now');
assert.strictEqual(
  formatNode({ type: TraceNodeType.ERROR, name: 'TypeError', message: 'boom' }),
  'error TypeError: boom',
);

// --- The causal tree --------------------------------------------------------

const trace = createTrace({ url: 'http://localhost:3000/#/cart' });
trace.id = 'trace-4f2a';
trace.createdAt = '2026-08-27T10:00:00.000Z';
trace.nodes = [
  { id: 1, parent: null, type: TraceNodeType.EVENT, eventType: 'click', target: { selector: 'button.qty-inc', nth: 0 }, component: 'CartItem' },
  { id: 2, parent: 1, type: TraceNodeType.ACTION, name: 'incQty', component: 'CartItem' },
  { id: 3, parent: 2, type: TraceNodeType.BRIDGE_ACTION, bridge: 'cart', name: 'addQty', args: ['a', 1] },
  { id: 4, parent: 3, type: TraceNodeType.WRITE, path: 'cart.items.2.qty', from: 1, to: 2 },
  { id: 5, parent: 4, type: TraceNodeType.WATCHER, name: 'CartItem#render', kind: 'render', component: 'CartItem' },
  { id: 6, parent: 5, type: TraceNodeType.DOM, op: 'text', target: { selector: 'span.qty', nth: 0 }, from: '1', to: '2' },
  { id: 7, parent: 4, type: TraceNodeType.COMPUTED, kind: 'getter', name: 'total', bridge: 'cart', from: 24, to: 36 },
];

const rendered = formatTrace(trace);
const lines = rendered.split('\n');

assert.ok(lines[0].includes('trace-4f2a'), 'the header names the trace');
assert.ok(lines[0].includes('7 nodes'));
assert.ok(rendered.includes('http://localhost:3000/#/cart'), 'the recorded URL is shown');

// Reading order follows causality, not time.
const clickLine = lines.findIndex((l) => l.includes('click <button.qty-inc>'));
const actionLine = lines.findIndex((l) => l.includes('action CartItem.incQty()'));
const writeLine = lines.findIndex((l) => l.includes('write cart.items.2.qty'));
const domLine = lines.findIndex((l) => l.includes('patched <span.qty>'));
assert.ok(clickLine < actionLine, 'the click is printed above the action it caused');
assert.ok(actionLine < writeLine, 'the action above the write');
assert.ok(writeLine < domLine, 'the write above the DOM patch it produced');

// Indentation reflects depth, so the shape is readable at a glance.
const indentOf = (i) => lines[i].length - lines[i].trimStart().length;
assert.ok(indentOf(actionLine) > indentOf(clickLine), 'children are indented under their cause');
assert.ok(indentOf(domLine) > indentOf(writeLine));

// Siblings get branch connectors, the last gets a corner.
assert.ok(rendered.includes('├─') || rendered.includes('└─'), 'tree connectors are drawn');
assert.ok(rendered.includes('└─ getter cart.total 24 → 36'), 'the sibling getter hangs off the same write');

assert.ok(rendered.includes('Determinism: deterministic'), 'the verdict is stated');
assert.ok(rendered.includes('regression test'), 'and says what it enables');

// --- Best-effort explains itself -------------------------------------------

const shaky = createTrace();
shaky.id = 'trace-a91c';
shaky.determinism = {
  status: Determinism.BEST_EFFORT,
  reasons: [{ reason: NonDeterminismReason.POLLING_RESOURCE, detail: '<resource name="ticker"> polls every 5000ms' }],
};
const verdict = formatDeterminism(shaky);
assert.ok(verdict.includes('best-effort'), 'the verdict is stated plainly');
assert.ok(verdict.includes('ticker'), 'the specific detail is shown');
assert.ok(verdict.includes('wall-clock time'), 'and the general explanation');

// Redactions are declared in the verdict, so a reader knows the trace is partial.
const redactedTrace = createTrace();
redactedTrace.redacted = true;
redactedTrace.redactions = ['auth.token'];
redactedTrace.determinism = { status: Determinism.BEST_EFFORT, reasons: [] };
assert.ok(formatDeterminism(redactedTrace).includes('auth.token'), 'withheld paths are declared');

// --- Contract violations surface in the rendered trace ---------------------

const violating = createTrace();
violating.id = 'trace-c1';
violating.nodes = [
  { id: 1, parent: null, type: TraceNodeType.ACTION, name: 'mark', component: 'Stamp', contracts: ['deterministic'] },
  { id: 2, parent: 1, type: TraceNodeType.GLOBAL, source: 'Date.now', kind: 'now' },
];
const violatingOut = formatTrace(violating);
assert.ok(violatingOut.includes('Contract violations'), 'violations are surfaced in the view');
assert.ok(violatingOut.includes('AVX_W33'), 'with the compiler diagnostic code');
assert.ok(violatingOut.includes('Stamp.mark()'), 'and the unit that broke its promise');

// --- Truncation of very wide traces ----------------------------------------

const wide = createTrace();
wide.id = 'trace-wide';
wide.nodes = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  parent: null,
  type: TraceNodeType.EVENT,
  eventType: 'click',
  target: { selector: 'button', nth: 0 },
}));
const capped = formatTrace(wide, { maxRoots: 3 });
assert.ok(capped.includes('7 more roots not shown'), 'the remainder is summarised rather than dumped');

// --- Listing summary --------------------------------------------------------

const summary = summarizeTrace(trace);
assert.strictEqual(summary.id, 'trace-4f2a');
assert.strictEqual(summary.events, 1, 'events and navigations are counted as interactions');
assert.strictEqual(summary.components, 1, 'distinct components are counted, and a bridge is not one');
assert.strictEqual(summary.status, Determinism.DETERMINISTIC);

// --- A malformed trace with a parent cycle must not hang -------------------

const cyclic = createTrace();
cyclic.id = 'trace-cycle';
cyclic.nodes = [
  { id: 1, parent: 2, type: TraceNodeType.ACTION, name: 'a' },
  { id: 2, parent: 1, type: TraceNodeType.ACTION, name: 'b' },
];
const cyclicOut = formatTrace(cyclic);
assert.ok(typeof cyclicOut === 'string' && cyclicOut.length > 0, 'a cyclic trace renders instead of hanging');

console.log('✅ All trace formatting tests passed.');
