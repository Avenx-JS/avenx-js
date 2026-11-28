/**
 * @file identity.js
 * @description Proxy identity, raw target unwrapping, caching, and parent-map cleanup.
 */

import { parentMap } from '../watcher.js';
import {
  RAW_SYMBOL,
  IS_REACTIVE_PROXY,
  PROXY_REF_SYMBOL,
  NON_REACTIVE_SYMBOL,
} from '../symbols.js';

/**
 * Checks if the value is a candidate for reactive wrapping.
 * We restrict this to plain objects, arrays, Sets, and Maps to avoid issues with
 * built-in classes (Date, RegExp, Promise) and custom class
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
 * Whether `target` is the state object the computed properties belong to.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The object a trap is answering for.
 * @returns {boolean} True when `target` owns the computed properties.
 */
export function isRootTarget(factory, target) {
  return !factory.rootTarget || target === factory.rootTarget;
}

/**
 * Returns a cached proxy or creates a new proxy for a nested object/array.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object | Array} val - The nested object or array.
 * @returns {Proxy} The reactive proxy.
 */
export function getOrCreateProxy(factory, val) {
  if (!factory.bypassSymbol && val[PROXY_REF_SYMBOL]) {
    return val[PROXY_REF_SYMBOL];
  }
  if (val[IS_REACTIVE_PROXY]) {
    return val;
  }
  if (factory.proxyCache.has(val)) {
    return factory.proxyCache.get(val);
  }
  const proxy = new Proxy(val, factory.create());
  factory.proxyCache.set(val, proxy);
  if (!factory.bypassSymbol && Object.isExtensible(val)) {
    Object.defineProperty(val, PROXY_REF_SYMBOL, {
      value: proxy,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  return proxy;
}
