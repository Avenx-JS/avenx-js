import assert from 'assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

// Mock DOM environment for runtime tests
const createMockElement = (tagName, value = '', attrs = {}, nodeType = 1) => {
  const listeners = {};
  const childNodes = [];
  const element = {
    nodeType,
    nodeName: tagName.toUpperCase(),
    tagName: tagName.toUpperCase(),
    value,
    childNodes,
    attributes: [],
    hasAttribute(name) {
      return attrs[name] !== undefined;
    },
    getAttribute(name) {
      return attrs[name] !== undefined ? attrs[name] : null;
    },
    setAttribute(name, val) {
      attrs[name] = String(val);
      this.attributes = Object.entries(attrs).map(([k, v]) => ({ name: k, value: v }));
      if (name === 'value') {
        this.value = String(val);
      }
    },
    removeAttribute(name) {
      delete attrs[name];
      this.attributes = Object.entries(attrs).map(([k, v]) => ({ name: k, value: v }));
      if (name === 'value') {
        this.value = '';
      }
    },
    addEventListener(event, callback) {
      listeners[event] = callback;
    },
    removeEventListener(event) {
      delete listeners[event];
    },
    appendChild(child) {
      child.parentNode = this;
      childNodes.push(child);
    },
    removeChild(child) {
      const idx = childNodes.indexOf(child);
      if (idx !== -1) {
        childNodes.splice(idx, 1);
        child.parentNode = null;
      }
    },
    replaceChild(newChild, oldChild) {
      const idx = childNodes.indexOf(oldChild);
      if (idx !== -1) {
        childNodes[idx] = newChild;
        newChild.parentNode = this;
        oldChild.parentNode = null;
      }
    },
    cloneNode(deep) {
      const copy = createMockElement(this.tagName, this.value, { ...attrs }, this.nodeType);
      if (deep) {
        childNodes.forEach((child) => {
          copy.appendChild(child.cloneNode(true));
        });
      }
      return copy;
    },
    querySelectorAll(selector) {
      const results = [];
      const matchSelector = (el) => {
        if (selector.includes('[')) {
          const parts = selector.split('[');
          const tagNamePart = parts[0].toUpperCase();
          const attrPart = parts[1].slice(0, -1);

          if (tagNamePart && el.tagName !== tagNamePart) {
            return false;
          }

          if (attrPart.includes('=')) {
            const [name, val] = attrPart.split('=');
            const cleanVal = val.replace(/^["']|["']$/g, '');
            return el.getAttribute(name) === cleanVal;
          } else {
            return el.hasAttribute(attrPart);
          }
        } else if (selector.startsWith('.')) {
          const className = selector.slice(1);
          return el.getAttribute('class') === className;
        } else {
          return el.tagName === selector.toUpperCase();
        }
      };
      const traverse = (node) => {
        node.childNodes.forEach((child) => {
          if (child.nodeType === 1) {
            if (matchSelector(child)) {
              results.push(child);
            }
            traverse(child);
          }
        });
      };
      traverse(this);
      return results;
    },
    querySelector(selector) {
      const res = this.querySelectorAll(selector);
      return res.length > 0 ? res[0] : null;
    },
    // test helper to fire events directly
    trigger(event, data = {}) {
      if (!Object.prototype.hasOwnProperty.call(data, 'target')) {
        Object.defineProperty(data, 'target', {
          value: this,
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }
      let current = this;
      while (current) {
        if (current.listeners && current.listeners[event]) {
          current.listeners[event](data);
        }
        if (listeners[event] && current === this) {
          listeners[event](data);
        }
        if (data.cancelBubble) {
          break;
        }
        current = current.parentNode;
      }
    },
    listeners,
  };
  element.attributes = Object.entries(attrs).map(([k, v]) => ({ name: k, value: v }));
  return element;
};

global.document = {
  querySelector: () => createMockElement('DIV'),
};

global.DOMParser = class {
  /**
   *
   * @param html
   */
  parseFromString(html) {
    const body = createMockElement('body');

    // Simple mock regex parser to build node structure
    const tagRegex = /<(input|textarea|select)\b([^>]*?)>/i;
    const match = html.match(tagRegex);
    if (match) {
      const tagName = match[1];
      const attrsStr = match[2];

      const valMatch = attrsStr.match(/value="([^"]*)"/i);
      const val = valMatch ? valMatch[1] : '';

      const attrs = {};
      const attrMatches = attrsStr.matchAll(/([\w@-]+)="([^"]*)"/g);
      for (const m of attrMatches) {
        attrs[m[1]] = m[2];
      }

      const childEl = createMockElement(tagName, val, attrs);
      body.appendChild(childEl);
    }
    return { body };
  }
};

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

/**
 *
 */
function testParserCompilation() {
  console.log('🧪 Testing ComponentParser two-way binding compilation...');
  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  const inputTemplate = '<input data-ax-bind="username" />';
  const processedInput = cp.processBindDirectives(inputTemplate);
  assert.ok(processedInput.includes('value="{{ username }}"'));
  assert.ok(processedInput.includes('@input="username = event.target.value"'));

  const textareaTemplate = '<textarea class="form" data-ax-bind="bio"></textarea>';
  const processedTextarea = cp.processBindDirectives(textareaTemplate);
  assert.ok(processedTextarea.includes('value="{{ bio }}"'));
  assert.ok(processedTextarea.includes('@input="bio = event.target.value"'));

  const selectTemplate = '<select data-ax-bind="city"></select>';
  const processedSelect = cp.processBindDirectives(selectTemplate);
  assert.ok(processedSelect.includes('value="{{ city }}"'));
  assert.ok(processedSelect.includes('@change="city = event.target.value"'));

  // Value-bound controls must never grow a checked binding.
  for (const processed of [processedInput, processedTextarea, processedSelect]) {
    assert.ok(!processed.includes('checked='), 'value-bound controls stay bound to value');
  }

  console.log('  ✅ Two-way binding compilation tests passed!');
}

/**
 * Checkbox and radio inputs bind through `checked`, not `value`.
 *
 * The runtime behaviour is covered in test/integration/form_bindings.test.js.
 * This pins the compiled output, because the transform is what decides which
 * DOM property a control binds to — and that decision is invisible until an
 * input is actually rendered.
 */
function testCheckboxAndRadioCompilation() {
  console.log('🧪 Testing checkbox and radio binding compilation...');
  const cp = new ComponentParser(new StyleProcessor());

  // A checkbox bound to a boolean: checked mirrors the value, and the change
  // handler reads back from `checked` rather than `value`.
  const boolCheckbox = cp.processBindDirectives('<input type="checkbox" data-ax-bind="agreed" />');
  assert.ok(boolCheckbox.includes('checked="{{'), 'a checkbox binds through checked');
  assert.ok(!/\svalue="\{\{/.test(boolCheckbox), 'a checkbox does not bind through value');
  assert.ok(boolCheckbox.includes('!!(agreed)'), 'the checked state is derived from the bound value');
  assert.ok(boolCheckbox.includes('agreed = event.target.checked'), 'the model reads event.target.checked');

  // A checkbox group bound to an array: membership drives checked, and the
  // handler adds or removes the input's value.
  const groupCheckbox = cp.processBindDirectives(
    '<input type="checkbox" value="apple" data-ax-bind="fruits" />',
  );
  assert.ok(groupCheckbox.includes('checked="{{'), 'a checkbox group binds through checked');
  assert.ok(groupCheckbox.includes("(fruits).includes('apple')"), 'membership drives the checked state');
  assert.ok(groupCheckbox.includes('event.target.checked'), 'the handler branches on event.target.checked');
  assert.ok(groupCheckbox.includes("(fruits).push('apple')"), 'checking adds the value');
  assert.ok(groupCheckbox.includes('splice'), 'unchecking removes the value');

  // A radio: checked is the comparison, and selecting one stores its value.
  // Reading `checked` here would collapse the group to a boolean.
  const radio = cp.processBindDirectives(
    '<input type="radio" name="color" value="red" data-ax-bind="selectedColor" />',
  );
  assert.ok(radio.includes('checked="{{'), 'a radio binds through checked');
  assert.ok(!/\svalue="\{\{/.test(radio), 'a radio does not bind its checked state through value');
  assert.ok(radio.includes("(selectedColor) === 'red'"), 'checked compares the model to the input value');
  assert.ok(radio.includes('selectedColor = event.target.value'), 'selecting a radio stores its value');

  // The type is read wherever it appears and however it is quoted.
  const variants = [
    "<input type='checkbox' data-ax-bind='ok' />",
    '<input TYPE="CheckBox" data-ax-bind="ok" />',
    '<input data-ax-bind="ok" type="checkbox" />',
  ];
  for (const variant of variants) {
    assert.ok(
      cp.processBindDirectives(variant).includes('checked="{{'),
      `checkbox detection should not depend on attribute order or casing: ${variant}`,
    );
  }

  // A static checked attribute is dropped: the binding owns that state.
  const preChecked = cp.processBindDirectives('<input type="checkbox" checked data-ax-bind="ok" />');
  assert.strictEqual(
    (preChecked.match(/checked="/g) || []).length,
    1,
    'a pre-existing checked attribute is replaced, not duplicated',
  );
  assert.ok(
    !/\schecked(?=[\s/>])/.test(preChecked),
    'the bare checked attribute is removed so the binding owns that state',
  );

  console.log('  ✅ Checkbox and radio compilation tests passed!');
}

/**
 *
 */
async function testRuntimeTwoWayBinding() {
  console.log('🧪 Testing runtime two-way binding behavior...');

  const comp = new AvenxComponent({ username: 'Alice' }, {}, {}, '<input data-ax-bind="username" />', {});

  const targetEl = createMockElement('div');
  comp.__setMountTarget(targetEl);
  comp.update();

  const inputEl = targetEl.childNodes[0];
  assert.ok(inputEl, 'Input child should be rendered');
  assert.strictEqual(inputEl.value, 'Alice');

  // 1. Updating state updates DOM value property
  comp.state.username = 'Bob';
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(inputEl.value, 'Bob');

  // 2. Modifying input value and triggering input event updates state
  inputEl.setAttribute('value', 'Charlie');
  inputEl.trigger('input', { target: inputEl });
  assert.strictEqual(comp.state.username, 'Charlie');

  console.log('  ✅ Runtime two-way binding behavior tests passed!');
}

/**
 *
 */
async function testRuntimeNestedTwoWayBinding() {
  console.log('🧪 Testing runtime nested path two-way binding behavior...');

  const comp = new AvenxComponent(
    { user: { profile: { age: '25' } } },
    {},
    {},
    '<input data-ax-bind="user.profile.age" />',
    {},
  );

  const targetEl = createMockElement('div');
  comp.__setMountTarget(targetEl);
  comp.update();

  const inputEl = targetEl.childNodes[0];
  assert.ok(inputEl);
  assert.strictEqual(inputEl.value, '25');

  // 1. Update state
  comp.state.user.profile.age = '30';
  await comp.nextTick();
  assert.strictEqual(inputEl.value, '30');

  // 2. Update input DOM value
  inputEl.setAttribute('value', '35');
  inputEl.trigger('input', { target: inputEl });
  assert.strictEqual(comp.state.user.profile.age, '35');

  console.log('  ✅ Runtime nested path two-way binding tests passed!');
}

(async () => {
  try {
    testParserCompilation();
    testCheckboxAndRadioCompilation();
    await testRuntimeTwoWayBinding();
    await testRuntimeNestedTwoWayBinding();
    console.log('✅ All two-way binding tests passed!');
  } catch (error) {
    console.error('❌ Two-way binding tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
