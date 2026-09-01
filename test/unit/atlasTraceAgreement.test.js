/**
 * Atlas and Trace describe the same application from two sides, and this test
 * is the seam between them.
 *
 * Atlas says what *can* happen, computed from source before anything runs.
 * Trace says what *did* happen, recorded from the running framework. If a run
 * takes a path Atlas never predicted, one of the two is wrong — and it is
 * almost always Atlas, because the trace is evidence.
 *
 * The committed trace was recorded by driving the fixture's own components
 * through the real runtime (`test/fixtures/atlas-app.trace.json`), not written
 * by hand. Every causal step in it is looked up in the Atlas; a step with no
 * corresponding edge fails, unless it is one of the kinds Atlas deliberately
 * does not model, which are enumerated with their reasons rather than being
 * quietly skipped.
 *
 * Atlas stays compile-time only. Nothing here makes the runtime depend on it.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AvenxCompiler from '../../lib/compiler.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';
import { AtlasEdgeKind, AtlasNodeKind, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { TRACE_VERSION, TraceNodeType } from '../../lib/core/trace/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'atlas-app');
const TRACE = path.join(__dirname, '..', 'fixtures', 'atlas-app.trace.json');

console.log('🧪 Testing that Atlas predicts what Trace records...');

/**
 * Trace node types Atlas does not model, and why.
 *
 * Adding to this map is a visible decision. It is the only sanctioned way for
 * a recorded step to go unchecked.
 * @type {Map<string, string>}
 */
const NOT_MODELLED = new Map([
  [TraceNodeType.EVENT, 'a DOM event is an input, not a relationship between declarations'],
  [TraceNodeType.WATCHER, 'a watcher wake-up is the runtime consequence of a write Atlas already models'],
  [TraceNodeType.DOM, 'Atlas models which binding renders a value, not which node the patcher touched'],
  [TraceNodeType.BRIDGE_EMIT, 'delivery to subscribers is the runtime fan-out of an emits edge'],
  [TraceNodeType.GLOBAL, 'reading a non-deterministic global is not an application relationship'],
  [TraceNodeType.RESOURCE, 'a resource settlement is network activity'],
  [TraceNodeType.NAVIGATION, 'a navigation is an input'],
  [TraceNodeType.ERROR, 'an error is not a declared relationship'],
  [TraceNodeType.CONTRACT, 'a contract violation is a property of a run'],
]);

try {
  clearAtlasCache();
  const model = new AvenxCompiler({
    rootDir: FIXTURE,
    srcDir: 'src',
    distDir: 'dist',
    logging: { silent: true },
  }).analyze();

  assert.ok(fs.existsSync(TRACE), 'the recorded trace is committed alongside the fixture');
  const trace = JSON.parse(fs.readFileSync(TRACE, 'utf-8'));
  assert.strictEqual(trace.traceVersion, TRACE_VERSION, 'the trace is in a format this build reads');
  assert.ok(trace.nodes.length > 0, 'the trace has steps');

  const byId = new Map(trace.nodes.map((node) => [node.id, node]));

  /**
   * The owner node id for a component or page name.
   * @param {string} name - The class name a trace node recorded.
   * @returns {string} The Atlas owner id.
   */
  function ownerOf(name) {
    const asPage = nodeId(AtlasNodeKind.PAGE, null, name);
    return model.hasNode(asPage) ? asPage : nodeId(AtlasNodeKind.COMPONENT, null, name);
  }

  /**
   * The Atlas node a trace node names, when it names a declaration.
   * @param {object} node - A trace node.
   * @returns {string|null} The Atlas node id.
   */
  function atlasIdOf(node) {
    if (!node) return null;
    if (node.type === TraceNodeType.BRIDGE_ACTION) {
      return nodeId(AtlasNodeKind.ACTION, nodeId(AtlasNodeKind.BRIDGE, null, node.bridge), node.name);
    }
    if (node.type === TraceNodeType.ACTION) {
      return nodeId(AtlasNodeKind.ACTION, ownerOf(node.component), node.name);
    }
    if (node.type === TraceNodeType.COMPUTED) {
      return node.bridge
        ? nodeId(AtlasNodeKind.GETTER, nodeId(AtlasNodeKind.BRIDGE, null, node.bridge), node.name)
        : nodeId(AtlasNodeKind.COMPUTED, ownerOf(node.component), node.name);
    }
    return null;
  }

  /**
   * The trace node that caused this one, if any.
   * @param {object} node - A trace node.
   * @returns {object|null} The parent node.
   */
  const parentOf = (node) =>
    node.parent === null || node.parent === undefined ? null : byId.get(node.parent) || null;

  /**
   * Whether the model holds an edge of a kind between two nodes.
   * @param {string} from - Source id.
   * @param {string} to - Target id.
   * @param {string} kind - Edge kind.
   * @returns {boolean} True when the edge exists.
   */
  const hasEdge = (from, to, kind) =>
    model.edges.some((item) => item.from === from && item.to === to && item.kind === kind);

  const checked = { declarations: 0, invokes: 0, writes: 0, reads: 0 };
  const misses = [];

  for (const node of trace.nodes) {
    if (NOT_MODELLED.has(node.type)) continue;

    // 1. Anything the run named must exist in the model.
    const atlasId = atlasIdOf(node);
    if (atlasId) {
      if (!model.hasNode(atlasId)) {
        misses.push(`the run executed ${node.type} "${node.name}" but Atlas has no node ${atlasId}`);
        continue;
      }
      checked.declarations++;
    }

    const parent = parentOf(node);

    // 2. An action running inside another action is an invocation.
    if (node.type === TraceNodeType.ACTION || node.type === TraceNodeType.BRIDGE_ACTION) {
      if (!parent) continue;
      const callerId = atlasIdOf(parent);
      if (!callerId) continue; // Invoked from a template handler; covered by the model tests.
      if (!hasEdge(callerId, atlasId, AtlasEdgeKind.INVOKES)) {
        misses.push(`the run invoked ${atlasId} from ${callerId}; Atlas has no invokes edge`);
      } else {
        checked.invokes++;
      }
      continue;
    }

    // 3. A write's parent is the code that performed it.
    if (node.type === TraceNodeType.WRITE) {
      if (!parent) continue;
      const writerId = atlasIdOf(parent);
      if (!writerId) continue;

      const key = String(node.path).split('.')[0];
      const written = model
        .outgoing(writerId)
        .filter((item) => item.kind === AtlasEdgeKind.WRITES)
        .map((item) => model.getNode(item.to))
        .filter(Boolean);

      if (!written.some((target) => target.name === key)) {
        misses.push(
          `the run wrote "${node.path}" from ${writerId}; Atlas records writes to ` +
            `[${written.map((target) => target.name).join(', ') || 'nothing'}]`,
        );
      } else {
        checked.writes++;
      }
      continue;
    }

    // 4. A derived value re-evaluating under a component's render means that
    //    component reads it. Atlas should hold a read edge from something that
    //    component declares.
    if (node.type === TraceNodeType.COMPUTED) {
      const reader = parent && parent.type === TraceNodeType.WATCHER ? parent.component : null;
      if (!reader) {
        // Evaluated inside another declaration rather than during a render.
        const viaId = atlasIdOf(parent);
        if (viaId && !hasEdge(viaId, atlasId, AtlasEdgeKind.READS)) {
          misses.push(`the run evaluated ${atlasId} inside ${viaId}; Atlas has no reads edge`);
        } else if (viaId) {
          checked.reads++;
        }
        continue;
      }

      const owner = ownerOf(reader);
      const readsIt = model
        .incoming(atlasId)
        .filter((item) => item.kind === AtlasEdgeKind.READS)
        .some((item) => {
          const source = model.getNode(item.from);
          return source && (source.id === owner || source.owner === owner);
        });

      if (!readsIt) {
        misses.push(`${reader} re-rendered and evaluated ${atlasId}; Atlas has nothing in ${owner} reading it`);
      } else {
        checked.reads++;
      }
      continue;
    }
  }

  assert.deepStrictEqual(misses, [], 'every causal step in the recorded trace corresponds to an Atlas edge');

  // The check must actually have checked something: a broken mapping that
  // found nothing to disagree with would otherwise pass silently.
  assert.ok(checked.declarations > 0, 'the run named declarations Atlas knows');
  assert.ok(checked.invokes > 0, 'the run exercised at least one invocation');
  assert.ok(checked.writes > 0, 'and at least one write');
  assert.ok(checked.reads > 0, 'and at least one derived read');

  // Every trace node type present is either checked or explicitly excused.
  const seen = new Set(trace.nodes.map((node) => node.type));
  for (const type of seen) {
    const modelled = !NOT_MODELLED.has(type);
    const known = [TraceNodeType.ACTION, TraceNodeType.BRIDGE_ACTION, TraceNodeType.WRITE, TraceNodeType.COMPUTED];
    assert.ok(
      !modelled || known.includes(type),
      `trace node type "${type}" is neither checked against Atlas nor listed as not modelled`,
    );
  }

  // Trace must not depend on Atlas at runtime.
  const runtimeBundle = path.join(__dirname, '..', '..', 'dist', 'runtime.js');
  if (fs.existsSync(runtimeBundle)) {
    const runtime = fs.readFileSync(runtimeBundle, 'utf-8');
    for (const marker of ['AppModel', 'AtlasNodeKind', 'atlasVersion', 'addComponentUnit']) {
      assert.ok(!runtime.includes(marker), `${marker} must not reach the runtime`);
    }
  }

  console.log(
    `✅ Atlas/Trace agreement verified (${checked.declarations} declarations, ${checked.invokes} invocations, ` +
      `${checked.writes} writes, ${checked.reads} derived reads).`,
  );
} catch (err) {
  console.error('❌ Atlas/Trace agreement test failed:', err);
  process.exit(1);
}
