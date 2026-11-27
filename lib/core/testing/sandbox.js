import { AvenxPage } from '../runtime/AvenxPage.js';
import { AvenxMock } from './mock.js';
import { getHTML } from './mountComponent.js';

/**
 * Sandbox container for isolating and registering components under test.
 */
export class AvenxSandbox {
  /**
   * Initializes the AvenxSandbox instance.
   */
  constructor() {
    /** @type {Map<string, Function>} */
    this.components = new Map();
    /** @type {object} */
    this.bridges = {};
  }

  /**
   * Registers a component class with the sandbox.
   * @param {string} name
   * @param {Function} compClass
   * @returns {AvenxSandbox}
   */
  register(name, compClass) {
    this.components.set(name, compClass);
    return this;
  }

  /**
   * Registers a bridge with the sandbox.
   * @param {string} name
   * @param {object} bridgeInstance
   * @returns {AvenxSandbox}
   */
  registerBridge(name, bridgeInstance) {
    this.bridges[name] = bridgeInstance;
    return this;
  }

  /**
   * Mocks the router state.
   * @param {object} route
   * @returns {AvenxSandbox}
   */
  setRoute(route) {
    if (this._mockRouter && typeof this._mockRouter.$destroy === 'function') {
      this._mockRouter.$destroy();
    }
    this._mockRouter = AvenxMock.createMockRouter({
      currentRoute: route,
      hash: route && route.hash,
      page: route && route.page,
      params: route && route.params,
      queryParams: route && route.params && route.params.query,
    });
    return this;
  }

  /**
   * Waits for any pending scheduled updates to complete.
   * @returns {Promise<void>}
   */
  async waitForUpdate() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Mounts a component in isolation.
   * @param {Function} compClass
   * @param {object} [props]
   * @param {Element} [container]
   * @returns {object} Sandbox mount helper instance.
   */
  mount(compClass, props = {}, container = null) {
    let target = container;
    if (!target) {
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        target = document.createElement('div');
      } else {
        target = this._createMockElement('div');
      }
    }

    let instance;
    if (compClass.prototype instanceof AvenxPage) {
      instance = new compClass(this.bridges, this.components, props);
    } else {
      instance = new compClass(this.bridges, props);
    }

    instance.mount(target);

    return {
      instance,
      container: target,
      get html() {
        return getHTML(target);
      },
      update: () => {
        instance.update();
      },
      trigger: (selectorOrElement, eventName, eventData = {}) => {
        let el = selectorOrElement;
        if (typeof selectorOrElement === 'string') {
          if (typeof target.querySelector === 'function') {
            el = target.querySelector(selectorOrElement);
          } else {
            el = this._findMockElementBySelector(target, selectorOrElement);
          }
        }
        if (!el) {
          throw new Error(`Element not found: ${selectorOrElement}`);
        }
        AvenxMock.trigger(el, eventName, eventData);
      },
    };
  }

  /**
   * Internal helper to resolve mock DOM selector fallback.
   * @param {object} root - Root node to start traversal.
   * @param {string} selector - CSS selector string.
   * @returns {object|null} Matched element or null.
   * @private
   */
  _findMockElementBySelector(root, selector) {
    if (!root) return null;
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      const traverse = (node) => {
        if (node.getAttribute && node.getAttribute('id') === id) return node;
        if (node.attrs && node.attrs.id === id) return node;
        const children = node.childNodes || node.children || [];
        for (const child of children) {
          const res = traverse(child);
          if (res) return res;
        }
        return null;
      };
      return traverse(root);
    } else if (selector.startsWith('.')) {
      const className = selector.substring(1);
      const traverse = (node) => {
        if (node.getAttribute && node.getAttribute('class') === className) return node;
        if (node.attrs && node.attrs.class === className) return node;
        const children = node.childNodes || node.children || [];
        for (const child of children) {
          const res = traverse(child);
          if (res) return res;
        }
        return null;
      };
      return traverse(root);
    } else {
      const tag = selector.toUpperCase();
      const traverse = (node) => {
        if (node.tagName === tag) return node;
        const children = node.childNodes || node.children || [];
        for (const child of children) {
          const res = traverse(child);
          if (res) return res;
        }
        return null;
      };
      return traverse(root);
    }
  }

  /**
   * Helper to create a fallback mock element.
   * @param {string} tagName - Tag name of the element.
   * @returns {object} Fallback element object.
   * @private
   */
  _createMockElement(tagName) {
    const listeners = {};
    const element = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      attrs: {},
      attributes: [],
      childNodes: [],
      children: [],
      listeners,
      hasAttribute(name) {
        return name in this.attrs;
      },
      getAttribute(name) {
        return this.attrs[name] !== undefined ? this.attrs[name] : null;
      },
      setAttribute(name, val) {
        this.attrs[name] = val;
      },
      removeAttribute(name) {
        delete this.attrs[name];
      },
      appendChild(child) {
        if (child.parentNode) {
          child.parentNode.removeChild(child);
        }
        child.parentNode = this;
        this.childNodes.push(child);
        if (child.nodeType === 1) {
          this.children.push(child);
        }
        return child;
      },
      removeChild(child) {
        const idx = this.childNodes.indexOf(child);
        if (idx !== -1) {
          this.childNodes.splice(idx, 1);
          child.parentNode = null;
        }
        const cIdx = this.children.indexOf(child);
        if (cIdx !== -1) {
          this.children.splice(cIdx, 1);
        }
        return child;
      },
      addEventListener(event, callback) {
        listeners[event] = callback;
      },
      removeEventListener(event, callback) {
        if (listeners[event] === callback) {
          delete listeners[event];
        }
      },
      querySelectorAll(selector) {
        if (selector === '*') {
          const result = [];
          const traverse = (node) => {
            const children = node.childNodes || node.children || [];
            children.forEach((child) => {
              if (child.nodeType === 1) {
                result.push(child);
              }
              traverse(child);
            });
          };
          traverse(this);
          return result;
        }
        return [];
      },
      get innerHTML() {
        return this.childNodes
          .map((c) => {
            if (c.nodeType === 3) return c.textContent;
            if (c.nodeType === 1) return c.outerHTML || `<${c.tagName.toLowerCase()}></${c.tagName.toLowerCase()}>`;
            return '';
          })
          .join('');
      },
      set innerHTML(val) {
        this.childNodes.forEach((c) => {
          c.parentNode = null;
        });
        this.childNodes = [];
        this.children = [];
      },
    };
    return element;
  }
}
