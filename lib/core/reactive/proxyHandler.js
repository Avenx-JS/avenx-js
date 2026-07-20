/**
 * @file proxyHandler.js
 * @description Factory for creating proxy handlers used in reactive state.
 * Handles normal property access and computed property redirection.
 */

import { track, trigger, parentMap, AvenxWatcher, depMap } from './watcher.js';

export const RAW_SYMBOL = Symbol('raw');
export const IS_REACTIVE_PROXY = Symbol('avenx.reactive.proxy');
export const PROXY_REF_SYMBOL = Symbol.for('__avenx_proxy_ref__');

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
  return (
    proto === null ||
    proto === Object.prototype ||
    proto === Array.prototype ||
    value instanceof Set ||
    value instanceof Map
  );
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
   * @param {object} [options.instance] - The component instance for fallback property lookups.
   * @param {boolean} [options.bypassSymbol] - Bypasses Symbol check during lookup.
   */
  constructor({ computedKeys = [], onChange = () => {}, getComputedValue = () => undefined, instance = null, bypassSymbol = false } = {}) {
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
    /** @type {object|null} @private */
    this.instance = instance;
    /** @type {boolean} @private */
    this.bypassSymbol = bypassSymbol || (typeof globalThis !== 'undefined' && !!globalThis.__avenx_bypass_symbol__);
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
   * Returns a custom implementation of a Map method.
   * @param {Map} target - The raw Map.
   * @param {string|symbol} key - The property/method key.
   * @param {Proxy} receiver - The Map proxy.
   * @returns {any}
   */
  getMapMethod(target, key, receiver) {
    if (key === 'size') {
      track(target, 'size');
      return target.size;
    }
    if (key === 'get') {
      return (k) => {
        track(target, k);
        const val = target.get(k);
        if (isReactiveTarget(val)) {
          parentMap.set(val, { parentTarget: target, parentKey: k });
          return this.getOrCreateProxy(val);
        }
        return val;
      };
    }
    if (key === 'has') {
      return (k) => {
        track(target, k);
        return target.has(k);
      };
    }
    if (key === 'set') {
      return (k, v) => {
        const rawVal = v && v[RAW_SYMBOL] ? v[RAW_SYMBOL] : v;
        const hasKey = target.has(k);
        const oldValue = target.get(k);
        const valueChanged = oldValue !== rawVal;

        target.set(k, rawVal);

        if (isReactiveTarget(rawVal)) {
          parentMap.set(rawVal, { parentTarget: target, parentKey: k });
        }

        if (valueChanged || !hasKey) {
          trigger(target, !hasKey ? [k, 'size'] : k);
          this.onChange();
        }
        return receiver;
      };
    }
    if (key === 'delete') {
      return (k) => {
        const hasKey = target.has(k);
        const result = target.delete(k);
        if (hasKey) {
          trigger(target, [k, 'size']);
          this.onChange();
        }
        return result;
      };
    }
    if (key === 'clear') {
      return () => {
        const size = target.size;
        if (size > 0) {
          const keysMap = depMap.get(target);
          const keysToTrigger = ['size'];
          if (keysMap) {
            keysToTrigger.push(...keysMap.keys());
          }
          target.clear();
          trigger(target, keysToTrigger);
          this.onChange();
        }
      };
    }
    if (key === 'forEach') {
      return (callback, thisArg) => {
        track(target, 'size');
        target.forEach((val, k) => {
          callback.call(
            thisArg,
            isReactiveTarget(val) ? this.getOrCreateProxy(val) : val,
            isReactiveTarget(k) ? this.getOrCreateProxy(k) : k,
            receiver,
          );
        });
      };
    }
    if (key === 'keys') {
      return () => {
        track(target, 'size');
        const iterator = target.keys();
        const self = this;
        return {
          next() {
            const { value, done } = iterator.next();
            return {
              value: done ? undefined : isReactiveTarget(value) ? self.getOrCreateProxy(value) : value,
              done,
            };
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      };
    }
    if (key === 'values') {
      return () => {
        track(target, 'size');
        const iterator = target.values();
        const self = this;
        return {
          next() {
            const { value, done } = iterator.next();
            return {
              value: done ? undefined : isReactiveTarget(value) ? self.getOrCreateProxy(value) : value,
              done,
            };
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      };
    }
    if (key === 'entries' || key === Symbol.iterator) {
      return () => {
        track(target, 'size');
        const iterator = target.entries();
        const self = this;
        return {
          next() {
            const { value, done } = iterator.next();
            let unwrapped;
            if (done) {
              unwrapped = undefined;
            } else {
              unwrapped = [
                isReactiveTarget(value[0]) ? self.getOrCreateProxy(value[0]) : value[0],
                isReactiveTarget(value[1]) ? self.getOrCreateProxy(value[1]) : value[1],
              ];
            }
            return {
              value: unwrapped,
              done,
            };
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      };
    }

    const value = Reflect.get(target, key, target);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  }

  /**
   * Returns a custom implementation of a Set method.
   * @param {Set} target - The raw Set.
   * @param {string|symbol} key - The property/method key.
   * @param {Proxy} receiver - The Set proxy.
   * @returns {any}
   */
  getSetMethod(target, key, receiver) {
    if (key === 'size') {
      track(target, 'size');
      return target.size;
    }
    if (key === 'has') {
      return (val) => {
        const rawVal = val && val[RAW_SYMBOL] ? val[RAW_SYMBOL] : val;
        track(target, rawVal);
        return target.has(rawVal);
      };
    }
    if (key === 'add') {
      return (val) => {
        const rawVal = val && val[RAW_SYMBOL] ? val[RAW_SYMBOL] : val;
        const hasVal = target.has(rawVal);
        if (!hasVal) {
          target.add(rawVal);
          trigger(target, [rawVal, 'size']);
          this.onChange();
        }
        return receiver;
      };
    }
    if (key === 'delete') {
      return (val) => {
        const rawVal = val && val[RAW_SYMBOL] ? val[RAW_SYMBOL] : val;
        const hasVal = target.has(rawVal);
        const result = target.delete(rawVal);
        if (hasVal) {
          trigger(target, [rawVal, 'size']);
          this.onChange();
        }
        return result;
      };
    }
    if (key === 'clear') {
      return () => {
        const size = target.size;
        if (size > 0) {
          const keysMap = depMap.get(target);
          const keysToTrigger = ['size'];
          if (keysMap) {
            keysToTrigger.push(...keysMap.keys());
          }
          target.clear();
          trigger(target, keysToTrigger);
          this.onChange();
        }
      };
    }
    if (key === 'forEach') {
      return (callback, thisArg) => {
        track(target, 'size');
        target.forEach((val) => {
          callback.call(
            thisArg,
            isReactiveTarget(val) ? this.getOrCreateProxy(val) : val,
            isReactiveTarget(val) ? this.getOrCreateProxy(val) : val,
            receiver,
          );
        });
      };
    }
    if (key === 'values' || key === 'keys' || key === Symbol.iterator) {
      return () => {
        track(target, 'size');
        const iterator = target.values();
        const self = this;
        return {
          next() {
            const { value, done } = iterator.next();
            return {
              value: done ? undefined : isReactiveTarget(value) ? self.getOrCreateProxy(value) : value,
              done,
            };
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      };
    }
    if (key === 'entries') {
      return () => {
        track(target, 'size');
        const iterator = target.entries();
        const self = this;
        return {
          next() {
            const { value, done } = iterator.next();
            let unwrapped;
            if (done) {
              unwrapped = undefined;
            } else {
              unwrapped = [
                isReactiveTarget(value[0]) ? self.getOrCreateProxy(value[0]) : value[0],
                isReactiveTarget(value[1]) ? self.getOrCreateProxy(value[1]) : value[1],
              ];
            }
            return {
              value: unwrapped,
              done,
            };
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      };
    }

    const value = Reflect.get(target, key, target);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
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
 
    
    if(isReactiveTarget(oldValue)){
      parentMap.delete(oldValue)
    }

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
    if (key === PROXY_REF_SYMBOL) {
      return target[PROXY_REF_SYMBOL];
    }
    if (this.computedKeys.has(key)) {
      return this.evaluateComputedWatcher(key, receiver);
    }

    if (target instanceof Map) {
      return this.getMapMethod(target, key, receiver);
    }
    if (target instanceof Set) {
      return this.getSetMethod(target, key, receiver);
    }

    if (!(key in target) && this.instance && key in this.instance) {
      const val = this.instance[key];
      if (typeof val === 'function') {
        return val.bind(this.instance);
      }
      return val;
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
      if (!this.bypassSymbol && value[PROXY_REF_SYMBOL]) {
        return value[PROXY_REF_SYMBOL];
      }
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
    const oldValue = target[key];
    const result = Reflect.deleteProperty(target, key);
    
    if(isReactiveTarget(oldValue)){
      parentMap.delete(oldValue)
    }

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
    if (!this.bypassSymbol && val[PROXY_REF_SYMBOL]) {
      return val[PROXY_REF_SYMBOL];
    }
    if (val[IS_REACTIVE_PROXY]) {
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
        if (key === PROXY_REF_SYMBOL) {
          return target[PROXY_REF_SYMBOL];
        }
        if (target instanceof Map) {
          return this.getMapMethod(target, key, receiver);
        }
        if (target instanceof Set) {
          return this.getSetMethod(target, key, receiver);
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
          if (!this.bypassSymbol && value[PROXY_REF_SYMBOL]) {
            return value[PROXY_REF_SYMBOL];
          }
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
        // Remove stale parent reference of the old child

        if(isReactiveTarget){
          parentMap.delete(oldValue)
        }

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
        const oldValue = target[key]

        const result = Reflect.deleteProperty(target, key);

        // Remove stale parent reference of the deleted child
        if(isReactiveTarget(oldValue)){
          parentMap.delete(oldValue)
        }

        if (hasKey) {
          trigger(target, key);
          this.onChange();
        }
        return result;
      },
    };
    const proxy = new Proxy(val, handler);
    this.proxyCache.set(val, proxy);
    if (!this.bypassSymbol && Object.isExtensible(val)) {
      Object.defineProperty(val, PROXY_REF_SYMBOL, {
        value: proxy,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }
    return proxy;
  }
}
