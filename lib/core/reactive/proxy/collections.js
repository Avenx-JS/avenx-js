/**
 * @file collections.js
 * @description Reactive method wrappers for Map, Set, and mutating Array methods.
 */

import { track, trigger, parentMap, depMap } from '../watcher.js';
import { RAW_SYMBOL } from '../symbols.js';
import { tracer } from '../../trace/tracer.js';
import { traceCollectionWrite } from '../../trace/reactive.js';
import { journal } from '../journal.js';
import { isReactiveTarget, cleanupParentMap, getOrCreateProxy } from './identity.js';
import { notifyChange } from './notify.js';

export const mutatingArrayMethods = new Set([
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
 * Returns a custom implementation of a Map method.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {Map} target - The raw Map.
 * @param {string|symbol} key - The property/method key.
 * @param {Proxy} receiver - The Map proxy.
 * @returns {any}
 */
export function getMapMethod(factory, target, key, receiver) {
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
        return getOrCreateProxy(factory, val);
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
        journal.recordCollection(target, factory, 'Map');
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
          notifyChange(factory, target, !hasKey ? [k, 'size'] : k);
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
        journal.recordCollection(target, factory, 'Map');
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
          notifyChange(factory, target, [k, 'size']);
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
        journal.recordCollection(target, factory, 'Map');
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
          notifyChange(factory, target, keysToTrigger);
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
          isReactiveTarget(val) ? getOrCreateProxy(factory, val) : val,
          isReactiveTarget(k) ? getOrCreateProxy(factory, k) : k,
          receiver,
        );
      });
    };
  }
  if (key === 'keys') {
    return () => {
      track(target, 'size');
      const iterator = target.keys();
      return {
        next() {
          const { value, done } = iterator.next();
          return {
            value: done ? undefined : isReactiveTarget(value) ? getOrCreateProxy(factory, value) : value,
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
      return {
        next() {
          const { value, done } = iterator.next();
          return {
            value: done ? undefined : isReactiveTarget(value) ? getOrCreateProxy(factory, value) : value,
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
      return {
        next() {
          const { value, done } = iterator.next();
          let unwrapped;
          if (done) {
            unwrapped = undefined;
          } else {
            unwrapped = [
              isReactiveTarget(value[0]) ? getOrCreateProxy(factory, value[0]) : value[0],
              isReactiveTarget(value[1]) ? getOrCreateProxy(factory, value[1]) : value[1],
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
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {Set} target - The raw Set.
 * @param {string|symbol} key - The property/method key.
 * @param {Proxy} receiver - The Set proxy.
 * @returns {any}
 */
export function getSetMethod(factory, target, key, receiver) {
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
        journal.recordCollection(target, factory, 'Set');
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
          notifyChange(factory, target, [rawVal, 'size']);
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
        journal.recordCollection(target, factory, 'Set');
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
          notifyChange(factory, target, [rawVal, 'size']);
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
        journal.recordCollection(target, factory, 'Set');
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
          notifyChange(factory, target, keysToTrigger);
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
          isReactiveTarget(val) ? getOrCreateProxy(factory, val) : val,
          isReactiveTarget(val) ? getOrCreateProxy(factory, val) : val,
          receiver,
        );
      });
    };
  }
  if (key === 'values' || key === 'keys' || key === Symbol.iterator) {
    return () => {
      track(target, 'size');
      const iterator = target.values();
      return {
        next() {
          const { value, done } = iterator.next();
          if (!done && isReactiveTarget(value)) {
            parentMap.set(value, { parentTarget: target, parentKey: value });
          }
          return {
            value: done ? undefined : isReactiveTarget(value) ? getOrCreateProxy(factory, value) : value,
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
              isReactiveTarget(value[0]) ? getOrCreateProxy(factory, value[0]) : value[0],
              isReactiveTarget(value[1]) ? getOrCreateProxy(factory, value[1]) : value[1],
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
