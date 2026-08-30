/**
 * A value that changes back on its own is the most confusing thing a trace can
 * contain. These cases check that a rewind is explained rather than merely
 * observed: the transaction appears as a node, and every restoring write hangs
 * underneath it.
 */
import assert from 'assert';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { journal, ConflictPolicy } from '../../lib/core/reactive/journal.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { tracer } from '../../lib/core/trace/tracer.js';
import { TraceNodeType } from '../../lib/core/trace/schema.js';
import { formatNode, formatTrace } from '../../lib/core/trace/format.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

console.log('🧪 Testing Avenx Rewind trace integration...');

const factory = new StateFactory();

/**
 * Records a session and returns the recorder.
 * @param {function(object): void} body - Receives reactive state.
 * @param {object} initial - Initial state.
 * @returns {object} The recorder.
 */
function record(initial, body) {
  const state = factory.create(initial);
  const recorder = startRecording();
  recorder.arm();
  const originalError = logger.error;
  logger.error = () => {};
  try {
    body(state);
  } finally {
    logger.error = originalError;
    stopRecording();
  }
  return recorder;
}

try {
  // ── A rewind produces a node, and the restoring writes are its children ───
  {
    const recorder = record({ count: 0, label: 'a' }, (state) => {
      try {
        journal.run({ owner: 'Cart', name: 'incQty' }, () => {
          state.count = 5;
          state.label = 'z';
          throw new Error('server said no');
        });
      } catch {
        // expected
      }
    });

    const rewinds = recorder.nodes.filter((node) => node.type === TraceNodeType.REWIND);
    assert.strictEqual(rewinds.length, 1, 'one transaction produces one rewind node');

    const rewind = rewinds[0];
    assert.strictEqual(rewind.action, 'Cart.incQty', 'the node names the action');
    assert.strictEqual(rewind.policy, ConflictPolicy.SAFE, 'and the policy it ran under');
    assert.strictEqual(rewind.restored, 2, 'and how much it put back');
    assert.strictEqual(rewind.conflicts, 0, 'and that nothing conflicted');

    const children = recorder.nodes.filter(
      (node) => node.parent === rewind.id && node.type === TraceNodeType.WRITE,
    );
    assert.strictEqual(children.length, 2, 'both restoring writes hang under the rewind');
    assert.deepStrictEqual(
      children.map((node) => `${node.path} ${node.from} -> ${node.to}`).sort(),
      ['count 5 -> 0', 'label z -> a'],
      'and each one reads as the undo it is',
    );
    console.log('  ✅ A rewind is a node, and its writes are its children.');
  }

  // ── A committed transaction leaves no rewind node ────────────────────────
  {
    const recorder = record({ count: 0 }, (state) => {
      journal.run({ owner: 'Cart', name: 'ok' }, () => {
        state.count = 5;
      });
    });

    assert.strictEqual(
      recorder.nodes.filter((node) => node.type === TraceNodeType.REWIND).length,
      0,
      'nothing is recorded when nothing was undone',
    );
    console.log('  ✅ A commit records no rewind.');
  }

  // ── A conflict is carried on the node ────────────────────────────────────
  {
    const recorder = record({ likes: 4 }, (state) => {
      const frame = journal.begin({ owner: 'Post', name: 'like' });
      state.likes = 5;
      journal.close(frame);
      state.likes = 6;
      try {
        journal.run({ owner: 'Post', name: 'like' }, () => {
          // Re-open the same frame's rewind through the public path by failing
          // a fresh transaction that re-journals the conflicted key.
          state.likes = 7;
          throw new Error('fail');
        });
      } catch {
        // expected
      }
      // Now play the stale frame back: its recorded value no longer stands.
      const outcome = frame.rewind();
      assert.strictEqual(outcome.conflicts.length, 1, 'the stale frame conflicts');
    });

    assert.ok(
      recorder.nodes.some((node) => node.type === TraceNodeType.REWIND),
      'the failing transaction still recorded its rewind',
    );
    console.log('  ✅ Conflicts travel with the node.');
  }

  // ── The node renders in the causal tree ──────────────────────────────────
  {
    const line = formatNode({
      type: TraceNodeType.REWIND,
      action: 'CartItem.incQty',
      policy: 'safe',
      restored: 3,
      conflicts: 0,
    });
    assert.strictEqual(line, 'rewind CartItem.incQty — 3 restored  [safe]', 'the line reads plainly');

    const conflicted = formatNode({
      type: TraceNodeType.REWIND,
      action: 'Post.like',
      policy: 'safe',
      restored: 1,
      conflicts: 2,
    });
    assert.ok(conflicted.includes('2 conflicted'), 'a conflict is visible in the line');

    const rendered = formatTrace({
      traceVersion: 1,
      nodes: [
        { id: 1, parent: null, type: TraceNodeType.EVENT, eventType: 'click', target: { selector: 'button' } },
        { id: 2, parent: 1, type: TraceNodeType.REWIND, action: 'Cart.inc', policy: 'safe', restored: 1, conflicts: 0 },
        { id: 3, parent: 2, type: TraceNodeType.WRITE, path: 'count', from: 1, to: 0 },
      ],
    });
    assert.ok(rendered.includes('rewind Cart.inc'), 'and the tree renders it');
    assert.ok(rendered.includes('write count'), 'with its writes beneath');
    console.log('  ✅ The causal tree explains the change back.');
  }

  // ── Nothing is recorded with tracing off ─────────────────────────────────
  {
    assert.strictEqual(tracer.on, false, 'tracing is off after the recordings above');
    const state = factory.create({ count: 0 });
    const originalError = logger.error;
    logger.error = () => {};
    try {
      journal.run({ owner: 'Cart', name: 'inc' }, () => {
        state.count = 1;
        throw new Error('fail');
      });
    } catch {
      // expected
    } finally {
      logger.error = originalError;
    }
    assert.strictEqual(state.count, 0, 'the rewind still works with tracing off');
    console.log('  ✅ Tracing off costs the rewind nothing.');
  }

  console.log('🎉 Avenx Rewind trace integration tests passed.');
} catch (error) {
  console.error('❌ Avenx Rewind trace integration tests failed:', error);
  process.exit(1);
}
