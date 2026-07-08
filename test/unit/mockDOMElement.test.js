const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
// Importieren des zentralen QS-Helpers für Mocks und Globals
const { MockDOMElement, setupDOMMock, teardownDOMMock } = require('../helpers/dom-mock');

// Testfall unter Verwendung des zentralisierten Mocks
/**
 *
 */
async function testComponentEventLifecycle() {
  console.log('🧪 Teste Event-Bindung & Unmount mit zentralisiertem MockDOMElement...');

  // Globals für diesen Testlauf registrieren
  setupDOMMock();

  // Definition einer einfachen Klick-Komponente
  const comp = new AvenxComponent({ count: 0 }, {}, {}, '<button @click="count++">Klicks: {{ count }}</button>', {});

  const mockEl = new MockDOMElement('button');
  comp.__setMountTarget(mockEl);

  // Einhängen & Rendern der Komponente
  comp.update();

  try {
    // 1. Verhaltens-Assertion: Wurde der Klick-Handler im DOM registriert?
    mockEl.assertListenerWasAdded('click');
    console.log('  ✅ addEventListener("click") wurde aufgerufen (Verhaltensprüfung bestanden).');

    // 2. Aushängen der Komponente
    comp.unmount();

    // 3. Verhaltens-Assertion: Wurde der Klick-Handler wieder entfernt?
    mockEl.assertListenerWasRemoved('click');
    console.log('  ✅ removeEventListener("click") wurde aufgerufen (Cleanup-Verhaltensprüfung bestanden).');
  } finally {
    // Globals nach dem Test sauber entfernen (Teardown)
    teardownDOMMock();
  }
}

(async () => {
  try {
    await testComponentEventLifecycle();
    console.log('✅ MockDOMElement-Test erfolgreich bestanden!');
    process.exit(0);
  } catch (e) {
    console.error('❌ MockDOMElement-Test fehlgeschlagen!');
    console.error(e);
    process.exit(1);
  }
})();
