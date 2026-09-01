import { AvenxWatcher } from './watcher.js';
import { tracer } from '../trace/tracer.js';
import {
  takeRecordedResponse,
  traceResourceStart,
  traceResourceSettle,
} from '../trace/resource.js';

/**
 * A reactive resource that evaluates a handler function asynchronously.
 * Supports Suspense and Error Boundaries by throwing Promises/Errors during render.
 */
export class Resource {
  /**
   * @param {string} name - Resource name.
   * @param {function(AbortSignal): any} handlerFn - The function to execute (e.g., fetch call).
   * @param {object} [componentContext] - The component instance context.
   * @param {object} [options] - Resource options (e.g., pollInterval).
   */
  constructor(name, handlerFn, componentContext, options = {}) {
    this.name = name;
    this.handlerFn = handlerFn;

    let ctx = componentContext;
    let opts = options;
    if (
      componentContext &&
      typeof componentContext === 'object' &&
      !('renderWatcher' in componentContext || 'update' in componentContext || '$app' in componentContext || 'state' in componentContext) &&
      'pollInterval' in componentContext
    ) {
      opts = componentContext;
      ctx = null;
    }

    this.componentContext = ctx || null;
    this.options = opts || {};

    this.status = 'idle'; // 'idle' | 'pending' | 'resolved' | 'rejected'
    this.value = undefined;
    this.error = undefined;
    this.promise = null;

    // Race-condition guard and cancellation tokens
    this._requestId = 0;
    this._abortController = null;

    this.pollTimer = null;
    this.pollInterval = this.options.pollInterval ? Number(this.options.pollInterval) : 0;

    /**
     * The trace node for the request currently in flight, so its settlement can
     * point back at it.
     * @type {object|null}
     */
    this.traceRequest = null;

    // Create a watcher that tracks reactive dependencies inside handlerFn
    this.watcher = new AvenxWatcher(
      () => {
        // During replay the recorded settlement stands in for the handler
        // entirely, rather than running it and discarding the result: the
        // handler *is* the network call, so calling it would hit the network.
        // The cost is that a replayed resource does not re-track the
        // dependencies its handler reads. Any behaviour that depends on it
        // shows up as a divergence during replay rather than passing quietly.
        const recorded = takeRecordedResponse(this.name);
        if (recorded) {
          return recorded.status === 'rejected'
            ? Promise.reject(Object.assign(new Error(recorded.error?.message || 'Recorded failure'), {
              name: recorded.error?.name || 'Error',
            }))
            : Promise.resolve(recorded.value);
        }
        // Evaluate the handler to track dependencies
        return this._executeHandler();
      },
      (newResult) => {
        // Triggered when reactive dependencies change
        this.fetch(newResult);
      },
      { name: `Resource#${name}` }
    );

    // Initiate the first fetch manually with the initial evaluated value
    this.fetch(this.watcher.value);

    if (this.pollInterval > 0) {
      this.pollTimer = setInterval(() => {
        const val = typeof this.watcher.get === 'function' ? this.watcher.get() : this.watcher.value;
        this.fetch(val);
      }, this.pollInterval);
    }
  }

  // --- Non-throwing Status Accessors ---

  /**
   * Indicates whether the resource is currently pending.
   * @returns {boolean}
   */
  get loading() {
    return this.status === 'pending';
  }

  // --- Internal Helper Methods ---

  /**
   * Invokes the user handler passing the active abort signal.
   * @private
   */
  _executeHandler() {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();
    return this.handlerFn.call(this.componentContext, this._abortController.signal);
  }

  /**
   * Notifies the parent component to schedule a re-render.
   * @private
   */
  _notifyComponent() {
    if (this.componentContext) {
      if (this.componentContext.renderWatcher) {
        this.componentContext.renderWatcher.dirty = true;
      }
      if (typeof this.componentContext.update === 'function') {
        this.componentContext.update();
      }
    }
  }

  /**
   * Evaluates the resource result and updates internal state with request ID guard.
   * @param {any} result - The result from the handler (Promise or sync value).
   * @returns {Promise<any>}
   */
  fetch(result) {
    const currentId = ++this._requestId;
    this.status = 'pending';
    this.error = undefined;

    const pending = tracer.on ? traceResourceStart(this.name, this.componentContext, this.pollInterval) : null;
    this.traceRequest = pending;

    if (result && typeof result.then === 'function') {
      this.promise = result.then(
        (val) => {
          if (tracer.on) {
            traceResourceSettle(pending, this.name, 'resolved', val);
          }
          // Ignore stale responses if a newer request was issued
          if (currentId !== this._requestId) return val;

          this.status = 'resolved';
          this.value = val;
          this._notifyComponent();
          return val;
        },
        (err) => {
          if (tracer.on) {
            traceResourceSettle(pending, this.name, 'rejected', err);
          }
          // Ignore stale or intentionally aborted responses
          if (currentId !== this._requestId) return;
          if (err && (err.name === 'AbortError' || err.message === 'canceled')) return;

          this.status = 'rejected';
          this.error = err;
          this._notifyComponent();
        }
      );
    } else {
      // Synchronous result handling
      this.status = 'resolved';
      this.value = result;
      this.promise = Promise.resolve(result);
      if (tracer.on) {
        traceResourceSettle(pending, this.name, 'resolved', result);
      }
      this._notifyComponent();
    }

    return this.promise;
  }

  // --- Imperative API ---

  /**
   * Imperatively triggers a re-fetch, bypassing watcher dependency updates.
   * @returns {Promise<any>}
   */
  refetch() {
    const result = this._executeHandler();
    return this.fetch(result);
  }

  /**
   * Imperatively sets the local value without a network call (useful for optimistic UI).
   * @param {any} nextValue
   */
  mutate(nextValue) {
    // Invalidate any in-flight requests so a pending fetch doesn't override this mutation
    this._requestId++;
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    this.status = 'resolved';
    this.value = nextValue;
    this.error = undefined;
    this.promise = Promise.resolve(nextValue);

    this._notifyComponent();
  }

  /**
   * Reads the resource value.
   * Throws Promise if pending (Suspense).
   * Throws Error if rejected (ErrorBoundary).
   * Returns value if resolved.
   * @returns {any}
   */
  read() {
    if (this.status === 'pending' && this.promise) {
      throw this.promise;
    }
    if (this.status === 'rejected') {
      throw this.error;
    }
    return this.value;
  }

  /**
   * Cleans up the watcher, aborts pending in-flight requests, and clears the polling timer.
   */
  teardown() {
    this._requestId++;
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watcher) {
      this.watcher.teardown();
    }
  }
}