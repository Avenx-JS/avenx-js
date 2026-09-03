/**
 * Failure reporting for the i18n plugin.
 *
 * A user interface must not go blank because a translator forgot a key, a
 * locale file failed to download, or a message turned out to be a number. Every
 * runtime failure therefore ends up here, is reported through the Avenx logger,
 * and is handed to the application's own `onError` callback if it registered
 * one — while the caller receives a usable string and carries on.
 *
 * Configuration mistakes are the opposite case: they are a developer's to fix
 * and are thrown at setup time, where the stack still points at the call that
 * was wrong.
 *
 * Everything here deduplicates by message text. Translation is read during
 * rendering, so one absent key would otherwise fill the console with thousands
 * of identical lines and bury everything else.
 * @module @avenx/i18n/diagnostics
 */

import { logger } from './runtime.js';

/**
 * Prefix shared by every message this plugin emits.
 * @type {string}
 */
export const PLUGIN_TAG = '[avenx-i18n]';

/**
 * Messages already emitted.
 * @type {Set<string>}
 */
const emitted = new Set();

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
 * @param {string} message - The warning text.
 */
export function warnOnce(message) {
  const text = `${PLUGIN_TAG} ${message}`;
  if (emitted.has(text)) {
    return;
  }
  emitted.add(text);
  logger.warn(text);
}

/**
 * Builds the reporter one i18n instance uses.
 *
 * The callback belongs to the instance rather than to the module so that two
 * instances — an application's and a test's — never report into each other's
 * handler.
 * @param {object} owner - Something exposing the application's `onError`.
 * @param {Function} [owner.onError] - Called with `{ phase, message, key, locale, error }`.
 * @returns {function(string, string, object=): void} The reporter.
 */
export function createReporter(owner) {
  /**
   * Reports an i18n failure without interrupting the application.
   * @param {string} phase - Which part of the plugin failed. See `I18nFailurePhase`.
   * @param {string} message - A description of what went wrong.
   * @param {object} [detail] - Structured context: `key`, `locale`, `error`.
   */
  return function report(phase, message, detail = {}) {
    const suffix = detail.locale ? ` (locale "${detail.locale}")` : '';
    const text = `${PLUGIN_TAG} ${message}${suffix}`;

    if (emitted.has(text)) {
      return;
    }
    emitted.add(text);
    logger.warn(text);

    const onError = owner && owner.onError;
    if (typeof onError !== 'function') {
      return;
    }
    try {
      onError({
        phase,
        message,
        key: detail.key,
        locale: detail.locale,
        error: detail.error || null,
      });
    } catch (callbackError) {
      logger.error(`${PLUGIN_TAG} onError callback threw while reporting a "${phase}" failure`, callbackError);
    }
  };
}

/**
 * Clears the once-only history. Exposed for tests, which run many independent
 * scenarios inside a single process.
 */
export function resetDiagnostics() {
  emitted.clear();
}
