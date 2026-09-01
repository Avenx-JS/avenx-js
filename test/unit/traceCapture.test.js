import assert from 'assert';
import { captureValue, wasLossy, formatCaptured } from '../../lib/core/trace/capture.js';
import { Redactor, NO_REDACTION } from '../../lib/core/trace/redact.js';
import { REDACTED } from '../../lib/core/trace/schema.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';

console.log('🧪 Testing trace value capture and redaction...');

// --- Redaction patterns -----------------------------------------------------

const exact = new Redactor(['auth.token']);
assert.ok(exact.matches('auth.token'), 'exact path matches');
assert.ok(exact.matches('auth.token.value'), 'nested values under a match are also withheld');
assert.ok(!exact.matches('auth.user'), 'siblings are untouched');
assert.ok(!exact.matches('authtoken'), 'segment boundaries are respected');

const single = new Redactor(['user.*']);
assert.ok(single.matches('user.email'), 'single-segment wildcard matches');
assert.ok(single.matches('user.email.domain'), 'nesting beneath a wildcard match is covered');
assert.ok(!single.matches('user'), 'the wildcard requires a segment');

const suffix = new Redactor(['*.password']);
assert.ok(suffix.matches('form.password'), 'leading wildcard matches');
assert.ok(!suffix.matches('password'), 'a leading wildcard still requires a prefix segment');

const deep = new Redactor(['secrets.**']);
assert.ok(deep.matches('secrets'), 'deep wildcard covers the root itself');
assert.ok(deep.matches('secrets.a.b.c'), 'deep wildcard covers any depth');
assert.ok(!deep.matches('public.a'), 'deep wildcard is still anchored');

const all = new Redactor(['**']);
assert.ok(all.matches('anything.at.all'), 'a bare deep wildcard matches everything');

assert.ok(NO_REDACTION.isEmpty, 'the shared empty redactor has no rules');
assert.ok(!NO_REDACTION.matches('auth.token'), 'the empty redactor matches nothing');

// Duplicate and junk patterns are ignored rather than duplicated
const dedup = new Redactor(['a.b', 'a.b', '', '   ']);
assert.strictEqual(dedup.patterns.length, 1, 'patterns are de-duplicated and blanks dropped');

// --- Basic capture ----------------------------------------------------------

assert.strictEqual(captureValue(42), 42);
assert.strictEqual(wasLossy(), false, 'a number is captured exactly');
assert.strictEqual(captureValue('hi'), 'hi');
assert.strictEqual(captureValue(true), true);
assert.strictEqual(captureValue(null), null);
assert.strictEqual(captureValue(undefined), null, 'undefined normalises to null for JSON');

assert.deepStrictEqual(captureValue({ a: 1, b: [2, 3] }), { a: 1, b: [2, 3] });
assert.strictEqual(wasLossy(), false, 'plain data is captured exactly');

// --- Lossy capture is reported ---------------------------------------------

captureValue(() => {});
assert.strictEqual(wasLossy(), true, 'a function is lossy');

captureValue(NaN);
assert.strictEqual(wasLossy(), true, 'NaN has no JSON form, so it is lossy rather than null');

captureValue(Infinity);
assert.strictEqual(wasLossy(), true, 'Infinity is lossy');

const cyclic = { name: 'root' };
cyclic.self = cyclic;
const capturedCycle = captureValue(cyclic);
assert.strictEqual(capturedCycle.self, '[Circular]', 'cycles are broken, not followed');
assert.strictEqual(wasLossy(), true, 'a cycle is lossy');

class Widget {
  constructor() {
    this.id = 1;
  }
}
const capturedClass = captureValue(new Widget());
assert.strictEqual(capturedClass, '[Widget]', 'class instances are summarised by name');
assert.strictEqual(wasLossy(), true, 'a class instance is lossy');

captureValue(new Map([['a', 1]]));
assert.strictEqual(wasLossy(), true, 'a Map is lossy');

// A Date survives exactly, in a form replay can restore
const captureDate = captureValue(new Date('2026-08-27T10:00:00.000Z'));
assert.deepStrictEqual(captureDate, { $date: '2026-08-27T10:00:00.000Z' });
assert.strictEqual(wasLossy(), false, 'a Date is captured exactly');

const capturedError = captureValue(new TypeError('bad input'));
assert.deepStrictEqual(capturedError, { $error: 'TypeError', message: 'bad input' });

// --- Bounds -----------------------------------------------------------------

const wide = Array.from({ length: 200 }, (_, i) => i);
const capturedWide = captureValue(wide, { maxItems: 10 });
assert.strictEqual(capturedWide.length, 11, 'breadth is bounded and the remainder summarised');
assert.strictEqual(capturedWide[10], '… (+190 more)');
assert.strictEqual(wasLossy(), true, 'truncating breadth is lossy');

let nested = { leaf: true };
for (let i = 0; i < 10; i++) {
  nested = { child: nested };
}
captureValue(nested, { maxDepth: 3 });
assert.strictEqual(wasLossy(), true, 'exceeding the depth budget is lossy');

const longString = 'x'.repeat(1000);
const capturedString = captureValue(longString, { maxString: 20 });
assert.ok(capturedString.includes('+980 chars'), 'long strings are truncated with a count');
assert.strictEqual(wasLossy(), true, 'truncating a string is lossy');

// A hostile getter must not break the recorder
const hostile = {
  get boom() {
    throw new Error('nope');
  },
};
assert.strictEqual(captureValue(hostile), '[Uncapturable]', 'a throwing getter is contained');
assert.strictEqual(wasLossy(), true, 'an uncapturable value is lossy');

// --- Redaction is applied during capture ------------------------------------

const redactor = new Redactor(['auth.token', 'user.*']);
const captured = captureValue(
  { token: 'super-secret', expiresIn: 3600 },
  { path: 'auth', redactor },
);
assert.strictEqual(captured.token, REDACTED, 'the matched value never enters the capture');
assert.strictEqual(captured.expiresIn, 3600, 'siblings survive');
assert.ok(redactor.applied, 'the redactor records that it fired');
assert.ok(redactor.matchedPaths.has('auth.token'));

// Redacting a whole subtree
const wholeValue = captureValue({ email: 'a@b.c', name: 'A' }, { path: 'user', redactor });
assert.strictEqual(wholeValue.email, REDACTED);
assert.strictEqual(wholeValue.name, REDACTED, 'every segment under user.* is covered');

// A redacted value must not appear anywhere in the serialized output
assert.ok(
  !JSON.stringify(captured).includes('super-secret'),
  'the secret is absent from the serialized capture',
);

const untouched = new Redactor(['never.matches']);
captureValue({ a: 1 }, { path: 'other', redactor: untouched });
assert.strictEqual(untouched.applied, false, 'declaring rules is not the same as applying them');

// --- Reactive proxies are unwrapped, not tracked ----------------------------

const factory = new StateFactory();
const state = factory.create({ count: 1, items: [{ qty: 2 }] });
const capturedState = captureValue(state);
assert.deepStrictEqual(capturedState, { count: 1, items: [{ qty: 2 }] }, 'proxies capture as plain data');
assert.strictEqual(wasLossy(), false, 'a reactive plain object is captured exactly');
assert.ok(
  JSON.parse(JSON.stringify(capturedState)),
  'the capture survives a JSON round trip',
);

// --- Display formatting -----------------------------------------------------

assert.strictEqual(formatCaptured('a'), '"a"');
assert.strictEqual(formatCaptured(3), '3');
assert.strictEqual(formatCaptured(null), 'null');
assert.strictEqual(formatCaptured([1, 2]), '[2 items]');
assert.strictEqual(formatCaptured([1]), '[1 item]');
assert.strictEqual(formatCaptured({ $date: '2026-01-01' }), '2026-01-01');
assert.strictEqual(formatCaptured({ $error: 'Error', message: 'x' }), 'Error: x');

console.log('✅ All trace capture and redaction tests passed.');
