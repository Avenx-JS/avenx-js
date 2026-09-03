/**
 * Resolves the Avenx runtime once for the whole plugin.
 *
 * A published plugin imports `avenx-core/runtime`. Inside this repository that
 * specifier does not resolve — the nearest package.json is the plugin's own —
 * so the checked-out runtime is used instead. Doing it here, rather than in
 * every module, keeps the fallback to a single place.
 * @module @avenx/i18n/runtime
 */

let core;
try {
  core = await import('avenx-core/runtime');
} catch {
  core = await import('../../../lib/core/index.js');
}

export const { bridge, logger, SafeHtml, HtmlEscaper, Sanitizer } = core;
