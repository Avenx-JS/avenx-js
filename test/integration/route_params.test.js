import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';

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

  insertBefore(newNode, referenceNode) {
    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }
    const idx = this.childNodes.indexOf(referenceNode);
    if (idx !== -1) {
      this.childNodes.splice(idx, 0, newNode);
      newNode.parentNode = this;
    } else {
      this.appendChild(newNode);
    }
    return newNode;
  }

  insertAfter(newNode) {
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
      } else if (selector.startsWith('#')) {
        const idName = selector.slice(1);
        return el.getAttribute('id') === idName;
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
// 2. Global DOM setup for router test
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

let hashListeners = [];
global.window = {
  addEventListener(event, cb) {
    if (event === 'hashchange') {
      hashListeners.push(cb);
    }
  },
  removeEventListener(event, cb) {
    if (event === 'hashchange') {
      hashListeners = hashListeners.filter((l) => l !== cb);
    }
  },
  location: {
    _hash: '',
    get hash() {
      return this._hash;
    },
    set hash(val) {
      this._hash = val;
      // Trigger all registered hashchange listeners
      setTimeout(() => {
        hashListeners.forEach((listener) => listener({ type: 'hashchange' }));
      }, 0);
    },
  },
  getComputedStyle: (el) => {
    return (
      el.style || {
        transitionDuration: '0s',
        animationDuration: '0s',
        transitionDelay: '0s',
        animationDelay: '0s',
      }
    );
  },
};

global.requestAnimationFrame = (cb) => {
  return setTimeout(() => cb(Date.now()), 0);
};

// ==========================================
// 3. Expose active route parameters ($route) Tests
// ==========================================

(async () => {
  try {
    console.log('🧪 Testing Route Parameters Exposure ($route) in all components...');

    class ChildComp extends AvenxComponent {
      constructor(bridges, props) {
        super(
          {},
          {},
          bridges,
          '<div id="child">Child Param: {{ $route.params.id }}, Hash: {{ $route.hash }}</div>',
          {},
          props,
        );
      }
    }

    class ParentPage extends AvenxPage {
      constructor(bridges, registry) {
        super(
          {},
          {},
          bridges,
          '<div>' +
            '  <div id="parent">Parent Param: {{ $route.params.id }}</div>' +
            '  <ChildComp data-avenx-comp="ChildComp"></ChildComp>' +
            '</div>',
          {},
          registry,
        );
      }
    }

    const app = new AvenxApp({ target: '#app' });
    app.registerPage('ParentPage', ParentPage);
    app.register('ChildComp', ChildComp);

    // Initialize router with dynamic hash pattern
    const router = app.initRouter({
      '#/user/:id': 'ParentPage',
    });

    // 1. Navigate to route #/user/42
    global.window.location.hash = '#/user/42';

    // Wait for the async router handling (hashchange listener fires in a timeout)
    await new Promise((resolve) => setTimeout(resolve, 10));

    const parentEl = testRootElement.querySelector('#parent');
    const childEl = testRootElement.querySelector('#child');

    assert.ok(parentEl, 'Parent page should be mounted');
    assert.ok(childEl, 'Child component should be mounted');

    assert.strictEqual(parentEl.textContent.trim(), 'Parent Param: 42', 'Parent page should access route params');
    assert.strictEqual(
      childEl.textContent.trim(),
      'Child Param: 42, Hash: #/user/42',
      'Child component should access route params and hash',
    );

    // 2. Navigate to route #/user/999
    global.window.location.hash = '#/user/999';
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(parentEl.textContent.trim(), 'Parent Param: 999', 'Parent page should update on navigation');
    assert.strictEqual(
      childEl.textContent.trim(),
      'Child Param: 999, Hash: #/user/999',
      'Child component should update on navigation',
    );

    // Clean up globals
    router.destroy();
    delete global.document;
    delete global.window;
    delete global.DOMParser;
    delete global.Node;
    delete global.requestAnimationFrame;

    console.log('  ✅ Route Parameters Exposure ($route) tests passed!');
  } catch (error) {
    console.error('❌ Route Parameters Exposure ($route) tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
