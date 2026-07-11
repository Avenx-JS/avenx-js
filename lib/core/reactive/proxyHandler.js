/**
 * @file proxyHandler.js
 * @description Factory for creating proxy handlers used in reactive state.
 * Handles normal property access and computed property redirection.
 */

import { track, trigger, parentMap, AvenxWatcher } from './watcher.js';

export const RAW_SYMBOL = Symbol('raw');
export const IS_REACTIVE_PROXY = Symbol('avenx.reactive.proxy');

const mutatingArrayMethods = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'copyWithin',
  'fill',
]);

/**
 * Checks if the value is a candidate for reactive wrapping.
 * We restrict this to plain objects and arrays to avoid issues with
 * built-in classes (Date, RegExp, Map, Set, Promise) and custom class
 * instances that may contain private fields or internal slots.
 * @param {any} value - The value to check.
 * @returns {boolean} True if the value should be reactive, false otherwise.
 */
export function isReactiveTarget(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype || proto === Array.prototype;
}

/**
 * Factory for creating and managing Proxy handlers for reactive state objects.
 */
export class ProxyHandlerFactory {
  /**
   * @param {object} [options] - Configuration options.
   * @param {string[]} [options.computedKeys] - List of keys that should be treated as computed properties.
   * @param {function(): void} [options.onChange] - Callback triggered when a property is set.
   * @param {function(string, object): any} [options.getComputedValue] - Function to evaluate a computed property.
   */
  constructor({ computedKeys = [], onChange = () => {}, getComputedValue = () => undefined } = {}) {
    /** @type {Set<string>} @private */
    this.computedKeys = new Set(computedKeys);
    /** @type {function(): void} @private */
    this.onChange = onChange;
    /** @type {function(string, object): any} @private */
    this.getComputedValueReal = getComputedValue;
    /** @type {WeakMap<object, Proxy>} @private */
    this.proxyCache = new WeakMap();
    /** @type {Map<string, AvenxWatcher>} @private */
    this.computedWatchers = new Map();
  }

  /**
   * Evaluates and caches a computed property using an internal AvenxWatcher.
   * @param {string} key - The computed key.
   * @param {object} receiver - The proxy receiver.
   * @returns {any}
   */
  evaluateComputedWatcher(key, receiver) {
    const target = receiver[RAW_SYMBOL] || receiver;
    track(target, key);

    let watcher = this.computedWatchers.get(key);
    if (!watcher) {
      watcher = new AvenxWatcher(
        () => this.getComputedValueReal(key, receiver),
        () => {
          trigger(target, key);
          this.onChange();
        },
        { lazy: true },
      );
      this.computedWatchers.set(key, watcher);
    }
    return watcher.evaluate();
  }

  /**
   * Cleans up all computed watchers created by this proxy handler.
   */
  teardown() {
    for (const watcher of this.computedWatchers.values()) {
      watcher.teardown();
    }
    this.computedWatchers.clear();
  }

  /**
   * Creates the proxy handler object.
   * @returns {ProxyHandler<object>}
   */
  create() {
    return {
      set: (target, key, value) => this.set(target, key, value),
      get: (target, key, receiver) => this.get(target, key, receiver),
      ownKeys: (target) => this.ownKeys(target),
      getOwnPropertyDescriptor: (target, key) => this.getOwnPropertyDescriptor(target, key),
      deleteProperty: (target, key) => this.deleteProperty(target, key),
    };
  }

  /**
   * Proxy 'set' trap.
   * @param {object} target - The target object.
   * @param {string|symbol} key - The property key.
   * @param {any} value - The new value.
   * @returns {boolean}
   */
  set(target, key, value) {
    if (value && value[RAW_SYMBOL]) {
      value = value[RAW_SYMBOL];
    }
    const oldValue = target[key];
    target[key] = value;

    if (isReactiveTarget(value)) {
      parentMap.set(value, { parentTarget: target, parentKey: key });
    }

    if (typeof key !== 'symbol' && (oldValue !== value || (Array.isArray(target) && key === 'length'))) {
      trigger(target, key);
      this.onChange();
    }
    return true;
  }

  /**
   * Proxy 'get' trap.
   * Redirects to evaluateComputedWatcher if the key is a computed property.
   * @param {object} target - The target object.
   * @param {string|symbol} key - The property key.
   * @param {object} receiver - The proxy or object inheriting from the proxy.
   * @returns {any}
   */
  get(target, key, receiver) {
    if (key === IS_REACTIVE_PROXY) {
      return true;
    }
    if (key === RAW_SYMBOL) {
      return target;
    }
    if (this.computedKeys.has(key)) {
      return this.evaluateComputedWatcher(key, receiver);
    }

    // Track property access
    if (typeof key !== 'symbol') {
      track(target, key);
    }

    const value = Reflect.get(target, key, receiver);
    if (typeof value === 'function') {
      if (Array.isArray(target) && mutatingArrayMethods.has(key)) {
        return (...args) => {
          const result = target[key](...args);
          trigger(target, 'length');
          this.onChange();
          return result;
        };
      }
      return value.bind(receiver);
    }
    if (isReactiveTarget(value)) {
      parentMap.set(value, { parentTarget: target, parentKey: key });
      return this.getOrCreateProxy(value);
    }
    return value;
  }

  /**
   * Proxy 'deleteProperty' trap.
   * @param {object} target - The target object.
   * @param {string|symbol} key - The property key.
   * @returns {boolean}
   */
  deleteProperty(target, key) {
    const hasKey = Reflect.has(target, key);
    const result = Reflect.deleteProperty(target, key);
    if (hasKey) {
      trigger(target, key);
      this.onChange();
    }
    return result;
  }

  /**
   * Proxy 'ownKeys' trap.
   * Includes computed keys in the list of keys.
   * @param {object} target - The target object.
   * @returns {Array<string|symbol>}
   */
  ownKeys(target) {
    return [...Reflect.ownKeys(target), ...this.computedKeys];
  }

  /**
   * Proxy 'getOwnPropertyDescriptor' trap.
   * Ensures computed properties appear as own properties.
   * @param {object} target - The target object.
   * @param {string|symbol} key - The property key.
   * @returns {PropertyDescriptor|undefined}
   */
  getOwnPropertyDescriptor(target, key) {
    if (this.computedKeys.has(key)) {
      return { enumerable: true, configurable: true };
    }
    return Reflect.getOwnPropertyDescriptor(target, key);
  }

  /**
   * Returns a cached proxy or creates a new proxy for a nested object/array.
   * @param {object | Array} val - The nested object or array.
   * @returns {Proxy} The reactive proxy.
   * @private
   */
  getOrCreateProxy(val) {
    if (val && val[IS_REACTIVE_PROXY]) {
      return val;
    }
    if (this.proxyCache.has(val)) {
      return this.proxyCache.get(val);
    }
    const handler = {
      get: (target, key, receiver) => {
        if (key === IS_REACTIVE_PROXY) {
          return true;
        }
        if (key === RAW_SYMBOL) {
          return target;
        }
        if (typeof key !== 'symbol') {
          track(target, key);
        }
        const value = Reflect.get(target, key, receiver);
        if (typeof value === 'function') {
          if (Array.isArray(target) && mutatingArrayMethods.has(key)) {
            return (...args) => {
              const result = target[key](...args);
              trigger(target, 'length');
              this.onChange();
              return result;
            };
          }
          return value.bind(receiver);
        }
        if (isReactiveTarget(value)) {
          parentMap.set(value, { parentTarget: target, parentKey: key });
          return this.getOrCreateProxy(value);
        }
        return value;
      },
      set: (target, key, value) => {
        if (value && value[RAW_SYMBOL]) {
          value = value[RAW_SYMBOL];
        }
        const oldValue = target[key];
        target[key] = value;

        if (isReactiveTarget(value)) {
          parentMap.set(value, { parentTarget: target, parentKey: key });
        }

        if (typeof key !== 'symbol' && (oldValue !== value || (Array.isArray(target) && key === 'length'))) {
          trigger(target, key);
          this.onChange();
        }
        return true;
      },
      deleteProperty: (target, key) => {
        const hasKey = Reflect.has(target, key);
        const result = Reflect.deleteProperty(target, key);
        if (hasKey) {
          trigger(target, key);
          this.onChange();
        }
        return result;
      },
    };
    const proxy = new Proxy(val, handler);
    this.proxyCache.set(val, proxy);
    return proxy;
  }
}
