/**
 * The runtime resolver used by the standalone browser build.
 *
 * A `<script>`-tag deployment has no module resolution, so the plugin reaches
 * the runtime the same way a compiled Avenx application does: through the
 * namespace the runtime bundle publishes on the global object. The build
 * substitutes this module for `runtime.js`, which keeps `avenx-core` out of
 * the standalone bundle — a page must only ever have one runtime on it.
 *
 * Resolution is deferred to first use rather than done at load. A compiled
 * Avenx application is one file containing the runtime and the application
 * together, so at the moment this script is parsed the namespace does not
 * exist yet — but by the time a bridge initializes and asks to be persisted,
 * it does. Deferring means the plugin can be loaded before the application,
 * which is the only order a plain `<script>` tag allows.
 * @module @avenx/persistence/runtime.global
 */

/**
 * Returns the Avenx runtime namespace.
 * @returns {object} The `Avenx` global.
 */
function core() {
  const namespace = typeof globalThis !== 'undefined' ? globalThis.Avenx : undefined;
  if (!namespace) {
    throw new Error(
      '[avenx-persistence] The Avenx runtime was not found on the page. Load the Avenx application bundle alongside avenx-persistence.global.js.',
    );
  }
  return namespace;
}

/**
 * The Avenx logger, resolved on each call.
 * @type {object}
 */
export const logger = {
  /**
   * @param {...any} args - Arguments to log.
   */
  warn(...args) {
    core().logger.warn(...args);
  },
  /**
   * @param {...any} args - Arguments to log.
   */
  error(...args) {
    core().logger.error(...args);
  },
};

/**
 * Creates a reactive effect. See `avenx-core/runtime`.
 * @param {Function} effect - The effect to run and track.
 * @param {object} [options] - Watcher options.
 * @returns {Function} The stop handle.
 */
export function watchEffect(effect, options) {
  return core().watchEffect(effect, options);
}

/**
 * Queues a job on the Avenx scheduler. See `avenx-core/runtime`.
 * @param {Function} job - The job to run at the end of the tick.
 */
export function queueJob(job) {
  core().queueJob(job);
}
