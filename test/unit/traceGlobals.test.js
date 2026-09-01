import assert from 'assert';
import { DynamicEvaluator } from '../../lib/core/security/evaluator.js';
import { AvenxSandbox } from '../../lib/core/security/sandbox.js';
import {
  resolveSandboxGlobal,
  hasGlobalOverrides,
  clearGlobalOverrides,
  installRecordingGlobals,
  installReplayGlobals,
} from '../../lib/core/trace/globals.js';
import { TraceRecorder } from '../../lib/core/trace/recorder.js';

console.log('🧪 Testing sandbox global substitution (determinism keystone)...');

const evaluator = new DynamicEvaluator();

// --- Pass-through when nothing is substituted -------------------------------

assert.strictEqual(hasGlobalOverrides(), false, 'no substitutions by default');
assert.strictEqual(resolveSandboxGlobal('Math'), Math, 'Math resolves to the real Math');
assert.strictEqual(resolveSandboxGlobal('JSON'), JSON, 'JSON resolves to the real JSON');
assert.strictEqual(resolveSandboxGlobal('Date'), Date, 'Date resolves to the real Date');

// Untraced evaluation behaves exactly as before the hook was added.
assert.strictEqual(evaluator.evaluateExpression('Math.max(1, 5)', {}), 5);
assert.strictEqual(evaluator.evaluateExpression('Math.floor(2.7)', {}), 2);
assert.strictEqual(evaluator.evaluateExpression('JSON.stringify({a:1})', {}), '{"a":1}');
const realNow = evaluator.evaluateExpression('Date.now()', {});
assert.ok(typeof realNow === 'number' && realNow > 0, 'the real clock is reachable when untraced');

// Restricted globals stay restricted — substitution must not widen the sandbox.
assert.throws(
  () => evaluator.evaluateExpression('window.location', {}),
  /Sandbox Violation/,
  'restricted globals are still blocked',
);

// --- Recording mode logs what template code observed ------------------------

const recorder = new TraceRecorder();
installRecordingGlobals(recorder);
assert.strictEqual(hasGlobalOverrides(), true, 'recording installs substitutions');

const t1 = evaluator.evaluateExpression('Date.now()', {});
const t2 = evaluator.evaluateExpression('Date.now()', {});
assert.strictEqual(typeof t1, 'number', 'a recording clock still returns a real reading');
assert.deepStrictEqual(recorder.globals.now, [t1, t2], 'every clock read is logged, in order');

const r1 = evaluator.evaluateExpression('Math.random()', {});
assert.ok(r1 >= 0 && r1 < 1, 'a recording Math.random still returns a usable value');
assert.deepStrictEqual(recorder.globals.random, [r1], 'random reads are logged');

// Non-substituted members of Math still work through the prototype chain.
assert.strictEqual(evaluator.evaluateExpression('Math.max(3, 9)', {}), 9, 'Math.max survives substitution');
assert.strictEqual(evaluator.evaluateExpression('Math.round(Math.PI)', {}), 3, 'Math.PI survives substitution');
assert.strictEqual(recorder.globals.now.length, 2, 'unrelated Math members are not logged as clock reads');

// `new Date()` is recorded; `new Date(explicit)` is not a non-deterministic read.
const constructed = evaluator.evaluateExpression('new Date().getTime()', {});
assert.strictEqual(typeof constructed, 'number');
assert.strictEqual(recorder.globals.now.length, 3, 'a bare `new Date()` counts as a clock read');
evaluator.evaluateExpression('new Date(0).getTime()', {});
assert.strictEqual(recorder.globals.now.length, 3, 'an explicit Date argument is deterministic already');
assert.strictEqual(evaluator.evaluateExpression('new Date(0).getTime()', {}), 0, 'explicit dates are exact');

// Instances are genuine Dates, so application type checks keep working.
assert.strictEqual(
  evaluator.evaluateExpression('(new Date(0)) instanceof Date', {}),
  true,
  'instanceof Date still holds under substitution',
);

clearGlobalOverrides();
assert.strictEqual(hasGlobalOverrides(), false);
assert.strictEqual(resolveSandboxGlobal('Date'), Date, 'clearing restores the real globals');

// --- Replay mode hands the recorded sequence back ---------------------------

const exhausted = [];
installReplayGlobals({ now: [1000, 2000, 3000], random: [0.25, 0.75] }, (src) => exhausted.push(src));

assert.strictEqual(evaluator.evaluateExpression('Date.now()', {}), 1000, 'replay returns recorded readings in order');
assert.strictEqual(evaluator.evaluateExpression('Date.now()', {}), 2000);
assert.strictEqual(evaluator.evaluateExpression('new Date().getTime()', {}), 3000, 'new Date() draws from the same log');
assert.strictEqual(evaluator.evaluateExpression('Math.random()', {}), 0.25);
assert.strictEqual(evaluator.evaluateExpression('Math.random()', {}), 0.75);
assert.deepStrictEqual(exhausted, [], 'nothing was exhausted while the log lasted');

// Replaying the same trace twice must produce the same values.
clearGlobalOverrides();
installReplayGlobals({ now: [1000, 2000, 3000], random: [0.25, 0.75] }, () => {});
assert.strictEqual(evaluator.evaluateExpression('Date.now()', {}), 1000, 'replay is repeatable');

// --- Exhaustion is reported, never papered over -----------------------------

clearGlobalOverrides();
const overruns = [];
installReplayGlobals({ now: [42], random: [] }, (src) => overruns.push(src));
assert.strictEqual(evaluator.evaluateExpression('Date.now()', {}), 42);
evaluator.evaluateExpression('Date.now()', {});
assert.deepStrictEqual(overruns, ['Date.now'], 'reading past the recorded log is reported');
evaluator.evaluateExpression('Math.random()', {});
assert.deepStrictEqual(overruns, ['Date.now', 'Math.random'], 'each exhausted source is reported');

clearGlobalOverrides();

// --- Substitution reaches action bodies, not just interpolations ------------

const recorder2 = new TraceRecorder();
installRecordingGlobals(recorder2);
const scope = { state: { stamp: 0 } };
evaluator.executeStatement('state.stamp = Date.now();', scope, scope);
assert.strictEqual(recorder2.globals.now.length, 1, 'action bodies resolve globals through the same sandbox');
assert.strictEqual(scope.state.stamp, recorder2.globals.now[0], 'the action saw the logged value');
clearGlobalOverrides();

// --- A raw sandbox proxy resolves through the hook too ----------------------

installReplayGlobals({ now: [777], random: [] }, () => {});
const proxy = AvenxSandbox.createProxy({}, {});
assert.strictEqual(proxy.Date.now(), 777, 'createProxy consumers see the substitution');
clearGlobalOverrides();

console.log('✅ All sandbox global substitution tests passed.');
