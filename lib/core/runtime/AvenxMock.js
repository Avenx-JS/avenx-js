import { AvenxPage } from './AvenxPage.js';
import { nextTick } from '../reactive/scheduler.js';
import { assertSnapshot } from '../testing/snapshot.js';

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
   * @param {Function|object} bridgeClassOrObject - The bridge class or object to mock.
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
   * Creates a lightweight mock router for isolated page / route-dependent tests.
   * Attaches itself to `window.__avenx_routers` so component `$route` works.
   * @param {object} [options]
   * @param {object} [options.currentRoute] - Full route object override.
   * @param {string} [options.hash] - Initial hash (default `#/`).
   * @param {string} [options.page] - Active page name.
   * @param {object} [options.params] - Path params.
   * @param {object} [options.queryParams] - Query params (merged into `params.query`).
   * @param {Array<Function|object>} [options.guards] - Optional guards run on push/replace.
   * @returns {object} Mock router with `push`, `replace`, `getParams`, and `currentRoute`.
   */
  static createMockRouter(options = {}) {
    const initialHash =
      (options.currentRoute && options.currentRoute.hash) ||
      options.hash ||
      '#/';
    const [pathPart, queryPart] = initialHash.split('?');
    const parsedQuery = {};
    if (queryPart) {
      const qp = new URLSearchParams(queryPart);
      for (const [k, v] of qp.entries()) {
        if (v === 'true') parsedQuery[k] = true;
        else if (v === 'false') parsedQuery[k] = false;
        else if (/^\d+$/.test(v)) parsedQuery[k] = Number(v);
        else parsedQuery[k] = v;
      }
    }
    const queryFromOptions =
      options.queryParams ||
      (options.currentRoute && options.currentRoute.query) ||
      (options.currentRoute && options.currentRoute.params && options.currentRoute.params.query) ||
      parsedQuery;
    const pathParams = {
      ...(options.params || {}),
      ...(options.currentRoute && options.currentRoute.params ? { ...options.currentRoute.params } : {}),
    };
    delete pathParams.query;
    if (queryFromOptions && Object.keys(queryFromOptions).length > 0) {
      pathParams.query = { ...queryFromOptions };
    }

    const currentRoute = {
      hash: initialHash,
      path: (options.currentRoute && options.currentRoute.path) || pathPart || '',
      page: (options.currentRoute && options.currentRoute.page) || options.page || '',
      params: pathParams,
      query: { ...queryFromOptions },
    };

    const guards = Array.isArray(options.guards) ? options.guards.slice() : [];
    const calls = [];

    /**
     * @param {string} path
     * @param {'push'|'replace'} method
     */
    const navigate = (path, method) => {
      const hash = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
      const [navPathPart, navQueryPart] = hash.split('?');
      const navQuery = {};
      if (navQueryPart) {
        const qp = new URLSearchParams(navQueryPart);
        for (const [k, v] of qp.entries()) {
          if (v === 'true') navQuery[k] = true;
          else if (v === 'false') navQuery[k] = false;
          else if (/^\d+$/.test(v)) navQuery[k] = Number(v);
          else navQuery[k] = v;
        }
      }
      const nextParams = { ...currentRoute.params };
      if (Object.keys(navQuery).length > 0) {
        nextParams.query = { ...navQuery };
      } else {
        delete nextParams.query;
      }
      const nextRoute = {
        hash,
        path: navPathPart,
        page: currentRoute.page,
        params: nextParams,
        query: navQuery,
      };

      for (const guard of guards) {
        const result =
          typeof guard === 'function'
            ? guard(nextRoute, { ...currentRoute })
            : guard && typeof guard.canActivate === 'function'
              ? guard.canActivate(nextRoute, { ...currentRoute })
              : true;
        if (result === false) {
          calls.push({ method, args: [path], blocked: true });
          return false;
        }
        if (typeof result === 'string') {
          return navigate(result, method);
        }
      }

      currentRoute.hash = nextRoute.hash;
      currentRoute.path = nextRoute.path;
      currentRoute.params = nextRoute.params;
      currentRoute.query = nextRoute.query;
      calls.push({ method, args: [path], blocked: false });
      return true;
    };

    const mockRouter = {
      currentRoute,
      guards,
      $calls: calls,
      $isMock: true,
      push(path) {
        return navigate(path, 'push');
      },
      replace(path) {
        return navigate(path, 'replace');
      },
      getParams() {
        return { ...currentRoute.params };
      },
      $reset() {
        calls.length = 0;
      },
    };

    if (typeof window === 'undefined') {
      global.window = global.window || {};
    }
    window.__avenx_routers = [mockRouter];

    return mockRouter;
  }

  /**
   * Triggers a DOM or custom event on an element.
   * Uses native event constructors for common DOM events and CustomEvent
   * for custom component events.
   * @param {Element|object} target - Target element.
   * @param {string} eventName - Event name.
   * @param {object} [detailOrOptions] - Event detail or event options.
   * @returns {Event|object}
   */
  static triggerEvent(target, eventName, detailOrOptions = {}) {
    if (!target) {
      throw new Error('triggerEvent requires a target element.');
    }

    const options =
      detailOrOptions && typeof detailOrOptions === 'object'
        ? detailOrOptions
        : {};

    // Real DOM element
    if (typeof target.dispatchEvent === 'function') {
      if ('value' in options && 'value' in target) {
        target.value = options.value;
      }

      let event;

      switch (eventName) {
        case 'click':
          if (typeof window !== 'undefined' && typeof window.MouseEvent !== 'undefined') {
            event = new window.MouseEvent(eventName, {
              bubbles: true,
              cancelable: true,
              ...options,
            });
          }
          break;

        case 'input':
          if (typeof window !== 'undefined' && typeof window.InputEvent !== 'undefined') {
            event = new window.InputEvent(eventName, {
              bubbles: true,
              cancelable: true,
              ...options,
            });
          }
          break;

        case 'keyup':
          if (typeof window !== 'undefined' && typeof window.KeyboardEvent !== 'undefined') {
            event = new window.KeyboardEvent(eventName, {
              bubbles: true,
              cancelable: true,
              ...options,
            });
          }
          break;

        default:
          break;
      }

      // Fallback for unsupported/missing native event constructors
      if (!event) {
        if (
          typeof window !== 'undefined' &&
          typeof window.CustomEvent !== 'undefined'
        ) {
          event = new window.CustomEvent(eventName, {
            bubbles: true,
            cancelable: true,
            detail: detailOrOptions,
          });
        } else if (
          typeof window !== 'undefined' &&
          typeof window.Event !== 'undefined'
        ) {
          event = new window.Event(eventName, {
            bubbles: true,
            cancelable: true,
          });
        }
      }

      if (!event) {
        throw new Error('No supported Event constructor available.');
      }

      target.dispatchEvent(event);
      return event;
    }

    // Mock element
    AvenxMock.trigger(target, eventName, detailOrOptions);

    return {
      type: eventName,
      target,
      ...options,
    };
  }

  /**
   * Triggers an event on an element.
   * Supports standard DOM Event/CustomEvent and custom MockNode trigger method.
   * @param {Element} element
   * @param {string} eventName
   * @param {object} [eventData]
   */
  static trigger(element, eventName, eventData = {}) {
    let event;
    if (typeof Event !== 'undefined' && typeof element.dispatchEvent === 'function') {
      if (typeof CustomEvent !== 'undefined') {
        event = new CustomEvent(eventName, { bubbles: true, cancelable: true, detail: eventData });
      } else {
        event = new Event(eventName, { bubbles: true, cancelable: true });
      }
      Object.assign(event, eventData);
    } else {
      event = {
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
    }

    if (!event.target) {
      try {
        Object.defineProperty(event, 'target', { value: element, writable: true, configurable: true });
      } catch {
        event.target = element;
      }
    }

    let isRealDOM = false;
    if (typeof Element !== 'undefined' && element instanceof Element && typeof element.dispatchEvent === 'function') {
      isRealDOM = true;
      element.dispatchEvent(event);
    } else if (typeof element.dispatchEvent === 'function') {
      element.dispatchEvent(event);
    }

    if (!isRealDOM) {
      let current = element;
      while (current) {
        if (current.listeners && typeof current.listeners[eventName] === 'function') {
          current.listeners[eventName](event);
        } else if (current.addEventListener && typeof current.listeners === 'object' && current.listeners[eventName]) {
          current.listeners[eventName](event);
        }

        let hasRun = false;
        if (current.__avenxDelegatedListeners && current.__avenxDelegatedListeners.has(eventName)) {
          const entry = current.__avenxDelegatedListeners.get(eventName);
          const handler = typeof entry === 'function' ? entry : entry.handler;
          if (typeof handler === 'function') {
            handler(event);
            hasRun = true;
          }
        }

        if (current.__avenxDirectListeners && current.__avenxDirectListeners.has(eventName)) {
          const entry = current.__avenxDirectListeners.get(eventName);
          const handler = typeof entry === 'function' ? entry : entry.handler;
          if (typeof handler === 'function') {
            handler(event);
            hasRun = true;
          }
        }

        if (!hasRun && Array.isArray(current.recordedCalls)) {
          current.recordedCalls.forEach((call) => {
            if (call.method === 'addEventListener' && call.event === eventName && typeof call.callback === 'function') {
              call.callback(event);
            }
          });
        }

        if (event.cancelBubble) break;
        current = current.parentNode;
      }
    }
  }

  /**
   * Instantiates, mounts, and returns component instance with mocked props, slots, and state.
   * @param {Function} ComponentClass
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  static mountTestComponent(ComponentClass, options) {
    return mountTestComponent(ComponentClass, options);
  }

  /**
   * Helper to dispatch DOM events synchronously and flush scheduler microtasks.
   * @param {Element} element
   * @param {string} eventType
   * @param {object} [detail]
   * @returns {Promise<void>}
   */
  static fireEvent(element, eventType, detail) {
    return fireEvent(element, eventType, detail);
  }

  /**
   * Waits for pending Promise microtasks / macrotasks to settle.
   * @returns {Promise<void>}
   */
  static flushPromises() {
    return flushPromises();
  }
}

/**
 * Settles the event loop so pending Promises and timers can complete.
 * Prefer this over ad-hoc `setTimeout` chains in unit tests.
 * @returns {Promise<void>}
 */
export function flushPromises() {
  return new Promise((resolve) => {
    if (typeof globalThis.setImmediate === 'function') {
      globalThis.setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Instantiates, mounts, and returns the component instance and target DOM element for testing.
 * @param {Function} ComponentClass - Component class to mount.
 * @param {object} [options] - Mounting options.
 * @param {object} [options.props] - Props to pass to component.
 * @param {object|string} [options.slots] - Slot content string, DOM node, or map of slot name to content.
 * @param {object} [options.state] - State overrides.
 * @param {object} [options.initialState] - Alias for state overrides.
 * @param {object} [options.bridges] - Mock or real bridges to pass.
 * @param {object} [options.components] - Child component map.
 * @param {Element} [options.container] - Target DOM container.
 * @param {object} [options.route] - Mock route options.
 * @returns {Promise<{instance: object, element: Element, container: Element, unmount: Function, html: string}>}
 */
export async function mountTestComponent(ComponentClass, options = {}) {
  const {
    props = {},
    slots = null,
    state = null,
    initialState = null,
    bridges = {},
    components = {},
    container = null,
    route = null,
  } = options;

  if (route) {
    AvenxMock.createMockRouter(typeof route === 'object' ? route : {});
  }

  let target = container;
  if (!target) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      target = document.createElement('div');
    } else {
      target = new AvenxSandbox()._createMockElement('div');
    }
  }

  if (slots) {
    if (typeof slots === 'string') {
      target.innerHTML = slots;
    } else if (typeof slots === 'object') {
      if (slots.nodeType) {
        target.appendChild(slots);
      } else {
        Object.entries(slots).forEach(([name, content]) => {
          if (name === 'default') {
            if (typeof content === 'string') {
              if (typeof target.insertAdjacentHTML === 'function') {
                target.insertAdjacentHTML('beforeend', content);
              } else {
                target.innerHTML += content;
              }
            } else if (content && content.nodeType) {
              target.appendChild(content);
            }
          } else {
            if (typeof content === 'string') {
              if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
                const div = document.createElement('div');
                div.setAttribute('slot', name);
                div.innerHTML = content;
                target.appendChild(div);
              }
            } else if (content && content.nodeType) {
              if (typeof content.setAttribute === 'function') {
                content.setAttribute('slot', name);
              }
              target.appendChild(content);
            }
          }
        });
      }
    }
  }

  let instance;
  if (ComponentClass.prototype && ComponentClass.prototype instanceof AvenxPage) {
    instance = new ComponentClass(bridges, components, props);
  } else {
    try {
      instance = new ComponentClass(bridges, props);
    } catch {
      instance = new ComponentClass(props);
    }
  }

  const stateOverrides = state || initialState;
  if (stateOverrides && instance.state) {
    Object.assign(instance.state, stateOverrides);
  }

  instance.mount(target);
  await nextTick();

  const element =
    (typeof instance._getElement === 'function' && instance._getElement()) ||
    (typeof instance.getElement === 'function' && instance.getElement()) ||
    target.firstElementChild ||
    target;

  const matchesSelector = (node, selector) => {
    if (!node || node.nodeType !== 1 || !selector) return false;
    if (selector === '*') return true;
    if (/^[a-zA-Z][\w-]*$/.test(selector)) {
      return node.tagName && node.tagName.toLowerCase() === selector.toLowerCase();
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const classAttr = (typeof node.getAttribute === 'function' && node.getAttribute('class')) || '';
      return (
        (node.classList && typeof node.classList.contains === 'function' && node.classList.contains(cls)) ||
        classAttr.split(/\s+/).includes(cls)
      );
    }
    const tagClass = selector.match(/^([a-zA-Z][\w-]*)\.([\w-]+)$/);
    if (tagClass) {
      const classAttr = (typeof node.getAttribute === 'function' && node.getAttribute('class')) || '';
      return (
        node.tagName &&
        node.tagName.toLowerCase() === tagClass[1].toLowerCase() &&
        ((node.classList && node.classList.contains(tagClass[2])) || classAttr.split(/\s+/).includes(tagClass[2]))
      );
    }
    if (typeof node.matches === 'function') {
      try {
        return node.matches(selector);
      } catch {
        return false;
      }
    }
    return false;
  };

  const collectElements = (root) => {
    const out = [];
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === 1) out.push(node);
      const kids = node.childNodes || node.children || [];
      for (let i = 0; i < kids.length; i++) {
        visit(kids[i]);
      }
    };
    visit(root);
    return out;
  };

  return {
    instance,
    component: instance,
    element,
    container: target,
    update: () => {
      if (typeof instance.update === 'function') {
        instance.update();
      }
    },
    unmount: () => {
      if (typeof instance.unmount === 'function') {
        instance.unmount();
      }
    },
    toMatchSnapshot(name = 'default', snapshotOptions = {}) {
      return assertSnapshot(element || target, name, snapshotOptions);
    },
    get html() {
      return getHTML(target);
    },
    find(selector) {
      if (!selector) return null;
      const roots = [element, target].filter(Boolean);
      for (const root of roots) {
        if (matchesSelector(root, selector)) return root;
        if (typeof root.querySelector === 'function') {
          const found = root.querySelector(selector);
          if (found) return found;
        }
        const nodes = collectElements(root);
        for (const node of nodes) {
          if (node !== root && matchesSelector(node, selector)) {
            return node;
          }
        }
      }
      return null;
    },
    findAll(selector) {
      if (!selector) return [];
      const seen = new Set();
      const out = [];
      const roots = [element, target].filter(Boolean);
      for (const root of roots) {
        if (typeof root.querySelectorAll === 'function') {
          const list = root.querySelectorAll(selector);
          for (let i = 0; i < list.length; i++) {
            if (!seen.has(list[i])) {
              seen.add(list[i]);
              out.push(list[i]);
            }
          }
        }
        for (const node of collectElements(root)) {
          if (matchesSelector(node, selector) && !seen.has(node)) {
            seen.add(node);
            out.push(node);
          }
        }
      }
      return out;
    },
    findComponent(ComponentClassOrName) {
      const matches = [];
      const roots = [element, target].filter(Boolean);
      for (const root of roots) {
        for (const node of collectElements(root)) {
          const comp = node.__avenx_comp_instance;
          if (!comp) continue;
          let ok;
          if (typeof ComponentClassOrName === 'function') {
            ok = comp instanceof ComponentClassOrName || comp.constructor === ComponentClassOrName;
          } else if (typeof ComponentClassOrName === 'string') {
            const name = ComponentClassOrName;
            ok =
              (comp.constructor && comp.constructor.name === name) ||
              (comp.name && comp.name === name) ||
              (typeof node.getAttribute === 'function' &&
                (node.getAttribute('data-avenx-comp') === name ||
                  node.getAttribute('data-avenx-comp-dynamic') === name));
          } else {
            ok = true;
          }
          if (ok) matches.push(comp);
        }
      }
      return matches.find((c) => c !== instance) || matches[0] || null;
    },
    async trigger(selectorOrEl, eventName, detail = {}) {
      let el = selectorOrEl;
      if (typeof selectorOrEl === 'string') {
        el = this.find(selectorOrEl);
      }
      if (!el) {
        throw new Error(`trigger: element not found for ${String(selectorOrEl)}`);
      }
      return fireEvent(el, eventName, detail);
    },
  };
}

/**
 * Helper to dispatch DOM events synchronously and flush the microtask scheduler.
 * @param {Element} element - Target element to fire event on.
 * @param {string} eventType - Type of event (e.g. 'click', 'input', 'change').
 * @param {object} [detail] - Event detail or options (e.g. { value: 'foo' }).
 * @returns {Promise<void>}
 */
export async function fireEvent(element, eventType, detail = {}) {
  if (!element) {
    throw new Error('fireEvent requires a target Element.');
  }

  if (detail && typeof detail === 'object') {
    if ('value' in detail && 'value' in element) {
      element.value = detail.value;
    }
    if ('checked' in detail && 'checked' in element) {
      element.checked = detail.checked;
    }
  }

  AvenxMock.trigger(element, eventType, detail);
  await nextTick();
}

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
    AvenxMock.createMockRouter({
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

export { assertSnapshot };
