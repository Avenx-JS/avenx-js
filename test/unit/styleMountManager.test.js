import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { styleMountManager } from '../../lib/core/runtime/StyleMountManager.js';

try {
  console.log('🧪 Testing Runtime Style Deduplication...');

  // --- Setup: Mock DOM environment ---
  const headChildren = [];

  global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  global.CustomEvent = class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  };

  global.document = {
    querySelector: () => createMockElement('div'),
    createElement: (tag) => createMockElement(tag),
    createElementNS: (ns, tag) => createMockElement(tag, ns),
    head: {
      querySelector: (selector) => {
        const match = selector.match(/\[data-avenx-style="([^"]+)"\]/);
        if (match) {
          return headChildren.find((el) => el._attrs && el._attrs['data-avenx-style'] === match[1]) || null;
        }
        return null;
      },
      appendChild: (el) => {
        el.parentNode = global.document.head;
        headChildren.push(el);
        return el;
      },
      removeChild: (el) => {
        const idx = headChildren.indexOf(el);
        if (idx !== -1) {
          headChildren.splice(idx, 1);
          el.parentNode = null;
        }
        return el;
      },
    },
  };

  global.DOMParser = class {
    parseFromString() {
      return { body: createMockElement('body') };
    }
  };

  global.window = global.window || {};
  global.window.getComputedStyle = (el) => {
    return (
      el.style || {
        transitionDuration: '0s',
        animationDuration: '0s',
        transitionDelay: '0s',
        animationDelay: '0s',
      }
    );
  };
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

  function createMockElement(tag, ns) {
    const el = {
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      nodeType: 1,
      namespaceURI: ns || 'http://www.w3.org/1999/xhtml',
      childNodes: [],
      _attrs: {},
      attributes: [],
      innerHTML: '',
      textContent: '',
      parentNode: null,
      style: {
        display: '',
        transitionDuration: '0s',
        animationDuration: '0s',
        transitionDelay: '0s',
        animationDelay: '0s',
      },
      hasAttribute(name) {
        return this._attrs[name] !== undefined;
      },
      getAttribute(name) {
        return this._attrs[name] !== undefined ? this._attrs[name] : null;
      },
      setAttribute(name, value) {
        this._attrs[name] = String(value);
        this.attributes = Object.entries(this._attrs).map(([k, v]) => ({ name: k, value: v }));
      },
      removeAttribute(name) {
        delete this._attrs[name];
        this.attributes = Object.entries(this._attrs).map(([k, v]) => ({ name: k, value: v }));
      },
      appendChild(child) {
        child.parentNode = el;
        el.childNodes.push(child);
        return child;
      },
      removeChild(child) {
        const idx = el.childNodes.indexOf(child);
        if (idx !== -1) {
          el.childNodes.splice(idx, 1);
          child.parentNode = null;
        }
        return child;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      dispatchEvent: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      cloneNode(deep) {
        const copy = createMockElement(tag, ns);
        copy._attrs = { ...el._attrs };
        copy.attributes = [...el.attributes];
        if (deep) {
          el.childNodes.forEach((child) => {
            if (child.nodeType === 1) {
              copy.appendChild(child.cloneNode(true));
            } else {
              copy.appendChild({ ...child, parentNode: copy });
            }
          });
        }
        return copy;
      },
    };
    return el;
  }

  // --- Test 1: Only one <style> element per component class ---
  console.log('  Test 1: Only one <style> element per component class...');

  class StyledButton extends AvenxComponent {
    static styles = '.btn { color: red; }';
    constructor(bridges, props) {
      super({ label: 'Click' }, {}, bridges || {}, '<button>{{ label }}</button>', {}, props || {});
    }
  }

  headChildren.length = 0;

  const target1 = createMockElement('div');
  const target2 = createMockElement('div');
  const target3 = createMockElement('div');

  const instance1 = new StyledButton();
  instance1.mount(target1);

  const instance2 = new StyledButton();
  instance2.mount(target2);

  const instance3 = new StyledButton();
  instance3.mount(target3);

  // Count <style> elements with data-avenx-style matching this component
  const styleElements = headChildren.filter((el) => el._attrs['data-avenx-style'] === 'avenx-style-StyledButton');

  assert.strictEqual(
    styleElements.length,
    1,
    `Expected exactly 1 <style> element for StyledButton, but found ${styleElements.length}`,
  );

  assert.strictEqual(
    styleMountManager.getRefCount(StyledButton),
    3,
    'Expected refCount to be 3 after mounting 3 instances',
  );

  console.log('  ✅ Test 1 passed: Only one <style> element exists for 3 instances');

  // --- Test 2: Unmounting one instance doesn't remove styles if others remain ---
  console.log('  Test 2: Partial unmount preserves styles...');

  instance1.unmount();

  const styleElementsAfterPartialUnmount = headChildren.filter(
    (el) => el._attrs['data-avenx-style'] === 'avenx-style-StyledButton',
  );

  assert.strictEqual(
    styleElementsAfterPartialUnmount.length,
    1,
    'Style element should still exist after unmounting one of three instances',
  );

  assert.strictEqual(
    styleMountManager.getRefCount(StyledButton),
    2,
    'Expected refCount to be 2 after unmounting 1 of 3 instances',
  );

  console.log('  ✅ Test 2 passed: Styles preserved with remaining active instances');

  // --- Test 3: Styles removed only when last instance unmounts ---
  console.log('  Test 3: Styles removed when last instance unmounts...');

  instance2.unmount();

  assert.strictEqual(
    styleMountManager.getRefCount(StyledButton),
    1,
    'Expected refCount to be 1 after unmounting 2 of 3 instances',
  );

  instance3.unmount();

  const styleElementsAfterFullUnmount = headChildren.filter(
    (el) => el._attrs['data-avenx-style'] === 'avenx-style-StyledButton',
  );

  assert.strictEqual(
    styleElementsAfterFullUnmount.length,
    0,
    'Style element should be removed after all instances are unmounted',
  );

  assert.strictEqual(
    styleMountManager.getRefCount(StyledButton),
    0,
    'Expected refCount to be 0 after all instances unmounted',
  );

  console.log('  ✅ Test 3 passed: Styles cleaned up after all instances unmounted');

  // --- Test 4: Remounting after full unmount re-adds styles ---
  console.log('  Test 4: Remounting creates a fresh style element...');

  const target4 = createMockElement('div');
  const instance4 = new StyledButton();
  instance4.mount(target4);

  const styleElementsAfterRemount = headChildren.filter(
    (el) => el._attrs['data-avenx-style'] === 'avenx-style-StyledButton',
  );

  assert.strictEqual(styleElementsAfterRemount.length, 1, 'A new <style> element should be created after remounting');

  instance4.unmount();

  console.log('  ✅ Test 4 passed: Remounting works correctly');

  // --- Test 5: Different component classes get separate style elements ---
  console.log('  Test 5: Different component classes get separate styles...');

  class StyledCard extends AvenxComponent {
    static styles = '.card { border: 1px solid blue; }';
    constructor(bridges, props) {
      super({ title: 'Card' }, {}, bridges || {}, '<div>{{ title }}</div>', {}, props || {});
    }
  }

  const target5 = createMockElement('div');
  const target6 = createMockElement('div');

  const buttonInstance = new StyledButton();
  buttonInstance.mount(target5);

  const cardInstance = new StyledCard();
  cardInstance.mount(target6);

  const buttonStyles = headChildren.filter((el) => el._attrs['data-avenx-style'] === 'avenx-style-StyledButton');
  const cardStyles = headChildren.filter((el) => el._attrs['data-avenx-style'] === 'avenx-style-StyledCard');

  assert.strictEqual(buttonStyles.length, 1, 'One style element for StyledButton');
  assert.strictEqual(cardStyles.length, 1, 'One style element for StyledCard');

  buttonInstance.unmount();
  cardInstance.unmount();

  console.log('  ✅ Test 5 passed: Separate style elements per component class');

  // --- Test 6: Components without static styles are unaffected ---
  console.log('  Test 6: Components without styles are unaffected...');

  class PlainComponent extends AvenxComponent {
    constructor(bridges, props) {
      super({}, {}, bridges || {}, '<span>plain</span>', {}, props || {});
    }
  }

  const beforeCount = headChildren.length;
  const target7 = createMockElement('div');
  const plainInstance = new PlainComponent();
  plainInstance.mount(target7);

  assert.strictEqual(
    headChildren.length,
    beforeCount,
    'No style element should be added for components without static styles',
  );

  plainInstance.unmount();

  console.log('  ✅ Test 6 passed: Components without styles work normally');

  // --- Test 7: Rapid/concurrent mount and unmount cleans up dangling style elements ---
  console.log('  Test 7: Rapid/concurrent mount/unmount cleans up styles...');

  class RapidComponent extends AvenxComponent {
    static styles = '.rapid { color: green; }';
    constructor(bridges, props) {
      super({}, {}, bridges || {}, '<div class="rapid">Rapid</div>', {}, props || {});
    }
  }

  const targets = [createMockElement('div'), createMockElement('div'), createMockElement('div')];
  const instances = targets.map((t) => new RapidComponent());

  // Rapidly mount instances concurrently
  instances.forEach((inst, idx) => inst.mount(targets[idx]));

  const styleElementsDuringMount = headChildren.filter(
    (el) => el._attrs['data-avenx-style'] === 'avenx-style-RapidComponent',
  );
  assert.strictEqual(styleElementsDuringMount.length, 1, 'Only 1 style element should exist during rapid mounts');

  // Rapidly unmount all instances concurrently
  instances.forEach((inst) => inst.unmount());

  const styleElementsAfterRapidUnmount = headChildren.filter(
    (el) => el._attrs['data-avenx-style'] === 'avenx-style-RapidComponent',
  );
  assert.strictEqual(
    styleElementsAfterRapidUnmount.length,
    0,
    'Style element should be completely removed after all rapid unmounts',
  );
  assert.strictEqual(
    styleMountManager.getRefCount(RapidComponent),
    0,
    'Ref count should be 0 after all rapid unmounts',
  );

  console.log('  ✅ Test 7 passed: Rapid/concurrent mount/unmount clean up styles correctly');

  // --- Test 8: Unmount cleans up dangling <style> nodes from DOM head even if registry is empty ---
  console.log('  Test 8: Unmount cleans up dangling style nodes...');

  class DanglingComponent extends AvenxComponent {
    static styles = '.dangling { display: none; }';
    constructor(bridges, props) {
      super({}, {}, bridges || {}, '<div class="dangling"></div>', {}, props || {});
    }
  }

  // Manually inject a dangling style element into document head
  const danglingEl = createMockElement('style');
  danglingEl.setAttribute('data-avenx-style', 'avenx-style-DanglingComponent');
  document.head.appendChild(danglingEl);

  assert.ok(
    headChildren.some((el) => el._attrs['data-avenx-style'] === 'avenx-style-DanglingComponent'),
    'Dangling style should exist in head initially',
  );

  // Calling unmount on the class should detect no active DOM instances and clean up the dangling style
  styleMountManager.unmount(DanglingComponent);

  assert.ok(
    !headChildren.some((el) => el._attrs['data-avenx-style'] === 'avenx-style-DanglingComponent'),
    'Dangling style element should be removed from head on unmount',
  );

  console.log('  ✅ Test 8 passed: Dangling style nodes cleaned up on unmount');

  // --- Cleanup ---
  delete global.Node;
  delete global.document;
  delete global.DOMParser;
  delete global.window;
  delete global.requestAnimationFrame;
  delete global.CustomEvent;

  console.log('  ✅ All Runtime Style Deduplication tests passed!');
} catch (error) {
  console.error('❌ Runtime Style Deduplication tests failed!');
  console.error(error);
  process.exit(1);
}
