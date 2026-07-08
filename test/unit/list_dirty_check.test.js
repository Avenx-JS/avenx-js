const assert = require('assert');
const { ListManager } = require('../../lib/core/renderer/listManager');

// Copy lightweight mock DOM setup from list_reused_nodes.test.js to keep the test self-contained and run in a pure Node environment.
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
        if (c.nodeType === 3) return c.textContent;
        if (c.nodeType === 1) return c.outerHTML;
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
      if (child.nodeType === 1) return child;
    }
    return null;
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    for (let i = idx - 1; i >= 0; i--) {
      const sibling = this.parentNode.childNodes[i];
      if (sibling.nodeType === 1) return sibling;
    }
    return null;
  }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    for (let i = idx + 1; i < this.parentNode.childNodes.length; i++) {
      const sibling = this.parentNode.childNodes[i];
      if (sibling.nodeType === 1) return sibling;
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
        if (tagNamePart && el.tagName !== tagNamePart) return false;
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
          if (matchSelector(child)) results.push(child);
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

function parseHTML(htmlStr) {
  htmlStr = htmlStr.trim();
  if (!htmlStr) return [];
  const nodes = [];
  let remaining = htmlStr;
  while (remaining.length > 0) {
    if (remaining.startsWith('<')) {
      const closeTagIndex = remaining.indexOf('>');
      if (closeTagIndex === -1) {
        nodes.push(new MockTextNode(remaining));
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
        if (endTagIndex !== -1) {
          const body = remaining.substring(0, endTagIndex);
          children = parseHTML(body);
          remaining = remaining.substring(endTagIndex + endTag.length);
        }
      }
      nodes.push(new MockElementNode(tagName, attrs, children));
    } else {
      const nextTag = remaining.indexOf('<');
      if (nextTag === -1) {
        nodes.push(new MockTextNode(remaining));
        break;
      } else {
        const text = remaining.substring(0, nextTag);
        nodes.push(new MockTextNode(text));
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
      if (depth === 0) return index + endMatch.index;
      index += endMatch.index + endMatch[0].length;
      remaining = remaining.substring(endMatch.index + endMatch[0].length);
    } else {
      break;
    }
  }
  return -1;
}

// Setup globals
const originalDocument = global.document;
const originalDOMParser = global.DOMParser;
const originalNode = global.Node;

global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
global.document = {
  createElement: (tagName) => new MockElementNode(tagName),
};
global.DOMParser = class {
  parseFromString(html) {
    const body = new MockElementNode('body');
    const parsed = parseHTML(html);
    parsed.forEach((c) => body.appendChild(c));
    return { body };
  }
};

(async () => {
  try {
    console.log('🧪 Testing ListManager dirty checking / caching behavior...');

    let renderCount = 0;
    const mockEvaluator = {
      evaluateExpression(expr, scope) {
        if (expr === 'items') return scope.items;
        return '';
      },
    };

    const mockRenderer = {
      render() {
        renderCount++;
        return '<li>item</li>';
      },
    };

    const listManager = new ListManager(mockEvaluator, mockRenderer);

    // Create a mock template element for ListManager
    const templateEl = new MockElementNode('template', {
      'data-ax-for': 'items',
      'data-ax-as': 'item',
    });
    templateEl.innerHTML = '<li class="list-item">{% item %}</li>';

    const parentEl = new MockElementNode('div');
    parentEl.appendChild(templateEl);

    // 1. Initial render with 3 items
    const list1 = ['a', 'b', 'c'];
    const scope1 = { items: list1 };

    listManager.process(parentEl, scope1, {});
    assert.strictEqual(renderCount, 3, 'Should render 3 times initially');

    // 2. Render again with exact same reference and content
    listManager.process(parentEl, scope1, {});
    assert.strictEqual(renderCount, 3, 'Should skip rendering since list reference, length, and items are unchanged');

    // 3. Render with mutated list (same reference, same length, but one item modified)
    list1[1] = 'x'; // Mutate item in place
    listManager.process(parentEl, scope1, {});
    assert.strictEqual(renderCount, 6, 'Should re-render when an item is modified');

    // 4. Render with mutated list (same reference, different length)
    list1.push('d'); // Length changes to 4
    listManager.process(parentEl, scope1, {});
    assert.strictEqual(renderCount, 10, 'Should re-render when length changes');

    // 5. Render with different list reference but same items
    const list2 = ['a', 'x', 'c', 'd'];
    const scope2 = { items: list2 };
    listManager.process(parentEl, scope2, {});
    assert.strictEqual(renderCount, 14, 'Should re-render when list reference changes, even if items are same');

    console.log('  ✅ ListManager dirty checking tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ ListManager dirty checking tests failed!');
    console.error(error);
    process.exit(1);
  } finally {
    // Restore original globals
    global.document = originalDocument;
    global.DOMParser = originalDOMParser;
    global.Node = originalNode;
  }
})();
