const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
const { AvenxPage } = require('../../lib/core/runtime/AvenxPage');
const { AvenxApp } = require('../../lib/core/runtime/AvenxApp');
const StyleProcessor = require('../../lib/compiler/StyleProcessor');
const ComponentParser = require('../../lib/compiler/ComponentParser');

// ==========================================
// 1. Lightweight Mock DOM & HTML Parser
// ==========================================

/**
 *
 */
class MockNode {
  /**
   *
   * @param nodeType
   * @param nodeName
   */
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
  }

  /**
   *
   * @param child
   */
  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  /**
   *
   * @param child
   */
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  /**
   *
   * @param newChild
   * @param oldChild
   */
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

  /**
   *
   * @param child
   */
  contains(child) {
    let curr = child;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  /**
   *
   */
  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  /**
   *
   * @param newNode
   */
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

/**
 *
 */
class MockTextNode extends MockNode {
  /**
   *
   * @param text
   */
  constructor(text) {
    super(3, '#text');
    this.textContent = text;
  }

  /**
   *
   * @param deep
   */
  cloneNode() {
    return new MockTextNode(this.textContent);
  }
}

/**
 *
 */
class MockElementNode extends MockNode {
  /**
   *
   * @param tagName
   * @param attrs
   */
  constructor(tagName, attrs = {}) {
    super(1, tagName.toUpperCase());
    this.tagName = tagName.toUpperCase();
    this.attrs = { ...attrs };
  }

  /**
   *
   */
  get attributes() {
    return Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
  }

  /**
   *
   * @param name
   */
  hasAttribute(name) {
    return name in this.attrs;
  }

  /**
   *
   * @param name
   */
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }

  /**
   *
   * @param name
   * @param value
   */
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  /**
   *
   * @param name
   */
  removeAttribute(name) {
    delete this.attrs[name];
  }

  /**
   *
   */
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  /**
   *
   */
  set textContent(val) {
    this.childNodes.forEach((c) => {
      c.parentNode = null;
    });
    this.childNodes = [];
    this.appendChild(new MockTextNode(val));
  }

  /**
   *
   */
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

  /**
   *
   */
  set innerHTML(htmlStr) {
    this.childNodes.forEach((c) => {
      c.parentNode = null;
    });
    this.childNodes = [];
    const parsed = parseHTML(htmlStr);
    parsed.forEach((c) => this.appendChild(c));
  }

  /**
   *
   */
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

  /**
   *
   */
  get firstElementChild() {
    for (const child of this.childNodes) {
      if (child.nodeType === 1) {
        return child;
      }
    }
    return null;
  }

  /**
   *
   */
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

  /**
   *
   */
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

  /**
   *
   * @param deep
   */
  cloneNode(deep) {
    const copy = new MockElementNode(this.tagName, this.attrs);
    if (deep) {
      this.childNodes.forEach((c) => {
        copy.appendChild(c.cloneNode(true));
      });
    }
    return copy;
  }

  /**
   *
   * @param selector
   */
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

  /**
   *
   * @param selector
   */
  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }
}

/**
 *
 * @param text
 */
function createMockTextNode(text) {
  return new MockTextNode(text);
}

/**
 *
 * @param tagName
 * @param attrs
 * @param children
 */
function createMockElementNode(tagName, attrs = {}, children = []) {
  const el = new MockElementNode(tagName, attrs);
  children.forEach((c) => el.appendChild(c));
  return el;
}

/**
 *
 * @param htmlStr
 */
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

/**
 *
 * @param str
 * @param tagName
 */
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
  /**
   *
   * @param html
   * @param type
   */
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

// ==========================================
// 2. Component Props Integration Tests
// ==========================================

(async () => {
  try {
    console.log('🧪 Testing Component Props (Data Down Passing)...');

    // 1. Compiler Tests (ComponentParser compiling component tags with attributes to data-props-*)
    console.log('  Testing ComponentParser attribute translation...');
    const tempFilePath = path.join(__dirname, 'TempComponent.component.js');
    const tempContent = `
        <state count="0" />
        <div><UserCard user="{{currentUser}}" title="User Profile" age="25" active='true' /></div>
        `;
    fs.writeFileSync(tempFilePath, tempContent, 'utf-8');

    const cp = new ComponentParser(new StyleProcessor());
    const generated = cp.parse(tempFilePath, 'component');

    // Clean up temp file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    assert.ok(generated.includes('class TempComponent extends AvenxComponent'), 'Should generate TempComponent class');
    assert.ok(
      generated.includes('data-avenx-comp="UserCard"'),
      'Should translate custom tag to div with data-avenx-comp',
    );
    assert.ok(generated.includes('data-props-user="currentUser"'), 'Should translate dynamic expression props');
    assert.ok(generated.includes('data-props-title="\'User Profile\'"'), 'Should translate static string props');
    assert.ok(generated.includes('data-props-age="25"'), 'Should translate numeric props');
    assert.ok(generated.includes('data-props-active="true"'), 'Should translate boolean props');

    // 2. Runtime Tests (Props passing and reactivity)
    console.log('  Testing child component props injection and reactivity...');

    let childMounts = 0;
    let lastChildInstance = null;

    /**
     *
     */
    class ChildUserCard extends AvenxComponent {
      /**
       *
       * @param bridges
       * @param props
       */
      constructor(bridges, props) {
        super(
          {}, // initialState
          {}, // computed
          bridges,
          '<div>Card [{{ props.title }}]: {{ props.user.name }} (Age: {{ props.user.age }})</div>',
          {}, // methods
          props,
        );
      }

      /**
       *
       * @param target
       */
      mount(target) {
        super.mount(target);
        childMounts++;
        lastChildInstance = this;
      }
    }

    /**
     *
     */
    class ParentPage extends AvenxPage {
      /**
       *
       * @param bridges
       * @param componentRegistry
       */
      constructor(bridges, componentRegistry) {
        super(
          {
            currentUser: { name: 'Alice', age: 25 },
            cardTitle: 'Initial Title',
          }, // initialState
          {}, // computed
          bridges,
          '<div>' +
            '  <h1>Dashboard</h1>' +
            '  <div data-avenx-comp="ChildUserCard" data-props-user="currentUser" data-props-title="cardTitle"></div>' +
            '</div>',
          {}, // methods
          componentRegistry,
        );
      }
    }

    const componentRegistry = new Map();
    componentRegistry.set('ChildUserCard', ChildUserCard);

    const parentPage = new ParentPage({}, componentRegistry);
    parentPage.mount(testRootElement);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify initial render content
    console.log('DEBUG testRootElement.outerHTML:', testRootElement.outerHTML);
    const childEl = testRootElement.querySelector('[data-avenx-comp="ChildUserCard"]');
    assert.ok(childEl, 'Child component element should be in the DOM');
    assert.strictEqual(childEl.textContent.trim(), 'Card [Initial Title]: Alice (Age: 25)');

    assert.strictEqual(childMounts, 1, 'Child should be mounted once');
    const firstChildInstance = lastChildInstance;
    assert.ok(firstChildInstance, 'Child instance should be cached');
    assert.strictEqual(firstChildInstance.props.title, 'Initial Title');
    assert.strictEqual(firstChildInstance.props.user.name, 'Alice');
    assert.strictEqual(firstChildInstance.props.user.age, 25);

    // Update parent state (updates props passed to child)
    console.log('  Testing update to props from parent...');
    parentPage.state.currentUser = { name: 'Bob', age: 30 };
    parentPage.state.cardTitle = 'Updated Title';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify updated content on child
    assert.strictEqual(childEl.textContent.trim(), 'Card [Updated Title]: Bob (Age: 30)');
    assert.strictEqual(childMounts, 1, 'Child component should NOT be unmounted/remounted');
    assert.strictEqual(lastChildInstance, firstChildInstance, 'Child component instance should be re-used');

    // Test direct child props modification reactivity
    console.log('  Testing child props direct reactivity...');
    assert.strictEqual(firstChildInstance.props.user.name, 'Bob');
    assert.strictEqual(firstChildInstance.props.user.age, 30);
    firstChildInstance.props.title = 'Direct Title';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(childEl.textContent.trim(), 'Card [Direct Title]: Bob (Age: 30)');

    console.log('  ✅ Component Props tests passed!');

    // 3. Testing Targeted Bridge Updates and Reactivity (no updateAll)
    console.log('  Testing targeted updates for registered bridges...');
    const app = new AvenxApp({ target: '#app' });
    app.registerBridge('AppBridge', {
      user: 'Alice',
      theme: 'dark',
    });

    let comp1Renders = 0;
    let comp2Renders = 0;

    class BridgeComp1 extends AvenxComponent {
      constructor(bridges) {
        super({}, {}, bridges, '<div>User: {{ AppBridge.user }}</div>');
      }
      runUpdate() {
        comp1Renders++;
        super.runUpdate();
      }
    }

    class BridgeComp2 extends AvenxComponent {
      constructor(bridges) {
        super({}, {}, bridges, '<div>Theme: {{ AppBridge.theme }}</div>');
      }
      runUpdate() {
        comp2Renders++;
        super.runUpdate();
      }
    }

    app.register('BridgeComp1', BridgeComp1);
    app.register('BridgeComp2', BridgeComp2);

    const bTarget1 = createMockElementNode('div');
    const bTarget2 = createMockElementNode('div');

    const bComp1 = new BridgeComp1(app.bridges);
    const bComp2 = new BridgeComp2(app.bridges);

    bComp1.mount(bTarget1);
    bComp2.mount(bTarget2);

    bComp1.update();
    bComp2.update();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(comp1Renders, 1, 'BridgeComp1 should render once initially');
    assert.strictEqual(comp2Renders, 1, 'BridgeComp2 should render once initially');
    assert.strictEqual(bTarget1.textContent.trim(), 'User: Alice');
    assert.strictEqual(bTarget2.textContent.trim(), 'Theme: dark');

    // Mutate only 'user' on the bridge
    app.bridges.AppBridge.user = 'Bob';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify only BridgeComp1 re-rendered and updated its DOM content
    assert.strictEqual(comp1Renders, 2, 'BridgeComp1 should re-render after user mutation');
    assert.strictEqual(comp2Renders, 1, 'BridgeComp2 should NOT re-render on user mutation (no updateAll)');
    assert.strictEqual(bTarget1.textContent.trim(), 'User: Bob');
    assert.strictEqual(bTarget2.textContent.trim(), 'Theme: dark');

    // Mutate only 'theme' on the bridge
    app.bridges.AppBridge.theme = 'light';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify only BridgeComp2 re-rendered and updated its DOM content
    assert.strictEqual(comp1Renders, 2, 'BridgeComp1 should NOT re-render on theme mutation');
    assert.strictEqual(comp2Renders, 2, 'BridgeComp2 should re-render after theme mutation');
    assert.strictEqual(bTarget1.textContent.trim(), 'User: Bob');
    assert.strictEqual(bTarget2.textContent.trim(), 'Theme: light');

    console.log('  ✅ Targeted bridge updates integration tests passed!');
  } catch (error) {
    console.error('❌ Component Props tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
