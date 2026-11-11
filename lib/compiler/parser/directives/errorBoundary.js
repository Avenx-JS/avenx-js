/**
 * @file errorBoundary.js
 * @description Desugars `<@errorBoundary>` (with an optional `<@fallback as="...">`) into DOM markers.
 */
import { escapeTemplateMarkers } from '../../../core/utils/templateUtils.js';

/**
 * Processes <@errorBoundary> tags, converting them to DOM markers.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
export function processErrorBoundary(template) {
  let currentTemplate = template;
  while (true) {
    const match = currentTemplate.match(/<@errorBoundary>([\s\S]*?)<\/ ?@errorBoundary>/i);
    if (!match) break;

    const fullMatch = match[0];
    const inner = match[1];

    // Extract <@fallback as="...">
    let fallbackContent = '';
    let errorAs = 'error';
    let boundaryContent = inner;
    const fallbackMatch = inner.match(/<@fallback(?:\s+as="([^"]*)")?>([\s\S]*?)<\/ ?@fallback>/i);
    if (fallbackMatch) {
      errorAs = fallbackMatch[1] || 'error';
      fallbackContent = escapeTemplateMarkers(fallbackMatch[2]); // Escape fallback logic
      boundaryContent = inner.replace(fallbackMatch[0], '');
    }

    const replacement = `<div data-ax-error-boundary="true" data-ax-error-as="${errorAs}"><template data-ax-error-fallback><div class="ax-error-boundary">${fallbackContent}</div></template>${boundaryContent}</div>`;
    currentTemplate = currentTemplate.replace(fullMatch, replacement);
  }
  return currentTemplate;
}
