import assert from 'assert';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

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
      if (selector.startsWith('[')) {
        const attrName = selector.slice(1, -1);
        if (el.hasAttribute(attrName)) {
          results.push(el);
        }
      } else if (selector.startsWith('.')) {
        const className = selector.slice(1);
        if (el.getAttribute('class') === className) {
          results.push(el);
        }
      } else if (el.tagName === selector.toUpperCase()) {
        results.push(el);
      }
    };
    const traverse = (node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 1) {
          matchSelector(child);
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
// 2. Lifecycle Integration Test Suite
// ==========================================

(async () => {
  try {
    console.log('🧪 Testing Child Component Lifecycle and Reuse in AvenxPage...');

    let childMounts = 0;
    let childUnmounts = 0;
    let childUpdates = 0;
    let lastChildInstance = null;

    // Custom child component class
    /**
     *
     */
    class ChildComponent extends AvenxComponent {
      /**
       *
       * @param bridges
       */
      constructor(bridges) {
        super(
          { childVal: 'initialChild' }, // initialState
          {}, // computed
          bridges,
          '<div>Child: {{ childVal }}</div>',
          {
            onMount: () => {
              childMounts++;
            },
            onUnmount: () => {
              childUnmounts++;
            },
            onUpdate: () => {
              childUpdates++;
            },
          },
        );
      }
      /**
       *
       * @param target
       */
      mount(target) {
        super.mount(target);
        lastChildInstance = this;
      }
    }

    // Parent Page class
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
            parentCount: 1,
            showChild: true,
          }, // initialState
          {}, // computed
          bridges,
          '<div>Page count: {{ parentCount }}' +
            "{{{ showChild ? '<div data-avenx-comp=\"ChildComponent\"></div>' : '' }}}" +
            '</div>',
          {}, // methods
          componentRegistry,
        );
      }
    }

    const componentRegistry = new Map();
    componentRegistry.set('ChildComponent', ChildComponent);

    // 1. Initial Page Mount
    const parentPage = new ParentPage({}, componentRegistry);
    assert.strictEqual(parentPage.$parent, null, 'Root component should not have a parent');
    parentPage.mount(testRootElement);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(childMounts, 1, 'Child should be mounted once');
    assert.strictEqual(childUnmounts, 0);
    assert.strictEqual(childUpdates, 0);

    const firstChildInstance = lastChildInstance;
    assert.ok(firstChildInstance, 'Child instance should be cached');
    assert.strictEqual(firstChildInstance.$parent, parentPage, 'Child should reference its parent component');

    // Mutate child component local state directly to verify it persists
    firstChildInstance.state.childVal = 'mutatedLocalState';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(childUpdates, 1, 'Child state change should trigger update');

    // 2. Update Parent Page State (reusing child component)
    parentPage.state.parentCount = 2; // Increments count
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify child component instance is preserved (NOT recreated)
    assert.strictEqual(lastChildInstance, firstChildInstance, 'Child component instance should be reused');
    assert.strictEqual(childMounts, 1, 'Child component should NOT call onMount again');
    assert.strictEqual(childUnmounts, 0, 'Child component should NOT call onUnmount');
    assert.strictEqual(
      firstChildInstance.state.childVal,
      'mutatedLocalState',
      'Child component local state should persist',
    );

    // 3. Conditional Removal (unmounting child component)
    parentPage.state.showChild = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(childUnmounts, 1, 'Child component should call onUnmount when removed from page');

    // 4. Conditional Re-addition (instantiating new child component)
    parentPage.state.showChild = true;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(childMounts, 2, 'Child component should call onMount again upon conditional re-addition');
    assert.notStrictEqual(
      lastChildInstance,
      firstChildInstance,
      'A new child component instance should be constructed',
    );

    // 5. Unmount Parent Page (unmounts all nested child components)
    parentPage.unmount();
    assert.strictEqual(childUnmounts, 2, 'Child component should call onUnmount when parent page is unmounted');

    console.log('  ✅ Child Component Lifecycle and Reuse tests passed!');
  } catch (error) {
    console.error('❌ Child Component Lifecycle and Reuse tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
