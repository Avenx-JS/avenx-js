const assert = require('assert');
const { DomPatcher } = require('../../lib/core/renderer/domPatch');
const { ListManager } = require('../../lib/core/renderer/listManager');

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
    return `<${this.tagName.toLowerCase()}${attrsStr}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  cloneNode(deep) {
    const copy = new MockElementNode(this.tagName, this.attrs);
    // Copy any custom properties set on the element (e.g. disabled, checked)
    for (const key of Object.keys(this)) {
      if (!['tagName', 'nodeName', 'nodeType', 'childNodes', 'parentNode', 'attrs'].includes(key)) {
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
          } else if (selector === 'template[data-ax-for]') {
            match = child.tagName === 'TEMPLATE' && child.hasAttribute('data-ax-for');
          } else if (selector === 'parsererror') {
            match = child.tagName === 'PARSERERROR';
          }
          if (match) {
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

// ==========================================
// 2. Integration Test Implementation
// ==========================================

(() => {
  try {
    console.log('🧪 Testing boolean attributes handling in DomPatcher and ListManager...');

    const patcher = new DomPatcher();

    // 1. Test cleanElement
    const tempButton = createMockElementNode('button', {
      disabled: 'false',
      required: 'true',
      checked: '',
    });

    patcher.cleanElement(tempButton);

    assert.strictEqual(
      tempButton.hasAttribute('disabled'),
      false,
      'Falsy boolean attribute "disabled" should be removed',
    );
    assert.strictEqual(tempButton.disabled, false, 'Property "disabled" should be set to false');
    assert.strictEqual(tempButton.hasAttribute('required'), true, 'Truthy boolean attribute "required" should be kept');
    assert.strictEqual(tempButton.required, true, 'Property "required" should be set to true');
    assert.strictEqual(tempButton.hasAttribute('checked'), true, 'Truthy boolean attribute "checked" should be kept');
    assert.strictEqual(tempButton.checked, true, 'Property "checked" should be set to true');

    // 2. Test initial patch (cloning behaviour)
    const target = createMockElementNode('div');
    patcher.patch(target, '<div><button disabled="false" required="true">Click</button></div>');

    assert.strictEqual(target.childNodes.length, 1);
    const container = target.childNodes[0];
    assert.strictEqual(container.childNodes.length, 1);
    const button = container.childNodes[0];

    assert.strictEqual(
      button.hasAttribute('disabled'),
      false,
      'Falsy boolean attribute "disabled" should be removed on initial clone',
    );
    assert.strictEqual(button.disabled, false, 'Property "disabled" should be false');
    assert.strictEqual(
      button.hasAttribute('required'),
      true,
      'Truthy boolean attribute "required" should be kept on initial clone',
    );
    assert.strictEqual(button.required, true, 'Property "required" should be true');

    // 3. Test patch update (attributes diff/patching behaviour)
    const nextHTML = '<div><button disabled="true" required="false">Click</button></div>';
    patcher.patch(target, nextHTML);

    assert.strictEqual(
      button.hasAttribute('disabled'),
      true,
      'Truthy boolean attribute "disabled" should be added on patch update',
    );
    assert.strictEqual(button.disabled, true, 'Property "disabled" should be true');
    assert.strictEqual(
      button.hasAttribute('required'),
      false,
      'Falsy boolean attribute "required" should be removed on patch update',
    );
    assert.strictEqual(button.required, false, 'Property "required" should be false');

    // 4. Test ListManager with boolean attributes
    const evaluator = {
      evaluateExpression: (expr, scope) => {
        if (expr === 'items') return scope.items;
        if (expr === 'item.disabled') return scope.item.disabled;
        return null;
      },
    };
    const renderer = {
      render: (template, resolveExpression) => {
        const disabledVal = resolveExpression('item.disabled');
        return `<button disabled="${disabledVal}">Item</button>`;
      },
    };

    const listManager = new ListManager(evaluator, renderer);
    const listContainer = createMockElementNode('div');
    const listTemplate = createMockElementNode('template', {
      'data-ax-for': 'items',
      'data-ax-as': 'item',
    });
    listTemplate.innerHTML = '<button disabled="{%item.disabled%}">Item</button>';
    listContainer.appendChild(listTemplate);

    // Initial list render
    listManager.process(listContainer, { items: [{ disabled: false }, { disabled: true }] }, {});

    // Scanned children should contain two buttons
    const buttons = listContainer.childNodes.filter((node) => node.tagName === 'BUTTON');
    assert.strictEqual(buttons.length, 2, 'Should render 2 buttons in list');

    assert.strictEqual(
      buttons[0].hasAttribute('disabled'),
      false,
      'First list item should have "disabled" attribute removed',
    );
    assert.strictEqual(buttons[0].disabled, false, 'First list item property "disabled" should be false');
    assert.strictEqual(buttons[1].hasAttribute('disabled'), true, 'Second list item should keep "disabled" attribute');
    assert.strictEqual(buttons[1].disabled, true, 'Second list item property "disabled" should be true');

    // Update list render
    listManager.process(listContainer, { items: [{ disabled: true }, { disabled: false }] }, {});

    assert.strictEqual(
      buttons[0].hasAttribute('disabled'),
      true,
      'First list item should have "disabled" attribute added after update',
    );
    assert.strictEqual(buttons[0].disabled, true, 'First list item property "disabled" should be true after update');
    assert.strictEqual(
      buttons[1].hasAttribute('disabled'),
      false,
      'Second list item should have "disabled" attribute removed after update',
    );
    assert.strictEqual(buttons[1].disabled, false, 'Second list item property "disabled" should be false after update');

    console.log('  ✅ Boolean attributes handling test passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Boolean attributes handling test failed!');
    console.error(error);
    process.exit(1);
  }
})();
