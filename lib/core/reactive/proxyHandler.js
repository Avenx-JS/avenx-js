/**
 * @file proxyHandler.js
 * @description Factory for creating proxy handlers used in reactive state.
 * Handles normal property access and computed property redirection.
 */

import { track, trigger, parentMap, AvenxWatcher, depMap, getPropertyPath, setDebugReactivity, isDebugReactivityEnabled } from './watcher.js';

import {
  RAW_SYMBOL,
  IS_REACTIVE_PROXY,
  PROXY_REF_SYMBOL,
  NON_REACTIVE_SYMBOL,
} from './symbols.js';
import { tracer } from '../trace/tracer.js';
import { traceWrite, traceCollectionWrite } from '../trace/reactive.js';
import { journal, setPathResolver } from './journal.js';

// The journal names a conflicted path in its report; the naming rules already
// live in the watcher. Injecting the resolver keeps the journal free of the
// watcher's surface while still producing "cart.items.0.qty" rather than "qty".
setPathResolver(getPropertyPath);

export { setDebugReactivity, isDebugReactivityEnabled };

// The symbols moved to ./symbols.js so consumers that only need to recognise a
// reactive value can import them without pulling in the proxy factory. They are
// re-exported here unchanged, so every existing importer is unaffected.
export { RAW_SYMBOL, IS_REACTIVE_PROXY, PROXY_REF_SYMBOL, NON_REACTIVE_SYMBOL };

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
  if (value[NON_REACTIVE_SYMBOL]) {
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
 * Returns the underlying raw object for a reactive proxy.
 * @param {any} target
 * @returns {any}
 */
export function toRaw(target) {
  if (target === null || typeof target !== 'object') {
    return target;
  }
  return target[RAW_SYMBOL] || target;
}

/**
 * Returns true when value is an Avenx reactive proxy.
 * @param {any} value
 * @returns {boolean}
 */
export function isReactive(value) {
  return !!(value && typeof value === 'object' && value[IS_REACTIVE_PROXY]);
}

/**
 * Marks an object so it will not be wrapped by reactive proxies.
 * @template T
 * @param {T} target
 * @returns {T}
 */
export function markRaw(target) {
  if (target === null || typeof target !== 'object') {
    return target;
  }
  if (!Object.isExtensible(target)) {
    return target;
  }
  if (!target[NON_REACTIVE_SYMBOL]) {
    Object.defineProperty(target, NON_REACTIVE_SYMBOL, {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  return target;
}

/**
 * Recursively cleans up parentMap entries for a detached reactive target and its nested properties.
 * @param {any} value
 * @param {Set<any>} [seen]
 */
export function cleanupParentMap(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') {
    return;
  }
  const rawValue = value[RAW_SYMBOL] || value;
  if (seen.has(rawValue)) {
    return;
  }
  seen.add(rawValue);

  if (parentMap.has(rawValue)) {
    parentMap.delete(rawValue);
  }

  if (rawValue instanceof Map) {
    for (const val of rawValue.values()) {
      cleanupParentMap(val, seen);
    }
  } else if (rawValue instanceof Set) {
    for (const val of rawValue.values()) {
      cleanupParentMap(val, seen);
    }
  } else if (Array.isArray(rawValue)) {
    for (let i = 0; i < rawValue.length; i++) {
      cleanupParentMap(rawValue[i], seen);
    }
  } else {
    // Plain object
    for (const val of Object.values(rawValue)) {
      cleanupParentMap(val, seen);
    }
  }
}


/**
 * Factory for creating and managing Proxy handlers for reactive state objects.
 */
export class ProxyHandlerFactory {
  /**
   * @param {object} [options] - Configuration options.
   * @param {string[]} [options.computedKeys] - List of keys that should be treated as computed properties.
   * @param {Function} [options.onChange] - Callback triggered when a property is set.
   * @param {Function} [options.getComputedValue] - Function to evaluate a computed property.
   * @param {object} [options.instance] - The component instance for fallback property lookups.
   * @param {boolean} [options.bypassSymbol] - Bypasses Symbol check during lookup.
   */
  constructor({
    computedKeys = [],
    onChange = () => {},
    getComputedValue = () => undefined,
    instance = null,
    bypassSymbol = false,
  } = {}) {
    /** @type {Set<string>} */
    this.computedKeys = new Set(computedKeys);
    /** @type {Function} */
    this.onChange = onChange;
    /** @type {Function} */
    this.getComputedValueReal = getComputedValue;
    /** @type {WeakMap<object, Proxy>} */
    this.proxyCache = new WeakMap();
    /** @type {Map<string, AvenxWatcher>} */
    this.computedWatchers = new Map();
    /** @type {object|null} */
    this.instance = instance;
    /** @type {boolean} */
    this.bypassSymbol = bypassSymbol || (typeof globalThis !== 'undefined' && !!globalThis.__avenx_bypass_symbol__);
    /** @type {object|null} */
    this.rootTarget = null;
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
          this.notifyChange(target);
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
   * Checks if the target object is still connected to the root state.
   * @param {object} target - The target raw object.
   * @returns {boolean}
   */
  isConnected(target) {
    if (!this.rootTarget) {
      return true;
    }
    let current = target;
    while (current) {
      if (current === this.rootTarget) {
        return true;
      }
      const relation = parentMap.get(current);
      if (!relation) {
        break;
      }
      current = relation.parentTarget;
    }
    return false;
  }

  /**
   * Notifies about a change if the target is connected to the root state.
   * @param {object} target - The target raw object.
   */
  notifyChange(target) {
    if (this.isConnected(target)) {
      this.onChange();
    }
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
        if (journal.active) {
          journal.recordCollection(target, this, getPropertyPath(target, undefined) || 'Map');
        }
        const hasKey = target.has(k);
        const oldValue = target.get(k);
        const valueChanged = oldValue !== rawVal;

        target.set(k, rawVal);

        if (isReactiveTarget(oldValue)) {
          cleanupParentMap(oldValue);
        }

        if (isReactiveTarget(rawVal)) {
          parentMap.set(rawVal, { parentTarget: target, parentKey: k });
        }

        if (valueChanged || !hasKey) {
          const token = tracer.on ? traceCollectionWrite(target, k, 'map.set', target.size) : -1;
          try {
            trigger(target, !hasKey ? [k, 'size'] : k);
            this.notifyChange(target);
          } finally {
            if (token >= 0) {
              tracer.leave(token);
            }
          }
        }
        return receiver;
      };
    }
    if (key === 'delete') {
      return (k) => {
        if (journal.active) {
          journal.recordCollection(target, this, getPropertyPath(target, undefined) || 'Map');
        }
        const hasKey = target.has(k);
        const oldValue = target.get(k);

        const result = target.delete(k);

        if (hasKey) {
          if (isReactiveTarget(oldValue)) {
            cleanupParentMap(oldValue);
          }

          const token = tracer.on ? traceCollectionWrite(target, k, 'map.delete', target.size) : -1;
          try {
            trigger(target, [k, 'size']);
            this.notifyChange(target);
          } finally {
            if (token >= 0) {
              tracer.leave(token);
            }
          }
        }

        return result;
      };
    }
    if (key === 'clear') {
      return () => {
        if (journal.active) {
          journal.recordCollection(target, this, getPropertyPath(target, undefined) || 'Map');
        }
        const size = target.size;
        if (size > 0) {
          const keysMap = depMap.get(target);
          const keysToTrigger = ['size'];
          if (keysMap) {
            keysToTrigger.push(...keysMap.keys());
          }
          target.clear();
          const token = tracer.on ? traceCollectionWrite(target, undefined, 'clear', 0) : -1;
          try {
            trigger(target, keysToTrigger);
            this.notifyChange(target);
          } finally {
            if (token >= 0) {
              tracer.leave(token);
            }
          }
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
        if (journal.active) {
          journal.recordCollection(target, this, getPropertyPath(target, undefined) || 'Set');
        }
        const rawVal = val && val[RAW_SYMBOL] ? val[RAW_SYMBOL] : val;
        const hasVal = target.has(rawVal);
        if (!hasVal) {
          target.add(rawVal);
          if (isReactiveTarget(rawVal)) {
            parentMap.set(rawVal, { parentTarget: target, parentKey: rawVal });
          }
          const token = tracer.on ? traceCollectionWrite(target, undefined, 'set.add', target.size) : -1;
          try {
            trigger(target, [rawVal, 'size']);
            this.notifyChange(target);
          } finally {
            if (token >= 0) {
              tracer.leave(token);
            }
          }
        }
        return receiver;
      };
    }
    if (key === 'delete') {
      return (val) => {
        if (journal.active) {
          journal.recordCollection(target, this, getPropertyPath(target, undefined) || 'Set');
        }
        const rawVal = val && val[RAW_SYMBOL] ? val[RAW_SYMBOL] : val;
        const hasVal = target.has(rawVal);

        const result = target.delete(rawVal);

        if (hasVal) {
          if (isReactiveTarget(rawVal)) {
            cleanupParentMap(rawVal);
          }

          const token = tracer.on ? traceCollectionWrite(target, undefined, 'set.delete', target.size) : -1;
          try {
            trigger(target, [rawVal, 'size']);
            this.notifyChange(target);
          } finally {
            if (token >= 0) {
              tracer.leave(token);
            }
          }
        }

        return result;
      };
    }
    if (key === 'clear') {
      return () => {
        if (journal.active) {
          journal.recordCollection(target, this, getPropertyPath(target, undefined) || 'Set');
        }
        const size = target.size;
        if (size > 0) {
          const keysMap = depMap.get(target);
          const keysToTrigger = ['size'];
          if (keysMap) {
            keysToTrigger.push(...keysMap.keys());
          }
          target.clear();
          const token = tracer.on ? traceCollectionWrite(target, undefined, 'clear', 0) : -1;
          try {
            trigger(target, keysToTrigger);
            this.notifyChange(target);
          } finally {
            if (token >= 0) {
              tracer.leave(token);
            }
          }
        }
      };
    }
    if (key === 'forEach') {
      return (callback, thisArg) => {
        track(target, 'size');
        target.forEach((val) => {
          if (isReactiveTarget(val)) {
            parentMap.set(val, { parentTarget: target, parentKey: val });
          }
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
            if (!done && isReactiveTarget(value)) {
              parentMap.set(value, { parentTarget: target, parentKey: value });
            }
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
              if (isReactiveTarget(value[0])) {
                parentMap.set(value[0], { parentTarget: target, parentKey: value[0] });
              }
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
  /**
   * Creates the proxy handler object.
   * @returns {ProxyHandler<object>}
   */
  create() {
    if (!this._sharedHandler) {
      this._sharedHandler = {
        set: (target, key, value) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return this.set(target, key, value);
        },
        get: (target, key, receiver) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return this.get(target, key, receiver);
        },
        ownKeys: (target) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return this.ownKeys(target);
        },
        getOwnPropertyDescriptor: (target, key) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return this.getOwnPropertyDescriptor(target, key);
        },
        deleteProperty: (target, key) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return this.deleteProperty(target, key);
        },
      };
    }
    return this._sharedHandler;
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
    const changed = typeof key !== 'symbol' && (oldValue !== value || (Array.isArray(target) && key === 'length'));

    // Journaled before the assignment, because whether the key already existed
    // is the difference between restoring a value and deleting one, and that
    // cannot be told apart once the write has landed.
    if (changed && journal.active) {
      if (Array.isArray(target) && key === 'length') {
        // `arr.length = 0` discards elements that no single before/after pair
        // describes, so the whole array is saved instead.
        journal.recordCollection(target, this, getPropertyPath(target, undefined) || 'array');
      } else {
        journal.recordWrite(target, key, oldValue, value, Object.prototype.hasOwnProperty.call(target, key), this);
      }
    }

    if (isReactiveTarget(oldValue)) {
      cleanupParentMap(oldValue);
    }
    target[key] = value;

    if (isReactiveTarget(value)) {
      parentMap.set(value, { parentTarget: target, parentKey: key });
    }

    if (changed) {
      // A write is recorded here rather than inside trigger(): trigger walks up
      // the parentMap re-firing itself for every ancestor, so recording there
      // would log one write per level of nesting for a single assignment.
      // Opening the node around the trigger call makes every watcher it wakes a
      // child of the write that woke it.
      const token = tracer.on ? traceWrite(target, key, oldValue, value) : -1;
      try {
        trigger(target, key, oldValue, value);
        this.notifyChange(target);
      } finally {
        if (token >= 0) {
          tracer.leave(token);
        }
      }
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
          // `push`, `splice` and `sort` have no single before-and-after pair to
          // journal, so the transaction keeps a copy of the array instead —
          // once, the first time it touches it.
          if (journal.active) {
            journal.recordCollection(target, this, getPropertyPath(target, undefined) || `array.${String(key)}`);
          }
          const result = target[key](...args);
          // The array's contents are deliberately not captured here: cloning
          // the whole array on every push would make tracing a growing list
          // quadratic. The length after the call is enough to explain it.
          const token = tracer.on ? traceCollectionWrite(target, 'length', key, target.length) : -1;
          try {
            trigger(target, 'length');
            this.notifyChange(target);
          } finally {
            if (token >= 0) {
              tracer.leave(token);
            }
          }
          return result;
        };
      }
      return value.bind(receiver);
    }
    if (isReactiveTarget(value)) {
      parentMap.set(value, { parentTarget: target, parentKey: key });
      if (!this.bypassSymbol && value[PROXY_REF_SYMBOL]) {
        return value[PROXY_REF_SYMBOL];
      }
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

    if (hasKey && typeof key !== 'symbol' && journal.active) {
      journal.recordDelete(target, key, oldValue, Object.prototype.hasOwnProperty.call(target, key), this);
    }

    const result = Reflect.deleteProperty(target, key);

    if (isReactiveTarget(oldValue)) {
      cleanupParentMap(oldValue);
    }

    if (hasKey) {
      const token = tracer.on ? traceWrite(target, key, oldValue, undefined, 'delete') : -1;
      try {
        trigger(target, key);
        this.notifyChange(target);
      } finally {
        if (token >= 0) {
          tracer.leave(token);
        }
      }
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
    const proxy = new Proxy(val, this.create());
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