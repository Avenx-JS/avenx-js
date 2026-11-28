/**
 * @file notify.js
 * @description Dependency-aware change notification and root connectivity checks.
 */

import { parentMap, depMap, getPropertyPath, isDebugReactivityEnabled } from '../watcher.js';

/**
 * Whether anything depends on a key, or on the path that reaches it.
 *
 * A dependency may be recorded at any level: a template reading `cart.items`
 * registers against `items` on the root target, while a write to
 * `cart.items[0].qty` lands on the element object. Walking up `parentMap` is
 * what connects the two.
 * @param {object} target - The raw target that changed.
 * @param {string|symbol|Array<string|symbol>} key - The key or keys that changed.
 * @returns {boolean} True when some watcher depends on the change.
 */
export function hasDependentOnPath(target, key) {
  const keys = Array.isArray(key) ? key : [key];

  const keysMap = depMap.get(target);
  if (keysMap) {
    for (const k of keys) {
      const watchers = keysMap.get(k);
      if (watchers && watchers.size > 0) {
        return true;
      }
    }
  }

  // Walk to the root, asking whether the property that reaches this object is
  // itself observed. A guard on depth is unnecessary: cleanupParentMap keeps
  // the chain acyclic, but a visited set costs nothing and makes that explicit.
  const seen = new Set();
  let current = target;
  while (current && !seen.has(current)) {
    seen.add(current);
    const relation = parentMap.get(current);
    if (!relation) {
      return false;
    }
    const parentKeys = depMap.get(relation.parentTarget);
    if (parentKeys) {
      const watchers = parentKeys.get(relation.parentKey);
      if (watchers && watchers.size > 0) {
        return true;
      }
    }
    current = relation.parentTarget;
  }

  return false;
}

/**
 * Checks if the target object is still connected to the root state.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The target raw object.
 * @returns {boolean}
 */
export function isConnected(factory, target) {
  if (!factory.rootTarget) {
    return true;
  }
  let current = target;
  while (current) {
    if (current === factory.rootTarget) {
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
 * Notifies about a change if anything actually depends on it.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {object} target - The target raw object.
 * @param {string|symbol|Array<string|symbol>} [key] - The key that changed.
 *   Omitted for structural changes whose affected keys are not known, which
 *   notify unconditionally.
 */
export function notifyChange(factory, target, key) {
  if (!isConnected(factory, target)) {
    return;
  }
  // The filter is only sound once the consumer has collected dependencies.
  // Before a component's first render nothing has been read, so every key
  // would look unobserved and no update would ever be scheduled.
  const filtering =
    typeof factory.onlyNotifyObserved === 'function'
      ? factory.onlyNotifyObserved()
      : factory.onlyNotifyObserved;

  if (filtering && key !== undefined && !hasDependentOnPath(target, key)) {
    if (isDebugReactivityEnabled() && factory.instance) {
      const componentName = factory.instance.constructor?.name || 'Component';
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        if (typeof k !== 'symbol') {
          const propPath = getPropertyPath(target, k);
          console.log(`[Avenx Debug] Skipped render for component "${componentName}" on unobserved key "${propPath || k}"`);
        }
      }
    }
    return;
  }
  factory.onChange(key, target);
}
