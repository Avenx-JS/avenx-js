/**
 * @file computed.js
 * @description Lazy computed watcher evaluation for proxy state objects.
 */

import { track, trigger, AvenxWatcher } from '../watcher.js';
import { RAW_SYMBOL } from '../symbols.js';
import { notifyChange } from './notify.js';

/**
 * Evaluates and caches a computed property using an internal AvenxWatcher.
 * @param {object} factory - The ProxyHandlerFactory instance.
 * @param {string} key - The computed key.
 * @param {object} receiver - The proxy receiver.
 * @returns {any}
 */
export function evaluateComputedWatcher(factory, key, receiver) {
  const target = receiver[RAW_SYMBOL] || receiver;
  track(target, key);

  let watcher = factory.computedWatchers.get(key);
  if (!watcher) {
    watcher = new AvenxWatcher(
      () => factory.getComputedValueReal(key, receiver),
      () => {
        trigger(target, key);
        notifyChange(factory, target, key);
      },
      { lazy: true },
    );
    factory.computedWatchers.set(key, watcher);
  }
  return watcher.evaluate();
}
