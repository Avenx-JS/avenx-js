/**
 * @file scopedSlots.js
 * @description Escapes interpolations inside scoped-slot and row templates so the parent does not evaluate them.
 */
import { escapeTemplateMarkers } from '../../../core/utils/templateUtils.js';
import { HtmlEscaper } from '../../../core/security/escapeHtml.js';
import { scanTagEnd } from '../htmlTree.js';

/**
 * Encodes interpolations inside `<template data-slot-props="...">` tags
 * to avoid premature evaluation by the parent component.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
export function escapeScopedSlots(template) {
  if (!template) return template;
  let currentTemplate = template;
  // The opening tag is located by scanning for `<template`, then bounded with
  // the shared tag scanner, and only then searched for `data-slot-props`.
  // Matching the whole tag with `/<template\s+[^>]*\bdata-slot-props=.../` put
  // `[^>]*` before the attribute, so any earlier attribute containing a `>`
  // -- `<template title="a > b" data-slot-props="row">` -- ended the match
  // early and the tag was not recognised as a scoped slot at all. Its
  // interpolations were then left unescaped for the parent to evaluate, which
  // is exactly what this pass exists to prevent.
  const startRegex = /<template\b/gi;
  let match;

  while ((match = startRegex.exec(currentTemplate)) !== null) {
    const startIndex = match.index;
    const tagEnd = scanTagEnd(currentTemplate, startIndex);
    if (tagEnd === -1) break;

    const openTag = currentTemplate.slice(startIndex, tagEnd + 1);
    const isScopedSlot = /\bdata-slot-props\s*=\s*["']/i.test(openTag);
    const isDataAxAs = /\bdata-ax-as\s*=\s*["']/i.test(openTag);
    if (!isScopedSlot && !isDataAxAs) {
      startRegex.lastIndex = tagEnd + 1;
      continue;
    }

    const tagOpenLength = openTag.length;

    // Find the matching </template> tag by tracking depth
    let searchIndex = startIndex + tagOpenLength;
    let depth = 1;
    let closingIndex = -1;
    let closingLength = 11;

    while (searchIndex < currentTemplate.length) {
      const nextOpen = currentTemplate.substring(searchIndex).match(/^<template\b/i);
      const nextClose = currentTemplate.substring(searchIndex).match(/^<\/template>/i);

      if (nextClose) {
        depth--;
        if (depth === 0) {
          closingIndex = searchIndex;
          closingLength = nextClose[0].length;
          break;
        }
        searchIndex += nextClose[0].length;
      } else if (nextOpen) {
        depth++;
        searchIndex += nextOpen[0].length;
      } else {
        searchIndex++;
      }
    }

    if (closingIndex !== -1) {
      const contentStart = startIndex + tagOpenLength;
      const content = currentTemplate.substring(contentStart, closingIndex);

      let escapedContent;
      if (isDataAxAs) {
        // Row templates (e.g. inside <VirtualList>) use unescapeTemplateMarkers
        // at runtime, so escape {{ and }}} to {% and {%% to prevent premature
        // evaluation by the parent component.
        escapedContent = content.includes('{{') ? escapeTemplateMarkers(content) : content;
      } else {
        // Escape interpolations in the content
        // [\s\S] rather than . so a multi-line expression inside a scoped slot
        // is escaped as a whole instead of being left half-encoded.
        const escaper = new HtmlEscaper();
        escapedContent = content
          .replace(/\{\{\{\s*([\s\S]*?)\s*\}\}\}/g, (m, g) => `_AX_LBRACE3_${escaper.escape(g)}_AX_RBRACE3_`)
          .replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (m, g) => `_AX_LBRACE_${escaper.escape(g)}_AX_RBRACE_`);
      }

      currentTemplate =
        currentTemplate.substring(0, contentStart) + escapedContent + currentTemplate.substring(closingIndex);

      // Advance regex lastIndex past the modified template block
      startRegex.lastIndex = contentStart + escapedContent.length + closingLength;
    }
  }
  return currentTemplate;
}
