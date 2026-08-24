/**
 * @file scope.js
 * @description Disposal scopes for Avenx-JS.
 *
 * A disposal scope is the owner of every teardown callback created while it is
 * active. Components run their lifecycle hooks and event handlers inside their
 * own scope, so anything that registers a subscription during that window (most
 * notably `bridge.on(...)`) is released automatically when the component
 * unmounts. This mirrors how `$watch` watchers are already collected in
 * `AvenxComponent._watchers` and torn down in `__performTeardown()`.
 */

/**
 * The scope that currently owns newly created teardown callbacks.
 * @type {DisposalScope|null}
 */
let activeScope = null;

/**
 * Collects teardown callbacks and releases them together.
 */
export class DisposalScope {
  /**
   * @param {string} [name] - Debug label used in diagnostics.
   */
  constructor(name = 'scope') {
    /** @type {string} */
    this.name = name;
    /** @type {Set<Function>} */
    this.disposers = new Set();
    /** @type {boolean} */
    this.disposed = false;
  }

  /**
   * Registers a teardown callback with this scope.
   * Disposing the scope runs it; running it earlier removes it from the scope.
   * @param {Function} disposer - The teardown callback.
   * @returns {Function} A wrapper that runs the teardown at most once.
   */
  add(disposer) {
    if (typeof disposer !== 'function') {
      return () => {};
    }
    if (this.disposed) {
      disposer();
      return () => {};
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.disposers.delete(release);
      disposer();
    };

    this.disposers.add(release);
    return release;
  }

  /**
   * Runs every registered teardown callback and empties the scope.
   * Safe to call more than once.
   */
  dispose() {
    this.disposed = true;
    // Copy first: a disposer removes itself from the set while running.
    const pending = [...this.disposers];
    this.disposers.clear();
    for (const release of pending) {
      release();
    }
  }
}

/**
 * Returns the scope that currently owns new teardown callbacks.
 * @returns {DisposalScope|null} The active scope, or null outside of one.
 */
export function getScope() {
  return activeScope;
}

/**
 * Runs a function with the given scope active, restoring the previous scope
 * afterwards. Passing `null` deliberately detaches ownership, which is how
 * long-lived work (such as a bridge `setup()`) avoids being torn down by
 * whichever component happened to touch it first.
 * @template T
 * @param {DisposalScope|null} scope - The scope to activate.
 * @param {() => T} fn - The function to run.
 * @returns {T} Whatever `fn` returned.
 */
export function runInScope(scope, fn) {
  const previous = activeScope;
  activeScope = scope;
  try {
    return fn();
  } finally {
    activeScope = previous;
  }
}

/**
 * Registers a teardown callback with the active scope, if there is one.
 * @param {Function} disposer - The teardown callback.
 * @returns {Function} A release function that runs the teardown at most once.
 */
export function onScopeDispose(disposer) {
  if (typeof disposer !== 'function') {
    return () => {};
  }
  if (!activeScope) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      disposer();
    };
  }
  return activeScope.add(disposer);
}
