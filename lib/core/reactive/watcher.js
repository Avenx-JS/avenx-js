/**
 * @file watcher.js
 * @description General-purpose state watcher and reactivity dependency tracking for Avenx-JS.
 */

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
  }
}

/**
 * Triggers all watchers registered to a mutated property, and propagates to parent nodes.
 * @param {object} target - The raw target where mutation occurred.
 * @param {string} key - The property key mutated.
 */
export function trigger(target, key) {
  const keysMap = depMap.get(target);
  if (keysMap) {
    const watchers = keysMap.get(key);
    if (watchers) {
      // Copy to prevent concurrent modification issues during execution
      const toRun = new Set(watchers);
      for (const watcher of toRun) {
        if (typeof watcher.update === 'function') {
          watcher.update();
        }
      }
    }
  }

  // Propagate triggering to parents in case target is a nested object
  const parentRelation = parentMap.get(target);
  if (parentRelation) {
    const { parentTarget, parentKey } = parentRelation;
    trigger(parentTarget, parentKey);
  }
}

/**
 * AvenxWatcher handles dependency tracking, caching, lazy/immediate callbacks,
 * and lifecycle cleanup for reactive expressions.
 */
export class AvenxWatcher {
  /**
   * @param {function(): any} getter - The reactive evaluation function.
   * @param {function(any, any): void|null} [callback] - Callback triggered when evaluated value changes.
   * @param {object} [options] - Configuration options.
   * @param {boolean} [options.immediate] - Run the callback immediately with initial value.
   * @param {boolean} [options.lazy] - Postpone the initial evaluation until first accessed.
   */
  constructor(getter, callback = null, options = {}) {
    /** @type {function(): any} */
    this.getter = getter;
    /** @type {function(any, any): void|null} */
    this.callback = callback;
    /** @type {object} */
    this.options = options;
    /** @type {Set<{target: object, key: string, watchersSet: Set<AvenxWatcher>}>} */
    this.deps = new Set();
    /** @type {boolean} */
    this.dirty = true;
    /** @type {any} */
    this.value = undefined;

    if (!options.lazy) {
      this.value = this.get();
      this.dirty = false;
    }

    if (options.immediate && this.callback) {
      this.callback(this.value, undefined);
    }
  }

  /**
   * Evaluates the getter function inside the watcher context to track reactive dependencies.
   * @returns {any}
   */
  get() {
    pushWatcher(this);
    try {
      return this.getter();
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
    this.deps.add({ target, key, watchersSet });
  }

  /**
   * Triggers re-evaluation when a tracked dependency changes, firing the callback if needed.
   */
  update() {
    if (this.options.lazy) {
      this.dirty = true;
      if (this.callback) {
        this.callback(this.value, this.value);
      }
    } else {
      const oldValue = this.value;
      const newValue = this.get();
      if (newValue !== oldValue || (newValue && typeof newValue === 'object')) {
        this.value = newValue;
        if (this.callback) {
          this.callback(newValue, oldValue);
        }
      }
    }
  }

  /**
   * Cleans up all registered dependencies of this watcher to prevent memory leaks.
   */
  teardown() {
    for (const dep of this.deps) {
      dep.watchersSet.delete(this);
    }
    this.deps.clear();
  }
}
