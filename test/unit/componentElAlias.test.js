import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

(async () => {
  try {
    setupDOMMock();

    class ElComp extends AvenxComponent {
      constructor() {
        super({ n: 1 }, {}, {}, `<div>{{state.n}}</div>`, {});
      }
    }

    const comp = new ElComp();

    // before mount: both null, alias identity holds
    assert.strictEqual(comp.$element, null);
    assert.strictEqual(comp.el, null);
    assert.strictEqual(comp.el, comp.$element);

    const host = document.createElement('div');
    comp.mount(host);

    // after mount: alias points at the same root element
    assert.ok(comp.$element, '$element should be set after mount');
    assert.strictEqual(comp.el, comp.$element);
    assert.strictEqual(typeof comp.el.querySelector, 'function');

    comp.unmount();

    // after unmount: both null again, identity still holds
    assert.strictEqual(comp.$element, null);
    assert.strictEqual(comp.el, null);
    assert.strictEqual(comp.el, comp.$element);

    teardownDOMMock();
    console.log('✅ this.el alias tests passed');
    process.exit(0);
  } catch (err) {
    teardownDOMMock();
    console.error('❌ this.el alias tests failed:', err);
    process.exit(1);
  }
})();
