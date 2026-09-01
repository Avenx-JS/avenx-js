/**
 * @file watcher.js
 * @description General-purpose state watcher and reactivity dependency tracking for Avenx-JS.
 */

import { tracer } from '../trace/tracer.js';
import { traceWatcher } from '../trace/reactive.js';

/**
 * WeakMap tracking raw target to Map of keys to Set of active Watchers depending on them.
 * @type {WeakMap<object, Map<string, Set<AvenxWatcher>>>}
 */
export const depMap = new WeakMap();

/**
 * WeakMap tracking nested child targets to their parent relationship.
 * @type {WeakMap<object, {parentTarget: object, parentKey: string}>}
 */
export const parentMap = new WeakMap();

/**
 * The currently active watcher evaluating a reactive expression/function.
 * @type {AvenxWatcher|null}
 */
export let activeWatcher = null;

/**
 * Call stack of active watchers.
 * @type {AvenxWatcher[]}
 */
const watcherStack = [];

/**
 * Pushes a watcher onto the active evaluation context stack.
 * @param {AvenxWatcher} watcher - The watcher instance to run.
 */
export function pushWatcher(watcher) {
  watcherStack.push(activeWatcher);
  activeWatcher = watcher;
}

/**
 * Pops the active watcher context from the stack.
 */
export function popWatcher() {
  activeWatcher = watcherStack.pop();
}

let debugReactivity = false;

/**
 * Programmatically enables or disables debug reactivity logging.
 * @param {boolean} enabled
 */
export function setDebugReactivity(enabled) {
  debugReactivity = Boolean(enabled);
}

/**
 * Returns whether debug reactivity logging is currently enabled.
 * @returns {boolean}
 */
export function isDebugReactivityEnabled() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.__avenx_debug_reactivity__ === 'boolean') {
    return globalThis.__avenx_debug_reactivity__;
  }
  return debugReactivity;
}

/**
 * Formats a value for debug logging output.
 * @param {any} val
 * @returns {string}
 */
export function formatValue(val) {
  if (typeof val === 'string') {
    return `"${val}"`;
  }
  if (val === undefined) {
    return 'undefined';
  }
  if (val === null) {
    return 'null';
  }
  if (typeof val === 'symbol') {
    return val.toString();
  }
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

/**
 * Constructs the full property path from a target object and key using parentMap.
 * @param {object} target
 * @param {string|symbol} key
 * @returns {string}
 */
export function getPropertyPath(target, key) {
  const parts = [];
  if (key !== undefined && key !== null) {
    parts.unshift(String(key));
  }
  let current = target;
  while (current) {
    const relation = parentMap.get(current);
    if (!relation) break;
    parts.unshift(String(relation.parentKey));
    current = relation.parentTarget;
  }
  return parts.join('.');
}

/**
 * Tracks a property access on a target, establishing a dependency relationship.
 * @param {object} target - The raw reactive target object.
 * @param {string} key - The property key accessed.
 */
export function track(target, key) {
  if (activeWatcher) {
    let keysMap = depMap.get(target);
    if (!keysMap) {
      keysMap = new Map();
      depMap.set(target, keysMap);
    }
    let watchers = keysMap.get(key);
    if (!watchers) {
      watchers = new Set();
      keysMap.set(key, watchers);
    }
    watchers.add(activeWatcher);
    activeWatcher.addDep(target, key, watchers);

    if (isDebugReactivityEnabled()) {
      const propPath = getPropertyPath(target, key);
      const watcherName = activeWatcher.name || (activeWatcher.options && activeWatcher.options.name) || 'anonymous';
      console.log(`[Avenx Debug] Tracked property "${propPath}" by Watcher "${watcherName}"`);
    }
  }
}

import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { logger } from '../runtime/AvenxLogger.js';

let triggerDepth = 0;
const MAX_TRIGGER_DEPTH = 50;
const triggeredWatchers = new Set();
const activeUpdatingWatchers = new Set();
const causationTrace = [];

/**
 * Returns the current active causation trace for diagnostics.
 * @returns {string[]}
 */
export function getActiveCausationTrace() {
  return [...causationTrace];
}

/**
 * Clears the causation trace log.
 */
export function clearCausationTrace() {
  causationTrace.length = 0;
}

/**
 * Triggers all watchers registered to a mutated property, and propagates to parent nodes.
 * @param {object} target - The raw target where mutation occurred.
 * @param {string} key - The property key mutated.
 * @param {any} [oldValue] - Previous value before mutation.
 * @param {any} [newValue] - New value after mutation.
 */
export function trigger(target, key, oldValue, newValue) {
  if (triggerDepth === 0) {
    triggeredWatchers.clear();
    causationTrace.length = 0;
  }
  triggerDepth++;

  if (triggerDepth > MAX_TRIGGER_DEPTH) {
    const cycleStr = causationTrace.slice(-6).join(' -> ') || 'synchronous-watcher-cycle';
    logger.error(
      formatMessage(
        AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
        ' (synchronous cascade loop)',
        `  ${cycleStr}\n\nSynchronous mutation cascade exceeded ${MAX_TRIGGER_DEPTH} levels. Aborted.`
      )
    );
    triggerDepth--;
    return;
  }

  try {
    const keys = Array.isArray(key) ? key : [key];

    for (const k of keys) {
      if (typeof k !== 'symbol') {
        const propPath = getPropertyPath(target, k);
        causationTrace.push(propPath);
      }
    }

    if (isDebugReactivityEnabled()) {
      for (const k of keys) {
        if (typeof k !== 'symbol') {
          const propPath = getPropertyPath(target, k);
          const oldFormatted = formatValue(oldValue);
          const newFormatted = formatValue(newValue);
          console.log(`[Avenx Debug] Triggered property "${propPath}" (old: ${oldFormatted}, new: ${newFormatted}) -> scheduling update`);
        }
      }
    }

    const keysMap = depMap.get(target);
    if (keysMap) {
      for (const k of keys) {
        const watchers = keysMap.get(k);
        if (watchers) {
          // Copy to prevent concurrent modification issues during execution
          const toRun = new Set(watchers);
          for (const watcher of toRun) {
            if (activeUpdatingWatchers.has(watcher)) {
              const cycleStr = `${watcher.name || 'anonymous'} -> ${causationTrace.join(' -> ')} -> ${watcher.name || 'anonymous'}`;
              logger.error(
                formatMessage(
                  AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
                  ' (synchronous watcher cycle)',
                  `  ${cycleStr}\n\nSynchronous watcher cycle detected. Execution aborted to prevent stack overflow.`
                )
              );
              continue;
            }

            if (!triggeredWatchers.has(watcher)) {
              triggeredWatchers.add(watcher);
              if (watcher.name) {
                causationTrace.push(`[${watcher.name}]`);
              }
              if (typeof watcher.update === 'function') {
                // Recorded inside the write's causal scope, so the trace reads
                // "this property changed, and that woke this watcher". The
                // ephemeral causationTrace above is kept as-is: it exists to
                // describe a deadlock at the moment one is detected, and is
                // cleared as the cascade unwinds.
                const token = tracer.on ? traceWatcher(watcher) : -1;
                try {
                  watcher.update();
                } finally {
                  if (token >= 0) {
                    tracer.leave(token);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Propagate triggering to parents in case target is a nested object
    const parentRelation = parentMap.get(target);
    if (parentRelation) {
      const { parentTarget, parentKey } = parentRelation;
      trigger(parentTarget, parentKey, oldValue, newValue);
    }
  } finally {
    triggerDepth--;
    if (triggerDepth === 0) {
      causationTrace.length = 0;
    }
  }
}

/**
 * Recursively traverses a reactive value to register deep dependencies.
 * @param {any} value
 * @param {Set<any>} [seen]
 */
function traverse(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen);
    }
  } else {
    for (const key of Object.keys(value)) {
      traverse(value[key], seen);
    }
  }
}

/**
 * AvenxWatcher handles dependency tracking, caching, lazy/immediate callbacks,
 * and lifecycle cleanup for reactive expressions.
 */
export class AvenxWatcher {
  #isPaused = false;

  /**
   * @param {Function|Array<Function>} getter - The reactive evaluation function.
   * @param {Function|null} [callback] - Callback triggered when evaluated value changes.
   * @param {object} [options] - Configuration options.
   * @param {boolean} [options.immediate] - Run the callback immediately with initial value.
   * @param {boolean} [options.lazy] - Postpone the initial evaluation until first accessed.
   */
  constructor(getter, callback = null, options = {}) {
    if (typeof callback === 'object' && callback !== null) {
      options = callback;
      callback = null;
    }

    /** @type {boolean} */
    this.isArray = Array.isArray(getter);
    /** @type {Function|Array<Function>} */
    this.getter = getter;
    /** @type {Function|null} */
    this.callback = typeof callback === 'function' ? callback : null;
    /** @type {object} */
    this.options = options || {};
    /** @type {boolean} */
    this.isEffect = !this.callback || !!options.isEffect || !!options.effect;
    /** @type {string} */
    this.name = (options && (options.name || options.id)) || (Array.isArray(getter) ? 'multi-watcher' : (getter && getter.name)) || 'anonymous';
    /** @type {Set<{target: object, key: string, watchersSet: Set<AvenxWatcher>}>} */
    this.deps = new Set();
    /** @type {boolean} */
    this.dirty = true;
    /** @type {any} */
    this.value = undefined;

    /** @type {any} */
    this.debounceTimer = null;
    /** @type {any} */
    this.throttleTimer = null;
    /** @type {number} */
    this.lastExecTime = 0;
    /** @type {any} */
    this.pendingNewValue = undefined;
    /** @type {any} */
    this.pendingOldValue = undefined;

    if (!options.lazy) {
      this.value = this.get();
      this.dirty = false;
    }

    if (options.immediate && this.callback) {
      this.callback(this.value, undefined);
    }
  }

  /**
   * Pauses watcher execution.
   */
  pause() {
    this.#isPaused = true;
  }

  /**
   * Resumes watcher execution.
   */
  resume() {
    this.#isPaused = false;
  }

  /**
   * Evaluates the getter function inside the watcher context to track reactive dependencies.
   * @returns {any}
   */
  get() {
    pushWatcher(this);
    const oldDeps = this.deps;
    this.deps = new Set();

    try {
      let value;
      if (this.isArray) {
        value = this.getter.map((fn) => fn());
      } else {
        value = this.getter();
      }
      if (this.options.deep) {
        traverse(value);
      }
      this.cleanupDeps(oldDeps);
      return value;
    } catch (err) {
      this.deps = oldDeps;
      throw err;
    } finally {
      popWatcher();
    }
  }

  /**
   * Evaluates a lazy computed watcher if it is dirty.
   * @returns {any}
   */
  evaluate() {
    if (this.dirty) {
      this.value = this.get();
      this.dirty = false;
    }
    return this.value;
  }

  /**
   * Registers a target property dependency on this watcher.
   * @param {object} target - Reactive object target.
   * @param {string} key - Property key.
   * @param {Set<AvenxWatcher>} watchersSet - Set mapping to this dependency.
   */
  addDep(target, key, watchersSet) {
    for (const dep of this.deps) {
      if (dep.watchersSet === watchersSet) {
        return;
      }
    }
    this.deps.add({ target, key, watchersSet });
  }

  /**
   * Compares active dependencies against old dependencies and unsubscribes from stale dependencies.
   * @param {Set<{target: object, key: string, watchersSet: Set<AvenxWatcher>}>} oldDeps
   */
  cleanupDeps(oldDeps) {
    const activeWatcherSets = new Set();
    for (const dep of this.deps) {
      activeWatcherSets.add(dep.watchersSet);
    }
    for (const oldDep of oldDeps) {
      if (!activeWatcherSets.has(oldDep.watchersSet)) {
        oldDep.watchersSet.delete(this);
      }
    }
  }

  /**
   * Executes the watcher callback, applying debounce or throttle timing if configured.
   * @param {any} newValue
   * @param {any} oldValue
   */
  run(newValue, oldValue) {
    if (!this.callback) return;

    if (typeof this.options.debounce === 'number' && this.options.debounce > 0) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      if (this.pendingOldValue === undefined) {
        this.pendingOldValue = oldValue;
      }
      this.pendingNewValue = newValue;

      this.debounceTimer = setTimeout(() => {
        const toNew = this.pendingNewValue;
        const toOld = this.pendingOldValue;
        this.pendingNewValue = undefined;
        this.pendingOldValue = undefined;
        this.debounceTimer = null;
        if (this.callback) {
          this.callback(toNew, toOld);
        }
      }, this.options.debounce);
      return;
    }

    if (typeof this.options.throttle === 'number' && this.options.throttle > 0) {
      const now = Date.now();
      const remaining = this.options.throttle - (now - (this.lastExecTime || 0));

      if (this.pendingOldValue === undefined) {
        this.pendingOldValue = oldValue;
      }
      this.pendingNewValue = newValue;

      if (remaining <= 0 || remaining > this.options.throttle) {
        if (this.throttleTimer) {
          clearTimeout(this.throttleTimer);
          this.throttleTimer = null;
        }
        this.lastExecTime = now;
        const toNew = this.pendingNewValue;
        const toOld = this.pendingOldValue;
        this.pendingNewValue = undefined;
        this.pendingOldValue = undefined;
        this.callback(toNew, toOld);
      } else if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.lastExecTime = Date.now();
          this.throttleTimer = null;
          const toNew = this.pendingNewValue;
          const toOld = this.pendingOldValue;
          this.pendingNewValue = undefined;
          this.pendingOldValue = undefined;
          if (this.callback) {
            this.callback(toNew, toOld);
          }
        }, remaining);
      }
      return;
    }

    this.callback(newValue, oldValue);
  }

  /**
   * Updates the watcher value and triggers evaluation or callback execution.
   */
  update() {
    if (this.#isPaused) return;
    if (activeUpdatingWatchers.has(this)) {
      const cycleStr = `${this.name} -> ${causationTrace.join(' -> ')} -> ${this.name}`;
      logger.error(
        formatMessage(
          AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
          ' (synchronous watcher cycle)',
          `  ${cycleStr}\n\nSynchronous watcher cycle detected. Execution aborted to prevent stack overflow.`
        )
      );
      return;
    }

    activeUpdatingWatchers.add(this);
    try {
      if (this.isEffect) {
        if (typeof this.options.debounce === 'number' && this.options.debounce > 0) {
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }
          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            if (!this.#isPaused) {
              this.value = this.get();
            }
          }, this.options.debounce);
          return;
        }

        if (typeof this.options.throttle === 'number' && this.options.throttle > 0) {
          const now = Date.now();
          const remaining = this.options.throttle - (now - (this.lastExecTime || 0));

          if (remaining <= 0 || remaining > this.options.throttle) {
            if (this.throttleTimer) {
              clearTimeout(this.throttleTimer);
              this.throttleTimer = null;
            }
            this.lastExecTime = now;
            this.value = this.get();
          } else if (!this.throttleTimer) {
            this.throttleTimer = setTimeout(() => {
              this.lastExecTime = Date.now();
              this.throttleTimer = null;
              if (!this.#isPaused) {
                this.value = this.get();
              }
            }, remaining);
          }
          return;
        }

        this.value = this.get();
      } else if (this.options.lazy) {
        this.dirty = true;
        if (this.callback) {
          this.run(this.value, this.value);
        }
      } else {
        const oldValue = this.value;
        const newValue = this.get();
        let hasChanged;

        if (this.isArray) {
          if (!Array.isArray(oldValue) || newValue.length !== oldValue.length) {
            hasChanged = true;
          } else {
            hasChanged = newValue.some(
              (val, i) => val !== oldValue[i] || (val && typeof val === 'object'),
            );
          }
        } else {
          hasChanged =
            newValue !== oldValue || (newValue && typeof newValue === 'object');
        }

        if (hasChanged) {
          this.value = newValue;
          if (this.callback) {
            this.run(newValue, oldValue);
          }
        }
      }
    } finally {
      activeUpdatingWatchers.delete(this);
    }
  }

  /**
   * Cleans up all registered dependencies of this watcher to prevent memory leaks.
   */
  teardown() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingNewValue = undefined;
    this.pendingOldValue = undefined;

    for (const dep of this.deps) {
      dep.watchersSet.delete(this);
    }
    this.deps.clear();
  }
}

/**
 * Creates an immediate effect watcher that automatically tracks reactive state properties accessed during execution and re-runs on mutation.
 * @param {Function} effect - The side-effect function to execute and track.
 * @param {object} [options] - Configuration options (e.g. debounce, throttle, deep, name).
 * @returns {Function} Stop handle function () => watcher.teardown().
 */
export function watchEffect(effect, options = {}) {
  if (typeof effect !== 'function') {
    throw new Error('watchEffect requires an effect function');
  }
  const watcher = new AvenxWatcher(effect, null, options);
  const stop = () => watcher.teardown();
  stop.watcher = watcher;
  return stop;
}

