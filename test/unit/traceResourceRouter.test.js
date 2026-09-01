import assert from 'assert';
import { Resource } from '../../lib/core/reactive/Resource.js';
import { AvenxRouter } from '../../lib/core/runtime/AvenxRouter.js';
import { MemoryNavigationDelegate } from '../../lib/core/runtime/navigation/index.js';
import { flushPromises } from '../../lib/core/testing.js';
import { startRecording, stopRecording } from '../../lib/core/trace/recorder.js';
import {
  installResourceResponses,
  clearResourceResponses,
  hasRecordedResponses,
} from '../../lib/core/trace/resource.js';
import { TraceNodeType, NonDeterminismReason, indexNodes } from '../../lib/core/trace/schema.js';

console.log('🧪 Testing resource and router recording...');

// --- A resolved resource records its request and its settlement -------------

let networkCalls = 0;
/**
 * Stands in for a fetch call.
 * @returns {Promise<object>} The response body.
 */
function loadUsers() {
  networkCalls++;
  return Promise.resolve({ users: [{ name: 'ada' }, { name: 'grace' }] });
}

let recorder = startRecording();
recorder.arm();
let resource = new Resource('users', loadUsers, null, {});
await flushPromises();
stopRecording();

assert.strictEqual(networkCalls, 1, 'the handler ran once');
const resourceNodes = recorder.nodes.filter((n) => n.type === TraceNodeType.RESOURCE);
assert.strictEqual(resourceNodes.length, 2, 'a request and a settlement were recorded');

const [request, settlement] = resourceNodes;
assert.strictEqual(request.phase, 'pending');
assert.strictEqual(request.name, 'users');
assert.strictEqual(settlement.phase, 'settled');
assert.strictEqual(settlement.status, 'resolved');
assert.deepStrictEqual(settlement.value, { users: [{ name: 'ada' }, { name: 'grace' }] }, 'the body is captured');
assert.strictEqual(settlement.request, request.id, 'the settlement points back at its request');
assert.deepStrictEqual(resource.value, { users: [{ name: 'ada' }, { name: 'grace' }] });
resource.teardown();

// --- A rejected resource records the failure --------------------------------

recorder = startRecording();
recorder.arm();
resource = new Resource('broken', () => Promise.reject(new TypeError('offline')), null, {});
await flushPromises();
stopRecording();

const failure = recorder.nodes.find((n) => n.type === TraceNodeType.RESOURCE && n.phase === 'settled');
assert.strictEqual(failure.status, 'rejected');
assert.strictEqual(failure.error.name, 'TypeError');
assert.strictEqual(failure.error.message, 'offline', 'the failure is recorded, not swallowed');
resource.teardown();

// --- A polling resource cannot be deterministic -----------------------------

recorder = startRecording();
recorder.arm();
resource = new Resource('ticker', () => Promise.resolve(1), null, { pollInterval: 10_000 });
await flushPromises();
assert.strictEqual(recorder.isDeterministic, false, 'a polling resource downgrades the trace');
assert.ok(
  recorder.reasons.has(NonDeterminismReason.POLLING_RESOURCE),
  'the downgrade names polling as the reason',
);
resource.teardown();
stopRecording();

// --- Replay serves recorded responses without touching the network ----------

const trace = {
  nodes: [
    { id: 1, type: TraceNodeType.RESOURCE, phase: 'pending', name: 'users' },
    {
      id: 2,
      type: TraceNodeType.RESOURCE,
      phase: 'settled',
      status: 'resolved',
      name: 'users',
      value: { users: [{ name: 'replayed' }] },
    },
  ],
};

networkCalls = 0;
const missing = [];
installResourceResponses(trace, (name) => missing.push(name));
assert.strictEqual(hasRecordedResponses(), true);

resource = new Resource('users', loadUsers, null, {});
await flushPromises();
assert.strictEqual(networkCalls, 0, 'replay never called the handler, so the network was never touched');
assert.deepStrictEqual(resource.value, { users: [{ name: 'replayed' }] }, 'the recorded body was served');
assert.deepStrictEqual(missing, [], 'nothing was missing');
resource.teardown();

// A second resource with no recorded response is reported, not invented.
resource = new Resource('unrecorded', () => Promise.resolve('live'), null, {});
await flushPromises();
assert.deepStrictEqual(missing, ['unrecorded'], 'an unrecorded resource is reported as missing');
assert.strictEqual(resource.value, 'live', 'and falls through to the real handler rather than fabricating a value');
resource.teardown();

// A recorded rejection replays as a rejection.
installResourceResponses(
  {
    nodes: [
      {
        id: 1,
        type: TraceNodeType.RESOURCE,
        phase: 'settled',
        status: 'rejected',
        name: 'flaky',
        error: { name: 'TypeError', message: 'offline' },
      },
    ],
  },
  () => {},
);
resource = new Resource('flaky', () => Promise.resolve('should not be used'), null, {});
await flushPromises();
assert.strictEqual(resource.status, 'rejected', 'a recorded failure replays as a failure');
assert.strictEqual(resource.error.message, 'offline');
resource.teardown();

clearResourceResponses();
assert.strictEqual(hasRecordedResponses(), false);

// Once cleared, resources go back to hitting their real handler.
networkCalls = 0;
resource = new Resource('users', loadUsers, null, {});
await flushPromises();
assert.strictEqual(networkCalls, 1, 'clearing restores live behaviour');
resource.teardown();

// --- Router navigations are recorded ----------------------------------------

const mounted = [];
const mockApp = {
  mountPage(pageName, params) {
    mounted.push({ pageName, params });
  },
};

const delegate = new MemoryNavigationDelegate('#/');
const router = new AvenxRouter(
  mockApp,
  { '#/': 'Home', '#/cart': 'Cart', '#/product/:id': 'Product' },
  { delegate },
);

recorder = startRecording();
recorder.arm();
router.navigate('#/cart');
await flushPromises();
router.navigate('#/product/42');
await flushPromises();
stopRecording();

assert.deepStrictEqual(
  mounted.map((entry) => entry.pageName),
  ['Cart', 'Product'],
  'the router still mounted both pages',
);

const navigations = recorder.nodes.filter((n) => n.type === TraceNodeType.NAVIGATION);
assert.strictEqual(navigations.length, 2, `two navigations recorded, got ${navigations.length}`);
assert.strictEqual(navigations[0].to, '#/cart');
assert.strictEqual(navigations[0].page, 'Cart');
assert.strictEqual(navigations[1].to, '#/product/42');
assert.strictEqual(navigations[1].page, 'Product');
assert.deepStrictEqual(navigations[1].params, { id: '42' }, 'route params are recorded');
assert.strictEqual(navigations[1].from, '#/cart', 'the previous route is recorded');

// --- A guard-cancelled navigation is not recorded as having happened --------

const guardedDelegate = new MemoryNavigationDelegate('#/');
const guardedMounted = [];
const guardedRouter = new AvenxRouter(
  {
    mountPage(pageName) {
      guardedMounted.push(pageName);
    },
  },
  { '#/': 'Home', '#/admin': { page: 'Admin', guards: [{ canActivate: () => false }] } },
  { delegate: guardedDelegate },
);

recorder = startRecording();
recorder.arm();
guardedRouter.navigate('#/admin');
await flushPromises();
stopRecording();

assert.strictEqual(
  guardedMounted.length,
  0,
  'the guard really did block the navigation',
);
assert.strictEqual(
  recorder.nodes.filter((n) => n.type === TraceNodeType.NAVIGATION && n.to === '#/admin').length,
  0,
  'a navigation a guard blocked is not recorded as a navigation that happened',
);

// --- Recorded nodes survive indexing ---------------------------------------

const byId = indexNodes({ nodes: recorder.nodes });
for (const node of recorder.nodes) {
  assert.strictEqual(byId.get(node.id), node);
}

console.log('✅ All resource and router recording tests passed.');
