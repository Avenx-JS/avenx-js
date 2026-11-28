/**
 * @file proxyHandler.js
 * @description Factory for creating proxy handlers used in reactive state.
 * Handles normal property access and computed property redirection.
 */

import { getPropertyPath, setDebugReactivity, isDebugReactivityEnabled } from './watcher.js';
import {
  RAW_SYMBOL,
  IS_REACTIVE_PROXY,
  PROXY_REF_SYMBOL,
  NON_REACTIVE_SYMBOL,
} from './symbols.js';
import { setPathResolver } from './journal.js';
import {
  isReactiveTarget,
  toRaw,
  isReactive,
  markRaw,
  cleanupParentMap,
  isRootTarget,
  getOrCreateProxy,
} from './proxy/identity.js';
import { isConnected, notifyChange } from './proxy/notify.js';
import { evaluateComputedWatcher } from './proxy/computed.js';
import { getMapMethod, getSetMethod } from './proxy/collections.js';
import {
  set as setTrap,
  get as getTrap,
  deleteProperty as deletePropertyTrap,
  ownKeys as ownKeysTrap,
  getOwnPropertyDescriptor as getOwnPropertyDescriptorTrap,
} from './proxy/traps.js';

// The journal names a conflicted path in its report; the naming rules already
// live in the watcher. Injecting the resolver keeps the journal free of the
// watcher's surface while still producing "cart.items.0.qty" rather than "qty".
setPathResolver(getPropertyPath);

export { setDebugReactivity, isDebugReactivityEnabled };

// The symbols moved to ./symbols.js so consumers that only need to recognise a
// reactive value can import them without pulling in the proxy factory. They are
// re-exported here unchanged, so every existing importer is unaffected.
export { RAW_SYMBOL, IS_REACTIVE_PROXY, PROXY_REF_SYMBOL, NON_REACTIVE_SYMBOL };

export { isReactiveTarget, toRaw, isReactive, markRaw, cleanupParentMap };

/**
 * Factory for creating and managing Proxy handlers for reactive state objects.
 */
export class ProxyHandlerFactory {
  /**
   * @param {object} [options] - Configuration options.
   * @param {string[]} [options.computedKeys] - List of keys that should be treated as computed properties.
   * @param {Function} [options.onChange] - Callback triggered when a property is set.
   * @param {Function|null} [options.onKeysChanged] - Callback triggered when the
   *   root target gains or loses a key, for consumers that cache its key set.
   * @param {boolean|function(): boolean} [options.onlyNotifyObserved] - When true, onChange is
   *   suppressed for writes that no watcher depends on, at any level of the
   *   property path. Off by default so the standalone reactive primitive keeps
   *   notifying for every mutation.
   * @param {Function} [options.getComputedValue] - Function to evaluate a computed property.
   * @param {object} [options.instance] - The component instance for fallback property lookups.
   * @param {boolean} [options.bypassSymbol] - Bypasses Symbol check during lookup.
   * @param {string[]} [options.persist] - List of state keys to persist in localStorage.
   */
  constructor({
    computedKeys = [],
    onChange = () => {},
    onKeysChanged = null,
    onlyNotifyObserved = false,
    getComputedValue = () => undefined,
    instance = null,
    bypassSymbol = false,
    persist = [],
  } = {}) {
    /** @type {Set<string>} */
    this.computedKeys = new Set(computedKeys);
    /** @type {Function} */
    this.onChange = onChange;
    /**
     * Called when the root target gains or loses a key.
     *
     * Distinct from `onChange`, which fires for a *value* change. A consumer
     * that caches the set of names state binds -- the template scope does --
     * needs to know when that set changed, and cannot tell from a value
     * notification. Without it the cache has to be rebuilt on every read, which
     * is `Object.keys()` over the whole state object per expression evaluated.
     * @type {Function|null}
     */
    this.onKeysChanged = onKeysChanged;
    /**
     * Whether onChange is suppressed for writes nothing depends on.
     *
     * Off by default: the standalone reactive primitive promises a
     * notification for every mutation. Components turn it on so that a write
     * to a key no expression reads does not schedule a render.
     * May be a predicate, so a consumer can enable filtering only once it has
     * actually collected dependencies.
     * @type {boolean|function(): boolean}
     */
    this.onlyNotifyObserved = onlyNotifyObserved;
    /** @type {Function} */
    this.getComputedValueReal = getComputedValue;
    /** @type {Set<string>} */
    this.persistKeys = new Set(persist);
    /** @type {WeakMap<object, Proxy>} */
    this.proxyCache = new WeakMap();
    /** @type {Map<string, import('./watcher.js').AvenxWatcher>} */
    this.computedWatchers = new Map();
    /** @type {object|null} */
    this.instance = instance;
    /** @type {boolean} */
    this.bypassSymbol =
      bypassSymbol ||
      (typeof globalThis !== 'undefined' &&
        !!globalThis.__avenx_bypass_symbol__);
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
    return evaluateComputedWatcher(this, key, receiver);
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
    return isConnected(this, target);
  }

  /**
   * Notifies about a change if anything actually depends on it.
   * @param {object} target - The target raw object.
   * @param {string|symbol|Array<string|symbol>} [key] - The key that changed.
   */
  notifyChange(target, key) {
    notifyChange(this, target, key);
  }

  /**
   * Returns a custom implementation of a Map method.
   * @param {Map} target - The raw Map.
   * @param {string|symbol} key - The property/method key.
   * @param {Proxy} receiver - The Map proxy.
   * @returns {any}
   */
  getMapMethod(target, key, receiver) {
    return getMapMethod(this, target, key, receiver);
  }

  /**
   * Returns a custom implementation of a Set method.
   * @param {Set} target - The raw Set.
   * @param {string|symbol} key - The property/method key.
   * @param {Proxy} receiver - The Set proxy.
   * @returns {any}
   */
  getSetMethod(target, key, receiver) {
    return getSetMethod(this, target, key, receiver);
  }

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
          return setTrap(this, target, key, value);
        },
        get: (target, key, receiver) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return getTrap(this, target, key, receiver);
        },
        ownKeys: (target) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return ownKeysTrap(this, target);
        },
        getOwnPropertyDescriptor: (target, key) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return getOwnPropertyDescriptorTrap(this, target, key);
        },
        deleteProperty: (target, key) => {
          if (!this.rootTarget) {
            this.rootTarget = target;
          }
          return deletePropertyTrap(this, target, key);
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
    return setTrap(this, target, key, value);
  }

  /**
   * Proxy 'get' trap.
   * @param {object} target - The target object.
   * @param {string|symbol} key - The property key.
   * @param {object} receiver - The proxy or object inheriting from the proxy.
   * @returns {any}
   */
  get(target, key, receiver) {
    return getTrap(this, target, key, receiver);
  }

  /**
   * Proxy 'deleteProperty' trap.
   * @param {object} target - The target object.
   * @param {string|symbol} key - The property key.
   * @returns {boolean}
   */
  deleteProperty(target, key) {
    return deletePropertyTrap(this, target, key);
  }

  /**
   * Proxy 'ownKeys' trap.
   * @param {object} target - The target object.
   * @returns {Array<string|symbol>}
   */
  ownKeys(target) {
    return ownKeysTrap(this, target);
  }

  /**
   * Proxy 'getOwnPropertyDescriptor' trap.
   * @param {object} target - The target object.
   * @param {string|symbol} key - The property key.
   * @returns {PropertyDescriptor|undefined}
   */
  getOwnPropertyDescriptor(target, key) {
    return getOwnPropertyDescriptorTrap(this, target, key);
  }

  /**
   * Whether `target` is the state object the computed properties belong to.
   * @param {object} target - The object a trap is answering for.
   * @returns {boolean} True when `target` owns the computed properties.
   * @private
   */
  isRootTarget(target) {
    return isRootTarget(this, target);
  }

  /**
   * Returns a cached proxy or creates a new proxy for a nested object/array.
   * @param {object | Array} val - The nested object or array.
   * @returns {Proxy} The reactive proxy.
   * @private
   */
  getOrCreateProxy(val) {
    return getOrCreateProxy(this, val);
  }
}
