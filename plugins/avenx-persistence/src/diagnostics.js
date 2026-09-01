/**
 * Failure reporting for the persistence plugin.
 *
 * Persistence is a background concern: a browser that refuses to store data,
 * or a leftover value from an older release, must never take the application
 * down with it. Every failure therefore ends up here, is reported through the
 * Avenx logger, and is handed to the application's own `onError` callback if
 * it registered one.
 *
 * Persisted values are deliberately never included in a message. They are
 * application data, frequently the kind a user would not want in a console
 * log or an error tracker, so diagnostics name the key and the phase only.
 * @module @avenx/persistence/diagnostics
 */

import { logger } from './runtime.js';

/**
 * Prefix shared by every message this plugin emits.
 * @type {string}
 */
export const PLUGIN_TAG = '[avenx-persistence]';

/**
 * Messages already emitted by {@link warnOnce}.
 * @type {Set<string>}
 */
const emittedOnce = new Set();

/**
 * Builds an Error carrying the plugin tag, for configuration mistakes that are
 * a developer's to fix and should therefore be loud.
 * @param {string} message - What went wrong.
 * @returns {Error} The error to throw.
 */
export function configError(message) {
  return new Error(`${PLUGIN_TAG} ${message}`);
}

/**
 * Logs a message the first time it is seen and ignores every repeat.
 *
 * Used for conditions that hold for the lifetime of the page — a browser with
 * storage switched off, for instance — where one warning is informative and
 * one per save is noise.
 * @param {string} message - The warning text.
 */
export function warnOnce(message) {
  if (emittedOnce.has(message)) {
    return;
  }
  emittedOnce.add(message);
  logger.warn(`${PLUGIN_TAG} ${message}`);
}

/**
 * Clears the {@link warnOnce} history. Exposed for tests, which run several
 * independent scenarios inside one process.
 */
export function resetDiagnostics() {
  emittedOnce.clear();
}

/**
 * Reports a persistence failure without interrupting the application.
 * @param {object} target - The reporting context.
 * @param {string} target.key - The persistence key the failure belongs to.
 * @param {Function} [target.onError] - Application callback for persistence failures.
 * @param {string} phase - Which part of the lifecycle failed, e.g. 'write' or 'deserialize'.
 * @param {string} message - A description that names no persisted value.
 * @param {Error} [error] - The underlying error, when there was one.
 */
export function report(target, phase, message, error) {
  const key = (target && target.key) || 'unknown';
  const detail = error && error.message ? `: ${error.message}` : '';
  logger.warn(`${PLUGIN_TAG} ${message} (key "${key}", phase "${phase}")${detail}`);

  const onError = target && target.onError;
  if (typeof onError !== 'function') {
    return;
  }
  try {
    onError({ key, phase, message, error: error || null });
  } catch (callbackError) {
    logger.error(`${PLUGIN_TAG} onError callback threw while reporting a "${phase}" failure`, callbackError);
  }
}
