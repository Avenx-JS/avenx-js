import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import {
  collectLocations,
  buildSidecar,
  annotateTrace,
  sidecarFileName,
} from '../../lib/compiler/sourceMapTrace.js';
import { TRACE_VERSION, TraceNodeType } from '../../lib/core/trace/schema.js';
import { formatNode } from '../../lib/core/trace/format.js';

console.log('🧪 Testing the trace source-location sidecar...');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-sidecar-'));

try {
  // --- Locations are collected while parsing a real component --------------

  // A project-root marker (findProjectRoot looks for package.json or
  // index.html), so paths resolve relative to the project rather than to the
  // component's own directory.
  fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({ name: 'fixture-app' }));
  fs.writeFileSync(path.join(workDir, 'avenx.config.json'), JSON.stringify({ srcDir: 'src' }));

  const componentDir = path.join(workDir, 'src/components/cart-item');
  fs.mkdirSync(componentDir, { recursive: true });
  const componentPath = path.join(componentDir, 'cart-item.component.js');
  fs.writeFileSync(
    componentPath,
    [
      '<contract deterministic />',
      '',
      '<state qty="1" price="12" />',
      '',
      '<computed name="subtotal" value="state.qty * state.price" />',
      '',
      '<action name="incQty">',
      '  state.qty = state.qty + 1;',
      '</action>',
      '',
      '<action name="reset"> state.qty = 1; </action>',
      '',
      '<div class="row"><span class="sub">{{ subtotal }}</span></div>',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(componentDir, 'cart-item.component.css'), '');

  const parser = new ComponentParser(new StyleProcessor({}, {}));
  parser.parse(componentPath);

  const entry = parser.locations.get('CartItem');
  assert.ok(entry, 'the parser collected locations for the component');
  assert.strictEqual(
    entry.file,
    'src/components/cart-item/cart-item.component.js',
    'the path is recorded relative to the project root',
  );
  assert.strictEqual(entry.actions.incQty.line, 7, 'the first action is located');
  assert.strictEqual(entry.actions.reset.line, 11, 'the second action is located');
  assert.strictEqual(entry.computed.subtotal.line, 5, 'the computed is located');
  assert.strictEqual(
    entry.computed.subtotal.expression,
    'state.qty * state.price',
    'the expression travels with the location',
  );
  assert.deepStrictEqual(entry.contracts, ['deterministic'], 'declared contracts are recorded');

  // --- Missing declarations are simply absent, never guessed ---------------

  const sparse = collectLocations({
    name: 'Empty',
    filePath: path.join(workDir, 'src/components/empty/empty.component.js'),
    rootDir: workDir,
    content: '<div></div>',
    methods: { ghost: 'noop();' },
  });
  assert.deepStrictEqual(sparse.actions, {}, 'an action with no <action> tag gets no invented line');

  // --- The sidecar document -------------------------------------------------

  // Keyed by absolute path, the way AvenxCompiler holds bridge descriptors, to
  // confirm the sidecar keys by the bridge's own name instead.
  const sidecar = buildSidecar(
    parser.locations,
    new Map([
      [
        path.join(workDir, 'src/bridges/cart.bridge.js'),
        {
          name: 'cart',
          filePath: path.join(workDir, 'src/bridges/cart.bridge.js'),
          actions: ['addQty'],
          getters: ['total'],
          stateKeys: ['items'],
        },
      ],
    ]),
    workDir,
  );

  assert.strictEqual(sidecar.traceVersion, TRACE_VERSION, 'the sidecar is versioned alongside the trace format');
  assert.ok(sidecar.components.CartItem, 'components are included');
  assert.strictEqual(
    sidecar.bridges.cart.file,
    'src/bridges/cart.bridge.js',
    'bridges are keyed by name, not by the absolute path the compiler keys them by',
  );
  assert.deepStrictEqual(Object.keys(sidecar.bridges), ['cart'], 'no absolute paths leak into the sidecar');
  assert.deepStrictEqual(sidecar.bridges.cart.actions, ['addQty']);
  assert.strictEqual(sidecarFileName('bundle'), 'bundle.trace.json');
  assert.strictEqual(sidecarFileName('app'), 'app.trace.json');

  // --- Annotation happens on read, not on record ---------------------------

  const trace = {
    traceVersion: TRACE_VERSION,
    nodes: [
      { id: 1, parent: null, type: TraceNodeType.EVENT, eventType: 'click' },
      { id: 2, parent: 1, type: TraceNodeType.ACTION, name: 'incQty', component: 'CartItem' },
      { id: 3, parent: 2, type: TraceNodeType.COMPUTED, name: 'subtotal', component: 'CartItem' },
      { id: 4, parent: 2, type: TraceNodeType.BRIDGE_ACTION, name: 'addQty', bridge: 'cart' },
      { id: 5, parent: 2, type: TraceNodeType.ACTION, name: 'unknown', component: 'Ghost' },
    ],
  };

  annotateTrace(trace, sidecar);

  assert.deepStrictEqual(
    trace.nodes[1].loc,
    { file: 'src/components/cart-item/cart-item.component.js', line: 7 },
    'the action node points at its source line',
  );
  assert.strictEqual(trace.nodes[2].loc.line, 5, 'the computed node points at its source line');
  assert.strictEqual(trace.nodes[3].loc.file, 'src/bridges/cart.bridge.js', 'the bridge action points at its module');
  assert.strictEqual(trace.nodes[4].loc, undefined, 'a component the sidecar does not know is left alone');

  // The annotated location shows up in the rendered trace.
  assert.ok(
    formatNode(trace.nodes[1]).includes('cart-item.component.js:7'),
    `the view shows the source location: ${formatNode(trace.nodes[1])}`,
  );

  // --- A trace without a sidecar still renders -----------------------------

  const bare = {
    traceVersion: TRACE_VERSION,
    nodes: [{ id: 1, parent: null, type: TraceNodeType.ACTION, name: 'incQty', component: 'CartItem' }],
  };
  annotateTrace(bare, null);
  assert.strictEqual(bare.nodes[0].loc, undefined, 'no sidecar means no annotation, not an error');
  assert.strictEqual(
    formatNode(bare.nodes[0]),
    'action CartItem.incQty()',
    'and the node renders without a location',
  );

  annotateTrace({ nodes: null }, sidecar); // must not throw
  annotateTrace(null, sidecar); // must not throw

  console.log('✅ Trace source-location sidecar tests passed.');
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
