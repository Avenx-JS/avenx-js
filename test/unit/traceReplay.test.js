import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { mountTestComponent, flushPromises, replay } from '../../lib/core/testing.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { installRecordingGlobals, clearGlobalOverrides } from '../../lib/core/trace/globals.js';
import { Determinism, TRACE_VERSION } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing deterministic replay...');

/**
 * A counter, the smallest thing with a real causal chain.
 */
class CounterComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { count: 0 },
      {},
      bridges,
      '<div class="counter"><span class="value">{{ count }}</span>' +
        '<button class="inc" @click="increment()">+</button></div>',
      { increment: 'state.count = state.count + 1;' },
      props,
    );
  }
}

/**
 * Mounts a component into a fresh host and records a scripted interaction.
 * @param {Function} ComponentClass - What to mount.
 * @param {function(object): Promise<void>} interact - Drives the mounted wrapper.
 * @param {object} [options] - Recorder options.
 * @returns {Promise<object>} The finished trace.
 */
async function record(ComponentClass, interact, options = {}) {
  const wrapper = await mountTestComponent(ComponentClass, {});
  const recorder = startRecording(options);
  recorder.arm();
  installRecordingGlobals(recorder);
  try {
    await interact(wrapper);
    await flushPromises();
  } finally {
    clearGlobalOverrides();
    stopRecording();
    wrapper.unmount();
  }
  return recorder.toJSON();
}

/**
 * Clicks a selector n times, flushing between each.
 * @param {object} wrapper - A mounted wrapper.
 * @param {string} selector - What to click.
 * @param {number} times - How many clicks.
 */
async function click(wrapper, selector, times = 1) {
  for (let i = 0; i < times; i++) {
    wrapper.find(selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flushPromises();
  }
}

// --- A deterministic trace replays and is verified --------------------------

const trace = await record(CounterComponent, (wrapper) => click(wrapper, 'button.inc', 3));
assert.strictEqual(trace.traceVersion, TRACE_VERSION);
assert.strictEqual(trace.determinism.status, Determinism.DETERMINISTIC, 'the recording is deterministic');

let mountedWrapper = null;
const result = await replay(trace, {
  mount: async () => {
    mountedWrapper = await mountTestComponent(CounterComponent, {});
    return mountedWrapper;
  },
});

assert.strictEqual(result.ok, true, 'replay reproduced the session');
assert.strictEqual(result.verified, true, 'and verified it against a deterministic recording');
assert.strictEqual(result.steps.length, 3, `three inputs replayed, got ${result.steps.length}`);
assert.deepStrictEqual(
  result.steps.map((s) => s.label),
  ['click <button.inc>', 'click <button.inc>', 'click <button.inc>'],
  'each recorded click was driven',
);
assert.ok(result.steps.every((s) => !s.diverged), 'no step diverged');
assert.deepStrictEqual(result.problems, []);

// The application really ran: the replayed component reached the same state.
assert.strictEqual(mountedWrapper.instance.state.count, 3, 'replay drove the real framework, not a mock');
assert.ok(mountedWrapper.element.outerHTML.includes('>3<'), 'and the real DOM updated');
mountedWrapper.unmount();

// The recorded writes were reproduced, not just the end state.
assert.deepStrictEqual(
  result.steps.map((s) => s.expected.find((sig) => sig.startsWith('write'))),
  ['write count 0 -> 1', 'write count 1 -> 2', 'write count 2 -> 3'],
  'each intermediate write is compared, not only the final value',
);
for (const step of result.steps) {
  assert.deepStrictEqual(step.observed, step.expected, `step ${step.index} matched exactly`);
}

// --- The per-step callback receives each step -------------------------------

const seen = [];
await replay(trace, {
  mount: async () => {
    mountedWrapper = await mountTestComponent(CounterComponent, {});
    return mountedWrapper;
  },
  at(step, context) {
    seen.push([step.index, context.instance.state.count]);
  },
});
assert.deepStrictEqual(seen, [[0, 1], [1, 2], [2, 3]], 'at() runs after each input with the live context');
mountedWrapper.unmount();

// --- Replay is repeatable ---------------------------------------------------

const again = await replay(trace, {
  mount: async () => {
    mountedWrapper = await mountTestComponent(CounterComponent, {});
    return mountedWrapper;
  },
});
assert.strictEqual(again.ok, true, 'replaying the same trace twice gives the same answer');
mountedWrapper.unmount();

// --- Divergence is detected and reported, never swallowed -------------------

/**
 * The same component after a "code change" that breaks the increment.
 */
class BrokenCounterComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { count: 0 },
      {},
      bridges,
      '<div class="counter"><span class="value">{{ count }}</span>' +
        '<button class="inc" @click="increment()">+</button></div>',
      // The regression: adds two instead of one.
      { increment: 'state.count = state.count + 2;' },
      props,
    );
  }
}

let brokenWrapper = null;
await assert.rejects(
  () =>
    replay(trace, {
      mount: async () => {
        brokenWrapper = await mountTestComponent(BrokenCounterComponent, {});
        return brokenWrapper;
      },
    }),
  (error) => {
    assert.strictEqual(error.code, 'AVX_R27', 'divergence raises the replay-diverged diagnostic');
    assert.ok(error.message.includes('write count 0 -> 1'), 'the report names what was recorded');
    assert.ok(error.message.includes('write count 0 -> 2'), 'and what actually happened');
    assert.ok(error.message.includes('Step 1'), 'and which step');
    return true;
  },
  'a changed application must not replay as a pass',
);
if (brokenWrapper) {
  brokenWrapper.unmount();
}

// Non-strict replay reports the divergence instead of throwing.
const lenient = await replay(trace, {
  strict: false,
  mount: async () => {
    brokenWrapper = await mountTestComponent(BrokenCounterComponent, {});
    return brokenWrapper;
  },
});
assert.strictEqual(lenient.ok, false, 'a non-strict replay still reports failure');
assert.strictEqual(lenient.verified, false, 'and never claims verification');
assert.ok(lenient.problems.length > 0, 'the problems are enumerated');
assert.strictEqual(lenient.problems[0].kind, 'divergence');
brokenWrapper.unmount();

// --- A best-effort trace refuses to replay silently -------------------------

const strayTrace = await record(CounterComponent, async (wrapper) => {
  await click(wrapper, 'button.inc', 1);
  // A mutation with no recorded input, exactly like a stray timer.
  wrapper.instance.state.count = 99;
  await flushPromises();
});
assert.strictEqual(strayTrace.determinism.status, Determinism.BEST_EFFORT, 'the recording caught the stray write');

await assert.rejects(
  () =>
    replay(strayTrace, {
      mount: async () => {
        mountedWrapper = await mountTestComponent(CounterComponent, {});
        return mountedWrapper;
      },
    }),
  (error) => {
    assert.strictEqual(error.code, 'AVX_R26');
    assert.ok(error.message.includes('unattributed-write'), 'the refusal names the reason');
    assert.ok(error.message.includes('allowBestEffort'), 'and says how to proceed anyway');
    return true;
  },
  'a best-effort trace must not replay as if it were reproducible',
);
if (mountedWrapper) {
  mountedWrapper.unmount();
}

// Opting in runs it, but the result is never marked verified.
const optedIn = await replay(strayTrace, {
  allowBestEffort: true,
  strict: false,
  mount: async () => {
    mountedWrapper = await mountTestComponent(CounterComponent, {});
    return mountedWrapper;
  },
});
assert.strictEqual(optedIn.recordedDeterminism, Determinism.BEST_EFFORT);
assert.strictEqual(optedIn.verified, false, 'a best-effort trace is never reported as verified, even when it passes');
mountedWrapper.unmount();

// --- Unreadable traces are rejected -----------------------------------------

await assert.rejects(
  () => replay({ traceVersion: TRACE_VERSION + 1, nodes: [] }, { mount: () => ({}) }),
  (error) => {
    assert.strictEqual(error.code, 'AVX_R25');
    return true;
  },
  'a newer trace format is refused rather than misread',
);

await assert.rejects(
  () => replay(trace, {}),
  (error) => {
    assert.strictEqual(error.code, 'AVX_R28');
    assert.ok(error.message.includes('mount()'));
    return true;
  },
  'replay without mount() explains itself',
);

// --- A missing event target is reported, not silently skipped ---------------

/**
 * A component whose button carries a different class than the recording expects.
 */
class RenamedComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { count: 0 },
      {},
      bridges,
      '<div class="counter"><span class="value">{{ count }}</span>' +
        '<button class="renamed" @click="increment()">+</button></div>',
      { increment: 'state.count = state.count + 1;' },
      props,
    );
  }
}

let renamedWrapper = null;
const renamed = await replay(trace, {
  strict: false,
  mount: async () => {
    renamedWrapper = await mountTestComponent(RenamedComponent, {});
    return renamedWrapper;
  },
});
assert.strictEqual(renamed.ok, false, 'an unfindable target fails the replay');
assert.ok(
  renamed.problems.some((p) => p.kind === 'input' && p.detail.includes('button.inc')),
  'the report names the selector that could not be found',
);
renamedWrapper.unmount();

// --- The tracer is left clean after every replay ----------------------------

const { tracer } = await import('../../lib/core/trace/tracer.js');
assert.strictEqual(tracer.on, false, 'replay detaches its observer even after throwing');
const { hasGlobalOverrides } = await import('../../lib/core/trace/globals.js');
assert.strictEqual(hasGlobalOverrides(), false, 'and restores the real globals');

console.log('✅ All replay tests passed.');
