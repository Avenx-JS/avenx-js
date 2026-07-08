const assert = require('assert');
const fs = require('fs');
const path = require('path');
const StyleProcessor = require('../../lib/compiler/StyleProcessor');
const ComponentParser = require('../../lib/compiler/ComponentParser');
const { AvenxComponent } = require('../../lib/core/runtime/AvenxComponent');
const { html } = require('../../lib/core/security/escapeHtml');

// --- Mock DOM Implementation (reusing component_props.test.js mock DOM structure) ---
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
      return child;
    }
    return null;
  }

  replaceChild(newChild, oldChild) {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx !== -1) {
      this.childNodes[idx] = newChild;
      newChild.parentNode = this;
      oldChild.parentNode = null;
      return oldChild;
    }
    return null;
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
    
    // Add realistic style and classList properties
    const self = this;
    this._style = {
      get display() {
        return self._display || '';
      },
      set display(val) {
        self._display = val;
        if (val) {
          self.setAttribute('style', `display: ${val}`);
        } else {
          self.removeAttribute('style');
        }
      }
    };
    this._display = attrs.style && attrs.style.includes('display:') 
      ? attrs.style.split('display:')[1].trim().split(';')[0]
      : '';
    
    this._classList = {
      add: (cls) => {
        const classes = this.getAttribute('class') ? this.getAttribute('class').split(/\s+/) : [];
        if (!classes.includes(cls)) {
          classes.push(cls);
          this.setAttribute('class', classes.join(' '));
        }
      },
      remove: (cls) => {
        const classes = this.getAttribute('class') ? this.getAttribute('class').split(/\s+/) : [];
        const idx = classes.indexOf(cls);
        if (idx !== -1) {
          classes.splice(idx, 1);
          this.setAttribute('class', classes.join(' '));
        }
      },
      contains: (cls) => {
        const classes = this.getAttribute('class') ? this.getAttribute('class').split(/\s+/) : [];
        return classes.includes(cls);
      }
    };
  }

  get style() {
    return this._style;
  }

  get classList() {
    return this._classList;
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
        return el.classList.contains(className);
      } else {
        return el.tagName === selector.toUpperCase();
      }
    };
    const traverse = (node) => {
      if (node.tagName === 'TEMPLATE') {
        return;
      }
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
        const attrRegex = /([\w\d@:-]+)=(?:"([^"]*)"|'([^']*)')/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          attrs[attrMatch[1]] = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
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
  createElement: (tagName) => {
    return new MockElementNode(tagName);
  },
  createElementNS: (ns, tagName) => {
    return new MockElementNode(tagName, { xmlns: ns });
  }
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

// --- Test Suites ---

async function runTests() {
  try {
    console.log('🧪 Testing Custom Directives (data-ax-show, data-ax-class, data-ax-html)...');

    // 1. Compiler Validation Tests
    console.log('  Testing compiler validateTemplate checks for new directives...');
    const cp = new ComponentParser(new StyleProcessor());
    const tempFile = path.join(__dirname, 'TempDirComp.component.js');
    
    // Test directive referencing undeclared variable should log warning
    const tempContent = `
      <div data-ax-show="undeclaredVar">Hello</div>
    `;
    fs.writeFileSync(tempFile, tempContent, 'utf-8');

    let loggedWarning = false;
    const logger = require('../../lib/core/runtime/AvenxLogger').logger;
    const originalLoggerWarn = logger.warn;
    logger.warn = (msg) => {
      if (msg.includes('Undeclared variable') && msg.includes('undeclaredVar')) {
        loggedWarning = true;
      }
    };

    cp.parse(tempFile, 'TempDirComp');

    // Restore logger
    logger.warn = originalLoggerWarn;
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    assert.ok(loggedWarning, 'Compiler should warn about undeclared variables inside custom directives');

    // 2. data-ax-show Runtime Tests
    console.log('  Testing data-ax-show visibility toggling...');
    class ShowComponent extends AvenxComponent {
      constructor() {
        super({ isVisible: true });
      }
      render() {
        return `<div data-ax-show="isVisible">Show Content</div>`;
      }
    }
    const showComp = new ShowComponent();
    const showTarget = createMockElementNode('div');
    showComp.mount(showTarget);
    showComp.update();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const contentDiv = showTarget.querySelector('[data-ax-show]');
    assert.ok(contentDiv, 'Content div should be mounted');
    assert.strictEqual(contentDiv.style.display, '', 'Display should be empty (visible) by default when isVisible is true');

    // Mutate state to false
    showComp.state.isVisible = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(contentDiv.style.display, 'none', 'Display should be "none" when isVisible is false');

    // Mutate state back to true
    showComp.state.isVisible = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(contentDiv.style.display, '', 'Display should be restored to default when isVisible is true');

    // 3. data-ax-class Runtime Tests
    console.log('  Testing data-ax-class class toggling...');
    class ClassComponent extends AvenxComponent {
      constructor() {
        super({ isActive: false, isRed: true, customTheme: 'theme-blue' });
      }
      render() {
        return `
          <div class="base-class" data-ax-class="{ active: isActive, 'text-red': isRed }">Class Obj</div>
          <p data-ax-class="customTheme">Class Str</p>
        `;
      }
    }
    const classComp = new ClassComponent();
    const classTarget = createMockElementNode('div');
    classComp.mount(classTarget);
    classComp.update();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const divEl = classTarget.querySelector('div');
    const pEl = classTarget.querySelector('p');

    assert.ok(divEl.classList.contains('base-class'), 'Should preserve static classes');
    assert.ok(!divEl.classList.contains('active'), 'Should not have active class initially');
    assert.ok(divEl.classList.contains('text-red'), 'Should have text-red class initially');
    assert.ok(pEl.classList.contains('theme-blue'), 'Should have theme-blue class initially');

    // Mutate isActive to true and isRed to false, customTheme to theme-green
    classComp.state.isActive = true;
    classComp.state.isRed = false;
    classComp.state.customTheme = 'theme-green';
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(divEl.classList.contains('base-class'), 'Should still preserve static classes');
    assert.ok(divEl.classList.contains('active'), 'Should have active class after mutation');
    assert.ok(!divEl.classList.contains('text-red'), 'Should not have text-red class after mutation');
    assert.ok(!pEl.classList.contains('theme-blue'), 'Should clean up previous theme-blue class');
    assert.ok(pEl.classList.contains('theme-green'), 'Should have new theme-green class');

    // 4. data-ax-html Runtime Tests
    console.log('  Testing data-ax-html rendering and security (escaping/SafeHtml)...');
    class HtmlComponent extends AvenxComponent {
      constructor() {
        super({ content: 'Hello <b>World</b>', rawContent: html`Hello <b>World</b>` });
      }
      render() {
        return `
          <div class="escaped" data-ax-html="content">Placeholder</div>
          <div class="raw" data-ax-html="rawContent">Placeholder</div>
        `;
      }
    }
    const htmlComp = new HtmlComponent();
    const htmlTarget = createMockElementNode('div');
    htmlComp.mount(htmlTarget);
    htmlComp.update();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const escEl = htmlTarget.querySelector('.escaped');
    const rawEl = htmlTarget.querySelector('.raw');

    assert.strictEqual(escEl.innerHTML, 'Hello &lt;b&gt;World&lt;/b&gt;', 'Content should be escaped by default to prevent XSS');
    assert.strictEqual(rawEl.innerHTML, 'Hello <b>World</b>', 'Content should render raw HTML if SafeHtml wrapper is used');

    // 5. Scoping Directives inside loops (ListManager support)
    console.log('  Testing directives inside list rendering loops...');
    class LoopComponent extends AvenxComponent {
      constructor() {
        super({
          items: [
            { id: 1, name: 'Item 1', active: true },
            { id: 2, name: 'Item 2', active: false },
          ]
        });
      }
      render() {
        return `
          <ul>
            <template data-ax-for="items" data-ax-as="item" data-ax-key="item.id">
              <li data-ax-show="item.active" data-ax-class="{ 'active-item': item.active }">${'{% item.name %}'}</li>
            </template>
          </ul>
        `;
      }
    }
    const loopComp = new LoopComponent();
    const loopTarget = createMockElementNode('div');
    loopComp.mount(loopTarget);
    loopComp.update();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const listItems = loopTarget.querySelectorAll('li');
    assert.strictEqual(listItems.length, 2, 'Should render 2 list items');
    assert.strictEqual(listItems[0].style.display, '', 'Item 1 should be visible');
    assert.ok(listItems[0].classList.contains('active-item'), 'Item 1 should have class active-item');
    assert.strictEqual(listItems[1].style.display, 'none', 'Item 2 should be hidden');
    assert.ok(!listItems[1].classList.contains('active-item'), 'Item 2 should not have class active-item');

    // Mutate second item status
    loopComp.state.items[1].active = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(listItems[1].style.display, '', 'Item 2 should become visible after mutation');
    assert.ok(listItems[1].classList.contains('active-item'), 'Item 2 should get class active-item after mutation');

    console.log('  ✅ Custom Directives unit tests successfully passed!');
  } catch (error) {
    console.error('❌ Custom Directives tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runTests();
