import { AvenxPage } from './AvenxPage.js';

/**
 * Creates a deep proxy to track calls and state modifications.
 * @param {object} target - Target object to proxy.
 * @param {string[]} path - Key path of the object being proxied.
 * @param {object} options - State change and calls tracking options.
 * @returns {object} Proxied target.
 */
function createDeepMockProxy(target, path = [], options) {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === '$calls') return options.calls;
      if (prop === '$stateChanges') return options.stateChanges;
      if (prop === '$onStateChange') {
        return (cb) => {
          options.stateChangeCallbacks.push(cb);
          return () => {
            const idx = options.stateChangeCallbacks.indexOf(cb);
            if (idx !== -1) options.stateChangeCallbacks.splice(idx, 1);
          };
        };
      }
      if (prop === '$onCall') {
        return (cb) => {
          options.callCallbacks.push(cb);
          return () => {
            const idx = options.callCallbacks.indexOf(cb);
            if (idx !== -1) options.callCallbacks.splice(idx, 1);
          };
        };
      }
      if (prop === '$reset') {
        return () => {
          options.calls.length = 0;
          options.stateChanges.length = 0;
        };
      }
      if (prop === '$isMock') return true;

      // Avoid proxying standard Symbols or constructor properties
      if (typeof prop === 'symbol' || prop === 'constructor' || prop === 'prototype') {
        return Reflect.get(t, prop, receiver);
      }

      const val = Reflect.get(t, prop, receiver);
      if (typeof val === 'function') {
        return function (...args) {
          if (path.length === 0) {
            options.calls.push({ method: prop, args });
            options.callCallbacks.forEach((cb) => cb(prop, args));
          }
          return val.apply(receiver, args);
        };
      }
      if (val && typeof val === 'object' && !(val instanceof Date) && !(val instanceof RegExp)) {
        return createDeepMockProxy(val, [...path, prop], options);
      }
      return val;
    },
    set(t, prop, value, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.set(t, prop, value, receiver);
      }
      const fullPath = [...path, prop];
      const pathStr = fullPath.join('.');
      options.stateChanges.push({ prop: pathStr, value });
      options.stateChangeCallbacks.forEach((cb) => cb(pathStr, value));
      return Reflect.set(t, prop, value, receiver);
    },
  });
}

/**
 * Recursively serializes a DOM element to HTML.
 * @param {Element|object} el - Element to serialize.
 * @returns {string} Serialized HTML string.
 */
function getHTML(el) {
  if (!el) return '';
  // If JSDOM/real DOM
  if (typeof Element !== 'undefined' && el instanceof Element) {
    return el.innerHTML;
  }
  // If it's a mock element with custom innerHTML getter
  const desc =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) || {}, 'innerHTML') ||
    Object.getOwnPropertyDescriptor(el, 'innerHTML');
  if (desc && typeof desc.get === 'function') {
    return el.innerHTML;
  }
  // Fallback serializing children
  if (el.childNodes && el.childNodes.length > 0) {
    return el.childNodes
      .map((c) => {
        if (c.nodeType === 3) return c.textContent;
        if (c.nodeType === 1) {
          const attrsStr = (c.attributes || []).map((attr) => ` ${attr.name}="${attr.value}"`).join('');
          const tag = c.tagName.toLowerCase();
          return `<${tag}${attrsStr}>${getHTML(c)}</${tag}>`;
        }
        return '';
      })
      .join('');
  }
  return el.innerHTML || '';
}

/**
 * Main testing utility class for Avenx components.
 */
export class AvenxMock {
  /**
   * Creates a mock bridge proxy.
   * @param {typeof AvenxBridge|object} bridgeClassOrObject - The bridge class or object to mock.
   * @param {object} [initialData] - Initial state override.
   * @returns {object} The mock bridge proxy.
   */
  static createMockBridge(bridgeClassOrObject, initialData = {}) {
    let instance;
    if (typeof bridgeClassOrObject === 'function') {
      instance = new bridgeClassOrObject();
    } else if (bridgeClassOrObject && typeof bridgeClassOrObject === 'object') {
      instance = Object.create(Object.getPrototypeOf(bridgeClassOrObject));
      Object.defineProperties(instance, Object.getOwnPropertyDescriptors(bridgeClassOrObject));
    } else {
      instance = {};
    }

    if (initialData) {
      Object.assign(instance, initialData);
    }

    const calls = [];
    const stateChanges = [];
    const stateChangeCallbacks = [];
    const callCallbacks = [];

    const options = {
      calls,
      stateChanges,
      stateChangeCallbacks,
      callCallbacks,
    };

    return createDeepMockProxy(instance, [], options);
  }

  /**
   * Creates a new testing sandbox.
   * @returns {AvenxSandbox}
   */
  static createSandbox() {
    return new AvenxSandbox();
  }

  /**
   * Triggers an event on an element.
   * Supports standard DOM Event/CustomEvent and custom MockNode trigger method.
   * @param {Element} element
   * @param {string} eventName
   * @param {object} [eventData]
   */
  static trigger(element, eventName, eventData = {}) {
    if (typeof Event !== 'undefined' && element.dispatchEvent) {
      let event;
      if (typeof CustomEvent !== 'undefined') {
        event = new CustomEvent(eventName, { bubbles: true, cancelable: true, detail: eventData });
      } else {
        event = new Event(eventName, { bubbles: true, cancelable: true });
      }
      Object.assign(event, eventData);
      element.dispatchEvent(event);
    } else if (typeof element.trigger === 'function') {
      element.trigger(eventName, eventData);
    } else {
      let current = element;
      const event = {
        target: element,
        type: eventName,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.cancelBubble = true;
        },
        ...eventData,
      };
      while (current) {
        if (current.listeners && typeof current.listeners[eventName] === 'function') {
          current.listeners[eventName](event);
        } else if (current.addEventListener && typeof current.listeners === 'object' && current.listeners[eventName]) {
          current.listeners[eventName](event);
        }
        if (event.cancelBubble) break;
        current = current.parentNode;
      }
    }
  }
}

/**
 * Sandbox container for isolating and registering components under test.
 */
export class AvenxSandbox {
  /**
   * Initializes the AvenxSandbox instance.
   */
  constructor() {
    /** @type {Map<string, typeof AvenxComponent>} */
    this.components = new Map();
    /** @type {object} */
    this.bridges = {};
  }

  /**
   * Registers a component class with the sandbox.
   * @param {string} name
   * @param {typeof AvenxComponent} compClass
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
    if (typeof window === 'undefined') {
      global.window = {};
    }
    window.__avenx_routers = [
      {
        currentRoute: route,
      },
    ];
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
   * @param {typeof AvenxComponent} compClass
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
