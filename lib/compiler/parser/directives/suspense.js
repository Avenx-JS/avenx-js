/**
 * @file suspense.js
 * @description Desugars `<@suspense>` (with an optional `<@fallback>`) into DOM markers.
 */
import { escapeTemplateMarkers } from '../../../core/utils/templateUtils.js';

/**
 * Processes <@suspense> tags, converting them to DOM markers.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
export function processSuspense(template) {
  let currentTemplate = template;
  while (true) {
    const match = currentTemplate.match(/<@suspense>([\s\S]*?)<\/ ?@suspense>/i);
    if (!match) break;

    const fullMatch = match[0];
    const inner = match[1];

    // Extract <@fallback>
    let fallbackContent = '';
    let suspenseContent = inner;
    const fallbackMatch = inner.match(/<@fallback>([\s\S]*?)<\/ ?@fallback>/i);
    if (fallbackMatch) {
      fallbackContent = escapeTemplateMarkers(fallbackMatch[1]); // Escape fallback template logic
      suspenseContent = inner.replace(fallbackMatch[0], '');
    }

    const replacement = `<div data-ax-suspense="true"><template data-ax-fallback>${fallbackContent}</template>${suspenseContent}</div>`;
    currentTemplate = currentTemplate.replace(fullMatch, replacement);
  }
  return currentTemplate;
}
