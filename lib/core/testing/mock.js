import { BRIDGE_DEFINITION, IS_BRIDGE, bridge, defineBridgeName } from '../runtime/bridge.js';
import { AvenxSandbox } from './sandbox.js';
import { mountTestComponent, fireEvent, flushPromises } from './mountComponent.js';

/**
 * Parses a URL query string into typed primitives (`boolean`, `number`, or `string`).
 * @param {string|undefined} queryPart - Raw query string without leading `?`.
 * @returns {Record<string, boolean|number|string>} Parsed query parameters.
 */
function parseRouterQuery(queryPart) {
  const parsed = {};
  if (!queryPart) return parsed;
  for (const [k, v] of new URLSearchParams(queryPart).entries()) {
    if (v === 'true') parsed[k] = true;
    else if (v === 'false') parsed[k] = false;
    else if (/^\d+$/.test(v)) parsed[k] = Number(v);
    else parsed[k] = v;
  }
  return parsed;
}

const NATIVE_EVENT_CONSTRUCTORS = {
  click: 'MouseEvent',
  input: 'InputEvent',
  keyup: 'KeyboardEvent',
};

/**
 * Creates a deep proxy to track calls and state modifications.
 * @param {object} target - Target object to proxy.
 * @param {string[]} path - Key path of the object being proxied.
 * @param {object} options - State change and calls tracking options.
 * @param {object} [fallback] - Object whose members are read when the target has no own member (a real bridge).
 * @returns {object} Proxied target.
 */
export function createDeepMockProxy(target, path = [], options, fallback) {
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

      // A bridge's actions and state are reached through its proxy, not as own
      // properties, so members the mock does not hold itself are read from it.
      const val =
        fallback && !Object.prototype.hasOwnProperty.call(t, prop)
          ? Reflect.get(fallback, prop)
          : Reflect.get(t, prop, receiver);
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
    let fallback;
    if (typeof bridgeClassOrObject === 'function') {
      instance = new bridgeClassOrObject();
    } else if (bridgeClassOrObject && typeof bridgeClassOrObject === 'object' && bridgeClassOrObject[IS_BRIDGE] === true) {
      // A real bridge is read-only from outside and its actions write to the
      // bridge they belong to. Build a separate bridge from the same definition,
      // with the seeded state in it, so this mock's actions and reads share one
      // state and no other mock or the real bridge sees the change. The mock
      // holds only direct assignments and reads everything else from that bridge.
      const definition = bridgeClassOrObject[BRIDGE_DEFINITION];
      const seeded = Object.defineProperties({}, Object.getOwnPropertyDescriptors(definition));
      seeded.state = { ...(definition.state || {}), ...(initialData || {}) };
      fallback = bridge(seeded);
      defineBridgeName(bridgeClassOrObject.$name, fallback);
      instance = Object.create(null);
    } else if (bridgeClassOrObject && typeof bridgeClassOrObject === 'object') {
      instance = Object.create(Object.getPrototypeOf(bridgeClassOrObject));
      Object.defineProperties(instance, Object.getOwnPropertyDescriptors(bridgeClassOrObject));
    } else {
      instance = {};
    }

    if (initialData && !fallback) {
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

    return createDeepMockProxy(instance, [], options, fallback);
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
    const parsedQuery = parseRouterQuery(queryPart);
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
     * @returns {boolean}
     */
    const navigate = (path, method) => {
      const hash = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
      const [navPathPart, navQueryPart] = hash.split('?');
      const navQuery = parseRouterQuery(navQueryPart);
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
      $destroy() {
        if (typeof window !== 'undefined' && window.__avenx_routers) {
          window.__avenx_routers.delete(mockRouter);
        }
      },
    };

    if (typeof window === 'undefined') {
      global.window = global.window || {};
    }
    if (!window.__avenx_routers) {
      window.__avenx_routers = new Set();
    }
    // Preserve real routers, but keep the legacy behavior where the newest
    // mock router is the one components without an app instance use.
    for (const router of window.__avenx_routers) {
      if (router && router.$isMock) {
        window.__avenx_routers.delete(router);
      }
    }
    window.__avenx_routers.add(mockRouter);

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
      const ctorName = NATIVE_EVENT_CONSTRUCTORS[eventName];
      if (ctorName && typeof window !== 'undefined' && typeof window[ctorName] !== 'undefined') {
        event = new window[ctorName](eventName, {
          bubbles: true,
          cancelable: true,
          ...options,
        });
      }

      // Fallback for unsupported/missing native event constructors
      if (!event && typeof window !== 'undefined') {
        if (typeof window.CustomEvent !== 'undefined') {
          event = new window.CustomEvent(eventName, {
            bubbles: true,
            cancelable: true,
            detail: detailOrOptions,
          });
        } else if (typeof window.Event !== 'undefined') {
          event = new window.Event(eventName, { bubbles: true, cancelable: true });
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
