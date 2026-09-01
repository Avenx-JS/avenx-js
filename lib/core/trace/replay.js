/**
 * @file replay.js
 * @description Deterministic replay of a recorded trace.
 *
 * Replay drives the *inputs* a session received — events, navigations, resource
 * settlements, and the non-deterministic globals the sandbox handed out — back
 * into a real application, and then compares what the application did against
 * what the recording says it did the first time.
 *
 * That comparison is the whole point, and it is why replay records a trace of
 * its own rather than simply asserting at the end. A replay that drove the
 * inputs and then checked a final value could pass while every intermediate
 * step was wrong. A replay that compares the observed write and DOM sequence
 * step by step cannot.
 *
 * ## Why observations are compared rather than trusted
 *
 * A recording marks itself best-effort when it detects an escape it knows
 * about: an unattributed write, a polling resource, a value it could not
 * serialize. Those checks are real but not exhaustive — bridge modules are
 * ordinary ES modules and are not sandboxed, so a `Date.now()` inside one is
 * invisible to the recorder.
 *
 * Replay therefore never trusts the recording's own claim. It re-derives
 * determinism by running the framework for real and diffing. A trace that
 * says "deterministic" and diverges fails loudly; a trace that says
 * "best-effort" and reproduces perfectly is reported as such but still refuses
 * to call itself verified unless the caller opts in.
 * @module lib/core/trace/replay
 */

import { nextTick } from '../reactive/scheduler.js';
import { tracer } from './tracer.js';
import { TraceRecorder } from './recorder.js';
import { installReplayGlobals, clearGlobalOverrides } from './globals.js';
import { installResourceResponses, clearResourceResponses } from './resource.js';
import { resolveNode } from './dom.js';
import { findContractViolations } from './contracts.js';
import {
  TraceNodeType,
  Determinism,
  INPUT_TYPES,
  validateTrace,
  indexNodes,
} from './schema.js';
import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';

/**
 * Settles pending microtasks, the scheduler queue and one macrotask turn.
 *
 * The scheduler's own `nextTick` covers batched component updates; the
 * macrotask turn is what lets a resolved resource promise land. Implemented
 * here rather than imported from the testing helpers so the replay engine does
 * not depend on the DOM mock.
 * @returns {Promise<void>}
 */
async function settle() {
  await nextTick();
  await new Promise((resolve) => {
    if (typeof globalThis.setImmediate === 'function') {
      globalThis.setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
  await nextTick();
}

/**
 * Reduces an observation node to the fields worth comparing.
 *
 * Ids, timestamps and sequence numbers are excluded: they differ between two
 * correct runs and comparing them would report divergence for every replay.
 * @param {object} node - A recorded node.
 * @returns {string|null} A comparable signature, or null for nodes not compared.
 */
function signature(node) {
  if (node.type === TraceNodeType.WRITE) {
    return `write ${node.path} ${JSON.stringify(node.from)} -> ${JSON.stringify(node.to)}${
      node.op ? ` (${node.op})` : ''
    }`;
  }
  if (node.type === TraceNodeType.DOM) {
    const target = node.target ? `${node.target.selector}[${node.target.nth}]` : '?';
    const name = node.name ? ` ${node.name}` : '';
    return `dom ${node.op} ${target}${name} ${JSON.stringify(node.from)} -> ${JSON.stringify(node.to)}`;
  }
  if (node.type === TraceNodeType.NAVIGATION) {
    return `nav ${node.from} -> ${node.to} (${node.page})`;
  }
  return null;
}

/**
 * Groups a trace's observations by the input that caused them.
 *
 * Every node is walked up to its causal root; nodes rooted at input *n* belong
 * to step *n*. Anything rooted elsewhere — an orphan left by truncation, an
 * unattributed write — is collected separately, because it is evidence about
 * the recording rather than about a step.
 * @param {object} trace - The trace.
 * @returns {{steps: object[], orphans: string[]}} Inputs with their observations.
 */
function groupByInput(trace) {
  const byId = indexNodes(trace);
  const stepOf = new Map();
  const steps = [];
  const orphans = [];

  for (const node of trace.nodes) {
    if (INPUT_TYPES.has(node.type) && (node.parent === null || node.parent === undefined)) {
      // A settled resource is a consequence, not a fresh input to drive.
      if (node.type === TraceNodeType.RESOURCE && node.phase === 'settled') {
        continue;
      }
      stepOf.set(node.id, steps.length);
      steps.push({ index: steps.length, input: node, observations: [] });
    }
  }

  for (const node of trace.nodes) {
    const sig = signature(node);
    if (!sig) {
      continue;
    }
    let current = node;
    while (current && !stepOf.has(current.id)) {
      current = current.parent === null || current.parent === undefined ? null : byId.get(current.parent);
    }
    if (current) {
      steps[stepOf.get(current.id)].observations.push(sig);
    } else {
      orphans.push(sig);
    }
  }

  return { steps, orphans };
}

/**
 * Builds the places an event target may be looked up, most specific first.
 *
 * A test mount is not attached to the document — `mountTestComponent` mounts
 * into a detached host — so resolving only against `document` would fail every
 * replay run from a test. The mounted subtree is therefore searched first, and
 * the document last, which also keeps a replay from reaching into unrelated
 * markup that happens to match the same selector.
 * @param {object|null} context - Whatever `mount()` returned.
 * @param {Document|Element} [explicit] - A root the caller supplied.
 * @returns {Array<Document|Element>} Candidate roots.
 */
function candidateRoots(context, explicit) {
  const roots = [];
  if (explicit) {
    roots.push(explicit);
  }
  if (context) {
    // The shape `mountTestComponent` returns, and the one an app-level mount
    // helper is most likely to mirror.
    for (const key of ['target', 'element', 'container', 'root']) {
      const candidate = context[key];
      if (candidate && typeof candidate.querySelectorAll === 'function') {
        roots.push(candidate);
      }
    }
  }
  if (typeof document !== 'undefined') {
    roots.push(document);
  }
  return roots;
}

/**
 * Dispatches a recorded event against the live application.
 * @param {object} input - The recorded event node.
 * @param {Array<Document|Element>} roots - Where to look for the target, in order.
 * @returns {{ok: boolean, error: string}} Whether the event could be delivered.
 */
function dispatchRecordedEvent(input, roots) {
  let target = null;
  for (const root of roots) {
    target = resolveNode(input.target, root);
    if (target) {
      break;
    }
  }
  if (!target) {
    return {
      ok: false,
      error: `could not find ${input.target ? `${input.target.selector}[${input.target.nth}]` : 'the event target'}`,
    };
  }

  // Field state is restored before dispatch, not asserted afterwards: for an
  // input event the typed value *is* the input, and the handler reads it off
  // the element.
  if (typeof input.value === 'string') {
    target.value = input.value;
  }
  if (typeof input.checked === 'boolean') {
    target.checked = input.checked;
  }

  const EventCtor = typeof globalThis.Event === 'function' ? globalThis.Event : null;
  if (!EventCtor) {
    return { ok: false, error: 'no DOM Event constructor is available in this environment' };
  }

  let event;
  if (input.key && typeof globalThis.KeyboardEvent === 'function') {
    event = new globalThis.KeyboardEvent(input.eventType, { bubbles: true, cancelable: true, key: input.key });
  } else {
    event = new EventCtor(input.eventType, { bubbles: true, cancelable: true });
  }

  target.dispatchEvent(event);
  return { ok: true };
}

/**
 * Replays a recorded trace against a live application.
 * @param {object} trace - A trace produced by a recording.
 * @param {object} options - Replay options.
 * @param {function(): (Promise<object>|object)} options.mount - Sets up and mounts the application.
 *   Whatever it returns is handed back to `at` as the context.
 * @param {function(object, object): (Promise<void>|void)} [options.at] - Called after each input
 *   with `(step, context)`, for the caller's own assertions.
 * @param {Document|Element} [options.root] - Where to resolve event targets. Defaults to the
 *   mounted subtree, falling back to `document`.
 * @param {object} [options.router] - A router to drive recorded navigations through.
 * @param {boolean} [options.allowBestEffort] - Accept a trace the recorder marked best-effort.
 *   Without this, replaying such a trace throws rather than reporting a pass it cannot stand behind.
 * @param {boolean} [options.strict] - Throw on divergence. Defaults to true.
 * @returns {Promise<object>} The replay result.
 * @throws {AvenxError} When the trace cannot be read, when it is best-effort and
 *   `allowBestEffort` was not set, or when replay diverged in strict mode.
 */
export async function replay(trace, options = {}) {
  const valid = validateTrace(trace);
  if (!valid.ok) {
    throw new AvenxError(AvenxErrorCodes.TRACE_UNREADABLE, valid.error);
  }
  if (typeof options.mount !== 'function') {
    throw new AvenxError(
      AvenxErrorCodes.TRACE_REPLAY_FAILED,
      'replay() needs a mount() option that sets up and mounts the application.',
    );
  }

  const recordedStatus = (trace.determinism && trace.determinism.status) || Determinism.DETERMINISTIC;
  if (recordedStatus !== Determinism.DETERMINISTIC && !options.allowBestEffort) {
    const reasons = ((trace.determinism && trace.determinism.reasons) || [])
      .map((entry) => `  - ${entry.reason}${entry.detail ? `: ${entry.detail}` : ''}`)
      .join('\n');
    throw new AvenxError(
      AvenxErrorCodes.TRACE_NOT_DETERMINISTIC,
      `${trace.id || 'this trace'}\n${reasons}`,
    );
  }

  const strict = options.strict !== false;
  const expected = groupByInput(trace);
  const problems = [];

  // Everything replay substitutes is installed together and torn down together,
  // so a thrown assertion cannot leave a fake clock behind for the next test.
  const exhausted = [];
  const missingResources = [];
  installReplayGlobals(trace.globals || {}, (source) => exhausted.push(source));
  installResourceResponses(trace, (name) => missingResources.push(name));

  const observer = new TraceRecorder({ id: `${trace.id || 'trace'}-replay` });
  const steps = [];
  /**
   * Where event targets are looked up. Assigned once `mount()` has returned the
   * context, because the mounted subtree is the most specific place to search.
   * @type {Array<Document|Element>}
   */
  let roots;

  try {
    tracer.attach(observer);
    const context = await options.mount();
    await settle();
    roots = candidateRoots(context, options.root);

    // Mount noise is not the session; recording of divergences starts here.
    observer.arm();

    for (const step of expected.steps) {
      const before = observer.nodes.length;
      const input = step.input;

      if (input.type === TraceNodeType.EVENT) {
        const delivered = dispatchRecordedEvent(input, roots);
        if (!delivered.ok) {
          problems.push({ step: step.index, kind: 'input', detail: delivered.error });
        }
      } else if (input.type === TraceNodeType.NAVIGATION) {
        const router = options.router || (context && context.router);
        if (router && typeof router.navigate === 'function') {
          router.navigate(input.to);
        } else {
          problems.push({
            step: step.index,
            kind: 'input',
            detail: `the trace navigates to ${input.to} but no router was supplied to replay()`,
          });
        }
      }

      await settle();

      const observed = observer.nodes
        .slice(before)
        .map(signature)
        .filter(Boolean);

      const divergence = diff(step.observations, observed);
      if (divergence) {
        problems.push({ step: step.index, kind: 'divergence', ...divergence });
      }

      const record = {
        index: step.index,
        type: input.type,
        label: describeInput(input),
        expected: step.observations,
        observed,
        diverged: !!divergence,
      };
      steps.push(record);

      // In strict mode the first divergence ends the replay before the
      // caller's own assertions run. Once a step has diverged, every later
      // assertion is comparing against a state the recording never reached, and
      // a bare "expected 1, got 2" from step four is a much worse explanation
      // than the causal report for step one.
      if (divergence && strict) {
        throw new AvenxError(
          AvenxErrorCodes.TRACE_REPLAY_DIVERGED,
          formatProblems({ traceId: trace.id, steps, problems }),
        );
      }

      if (typeof options.at === 'function') {
        await options.at(record, context);
      }
    }
  } finally {
    tracer.detach();
    clearGlobalOverrides();
    clearResourceResponses();
  }

  for (const source of exhausted) {
    problems.push({
      step: -1,
      kind: 'exhausted',
      detail: `replay read more ${source} values than the recording captured`,
    });
  }
  for (const name of missingResources) {
    problems.push({
      step: -1,
      kind: 'exhausted',
      detail: `<resource name="${name}"> asked for a response the trace does not contain`,
    });
  }

  const result = {
    ok: problems.length === 0,
    traceId: trace.id,
    recordedDeterminism: recordedStatus,
    // Determinism is re-derived from the run rather than copied from the trace.
    // This is the only claim in the system backed by evidence.
    verified: problems.length === 0 && recordedStatus === Determinism.DETERMINISTIC,
    steps,
    problems,
    orphans: expected.orphans,
    contractViolations: findContractViolations(trace),
  };

  if (!result.ok && strict) {
    throw new AvenxError(AvenxErrorCodes.TRACE_REPLAY_DIVERGED, formatProblems(result));
  }

  return result;
}

/**
 * Compares an expected observation sequence against what replay saw.
 * @param {string[]} expectedSigs - Signatures from the recording.
 * @param {string[]} observedSigs - Signatures from this run.
 * @returns {{expected: string[], observed: string[], at: number}|null} The first
 *   point of difference, or null when the sequences match.
 */
function diff(expectedSigs, observedSigs) {
  const limit = Math.max(expectedSigs.length, observedSigs.length);
  for (let i = 0; i < limit; i++) {
    if (expectedSigs[i] !== observedSigs[i]) {
      return { expected: expectedSigs, observed: observedSigs, at: i };
    }
  }
  return null;
}

/**
 * Describes a replayed input in one line.
 * @param {object} input - The input node.
 * @returns {string} A label such as `click <button.qty-inc>`.
 */
function describeInput(input) {
  if (input.type === TraceNodeType.EVENT) {
    const target = input.target ? `<${input.target.selector}>` : '<unknown>';
    return `${input.eventType} ${target}`;
  }
  if (input.type === TraceNodeType.NAVIGATION) {
    return `navigate ${input.to}`;
  }
  return input.type;
}

/**
 * Renders a replay's problems as a developer-readable report.
 * @param {object} result - A replay result.
 * @returns {string} The report.
 */
export function formatProblems(result) {
  const lines = [`Replay of ${result.traceId || 'trace'} diverged from the recording.`, ''];

  for (const problem of result.problems) {
    if (problem.kind === 'divergence') {
      const step = result.steps[problem.step];
      lines.push(`Step ${problem.step + 1} (${step ? step.label : 'unknown'}) diverged at position ${problem.at + 1}:`);
      lines.push(`  recorded: ${problem.expected[problem.at] ?? '(nothing more)'}`);
      lines.push(`  replayed: ${problem.observed[problem.at] ?? '(nothing more)'}`);
      lines.push('');
    } else if (problem.kind === 'input') {
      lines.push(`Step ${problem.step + 1}: ${problem.detail}`);
      lines.push('');
    } else {
      lines.push(`${problem.detail}`);
      lines.push('');
    }
  }

  lines.push(
    'A divergence means the recorded session cannot be reproduced from its inputs alone —',
    'usually because something outside the sandbox boundary (a bridge reading the clock, a',
    'timer, a request made outside a <resource>) took part in the original run.',
  );

  return lines.join('\n');
}
