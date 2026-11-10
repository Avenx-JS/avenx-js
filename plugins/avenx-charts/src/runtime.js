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
 * @module @avenx/charts/runtime
 */
export { AvenxComponent } from 'avenx-core/runtime';

/**
 * No-op in the module build: `AvenxComponent` above is already the real base
 * class, so there is nothing to resolve. The standalone browser build replaces
 * this module with one whose `ensureRuntime` relinks a lazy placeholder (see
 * `runtime.global.js`); keeping the same export here lets `plugin.js` call it
 * unconditionally.
 */
export function ensureRuntime() {}
