import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

/**
 * Tests that elements marked with data-ax-ref are exposed through $refs.
 */
function testComponentRefCollection() {
  console.log('🧪 Testing data-ax-ref collection...');

  setupDOMMock();

  try {
    const component = new AvenxComponent();

    const root = new MockDOMElement('div');
    const input = new MockDOMElement('input');

    input.setAttribute('data-ax-ref', 'myInput');

    component.__setMountTarget(root);

    root.appendChild(input);

    component.runUpdate();

    assert.strictEqual(
      component.$refs.myInput,
      input,
      '$refs.myInput should point to the referenced DOM element.',
    );

    console.log('  ✅ data-ax-ref element is available through $refs.');
  } finally {
    teardownDOMMock();
  }
}

/**
 * Tests that refs are scoped to the current component boundary.
 */
function testComponentRefScoping() {
  console.log('🧪 Testing data-ax-ref component scoping...');

  setupDOMMock();

  try {
    const component = new AvenxComponent();

    const root = new MockDOMElement('div');

    const parentInput = new MockDOMElement('input');
    parentInput.setAttribute('data-ax-ref', 'parentInput');

    const childComponent = new MockDOMElement('div');
    childComponent.setAttribute('data-avenx-comp', 'child-component');

    const childInput = new MockDOMElement('input');
    childInput.setAttribute('data-ax-ref', 'childInput');

    childComponent.appendChild(childInput);

    component.__setMountTarget(root);

    root.appendChild(parentInput);
    root.appendChild(childComponent);

    component.runUpdate();

    assert.strictEqual(
      component.$refs.parentInput,
      parentInput,
      'The parent component should collect its own ref.',
    );

    assert.strictEqual(
      component.$refs.childInput,
      undefined,
      'The parent component should not collect refs inside nested components.',
    );

    console.log('  ✅ Refs remain scoped to the current component boundary.');
  } finally {
    teardownDOMMock();
  }
}

/**
 * Tests that refs are cleared when the component is unmounted.
 */
function testComponentRefCleanup() {
  console.log('🧪 Testing data-ax-ref cleanup...');

  setupDOMMock();

  try {
    const component = new AvenxComponent();

    const root = new MockDOMElement('div');
    const input = new MockDOMElement('input');

    input.setAttribute('data-ax-ref', 'myInput');

    component.__setMountTarget(root);

    root.appendChild(input);

    component.runUpdate();

    assert.strictEqual(
      component.$refs.myInput,
      input,
      '$refs.myInput should exist before unmount.',
    );

    component.unmount();

    assert.deepStrictEqual(
      component.$refs,
      {},
      '$refs should be cleared after component unmount.',
    );

    console.log('  ✅ $refs are cleared after unmount.');
  } finally {
    teardownDOMMock();
  }
}

function runTests() {
  try {
    testComponentRefCollection();
    testComponentRefScoping();
    testComponentRefCleanup();

    console.log('✅ All component ref tests passed successfully!');
  } catch (error) {
    console.error('❌ Component ref tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runTests();
