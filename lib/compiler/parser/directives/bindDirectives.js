/**
 * @file bindDirectives.js
 * @description Expands two-way `data-ax-bind` bindings on form controls.
 *
 * The rewrite itself lives in `core/utils/templateUtils.js`, because the
 * runtime's string renderer applies the same expansion to templates it renders
 * without the compiler. This module is the compiler's entry point to it, so the
 * pass sits beside the other desugaring passes and the pipeline index can name
 * it.
 */
import { processBindDirectives as expandBindDirectives } from '../../../core/utils/templateUtils.js';

/**
 * Processes data-ax-bind attributes on input, textarea, and select elements.
 * Converts data-ax-bind="expr" to value="{{ expr }}" and event listener.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
export function processBindDirectives(template) {
  return expandBindDirectives(template);
}
