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
 *
 * The code is AVX_R34 and not the generic template-render error it used to
 * borrow. Reusing AVX_R08 made this read as "an interpolation failed", which
 * sent a developer looking at their expression -- the one place the fault was
 * certainly not. It also made the condition invisible to `avenx explain`,
 * because AVX_R08's entry describes something else entirely.
 * The code splits on why the component needs the renderer. A component that
 * has no render program because the compiler could not lower its template is
 * AVX_R34: reaching the registry empty then really is a build that disagreed
 * with itself. But a component whose program exists and whose skeleton this
 * environment could not prepare -- no usable DOM, or a parser that reshaped
 * the tree past the compiler's markers -- fell back for an environment
 * reason, and AVX_R34's mislinked-bundle text would send its user rebuilding
 * a bundle that renders fine in a browser. That case is AVX_R37, keyed by the
 * failure reason the compiled template recorded.
 * @param {string} [componentName] - The component that needs the renderer, for
 *   the diagnostic.
 * @param {string} [skeletonFailure] - Why the component's compiled skeleton
 *   could not be prepared ('no-dom' or 'marker-mismatch'), when that is what
 *   forced the fallback. Null when the component simply has no program.
 * @returns {object} The renderer classes.
 */
export function requireStringRenderer(componentName = 'a component', skeletonFailure = null) {
  if (!installed) {
    const detail = skeletonFailure ? SKELETON_FAILURE_DETAILS[skeletonFailure] : undefined;
    if (detail) {
      throw new AvenxError(
        AvenxErrorCodes.COMPILED_TEMPLATE_ENVIRONMENT_UNSUPPORTED,
        componentName,
        detail,
      );
    }
    throw new AvenxError(
      AvenxErrorCodes.RENDERER_UNAVAILABLE,
      componentName,
      'the string renderer',
    );
  }
  return installed;
}

/**
 * What kept a compiled template's skeleton from being prepared, by failure
 * reason, as the sentence AVX_R37 names.
 * @type {Object<string, string>}
 */
const SKELETON_FAILURE_DETAILS = {
  'no-dom':
    'there is no usable DOM (no document, or document.createElement is unavailable), so its skeleton could not be parsed at all',
  'marker-mismatch':
    'the DOM here reshaped its skeleton past the compiler\'s markers, so the parsed tree could not be matched to its render program',
};
