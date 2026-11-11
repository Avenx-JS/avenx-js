/**
 * @file defer.js
 * @description Desugars `<@defer>` (with optional `<@placeholder>` / `<@loading>`) into DOM markers.
 */
import { escapeTemplateMarkers } from '../../../core/utils/templateUtils.js';

/**
 * Processes <@defer> tags, converting them to DOM markers with templates for deferred loading.
 * Supports triggers via when="<trigger>" (idle, visible, interaction, timer, expression)
 * and optional <@placeholder> and <@loading> sub-tags.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
export function processDefer(template) {
  let currentTemplate = template;
  while (true) {
    const match = currentTemplate.match(/<@defer(?:\s+when=["']([^"']*)["'])?\s*>([\s\S]*?)<\/ ?@defer>/i);
    if (!match) break;

    const fullMatch = match[0];
    const whenCondition = (match[1] || 'idle').trim();
    const inner = match[2];

    let placeholderContent = '';
    let loadingContent = '';
    let deferredContent = inner;

    const placeholderMatch = inner.match(/<@placeholder>([\s\S]*?)<\/ ?@placeholder>/i);
    if (placeholderMatch) {
      placeholderContent = escapeTemplateMarkers(placeholderMatch[1]).trim();
      deferredContent = deferredContent.replace(placeholderMatch[0], '');
    }

    const loadingMatch = inner.match(/<@loading>([\s\S]*?)<\/ ?@loading>/i);
    if (loadingMatch) {
      loadingContent = escapeTemplateMarkers(loadingMatch[1]).trim();
      deferredContent = deferredContent.replace(loadingMatch[0], '');
    }

    deferredContent = escapeTemplateMarkers(deferredContent).trim();

    const placeholderTpl = placeholderContent
      ? `<template data-ax-defer-placeholder>${placeholderContent}</template>`
      : '';
    const loadingTpl = loadingContent ? `<template data-ax-defer-loading>${loadingContent}</template>` : '';
    const contentTpl = `<template data-ax-defer-content>${deferredContent}</template>`;

    const replacement = `<div data-ax-defer="true" data-ax-defer-when="${whenCondition}">${placeholderTpl}${loadingTpl}${contentTpl}</div>`;
    currentTemplate = currentTemplate.replace(fullMatch, replacement);
  }
  return currentTemplate;
}
