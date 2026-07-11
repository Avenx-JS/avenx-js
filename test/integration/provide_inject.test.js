import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';

// ==========================================
// 1. Lightweight Mock DOM & HTML Parser
// ==========================================

class MockNode {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
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
    const tag = this.tagName.toLowerCase();
    return `<${tag}${attrsStr}>${this.innerHTML}</${tag}>`;
  }

  get firstElementChild() {
    for (const child of this.childNodes) {
      if (child.nodeType === 1) {
        return child;
      }
    }
    return null;
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    for (let i = idx - 1; i >= 0; i--) {
      const sibling = this.parentNode.childNodes[i];
      if (sibling.nodeType === 1) {
        return sibling;
      }
    }
    return null;
  }

  get nextElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    for (let i = idx + 1; i < this.parentNode.childNodes.length; i++) {
      const sibling = this.parentNode.childNodes[i];
      if (sibling.nodeType === 1) {
        return sibling;
      }
    }
    return null;
  }

  cloneNode(deep) {
    const copy = new MockElementNode(this.tagName, this.attrs);
    if (deep) {
      this.childNodes.forEach((c) => {
        copy.appendChild(c.cloneNode(true));
      });
    }
    return copy;
  }

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
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
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
    if (remaining.startsWith('<')) {
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
        const attrRegex = /([\w\d@:-]+)=["']([^"']*)["']/g;
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

// ==========================================
// 2. Global DOM setup for tests
// ==========================================

const testRootElement = createMockElementNode('div', { id: 'app' });

global.document = {
  querySelector: (selector) => {
    if (selector === '#app') return testRootElement;
    return null;
  },
  querySelectorAll: () => [],
  createElement: (tagName) => {
    return new MockElementNode(tagName);
  },
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

global.window = {};
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

global.requestAnimationFrame = (cb) => {
  return setTimeout(() => cb(Date.now()), 0);
};

// ==========================================
// 3. Provide / Inject Integration Tests
// ==========================================

(async () => {
  try {
    console.log('🧪 Testing Ancestor-Descendant State Injection (Provide / Inject API)...');

    // -------------------------------------------------------------------------
    // Test Case 1: Basic Provide / Inject (Variables, Functions, and Reactivity)
    // -------------------------------------------------------------------------
    console.log('  1. Testing basic provide / inject with variables, functions & reactivity...');

    let childRenders = 0;
    let parentRenders = 0;

    class ChildComp extends AvenxComponent {
      constructor(bridges, props) {
        super({}, {}, bridges, '<div>Child Theme: {{ theme }}</div>', {}, props);
      }
      runUpdate() {
        childRenders++;
        super.runUpdate();
      }
    }
    ChildComp.inject = ['theme', 'changeTheme'];

    class ParentPage extends AvenxPage {
      constructor(bridges, registry) {
        super(
          {},
          {},
          bridges,
          '<div>' + '  <ChildComp data-avenx-comp="ChildComp"></ChildComp>' + '</div>',
          {},
          registry,
        );
        this.provide = {
          theme: 'dark',
          changeTheme(newTheme) {
            this.theme = newTheme;
          },
        };
      }
      runUpdate() {
        parentRenders++;
        super.runUpdate();
      }
    }

    const registry1 = new Map();
    registry1.set('ChildComp', ChildComp);

    // Reset root element
    testRootElement.innerHTML = '';

    const parentPage = new ParentPage({}, registry1);
    parentPage.mount(testRootElement);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify initial mount & render values
    const childEl = testRootElement.querySelector('[data-avenx-comp="ChildComp"]');
    assert.ok(childEl, 'Child component should be mounted in the DOM');
    const childInstance = childEl.__avenx_comp_instance;
    assert.ok(childInstance, 'Child component instance should be cached on element');

    assert.strictEqual(childInstance.theme, 'dark', 'Child should inject theme correctly');
    assert.strictEqual(typeof childInstance.changeTheme, 'function', 'Child should inject changeTheme function');
    assert.strictEqual(childEl.textContent.trim(), 'Child Theme: dark', 'Child template should render injected theme');

    assert.strictEqual(parentRenders, 1, 'Parent component should have rendered once');
    assert.strictEqual(childRenders, 1, 'Child component should have rendered once');

    // Mutate parent theme using the injected method
    childInstance.changeTheme('light');

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify child updated reactively, parent did NOT re-render (Targeted Reactivity)
    assert.strictEqual(parentPage._providedState.theme, 'light', 'Parent theme should update to light');
    assert.strictEqual(childInstance.theme, 'light', 'Child injected theme should update to light');
    assert.strictEqual(
      childEl.textContent.trim(),
      'Child Theme: light',
      'Child template should update rendering to light',
    );

    assert.strictEqual(
      parentRenders,
      1,
      'Parent component should NOT re-render on child injected change (performance updateAll avoided)',
    );
    assert.strictEqual(childRenders, 2, 'Child component should re-render on injected value change');

    console.log('  ✅ Basic Provide/Inject and Targeted Reactivity tests passed!');

    // -------------------------------------------------------------------------
    // Test Case 2: Array-Based provide and inject (Reactivity on scope variables)
    // -------------------------------------------------------------------------
    console.log('  2. Testing array-based provide and inject...');

    let arrayChildRenders = 0;

    class ArrayChild extends AvenxComponent {
      constructor(bridges, props) {
        super({}, {}, bridges, '<div>Color: {{ color }}</div>', {}, props);
      }
      runUpdate() {
        arrayChildRenders++;
        super.runUpdate();
      }
    }
    ArrayChild.inject = ['color'];

    class ArrayParent extends AvenxPage {
      constructor(bridges, registry) {
        super(
          { color: 'blue' },
          {},
          bridges,
          '<div>' + '  <ArrayChild data-avenx-comp="ArrayChild"></ArrayChild>' + '</div>',
          {},
          registry,
        );
        this.provide = ['color'];
      }
    }

    const registry2 = new Map();
    registry2.set('ArrayChild', ArrayChild);

    testRootElement.innerHTML = '';
    const arrayParent = new ArrayParent({}, registry2);
    arrayParent.mount(testRootElement);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const arrayChildEl = testRootElement.querySelector('[data-avenx-comp="ArrayChild"]');
    assert.ok(arrayChildEl, 'Array child component should be in DOM');
    const arrayChildInst = arrayChildEl.__avenx_comp_instance;
    assert.ok(arrayChildInst, 'Array child instance should be attached');

    assert.strictEqual(arrayChildInst.color, 'blue', 'Array child should resolve color from parent scope');
    assert.strictEqual(arrayChildEl.textContent.trim(), 'Color: blue', 'Array child template should render color');
    assert.strictEqual(arrayChildRenders, 1, 'Array child should render once initially');

    // Mutate parent color
    arrayParent.state.color = 'red';
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(arrayChildInst.color, 'red', 'Array child should react to parent scope change');
    assert.strictEqual(
      arrayChildEl.textContent.trim(),
      'Color: red',
      'Array child template should re-render with new color',
    );
    assert.strictEqual(arrayChildRenders, 2, 'Array child should re-render');

    console.log('  ✅ Array-based Provide/Inject tests passed!');

    // -------------------------------------------------------------------------
    // Test Case 3: Nested scopes and Shadowing
    // -------------------------------------------------------------------------
    console.log('  3. Testing nested scopes and shadowing...');

    class GrandchildComp extends AvenxComponent {
      constructor(bridges, props) {
        super({}, {}, bridges, '<div>Shadowed: {{ theme }}, Shared: {{ api }}</div>', {}, props);
      }
    }
    GrandchildComp.inject = ['theme', 'api'];

    class IntermediateComp extends AvenxPage {
      constructor(bridges, registry) {
        super(
          {},
          {},
          bridges,
          '<div>' + '  <GrandchildComp data-avenx-comp="GrandchildComp"></GrandchildComp>' + '</div>',
          {},
          registry,
        );
        this.provide = {
          theme: 'light', // Shadows parent's theme
        };
      }
    }

    class GrandparentComp extends AvenxPage {
      constructor(bridges, registry) {
        super(
          {},
          {},
          bridges,
          '<div>' + '  <IntermediateComp data-avenx-comp="IntermediateComp"></IntermediateComp>' + '</div>',
          {},
          registry,
        );
        this.provide = {
          theme: 'dark',
          api: 'v1',
        };
      }
    }

    const registry3 = new Map();
    registry3.set('GrandchildComp', GrandchildComp);
    registry3.set('IntermediateComp', IntermediateComp);

    testRootElement.innerHTML = '';
    const grandparent = new GrandparentComp({}, registry3);
    grandparent.mount(testRootElement);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const grandchildEl = testRootElement.querySelector('[data-avenx-comp="GrandchildComp"]');
    assert.ok(grandchildEl, 'Grandchild should be in DOM');
    const grandchildInst = grandchildEl.__avenx_comp_instance;
    assert.ok(grandchildInst, 'Grandchild instance should exist');

    // Shadows theme ('light') but inherits api ('v1')
    assert.strictEqual(grandchildInst.theme, 'light', 'Should shadow theme from intermediate');
    assert.strictEqual(grandchildInst.api, 'v1', 'Should inherit api from grandparent');
    assert.strictEqual(
      grandchildEl.textContent.trim(),
      'Shadowed: light, Shared: v1',
      'Grandchild template should render shadowed and shared values',
    );

    console.log('  ✅ Nested scopes and shadowing tests passed!');

    console.log('✅ Provide / Inject Integration Tests successfully completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Provide / Inject Integration Tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
