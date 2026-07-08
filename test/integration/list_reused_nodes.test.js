const assert = require('assert');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
const { ListManager } = require('../../lib/core/renderer/listManager');

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
// 2. Node Stability Integration Test Suite
// ==========================================

(async () => {
  try {
    console.log('🧪 Testing List Item Node Stability and In-place Patching...');

    /**
     *
     */
    class ListTestComp extends AvenxComponent {
      /**
       *
       */
      constructor() {
        super(
          {
            items: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' },
            ],
          }, // initialState
          {}, // computed
          {}, // bridges
          '<div>' +
            '  <ul>' +
            '    <template data-ax-for="items" data-ax-as="item" data-ax-key="item.id">' +
            '      <li class="list-item">{% item.name %}</li>' +
            '    </template>' +
            '  </ul>' +
            '</div>',
        );
      }
    }

    const comp = new ListTestComp();
    comp.mount(testRootElement);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Get the initial list item elements
    let items = testRootElement.querySelectorAll('[data-ax-list-item]');
    assert.strictEqual(items.length, 2, 'Should render 2 items initially');
    assert.strictEqual(items[0].textContent, 'Alice');
    assert.strictEqual(items[1].textContent, 'Bob');

    const aliceNode = items[0];
    const bobNode = items[1];

    // Attach unmanaged state to the DOM elements to verify stability
    aliceNode.customState = 'state-alice';
    bobNode.customState = 'state-bob';

    // Update the list data - update Alice's name and keep Bob the same
    comp.state.items = [
      { id: 1, name: 'Alice Updated' },
      { id: 2, name: 'Bob' },
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));

    items = testRootElement.querySelectorAll('[data-ax-list-item]');
    assert.strictEqual(items.length, 2, 'Should still have 2 items');
    assert.strictEqual(items[0].textContent, 'Alice Updated', 'First item content should be updated');
    assert.strictEqual(items[1].textContent, 'Bob', 'Second item content should remain Bob');

    // Assert references are preserved
    assert.strictEqual(items[0], aliceNode, 'Alice element node reference should be reused');
    assert.strictEqual(items[1], bobNode, 'Bob element node reference should be reused');

    // Assert custom unmanaged state is preserved
    assert.strictEqual(items[0].customState, 'state-alice', 'Alice node custom state should be preserved');
    assert.strictEqual(items[1].customState, 'state-bob', 'Bob node custom state should be preserved');

    // Assert attributes are maintained correctly
    assert.strictEqual(items[0].getAttribute('data-ax-list-item'), '', 'data-ax-list-item should be preserved');
    assert.strictEqual(items[0].getAttribute('data-ax-key-val'), '1', 'data-ax-key-val should be preserved');

    // Reorder the list items
    comp.state.items = [
      { id: 2, name: 'Bob' },
      { id: 1, name: 'Alice Updated' },
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));

    items = testRootElement.querySelectorAll('[data-ax-list-item]');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0], bobNode, 'First item should now be Bob (reordered)');
    assert.strictEqual(items[1], aliceNode, 'Second item should now be Alice (reordered)');

    assert.strictEqual(items[0].customState, 'state-bob');
    assert.strictEqual(items[1].customState, 'state-alice');

    // Remove an item from the list
    comp.state.items = [{ id: 2, name: 'Bob' }];
    await new Promise((resolve) => setTimeout(resolve, 0));

    items = testRootElement.querySelectorAll('[data-ax-list-item]');
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0], bobNode, 'Only Bob node should remain');
    assert.strictEqual(items[0].customState, 'state-bob');

    // Set the list to null (non-array) and verify DOM items are cleaned up
    comp.state.items = null;
    await new Promise((resolve) => setTimeout(resolve, 0));

    items = testRootElement.querySelectorAll('[data-ax-list-item]');
    assert.strictEqual(items.length, 0, 'All list items should be removed when list is null');

    // Reset list back to an array
    comp.state.items = [{ id: 3, name: 'Charlie' }];
    await new Promise((resolve) => setTimeout(resolve, 0));

    items = testRootElement.querySelectorAll('[data-ax-list-item]');
    assert.strictEqual(items.length, 1, 'Should render list items again when array is restored');
    assert.strictEqual(items[0].textContent, 'Charlie');

    console.log('  ✅ List Item Node Stability and In-place Patching tests passed!');

    // ==========================================
    // 3. Test event listener unbinding in ListManager
    // ==========================================
    console.log('🧪 Testing ListManager event unbinding on element removal...');

    const mockEvaluator = {
      evaluateExpression(_, scope) {
        return scope.items || [];
      },
    };

    const mockRenderer = {
      render() {
        return '<li>item</li>';
      },
    };

    let unbindCalledWith = null;
    const mockEventBinder = {
      unbind(element) {
        unbindCalledWith = element;
      },
    };

    const listManager = new ListManager(mockEvaluator, mockRenderer, mockEventBinder);

    // Create mock template and parent element
    const templateEl = createMockElementNode('template', {
      'data-ax-for': 'items',
      'data-ax-as': 'item',
    });
    const parentEl = createMockElementNode('div', {}, [templateEl]);

    // Mock nextElementSibling / siblings for getCurrentItems
    const mockItem = createMockElementNode('li', {
      'data-ax-list-item': '',
      'data-ax-key-val': '0',
    });
    templateEl.after(mockItem);

    // First update - contains key '0'
    listManager.process(parentEl, { items: [{ id: 0 }] }, {});
    assert.strictEqual(unbindCalledWith, null, 'Unbind should not be called when items are retained or added');

    // Second update - items is empty, key '0' is removed
    listManager.process(parentEl, { items: [] }, {});
    assert.strictEqual(unbindCalledWith, mockItem, 'Unbind should be called with the removed element');

    console.log('  ✅ ListManager event unbinding on element removal tests passed!');
  } catch (error) {
    console.error('❌ List Item Node Stability and In-place Patching tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
