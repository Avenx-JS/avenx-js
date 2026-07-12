import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

/**
 * Tests data-ax-ref collection and component-scoped DOM references.
 */
async function testComponentRefs() {
  console.log('🧪 Testing data-ax-ref DOM element referencing...');

  setupDOMMock();

  try {
    const comp = new AvenxComponent(
      {},
      {},
      {},
      '<div><input data-ax-ref="myInput"></div>',
      {},
    );

    const root = new MockDOMElement('div');
    const input = new MockDOMElement('input');

    input.setAttribute('data-ax-ref', 'myInput');
    root.appendChild(input);

    comp.__setMountTarget(root);

    // __setMountTarget clears the initial content, so append the element
    // again to simulate the rendered component DOM.
    root.appendChild(input);

    comp.runUpdate();

    assert.strictEqual(
      comp.$refs.myInput,
      input,
      '$refs.myInput should point to the referenced DOM element.',
    );

    console.log('  ✅ Referenced DOM element is available through $refs.');

    comp.unmount();

    assert.deepStrictEqual(
      comp.$refs,
      {},
      '$refs should be cleared when the component is unmounted.',
    );

    console.log('  ✅ $refs are cleared after unmount.');
  } finally {
    teardownDOMMock();
  }
}

(async () => {
  try {
    await testComponentRefs();
    console.log('✅ Component refs tests passed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Component refs tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
