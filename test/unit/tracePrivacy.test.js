import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { bridge } from '../../lib/core/runtime/bridge.js';
import { mountTestComponent, flushPromises } from '../../lib/core/testing.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import { generateTest } from '../../lib/core/trace/exportTest.js';
import { formatTrace } from '../../lib/core/trace/format.js';
import { REDACTED, TraceNodeType, Determinism } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing privacy: redacted values never reach a trace...');

const SECRET_TOKEN = 'tok_live_51H8xQzSECRETVALUE';
const SECRET_PASSWORD = 'hunter2-correct-horse';
const SECRET_EMAIL = 'ada@lovelace.example';

/**
 * A sign-in form that handles exactly the values a team would not want
 * appearing in a trace attached to a bug report.
 */
class SignInComponent extends AvenxComponent {
  /**
   * @param {object} bridges - Bridges.
   * @param {object} props - Props.
   */
  constructor(bridges, props) {
    super(
      { auth: { token: '', status: 'anonymous' }, form: { password: '', remember: false }, user: { email: '' } },
      {},
      bridges,
      '<div class="signin">' +
        '<span class="status">{{ auth.status }}</span>' +
        '<button class="go" @click="signIn()">Sign in</button>' +
        '</div>',
      {
        signIn:
          `state.form.password = ${JSON.stringify(SECRET_PASSWORD)};` +
          `state.user.email = ${JSON.stringify(SECRET_EMAIL)};` +
          `state.auth.token = ${JSON.stringify(SECRET_TOKEN)};` +
          "state.auth.status = 'authenticated';",
      },
      props,
    );
  }
}

const wrapper = await mountTestComponent(SignInComponent, {});

const recorder = startRecording({
  id: 'trace-private',
  redact: ['auth.token', 'form.password', 'user.*'],
  meta: { url: 'http://localhost:3000/#/signin' },
});
recorder.arm();

wrapper.find('button.go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
stopRecording();

const trace = recorder.toJSON();
const serialized = JSON.stringify(trace);

// --- The secrets are simply not there ---------------------------------------

assert.ok(!serialized.includes(SECRET_TOKEN), 'the auth token is absent from the serialized trace');
assert.ok(!serialized.includes(SECRET_PASSWORD), 'the password is absent');
assert.ok(!serialized.includes(SECRET_EMAIL), 'the email is absent');

// --- But the structure survives, so the trace is still useful ---------------

const writes = trace.nodes.filter((n) => n.type === TraceNodeType.WRITE);
const tokenWrite = writes.find((n) => n.path === 'auth.token');
assert.ok(tokenWrite, 'the write still appears — only its value was withheld');
assert.strictEqual(tokenWrite.to, REDACTED, 'the value is replaced by the placeholder');

const statusWrite = writes.find((n) => n.path === 'auth.status');
assert.ok(statusWrite, 'unmatched siblings are untouched');
assert.strictEqual(statusWrite.from, 'anonymous', 'and keep their real values');
assert.strictEqual(statusWrite.to, 'authenticated');

const passwordWrite = writes.find((n) => n.path === 'form.password');
assert.strictEqual(passwordWrite.to, REDACTED);
const emailWrite = writes.find((n) => n.path === 'user.email');
assert.strictEqual(emailWrite.to, REDACTED, 'a wildcard pattern covers the whole subtree');

// --- The trace declares what it withheld ------------------------------------

assert.deepStrictEqual(
  trace.redactions,
  ['auth.token', 'form.password', 'user.*'],
  'the trace declares its redaction rules, so a reader knows it is partial',
);
assert.strictEqual(trace.redacted, true, 'and records that a rule actually fired');

const rendered = formatTrace(trace);
assert.ok(!rendered.includes(SECRET_TOKEN), 'the rendered view does not leak the secret either');
assert.ok(rendered.includes('[redacted]'), 'and shows where a value was withheld');
assert.ok(rendered.includes('auth.token'), 'while still naming the path that changed');

// --- An exported test cannot resurrect a redacted value ---------------------

const generated = generateTest(trace, { tracePath: './x.trace.json', title: 'signin' });
assert.ok(!generated.includes(SECRET_TOKEN), 'the generated test does not contain the token');
assert.ok(!generated.includes(SECRET_PASSWORD), 'nor the password');
assert.ok(!generated.includes(SECRET_EMAIL), 'nor the email');
assert.ok(
  !generated.includes(`"${REDACTED}"`),
  'and no assertion is generated against the placeholder, which would be meaningless',
);

// --- Declaring rules that never match does not mark a trace as redacted ----

const clean = startRecording({ id: 'trace-clean', redact: ['nothing.matches.this'] });
clean.arm();
const plain = await mountTestComponent(SignInComponent, {});
plain.find('button.go').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flushPromises();
stopRecording();
const cleanTrace = clean.toJSON();
assert.strictEqual(cleanTrace.redacted, false, 'declaring rules is not the same as applying them');
assert.deepStrictEqual(cleanTrace.redactions, ['nothing.matches.this'], 'the rules are still declared');
// Without a matching rule the values really are recorded — which is exactly
// why the rules have to be configured deliberately.
assert.ok(
  JSON.stringify(cleanTrace).includes(SECRET_TOKEN),
  'an unredacted trace does contain application state, which is the point of documenting this',
);
plain.unmount();

// --- Bridge state is redacted on the same paths -----------------------------

const auth = bridge({
  state: { token: '', user: null },
  signIn(token, email) {
    this.token = token;
    this.user = { email };
  },
});

const bridgeRecorder = startRecording({ id: 'trace-bridge', redact: ['token', 'user.**'] });
bridgeRecorder.arm();
auth.signIn(SECRET_TOKEN, SECRET_EMAIL);
stopRecording();

const bridgeSerialized = bridgeRecorder.serialize();
assert.ok(!bridgeSerialized.includes(SECRET_TOKEN), 'bridge state is redacted too');
assert.ok(!bridgeSerialized.includes(SECRET_EMAIL), 'including nested bridge state');
assert.ok(
  bridgeRecorder.nodes.some((n) => n.type === TraceNodeType.BRIDGE_ACTION && n.name === 'signIn'),
  'the action itself is still recorded',
);

// Arguments are captured under `<bridge>.<action>.args`, so a rule can target
// them directly rather than relying on the value-scrubbing backstop.
const argsRecorder = startRecording({ id: 'trace-args', redact: ['bridge.signIn.args'] });
argsRecorder.arm();
const auth2 = bridge({
  state: { token: '' },
  signIn(token) {
    this.token = token;
  },
});
auth2.signIn(SECRET_TOKEN);
stopRecording();
const argsNode = argsRecorder.nodes.find((n) => n.type === TraceNodeType.BRIDGE_ACTION);
assert.strictEqual(argsNode.args, REDACTED, 'action arguments are redactable by their own path');

wrapper.unmount();

// --- Determinism is honest about redacted traces ----------------------------

assert.strictEqual(
  trace.determinism.status,
  Determinism.DETERMINISTIC,
  'redaction alone does not change what happened',
);

console.log('✅ All trace privacy tests passed.');
