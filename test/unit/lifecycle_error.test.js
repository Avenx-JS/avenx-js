const assert = require('assert');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
const { MockDOMElement, setupDOMMock, teardownDOMMock } = require('../helpers/dom-mock');

let loggedErrors = [];
const originalConsoleError = console.error;

function hookConsoleError() {
    loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args.join(' '));
    };
}

function restoreConsoleError() {
    console.error = originalConsoleError;
}

async function testLifecycleErrors() {
    console.log('🧪 Testing unhandled errors in component lifecycle hooks...');

    setupDOMMock();
    hookConsoleError();

    // 1. Test error in onMount
    let mountExecuted = false;
    const compMountError = new AvenxComponent(
        { count: 0 },
        {},
        {},
        '<div>Counter: {{ count }}</div>',
        {
            onMount() {
                mountExecuted = true;
                throw new Error('Simulated onMount error');
            }
        }
    );

    const mockEl1 = new MockDOMElement('div');
    compMountError.__setMountTarget(mockEl1);
    compMountError.__afterMount();

    assert.ok(mountExecuted, 'onMount should be executed');
    assert.strictEqual(loggedErrors.length, 1, 'Should log exactly one error');
    assert.ok(loggedErrors[0].includes('AVX_R12'), 'Logged error should contain code AVX_R12');
    assert.ok(loggedErrors[0].includes('onMount'), 'Logged error should contain onMount identifier');
    assert.ok(loggedErrors[0].includes('Simulated onMount error'), 'Logged error should contain original error message');
    console.log('  ✅ onMount error caught and logged successfully without crashing.');

    // 2. Test error in onUpdate
    loggedErrors = [];
    let updateExecuted = false;
    const compUpdateError = new AvenxComponent(
        { count: 0 },
        {},
        {},
        '<div>Counter: {{ count }}</div>',
        {
            onUpdate() {
                updateExecuted = true;
                throw new Error('Simulated onUpdate error');
            }
        }
    );

    const mockEl2 = new MockDOMElement('div');
    compUpdateError.__setMountTarget(mockEl2);
    compUpdateError.__afterMount(); // sets #isMounted = true

    // Trigger update
    compUpdateError.update();

    assert.ok(updateExecuted, 'onUpdate should be executed');
    assert.strictEqual(loggedErrors.length, 1, 'Should log exactly one error');
    assert.ok(loggedErrors[0].includes('AVX_R12'), 'Logged error should contain code AVX_R12');
    assert.ok(loggedErrors[0].includes('onUpdate'), 'Logged error should contain onUpdate identifier');
    assert.ok(loggedErrors[0].includes('Simulated onUpdate error'), 'Logged error should contain original error message');
    console.log('  ✅ onUpdate error caught and logged successfully without crashing.');

    // 3. Test error in onUnmount
    loggedErrors = [];
    let unmountExecuted = false;
    const compUnmountError = new AvenxComponent(
        { count: 0 },
        {},
        {},
        '<div>Counter: {{ count }}</div>',
        {
            onUnmount() {
                unmountExecuted = true;
                throw new Error('Simulated onUnmount error');
            }
        }
    );

    const mockEl3 = new MockDOMElement('div');
    compUnmountError.__setMountTarget(mockEl3);
    compUnmountError.unmount();

    assert.ok(unmountExecuted, 'onUnmount should be executed');
    assert.strictEqual(loggedErrors.length, 1, 'Should log exactly one error');
    assert.ok(loggedErrors[0].includes('AVX_R12'), 'Logged error should contain code AVX_R12');
    assert.ok(loggedErrors[0].includes('onUnmount'), 'Logged error should contain onUnmount identifier');
    assert.ok(loggedErrors[0].includes('Simulated onUnmount error'), 'Logged error should contain original error message');
    console.log('  ✅ onUnmount error caught and logged successfully without crashing.');

    restoreConsoleError();
    teardownDOMMock();
}

(async () => {
    try {
        await testLifecycleErrors();
        console.log('  ✅ Lifecycle hooks error tolerance tests passed!');
        process.exit(0);
    } catch (error) {
        restoreConsoleError();
        console.error('❌ Lifecycle hooks error tolerance tests failed!');
        console.error(error);
        process.exit(1);
    }
})();
