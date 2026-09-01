import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { mountTestComponent, flushPromises } from '../../lib/core/testing.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { installRecordingGlobals, clearGlobalOverrides } from '../../lib/core/trace/globals.js';
import { findContractViolations, formatViolation } from '../../lib/core/trace/contracts.js';
import { TraceNodeType } from '../../lib/core/trace/schema.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

console.log('🧪 Testing contract integration with traces...');

/**
 * A component that declares `deterministic` and then reads the clock anyway —
 * indirectly enough that source-pattern matching at build time would not
 * necessarily catch it.
 */
class StampComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { stamp: 0 },
      {},
      bridges,
      '<div><span class="stamp">{{ stamp }}</span><button class="go" @click="mark()">go</button></div>',
      { mark: 'state.stamp = Date.now();' },
      props,
      {},
      {},
      { contracts: ['deterministic'] },
    );
  }
}

const wrapper = await mountTestComponent(StampComponent, {});
const recorder = startRecording();
recorder.arm();
installRecordingGlobals(recorder);

wrapper.find('button.go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();

clearGlobalOverrides();
stopRecording();

const trace = recorder.toJSON();

// The declared contract travelled onto the action node.
const action = trace.nodes.find((n) => n.type === TraceNodeType.ACTION);
assert.ok(action, 'the action was recorded');
assert.deepStrictEqual(action.contracts, ['deterministic'], 'the declared contract is on the node');

// The clock read was located in the causal graph.
const globalRead = trace.nodes.find((n) => n.type === TraceNodeType.GLOBAL);
assert.ok(globalRead, 'the non-deterministic read was located');
assert.strictEqual(globalRead.source, 'Date.now');
assert.strictEqual(globalRead.parent, action.id, 'the read is attributed to the action that made it');

// And the contract check finds it.
const violations = findContractViolations(trace);
assert.strictEqual(violations.length, 1, `one violation, got ${violations.length}`);
assert.strictEqual(violations[0].code, AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION);
assert.strictEqual(violations[0].contract, 'deterministic');
assert.strictEqual(violations[0].unit, 'StampComponent.mark()');
assert.ok(violations[0].detail.includes('Date.now'), 'the violation names what was read');

const line = formatViolation(violations[0]);
assert.ok(line.includes('AVX_W33'), 'the compiler diagnostic code is reused, not a new one');
assert.ok(line.includes('StampComponent.mark()'));

// The recorded values were still real, so the app behaved normally.
assert.ok(wrapper.instance.state.stamp > 0, 'the action still ran and set a real timestamp');
assert.strictEqual(trace.globals.now.length, 1, 'the clock read was logged for replay');
wrapper.unmount();

// --- A component that honours its contract produces no violations -----------

/**
 * A `deterministic` component that really is deterministic.
 */
class HonestComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { n: 0 },
      {},
      bridges,
      '<div><span class="n">{{ n }}</span><button class="go" @click="bump()">go</button></div>',
      { bump: 'state.n = state.n + 1;' },
      props,
      {},
      {},
      { contracts: ['deterministic'] },
    );
  }
}

const honest = await mountTestComponent(HonestComponent, {});
const honestRecorder = startRecording();
honestRecorder.arm();
installRecordingGlobals(honestRecorder);
honest.find('button.go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
clearGlobalOverrides();
stopRecording();

assert.deepStrictEqual(
  findContractViolations(honestRecorder.toJSON()),
  [],
  'a component that honours its contract reports nothing',
);
honest.unmount();

// --- A `pure` unit that writes state is caught ------------------------------

const pureTrace = {
  nodes: [
    { id: 1, parent: null, type: TraceNodeType.EVENT, eventType: 'click' },
    { id: 2, parent: 1, type: TraceNodeType.ACTION, name: 'render', component: 'Badge', contracts: ['pure'] },
    { id: 3, parent: 2, type: TraceNodeType.WRITE, path: 'cache.lastSeen', from: 0, to: 1 },
  ],
};
const pureViolations = findContractViolations(pureTrace);
assert.strictEqual(pureViolations.length, 1);
assert.strictEqual(pureViolations[0].code, AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION);
assert.strictEqual(pureViolations[0].unit, 'Badge.render()');
assert.ok(pureViolations[0].detail.includes('cache.lastSeen'));

// --- Violations are found through indirection, which is the point -----------

const indirect = {
  nodes: [
    { id: 1, parent: null, type: TraceNodeType.EVENT, eventType: 'click' },
    { id: 2, parent: 1, type: TraceNodeType.ACTION, name: 'refresh', component: 'Feed', contracts: ['deterministic'] },
    { id: 3, parent: 2, type: TraceNodeType.BRIDGE_ACTION, bridge: 'clock', name: 'tick' },
    { id: 4, parent: 3, type: TraceNodeType.GLOBAL, source: 'Math.random', kind: 'random' },
  ],
};
const indirectViolations = findContractViolations(indirect);
assert.strictEqual(indirectViolations.length, 1, 'a violation two levels down is still attributed');
assert.strictEqual(indirectViolations[0].unit, 'Feed.refresh()');
assert.ok(
  indirectViolations[0].detail.includes('Math.random'),
  'source-pattern matching at build time would not have seen this one',
);

// --- Undeclared units are not policed ---------------------------------------

const undeclared = {
  nodes: [
    { id: 1, parent: null, type: TraceNodeType.ACTION, name: 'go', component: 'Free' },
    { id: 2, parent: 1, type: TraceNodeType.GLOBAL, source: 'Date.now', kind: 'now' },
    { id: 3, parent: 1, type: TraceNodeType.WRITE, path: 'x' },
  ],
};
assert.deepStrictEqual(findContractViolations(undeclared), [], 'code that declared nothing is not policed');
assert.deepStrictEqual(findContractViolations({ nodes: [] }), [], 'an empty trace has no violations');
assert.deepStrictEqual(findContractViolations({}), [], 'a trace with no nodes array is handled');

console.log('✅ All contract integration tests passed.');
