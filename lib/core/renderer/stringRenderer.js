/**
 * @file stringRenderer.js
 * @description The seam that lets the string renderer leave a bundle.
 *
 * ## Why this exists
 *
 * The string renderer is the pre-IR rendering path: render the whole template
 * to HTML, parse it, diff the result into the document, then re-scan the
 * subtree for lists, deferred blocks and event handlers. It is about 87 KB of
 * source -- roughly a quarter of a small application's bundle -- and since the
 * IR lowers `<@if>`, `<@for>`, `<slot>`, `<@defer>` and component tags, most
 * applications never execute a line of it.
 *
 * They were still paying for it, because `AvenxComponent` imported the four
 * classes directly and an import is reachability. The classes were already
 * behind lazy getters, so nothing was *constructed* -- but nothing was dropped
 * either.
 *
 * So the import moved. `AvenxComponent` asks this registry, and the compiler
 * adds the module that fills it only when at least one component in the build
 * actually fell back. An application whose every template compiles does not
 * reference the string renderer, and the bundler shakes it out.
 *
 * ## Deliberately tiny
 *
 * This module imports nothing. If it imported the renderer to provide a
 * default, the renderer would be reachable again and the whole arrangement
 * would achieve nothing.
 *
 * ## Temporary
 *
 * This is migration scaffolding. It exists for as long as there are template
 * constructs the IR does not model -- suspense, error boundaries, deadlock
 * boundaries, transitions, refs, declarative validation and dynamic component
 * tags. When the last of those lowers, the string renderer goes and this module
 * goes with it.
 * @module lib/core/renderer/stringRenderer
 */

import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';

/**
 * The renderer classes, once something has installed them.
 * @type {{DomPatcher: Function, ListManager: Function, DeferManager: Function,
 *   TemplateRenderer: Function}|null}
 */
let installed = null;

/**
 * Registers the string renderer's classes.
 *
 * Called by `avenx-core/runtime/string-renderer`, which the compiler adds to
 * the graph when a component falls back.
 * @param {object} classes - The renderer classes.
 * @param {Function} classes.DomPatcher - The DOM patcher.
 * @param {Function} classes.ListManager - The list manager.
 * @param {Function} classes.DeferManager - The defer manager.
 * @param {Function} classes.TemplateRenderer - The template renderer.
 */
export function installStringRenderer(classes) {
  installed = classes;
}

/**
 * Whether the string renderer is available in this bundle.
 * @returns {boolean} True when something installed it.
 */
export function hasStringRenderer() {
  return installed !== null;
}

/**
 * Returns the string renderer's classes.
 *
 * Throws rather than returning null when nothing installed it, because the
 * caller is a component about to render and has no second option. Reaching
 * here means a component without a render program ended up in a build that
 * concluded no component needed one, which is a compiler fault and should read
 * like one rather than like a missing method on undefined.
 * @returns {object} The renderer classes.
 */
export function requireStringRenderer() {
  if (!installed) {
    throw new AvenxError(
      AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
      'string renderer',
      'this component has no render program, and this bundle does not carry the string renderer. ' +
        'The build decides which to include from whether any template fell back; ' +
        'a component reaching here was compiled by a different build than the one that linked this bundle.',
    );
  }
  return installed;
}
