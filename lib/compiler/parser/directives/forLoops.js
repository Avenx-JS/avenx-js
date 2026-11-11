/**
 * @file forLoops.js
 * @description Desugars `<@for>` / `<@empty>` into runtime `<template>` markers.
 */
import { logger } from '../../../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { escapeTemplateMarkers } from '../../../core/utils/templateUtils.js';
import { TemplateValidationError } from '../../errors/index.js';
import { parseForHeader } from '../../ir/build.js';
import { scanTagEnd } from '../htmlTree.js';

/**
 * Processes <@for> loops in the template, converting them to <template> tags
 * that can be handled by the runtime for efficient list rendering.
 *
 * Loops are rewritten innermost first, so a nested loop's body is already a
 * `<template>` by the time its parent's body is escaped.
 * @param {string} template - The HTML template string.
 * @returns {string} The processed template.
 */
export function processForLoops(template) {
  let currentTemplate = template;

  while (true) {
    const tagRegex = /(<@for\b)|(<\/ ?@for>)|(<@empty>)/gi;
    let match;
    const tags = [];
    while ((match = tagRegex.exec(currentTemplate)) !== null) {
      if (match[1]) {
        // The header is scanned and parsed by the same code the IR uses.
        // This loop used to carry its own pattern for it, and the two
        // disagreed: `([^>]+?)` ends the header at the first `>`, so
        // `<@for r in rows.filter(x => x.n > 2)>` was truncated to
        // `rows.filter(x =` and reported as a malformed expression. One
        // parser means the fallback template and the compiled program
        // describe the same loop.
        const end = scanTagEnd(currentTemplate, match.index);
        if (end === -1) break;
        const header = currentTemplate.slice(match.index + '<@for'.length, end).trim();

        let parts;
        try {
          parts = parseForHeader(header);
        } catch {
          // Reported by the IR builder with a location and a reason; a
          // second, vaguer complaint from here would not help.
          tagRegex.lastIndex = end + 1;
          continue;
        }

        tags.push({
          type: 'start',
          index: match.index,
          length: end + 1 - match.index,
          item: parts.destructure ? `[${parts.destructure.join(', ')}]` : parts.item,
          list: parts.list,
          key: parts.key,
        });
        tagRegex.lastIndex = end + 1;
      } else if (match[2]) {
        tags.push({
          type: 'end',
          index: match.index,
          length: match[0].length,
        });
      } else if (match[3]) {
        tags.push({
          type: 'empty',
          index: match.index,
          length: match[0].length,
        });
      }
    }

    if (tags.length === 0) {
      break;
    }

    let innerPair = null;
    let innerEmpty = null;
    const stack = [];
    const emptyStack = [];
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      if (tag.type === 'start') {
        stack.push(tag);
        emptyStack.push(null);
      } else if (tag.type === 'empty') {
        if (emptyStack.length > 0) {
          emptyStack[emptyStack.length - 1] = tag;
        }
      } else {
        const startTag = stack.pop();
        const emptyTag = emptyStack.pop();
        if (startTag) {
          innerPair = { start: startTag, end: tag };
          innerEmpty = emptyTag;
          break; // Found innermost loop!
        }
      }
    }

    if (!innerPair) {
      const unmatchedIdx =
        stack.length > 0 && stack[0].index !== undefined ? stack[0].index : currentTemplate.indexOf('<@for');
      const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_UNMATCHED_FOR_TAG);
      if (unmatchedIdx >= 0) {
        err.setLocation({ source: currentTemplate, index: unmatchedIdx });
      }
      logger.warn(err.message);
      break;
    }

    const startIdx = innerPair.start.index;
    const endIdx = innerPair.end.index + innerPair.end.length;

    let body,
      emptyBody = '';
    const bodyStart = startIdx + innerPair.start.length;
    const bodyEnd = innerPair.end.index;

    if (innerEmpty) {
      body = currentTemplate.substring(bodyStart, innerEmpty.index);
      emptyBody = currentTemplate.substring(innerEmpty.index + innerEmpty.length, bodyEnd);
    } else {
      body = currentTemplate.substring(bodyStart, bodyEnd);
    }

    // Escape inner interpolation tags to prevent them from being processed
    // by the initial template render. They will be processed per-item at runtime.
    const escapedBody = escapeTemplateMarkers(body);
    let attrs = `data-ax-for="${innerPair.start.list.trim()}" data-ax-as="${innerPair.start.item.trim()}"`;
    if (innerPair.start.key) {
      attrs += ` data-ax-key="${innerPair.start.key.trim()}"`;
    }

    let replacement = `<template ${attrs}>${escapedBody}</template>`;
    if (innerEmpty) {
      const escapedEmptyBody = escapeTemplateMarkers(emptyBody);
      replacement += `<template data-ax-empty>${escapedEmptyBody}</template>`;
    }
    currentTemplate = currentTemplate.substring(0, startIdx) + replacement + currentTemplate.substring(endIdx);
  }

  return currentTemplate;
}
