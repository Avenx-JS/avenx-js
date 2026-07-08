const assert = require('assert');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
const { MockDOMElement, setupDOMMock, teardownDOMMock } = require('../helpers/dom-mock');

/**
 *
 */
async function testUnmountReferenceCleanup() {
  console.log('🧪 TDD-Test: Bereinigung der __avenx_comp_instance beim Unmount...');

  setupDOMMock();

  const comp = new AvenxComponent({}, {}, {}, '<div>Test</div>', {});
  const mockEl = new MockDOMElement('div');

  // 1. Mount target zuweisen
  comp.__setMountTarget(mockEl);

  // 2. Erwartung: Referenz existiert
  assert.strictEqual(mockEl.__avenx_comp_instance, comp, 'Soll-Zustand: Referenz existiert nach Mount.');
  console.log('  ✅ Referenz nach Mount vorhanden.');

  // 3. Unmount ausführen
  comp.unmount();

  // 4. Erwartung: Referenz wurde gelöscht (Dies wird im RED-Status fehlschlagen!)
  assert.strictEqual(mockEl.__avenx_comp_instance, undefined, 'Soll-Zustand: Referenz gelöscht nach Unmount.');
  console.log('  ✅ Referenz nach Unmount gelöscht.');

  teardownDOMMock();
}

(async () => {
  try {
    await testUnmountReferenceCleanup();
    console.log('✅ Unmount Reference Test erfolgreich bestanden!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Unmount Reference Test fehlgeschlagen (Erwartetes RED in TDD)!');
    console.error(e);
    process.exit(1);
  }
})();
