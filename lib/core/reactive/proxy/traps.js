/**
 * @file traps.js
 * @description Proxy trap implementations over a ProxyHandlerFactory instance.
 */

import { track, trigger, parentMap } from '../watcher.js';
import { RAW_SYMBOL, IS_REACTIVE_PROXY, PROXY_REF_SYMBOL } from '../symbols.js';
import { tracer } from '../../trace/tracer.js';
import { traceWrite, traceCollectionWrite } from '../../trace/reactive.js';
import { journal } from '../journal.js';
import {
  isReactiveTarget,
  cleanupParentMap,
  isRootTarget,
  getOrCreateProxy,
} from './identity.js';
import { notifyChange } from './notify.js';
import { evaluateComputedWatcher } from './computed.js';
import { mutatingArrayMethods, getMapMethod, getSetMethod } from './collections.js';

/**
 * Proxy 'set' trap.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The target object.
 * @param {string|symbol} key - The property key.
 * @param {any} value - The new value.
 * @returns {boolean}
 */
export function set(factory, target, key, value) {
  if (value && value[RAW_SYMBOL]) {
    value = value[RAW_SYMBOL];
  }

  const isNewRootKey =
    factory.onKeysChanged !== null &&
    target === factory.rootTarget &&
    typeof key !== 'symbol' &&
    !Object.prototype.hasOwnProperty.call(target, key);

  const oldValue = target[key];
  const changed =
    typeof key !== 'symbol' &&
    (oldValue !== value || (Array.isArray(target) && key === 'length'));

  // Journaled before the assignment, because whether the key already existed
  // is the difference between restoring a value and deleting one, and that
  // cannot be told apart once the write has landed.
  if (changed && journal.active) {
    if (Array.isArray(target) && key === 'length') {
      // `arr.length = 0` discards elements that no single before/after pair
      // describes, so the whole array is saved instead.
      journal.recordCollection(target, factory, 'array');
    } else {
      journal.recordWrite(
        target,
        key,
        oldValue,
        value,
        Object.prototype.hasOwnProperty.call(target, key),
        factory,
      );
    }
  }

  if (isReactiveTarget(oldValue)) {
    cleanupParentMap(oldValue);
  }

  target[key] = value;

  if (isReactiveTarget(value)) {
    parentMap.set(value, { parentTarget: target, parentKey: key });
  }

  // Persist configured root-level state values to localStorage.
  if (
    changed &&
    typeof key !== 'symbol' &&
    target === factory.rootTarget &&
    factory.persistKeys.has(key) &&
    typeof localStorage !== 'undefined'
  ) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage and serialization errors so persistence
      // never breaks normal reactive state updates.
    }
  }

  if (isNewRootKey) {
    factory.onKeysChanged();
  }

  if (changed) {
    const token = tracer.on ? traceWrite(target, key, oldValue, value) : -1;

    try {
      trigger(target, key, oldValue, value);
      notifyChange(factory, target, key);
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
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The target object.
 * @param {string|symbol} key - The property key.
 * @param {object} receiver - The proxy or object inheriting from the proxy.
 * @returns {any}
 */
export function get(factory, target, key, receiver) {
  if (key === IS_REACTIVE_PROXY) {
    return true;
  }
  if (key === RAW_SYMBOL) {
    return target;
  }
  if (key === PROXY_REF_SYMBOL) {
    return target[PROXY_REF_SYMBOL];
  }
  // Computed properties belong to the component's own state object, not to
  // every object reachable through it. One handler is shared by the root and
  // every nested proxy it creates, so an unguarded check made each nested
  // object claim all of the component's computeds.
  if (isRootTarget(factory, target) && factory.computedKeys.has(key)) {
    return evaluateComputedWatcher(factory, key, receiver);
  }

  if (target instanceof Map) {
    return getMapMethod(factory, target, key, receiver);
  }
  if (target instanceof Set) {
    return getSetMethod(factory, target, key, receiver);
  }

  if (!(key in target) && factory.instance && key in factory.instance) {
    const val = factory.instance[key];
    if (typeof val === 'function') {
      return val.bind(factory.instance);
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
          journal.recordCollection(target, factory, `array.${String(key)}`);
        }
        const result = target[key](...args);
        // The array's contents are deliberately not captured here: cloning
        // the whole array on every push would make tracing a growing list
        // quadratic. The length after the call is enough to explain it.
        const token = tracer.on ? traceCollectionWrite(target, 'length', key, target.length) : -1;
        try {
          trigger(target, 'length');
          notifyChange(factory, target, 'length');
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
    if (!factory.bypassSymbol && value[PROXY_REF_SYMBOL]) {
      return value[PROXY_REF_SYMBOL];
    }
    return getOrCreateProxy(factory, value);
  }
  return value;
}

/**
 * Proxy 'deleteProperty' trap.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The target object.
 * @param {string|symbol} key - The property key.
 * @returns {boolean}
 */
export function deleteProperty(factory, target, key) {
  const hasKey = Reflect.has(target, key);
  const oldValue = target[key];

  if (hasKey && typeof key !== 'symbol' && journal.active) {
    journal.recordDelete(target, key, oldValue, Object.prototype.hasOwnProperty.call(target, key), factory);
  }

  const result = Reflect.deleteProperty(target, key);

  if (isReactiveTarget(oldValue)) {
    cleanupParentMap(oldValue);
  }

  if (hasKey) {
    if (factory.onKeysChanged !== null && target === factory.rootTarget && typeof key !== 'symbol') {
      factory.onKeysChanged();
    }
    const token = tracer.on ? traceWrite(target, key, oldValue, undefined, 'delete') : -1;
    try {
      trigger(target, key);
      notifyChange(factory, target, key);
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
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The target object.
 * @returns {Array<string|symbol>}
 */
export function ownKeys(factory, target) {
  if (!isRootTarget(factory, target)) {
    return Reflect.ownKeys(target);
  }
  return [...Reflect.ownKeys(target), ...factory.computedKeys];
}

/**
 * Proxy 'getOwnPropertyDescriptor' trap.
 * Ensures computed properties appear as own properties.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The target object.
 * @param {string|symbol} key - The property key.
 * @returns {PropertyDescriptor|undefined}
 */
export function getOwnPropertyDescriptor(factory, target, key) {
  if (isRootTarget(factory, target) && factory.computedKeys.has(key)) {
    return { enumerable: true, configurable: true };
  }
  return Reflect.getOwnPropertyDescriptor(target, key);
}
