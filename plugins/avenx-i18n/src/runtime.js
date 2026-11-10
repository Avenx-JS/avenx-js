/**
 * The Avenx runtime, resolved once for the whole plugin.
 *
 * A static import of `avenx-core/runtime`, the peer dependency, so a bundler
 * sees exactly one runtime and links this plugin to the application's copy of
 * it. This module used to try that import and fall back to
 * `../../../lib/core/index.js` when it failed; that path exists only in this
 * repository, and in an installed package it made Vite fail the build with an
 * unresolved import. Inside the repository the specifier resolves through the
 * link `scripts/link-plugin-core.js` creates.
 *
 * Keeping the import in this one module still gives the standalone browser
 * build a single module to swap (see `runtime.global.js`).
 * @module @avenx/i18n/runtime
 */
export { bridge, logger, SafeHtml, HtmlEscaper, Sanitizer } from 'avenx-core/runtime';
