const assert = require('assert');

// 1. Die Mock-Klasse zur Verhaltensprüfung (Behavior Verification)
/**
 *
 */
class MockDOMElement {
  /**
   *
   * @param tagName
   * @param namespaceURI
   */
  constructor(tagName, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.tagName = tagName.toUpperCase();
    this.nodeName = tagName.toUpperCase();
    this.nodeType = 1; // Element Node
    this.namespaceURI = namespaceURI;
    this.childNodes = [];
    this._attrs = {};
    this.attributes = [];
    this.innerHTML = '';
    this.value = '';

    const self = this;
    this.style = {
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
      },
      transitionDuration: '0s',
      animationDuration: '0s',
      transitionDelay: '0s',
      animationDelay: '0s',
    };
    this._display = '';

    this.classList = {
      add: (...classes) => {
        classes.forEach(cls => {
          const current = self.getAttribute('class') ? self.getAttribute('class').split(/\s+/) : [];
          if (!current.includes(cls)) {
            current.push(cls);
            self.setAttribute('class', current.join(' '));
          }
        });
      },
      remove: (...classes) => {
        classes.forEach(cls => {
          const current = self.getAttribute('class') ? self.getAttribute('class').split(/\s+/) : [];
          const idx = current.indexOf(cls);
          if (idx !== -1) {
            current.splice(idx, 1);
            self.setAttribute('class', current.join(' '));
          }
        });
      },
      contains: (cls) => {
        const current = self.getAttribute('class') ? self.getAttribute('class').split(/\s+/) : [];
        return current.includes(cls);
      }
    };

    // Verhaltensaufzeichnung (Interaction Logging)
    this.recordedCalls = [];
  }

  /**
   *
   * @param name
   * @param value
   */
  setAttribute(name, value) {
    this._attrs[name] = String(value);
    this.attributes = Object.entries(this._attrs).map(([k, v]) => ({ name: k, value: v }));
  }

  /**
   *
   * @param name
   */
  getAttribute(name) {
    return this._attrs[name] !== undefined ? this._attrs[name] : null;
  }

  /**
   *
   * @param name
   */
  hasAttribute(name) {
    return this._attrs[name] !== undefined;
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(val) {
    this.setAttribute('class', val);
  }

  /**
   *
   * @param name
   */
  removeAttribute(name) {
    delete this._attrs[name];
    this.attributes = Object.entries(this._attrs).map(([k, v]) => ({ name: k, value: v }));
  }

  /**
   *
   * @param child
   */
  appendChild(child) {
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
      return child;
    }
  }

  /**
   *
   * @param newChild
   * @param oldChild
   */
  replaceChild(newChild, oldChild) {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx !== -1) {
      this.childNodes[idx] = newChild;
      newChild.parentNode = this;
      oldChild.parentNode = null;
      return oldChild;
    }
  }

  /**
   *
   * @param newChild
   * @param referenceChild
   */
  insertBefore(newChild, referenceChild) {
    newChild.parentNode = this;
    const idx = this.childNodes.indexOf(referenceChild);
    if (idx !== -1) {
      this.childNodes.splice(idx, 0, newChild);
    } else {
      this.childNodes.push(newChild);
    }
    return newChild;
  }

  /**
   *
   * @param deep
   */
  cloneNode(deep) {
    const copy = new MockDOMElement(this.tagName, this.namespaceURI);
    copy.value = this.value;
    copy._attrs = { ...this._attrs };
    copy.attributes = [...this.attributes];
    copy.style.display = this.style.display;
    copy.style.transitionDuration = this.style.transitionDuration;
    copy.style.animationDuration = this.style.animationDuration;
    copy.style.transitionDelay = this.style.transitionDelay;
    copy.style.animationDelay = this.style.animationDelay;
    if (deep) {
      this.childNodes.forEach((child) => {
        if (child.nodeType === 1) {
          copy.appendChild(child.cloneNode(true));
        } else {
          copy.appendChild({ ...child, parentNode: copy });
        }
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
    const lowerSel = selector.toLowerCase();
    const traverse = (node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 1) {
          if (selector === '*' || child.tagName.toLowerCase() === lowerSel) {
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
   * @param event
   * @param callback
   */
  addEventListener(event, callback) {
    // Protokolliert den Aufruf für spätere Assertions
    this.recordedCalls.push({ method: 'addEventListener', event, callback });
  }

  /**
   *
   * @param event
   * @param callback
   */
  removeEventListener(event, callback) {
    // Protokolliert den Aufruf für spätere Assertions
    this.recordedCalls.push({ method: 'removeEventListener', event, callback });
  }

  /**
   *
   * @param event
   */
  dispatchEvent(event) {
    this.recordedCalls.push({ method: 'dispatchEvent', event });
  }

  // Verifikations-Methoden zur Verhaltensprüfung (Behavior Verification)
  /**
   *
   * @param event
   */
  assertListenerWasAdded(event) {
    const found = this.recordedCalls.some((call) => call.method === 'addEventListener' && call.event === event);
    assert.ok(found, `Erwartung fehlgeschlagen: addEventListener wurde nicht für "${event}" aufgerufen.`);
  }

  /**
   *
   * @param event
   */
  assertListenerWasRemoved(event) {
    const found = this.recordedCalls.some((call) => call.method === 'removeEventListener' && call.event === event);
    assert.ok(found, `Erwartung fehlgeschlagen: removeEventListener wurde nicht für "${event}" aufgerufen.`);
  }
}

// 2. Hilfsfunktionen zum Registrieren und Zurücksetzen der globalen Variablen
/**
 *
 */
function setupDOMMock() {
  global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  global.document = {
    querySelector: () => new MockDOMElement('div'),
    createElement: (tag) => new MockDOMElement(tag),
    createElementNS: (ns, tag) => new MockDOMElement(tag, ns),
  };

  global.window = global.window || {};
  global.window.getComputedStyle = (el) => {
    return el.style || {
      transitionDuration: '0s',
      animationDuration: '0s',
      transitionDelay: '0s',
      animationDelay: '0s',
    };
  };
  global.requestAnimationFrame = (cb) => {
    return setTimeout(() => cb(Date.now()), 0);
  };

  global.DOMParser = class {
    /**
     *
     * @param htmlString
     */
    parseFromString(htmlString) {
      const body = new MockDOMElement('body');

      // Einfacher HTML Regex Parser
      const tagRegex = /<([a-z0-9-]+)([^>]*?)>([\s\S]*?)<\/\1>/gi;
      let match;
      while ((match = tagRegex.exec(htmlString)) !== null) {
        const tagName = match[1];
        const attrsStr = match[2];
        const content = match[3];

        const element = new MockDOMElement(tagName);

        const attrRegex = /([\w@:-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
          const attrName = attrMatch[1];
          const attrValue = attrMatch[2] || attrMatch[3] || '';
          element.setAttribute(attrName, attrValue);
        }

        if (content.trim()) {
          const textNode = {
            nodeType: 3,
            nodeName: '#text',
            textContent: content,
            parentNode: element,
          };
          element.childNodes.push(textNode);
        }

        body.appendChild(element);
      }

      return { body };
    }
  };
}

/**
 *
 */
function teardownDOMMock() {
  delete global.Node;
  delete global.document;
  delete global.DOMParser;
  delete global.window;
  delete global.requestAnimationFrame;
}

module.exports = {
  MockDOMElement,
  setupDOMMock,
  teardownDOMMock,
};
