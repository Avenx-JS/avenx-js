import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxMock } from '../../lib/core/index.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

// Sample bridge definition for tests
class SampleBridge {
  constructor() {
    this.value = 10;
    this.nested = {
      key: 'initial',
    };
  }

  multiply(n) {
    this.value *= n;
  }

  setNestedKey(k) {
    this.nested.key = k;
  }
}

// Sample component definition for tests
class CounterComponent extends AvenxComponent {
  constructor(bridges, props) {
    super(
      { count: 0 }, // initialState
      {}, // computed
      bridges,
      '<div>Count: {{state.count}}, Prop: {{props.title}}, Bridge: {{SampleBridge.value}}, Nested: {{SampleBridge.nested.key}}</div>',
      {
        increment: 'this.state.count++',
        doubleBridgeValue: 'SampleBridge.multiply(2)',
      }, // methods
      props,
    );
  }
}

(async () => {
  try {
    console.log('🧪 Testing AvenxMock and testing utilities...');

    // Setup DOM mock globally
    setupDOMMock();

    // ==========================================
    // 1. Mock Bridge State Interception & Spy Tests
    // ==========================================
    console.log('  Testing Mock Bridge creation & state tracking...');

    const mockBridge = AvenxMock.createMockBridge(SampleBridge, { value: 15 });

    // Verify initial data overrides
    assert.strictEqual(mockBridge.value, 15);
    assert.strictEqual(mockBridge.$isMock, true);

    // Verify setting property directly triggers state change interception
    mockBridge.value = 20;
    assert.strictEqual(mockBridge.value, 20);
    assert.strictEqual(mockBridge.$stateChanges.length, 1);
    assert.strictEqual(mockBridge.$stateChanges[0].prop, 'value');
    assert.strictEqual(mockBridge.$stateChanges[0].value, 20);

    // Verify deep state changes
    mockBridge.nested.key = 'updated';
    assert.strictEqual(mockBridge.nested.key, 'updated');
    assert.ok(mockBridge.$stateChanges.some((change) => change.prop === 'nested.key' && change.value === 'updated'));

    // Verify method calls and their inner state changes are intercepted
    mockBridge.$reset();
    assert.strictEqual(mockBridge.$calls.length, 0);
    assert.strictEqual(mockBridge.$stateChanges.length, 0);

    mockBridge.multiply(3);
    assert.strictEqual(mockBridge.value, 60);
    assert.strictEqual(mockBridge.$calls.length, 1);
    assert.strictEqual(mockBridge.$calls[0].method, 'multiply');
    assert.deepStrictEqual(mockBridge.$calls[0].args, [3]);
    assert.ok(mockBridge.$stateChanges.some((change) => change.prop === 'value' && change.value === 60));

    // Verify callback hooks
    let stateChangedProp = null;
    let stateChangedVal = null;
    const unsubscribeState = mockBridge.$onStateChange((prop, value) => {
      stateChangedProp = prop;
      stateChangedVal = value;
    });

    let calledMethod = null;
    let calledArgs = null;
    const unsubscribeCall = mockBridge.$onCall((method, args) => {
      calledMethod = method;
      calledArgs = args;
    });

    mockBridge.value = 100;
    assert.strictEqual(stateChangedProp, 'value');
    assert.strictEqual(stateChangedVal, 100);

    mockBridge.multiply(2);
    assert.strictEqual(calledMethod, 'multiply');
    assert.deepStrictEqual(calledArgs, [2]);

    unsubscribeState();
    unsubscribeCall();

    stateChangedProp = null;
    calledMethod = null;
    mockBridge.value = 500;
    mockBridge.multiply(2);
    assert.strictEqual(stateChangedProp, null);
    assert.strictEqual(calledMethod, null);

    // ==========================================
    // 2. Sandbox Testing & Isolation
    // ==========================================
    console.log('  Testing AvenxSandbox & isolated component mounting...');

    const sandbox = AvenxMock.createSandbox();
    const mockSampleBridge = AvenxMock.createMockBridge(SampleBridge, { value: 7 });

    sandbox.register('Counter', CounterComponent);
    sandbox.registerBridge('SampleBridge', mockSampleBridge);

    // Mount in sandbox
    const mounted = sandbox.mount(CounterComponent, { title: 'Unit Test' });

    // Verify initial render
    assert.ok(mounted.html.includes('Count: 0'));
    assert.ok(mounted.html.includes('Prop: Unit Test'));
    assert.ok(mounted.html.includes('Bridge: 7'));

    // Test isolated action
    mounted.instance.increment();
    await sandbox.waitForUpdate();
    assert.ok(mounted.html.includes('Count: 1'));

    // Test bridge trigger from component action
    mounted.instance.doubleBridgeValue();
    assert.strictEqual(mockSampleBridge.value, 14);
    assert.ok(mockSampleBridge.$calls.some((c) => c.method === 'multiply'));

    // Test route mocking
    sandbox.setRoute({ hash: '#/users', page: 'users', params: { id: '99' } });
    assert.deepStrictEqual(mounted.instance.$route, { hash: '#/users', page: 'users', params: { id: '99' } });

    // Clean up global DOM mock
    teardownDOMMock();

    console.log('✅ AvenxMock and testing utilities tests passed successfully!');
    process.exit(0);
  } catch (err) {
    // Clean up global DOM mock
    teardownDOMMock();

    console.error('❌ AvenxMock testing failed:', err);
    process.exit(1);
  }
})();
