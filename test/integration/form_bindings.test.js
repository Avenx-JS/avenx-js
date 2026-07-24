import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

// ==========================================
// 1. Lightweight Mock DOM & HTML Parser
// ==========================================

class MockNode {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChild(newChild, oldChild) {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx !== -1) {
      if (newChild.parentNode) {
        newChild.parentNode.removeChild(newChild);
      }
      this.childNodes[idx] = newChild;
      newChild.parentNode = this;
      oldChild.parentNode = null;
    }
    return oldChild;
  }

  contains(child) {
    let curr = child;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  after(newNode) {
    if (!this.parentNode) return;
    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx !== -1) {
      this.parentNode.childNodes.splice(idx + 1, 0, newNode);
      newNode.parentNode = this.parentNode;
    }
  }

  get nextElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx === -1) return null;
    for (let i = idx + 1; i < this.parentNode.childNodes.length; i++) {
      const sib = this.parentNode.childNodes[i];
      if (sib.nodeType === 1) return sib;
    }
    return null;
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx === -1) return null;
    for (let i = idx - 1; i >= 0; i--) {
      const sib = this.parentNode.childNodes[i];
      if (sib.nodeType === 1) return sib;
    }
    return null;
  }

  addEventListener(event, handler) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
    }
  }

  dispatchEvent(event) {
    let current = this;
    while (current) {
      if (current.listeners && current.listeners[event.type]) {
        for (const handler of current.listeners[event.type]) {
          handler(event);
        }
      }
      if (event.cancelBubble) {
        break;
      }
      current = current.parentNode;
    }
  }
}

class MockTextNode extends MockNode {
  constructor(text) {
    super(3, '#text');
    this.textContent = text;
  }

  cloneNode() {
    return new MockTextNode(this.textContent);
  }
}

class MockElementNode extends MockNode {
  constructor(tagName, attrs = {}) {
    super(1, tagName.toUpperCase());
    this.tagName = tagName.toUpperCase();
    this.attrs = { ...attrs };
  }

  get attributes() {
    return Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
  }

  hasAttribute(name) {
    return name in this.attrs;
  }

  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  get value() {
    if (this.tagName === 'SELECT') {
      return this._selectedValue || '';
    }
    return this.getAttribute('value') || '';
  }

  set value(val) {
    if (this.tagName === 'SELECT') {
      const options = this.querySelectorAll('option');
      const matched = options.find((opt) => opt.value === val);
      if (matched) {
        this._selectedValue = val;
      } else {
        this._selectedValue = '';
      }
    } else {
      this.setAttribute('value', val);
    }
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(val) {
    this.childNodes.forEach((c) => {
      c.parentNode = null;
    });
    this.childNodes = [];
    this.appendChild(new MockTextNode(val));
  }

  get innerHTML() {
    return this.childNodes
      .map((c) => {
        if (c.nodeType === 3) {
          return c.textContent;
        } else if (c.nodeType === 1) {
          return c.outerHTML;
        }
        return '';
      })
      .join('');
  }

  set innerHTML(htmlStr) {
    this.childNodes.forEach((c) => {
      c.parentNode = null;
    });
    this.childNodes = [];
    const parsed = parseHTML(htmlStr);
    parsed.forEach((c) => this.appendChild(c));
  }

  get outerHTML() {
    const attrsStr = Object.entries(this.attrs)
      .map(([name, value]) => {
        if (value === '') return ` ${name}`;
        return ` ${name}="${value}"`;
      })
      .join('');
    return `<${this.tagName.toLowerCase()}${attrsStr}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  cloneNode(deep) {
    const copy = new MockElementNode(this.tagName, this.attrs);
    for (const key of Object.keys(this)) {
      if (!['tagName', 'nodeName', 'nodeType', 'childNodes', 'parentNode', 'attrs', 'listeners'].includes(key)) {
        copy[key] = this[key];
      }
    }
    if (deep) {
      this.childNodes.forEach((child) => {
        copy.appendChild(child.cloneNode(deep));
      });
    }
    return copy;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 1) {
          let match = false;
          if (selector === '*') {
            match = true;
          } else if (selector.startsWith('input') || selector.startsWith('INPUT')) {
            match = child.tagName === 'INPUT';
          } else if (selector === 'template[data-ax-for]') {
            match = child.tagName === 'TEMPLATE' && child.hasAttribute('data-ax-for');
          } else if (selector.startsWith('#')) {
            match = child.getAttribute('id') === selector.substring(1);
          } else if (child.tagName === selector.toUpperCase()) {
            match = true;
          }
          if (match) {
            results.push(child);
          }
          if (child.tagName !== 'TEMPLATE') {
            traverse(child);
          }
        }
      });
    };
    traverse(this);
    return results;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }

  get firstElementChild() {
    return this.childNodes.find((c) => c.nodeType === 1) || null;
  }
}

function createMockTextNode(text) {
  return new MockTextNode(text);
}

function createMockElementNode(tagName, attrs = {}, children = []) {
  const el = new MockElementNode(tagName, attrs);
  children.forEach((c) => el.appendChild(c));
  return el;
}

function parseHTML(htmlStr) {
  htmlStr = htmlStr.trim();
  if (!htmlStr) return [];

  const nodes = [];
  let remaining = htmlStr;

  while (remaining.length > 0) {
    if (remaining.startsWith('<') && !remaining.startsWith('</')) {
      const closeTagIndex = remaining.indexOf('>');
      if (closeTagIndex === -1) {
        nodes.push(createMockTextNode(remaining));
        break;
      }
      const tagContent = remaining.substring(1, closeTagIndex);
      const isSelfClosing = tagContent.endsWith('/');
      const cleanTagContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent.trim();

      const firstSpace = cleanTagContent.indexOf(' ');
      let tagName = firstSpace === -1 ? cleanTagContent : cleanTagContent.substring(0, firstSpace);
      tagName = tagName.toUpperCase();

      const attrs = {};
      if (firstSpace !== -1) {
        const attrStr = cleanTagContent.substring(firstSpace + 1);
        const attrRegex = /([\w\d@:-]+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          attrs[attrMatch[1]] = attrMatch[2];
        }
      }

      remaining = remaining.substring(closeTagIndex + 1);

      let children = [];
      if (!isSelfClosing) {
        const endTag = `</${tagName.toLowerCase()}>`;
        const endTagIndex = findClosingTagIndex(remaining, tagName);
        if (endTagIndex === -1) {
          // treat as self-closing
        } else {
          const body = remaining.substring(0, endTagIndex);
          children = parseHTML(body);
          remaining = remaining.substring(endTagIndex + endTag.length);
        }
      }

      nodes.push(createMockElementNode(tagName, attrs, children));
    } else if (remaining.startsWith('</')) {
      const closeTagIndex = remaining.indexOf('>');
      if (closeTagIndex === -1) {
        break;
      }
      remaining = remaining.substring(closeTagIndex + 1);
    } else {
      const nextTag = remaining.indexOf('<');
      if (nextTag === -1) {
        nodes.push(createMockTextNode(remaining));
        break;
      } else {
        const text = remaining.substring(0, nextTag);
        nodes.push(createMockTextNode(text));
        remaining = remaining.substring(nextTag);
      }
    }
  }
  return nodes;
}

function findClosingTagIndex(str, tagName) {
  const startTagPattern = new RegExp(`<${tagName.toLowerCase()}[\\s>]`, 'i');
  const endTagPattern = new RegExp(`</${tagName.toLowerCase()}>`, 'i');

  let depth = 1;
  let index = 0;
  let remaining = str;

  while (remaining.length > 0) {
    const startMatch = remaining.match(startTagPattern);
    const endMatch = remaining.match(endTagPattern);

    if (startMatch && (!endMatch || startMatch.index < endMatch.index)) {
      depth++;
      index += startMatch.index + startMatch[0].length;
      remaining = remaining.substring(startMatch.index + startMatch[0].length);
    } else if (endMatch) {
      depth--;
      if (depth === 0) {
        return index + endMatch.index;
      }
      index += endMatch.index + endMatch[0].length;
      remaining = remaining.substring(endMatch.index + endMatch[0].length);
    } else {
      break;
    }
  }
  return -1;
}

// Set up globals
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => createMockElementNode(tag),
  createElementNS: (ns, tag) => createMockElementNode(tag),
};

global.DOMParser = class {
  parseFromString(html) {
    const body = createMockElementNode('body');
    const parsed = parseHTML(html);
    parsed.forEach((c) => body.appendChild(c));
    return { body };
  }
};

global.Node = {
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,
};

function triggerChangeEvent(inputElement, checked) {
  inputElement.checked = checked;
  const event = {
    type: 'change',
    target: inputElement,
    cancelBubble: false,
  };
  inputElement.dispatchEvent(event);
}

// ==========================================
// 2. Integration Test Cases
// ==========================================

async function testCheckboxGroupBinding() {
  console.log('🧪 Testing Checkbox Group binding to reactive array...');

  const comp = new AvenxComponent(
    { fruits: ['apple'] },
    {},
    {},
    `<div>
       <input type="checkbox" id="chk-apple" data-ax-bind="fruits" value="apple" />
       <input type="checkbox" id="chk-banana" data-ax-bind="fruits" value="banana" />
     </div>`,
    {},
  );

  const rootEl = createMockElementNode('div');
  comp.__setMountTarget(rootEl);
  comp.update();

  const chkApple = rootEl.querySelector('#chk-apple');
  const chkBanana = rootEl.querySelector('#chk-banana');

  assert.ok(chkApple, 'Apple checkbox should render');
  assert.ok(chkBanana, 'Banana checkbox should render');

  // Verify initial sync
  assert.strictEqual(chkApple.checked, true, 'Apple should be checked initially');
  assert.strictEqual(chkBanana.checked, false, 'Banana should not be checked initially');

  // Check Banana
  triggerChangeEvent(chkBanana, true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepStrictEqual([...comp.state.fruits], ['apple', 'banana'], 'Banana should be appended');
  assert.strictEqual(chkBanana.checked, true);

  // Uncheck Apple
  triggerChangeEvent(chkApple, false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepStrictEqual([...comp.state.fruits], ['banana'], 'Apple should be removed');
  assert.strictEqual(chkApple.checked, false);

  // Mutate array directly to test sync-back (push)
  comp.state.fruits.push('apple');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(chkApple.checked, true, 'Apple checkbox should reactively sync to checked');

  console.log('  ✅ Checkbox group integration tests passed!');
}

async function testSingleCheckboxBinding() {
  console.log('🧪 Testing Single Checkbox binding to boolean...');

  const comp = new AvenxComponent(
    { agreed: false },
    {},
    {},
    `<input type="checkbox" id="chk-agreed" data-ax-bind="agreed" />`,
    {},
  );

  const rootEl = createMockElementNode('div');
  comp.__setMountTarget(rootEl);
  comp.update();

  const chkAgreed = rootEl.querySelector('#chk-agreed');
  assert.strictEqual(chkAgreed.checked, false, 'Agreed checkbox should be false initially');

  // Toggle true
  triggerChangeEvent(chkAgreed, true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(comp.state.agreed, true, 'Agreed state should update to true');
  assert.strictEqual(chkAgreed.checked, true);

  // Toggle false
  triggerChangeEvent(chkAgreed, false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(comp.state.agreed, false, 'Agreed state should update to false');
  assert.strictEqual(chkAgreed.checked, false);

  console.log('  ✅ Single checkbox integration tests passed!');
}

async function testRadioGroupBinding() {
  console.log('🧪 Testing Radio Group binding to string...');

  const comp = new AvenxComponent(
    { selectedColor: 'red' },
    {},
    {},
    `<div>
       <input type="radio" id="rad-red" name="color" data-ax-bind="selectedColor" value="red" />
       <input type="radio" id="rad-blue" name="color" data-ax-bind="selectedColor" value="blue" />
     </div>`,
    {},
  );

  const rootEl = createMockElementNode('div');
  comp.__setMountTarget(rootEl);
  comp.update();

  const radRed = rootEl.querySelector('#rad-red');
  const radBlue = rootEl.querySelector('#rad-blue');

  assert.strictEqual(radRed.checked, true, 'Red radio should be checked initially');
  assert.strictEqual(radBlue.checked, false, 'Blue radio should not be checked initially');

  // Select Blue
  triggerChangeEvent(radBlue, true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(comp.state.selectedColor, 'blue', 'State selectedColor should update to blue');
  assert.strictEqual(radRed.checked, false, 'Red radio should uncheck');
  assert.strictEqual(radBlue.checked, true, 'Blue radio should check');

  // Sync back from state changes
  comp.state.selectedColor = 'red';
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(radRed.checked, true, 'Red radio should check again');
  assert.strictEqual(radBlue.checked, false, 'Blue radio should uncheck again');

  console.log('  ✅ Radio group integration tests passed!');
}

async function testDynamicSelectBinding() {
  console.log('🧪 Testing dynamic option binding on select elements...');

  const comp = new AvenxComponent(
    { selectedCity: 'Berlin', cities: ['Paris', 'Berlin', 'London'] },
    {},
    {},
    `<select id="select-city" data-ax-bind="selectedCity">
       <template data-ax-for="cities" data-ax-as="city">
         <option value="{% city %}">{% city %}</option>
       </template>
     </select>`,
    {},
  );

  const rootEl = createMockElementNode('div');
  comp.__setMountTarget(rootEl);
  comp.update();

  const selectEl = rootEl.querySelector('#select-city');
  assert.ok(selectEl, 'Select element should render');

  const options = selectEl.querySelectorAll('option');
  assert.strictEqual(options.length, 3, 'Options should be populated dynamically');

  // Verify initial selection matches state
  assert.strictEqual(selectEl.value, 'Berlin', 'Select initial value should sync with state');

  console.log('  ✅ Dynamic select element integration tests passed!');
}

(async () => {
  try {
    await testCheckboxGroupBinding();
    await testSingleCheckboxBinding();
    await testRadioGroupBinding();
    await testDynamicSelectBinding();
    console.log('✅ Form bindings integration tests passed successfully!');
  } catch (error) {
    console.error('❌ Form bindings integration tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
