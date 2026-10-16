/**
 * @file templateEvents.js
 * @description One walk over a template, shared by everything that needs it.
 * @module lib/compiler/templateEvents
 */

import { scanTagEnd } from './parser/htmlTree.js';
import { parseForHeader } from './ir/build.js';
import { tokenizeMarkup } from '../core/utils/markupLexer.js';

/**
 * Built-in directive attributes whose values are literal names or rule strings
 * rather than component-scope expressions.
 * @type {Set<string>}
 */
const NON_EXPRESSION_DIRECTIVES = new Set([
  'data-ax-ref',
  'data-ax-validate',
]);

/**
 * Collects every expression-bearing construct in a template, with its offset.
 *
 * Two callers need exactly this walk and must not drift apart:
 * `validateTemplate` runs it over the processed template to report undeclared
 * references, and Atlas runs it over the original source — where the offsets
 * still point at what the developer wrote — to record the relationships each
 * construct creates.
 *
 * Offsets are relative to whatever string is passed in. Nothing here assumes
 * the template has been transformed, so it is safe on raw source.
 * @param {string} template - The template text to walk.
 * @returns {Array<object>} Events ordered by offset. Each carries `type`,
 *   `index` and `length`; expression-bearing types also carry `expr`.
 */
export function collectTemplateEvents(template) {
  const events = [];
  if (!template) return events;

  // 1. Loop starts and ends. The item binding is in scope for everything
  //    between them, which is why the ends are events rather than being
  //    ignored.
  //    The header is scanned and parsed by the same code the IR uses. This
  //    module used to carry a third copy of the pattern, and like the others it
  //    ended the header at the first `>` -- so `<@for r in rows.filter(x =>
  //    x.n > 2)>` reached the validator as `rows.filter(x =` and was reported
  //    as an undeclared reference to `x`. Atlas reads these events too, so the
  //    disagreement reached its edges as well.
  const forStartRegex = /<@for\b/gi;
  let match;
  while ((match = forStartRegex.exec(template)) !== null) {
    const end = scanTagEnd(template, match.index);
    if (end === -1) break;

    try {
      const parts = parseForHeader(template.slice(match.index + '<@for'.length, end).trim());
      events.push({
        type: 'loop_start',
        index: match.index,
        length: end + 1 - match.index,
        item: parts.item || (parts.destructure || []).join(', '),
        bindings: parts.item ? [parts.item] : parts.destructure || [],
        list: parts.list,
        key: parts.key,
      });
    } catch {
      // A malformed header is reported by the IR builder, with a location and
      // a reason. A second, vaguer complaint from here would not help.
    }
    forStartRegex.lastIndex = end + 1;
  }

  // The <@empty> branch renders only when the list is empty, so a static id
  // inside it is never repeated by the loop. The validator needs to know
  // where the branch starts and ends.
  const emptyStartRegex = /<@empty>/gi;
  while ((match = emptyStartRegex.exec(template)) !== null) {
    events.push({ type: 'empty_start', index: match.index, length: match[0].length });
  }

  const emptyEndRegex = /<\/ ?@empty>/gi;
  while ((match = emptyEndRegex.exec(template)) !== null) {
    events.push({ type: 'empty_end', index: match.index, length: match[0].length });
  }

  const forEndRegex = /<\/ ?@for>/gi;
  while ((match = forEndRegex.exec(template)) !== null) {
    events.push({
      type: 'loop_end',
      index: match.index,
      length: match[0].length,
    });
  }

  // 2. Interpolations.
  const interpRegex = /\{\{([\s\S]*?)\}\}/g;
  while ((match = interpRegex.exec(template)) !== null) {
    events.push({
      type: 'interpolation',
      index: match.index,
      length: match[0].length,
      expr: match[1],
    });
  }

  // 3. Conditions, attributes carrying expressions, and static ids for the
  //    duplicate-id check -- all read from the shared markup lexer.
  //
  //    This used to be `/<([a-zA-Z0-9@/!-][^>]*?)>/g` plus three attribute
  //    regexes run over whatever that matched, which is the pattern the lexer
  //    exists to replace: it ends a tag at the first `>` wherever it appears.
  //    `<div title="a > b" @click="go()">` was cut after `a >`, so the handler
  //    was invisible to both consumers of this walk -- the validator never
  //    checked its identifiers, and Atlas recorded no invocation, which made
  //    AVX_W41 claim the action it calls is never invoked.
  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open') continue;

    // `<@if …>` and `<@elseif …>` carry an expression header rather than
    // attributes, and that header was never collected at all. Nothing read the
    // condition, so a typo in it was never reported (AVX_W03 fires for an
    // interpolation but not for a condition), and state read only by a
    // condition was reported as read nowhere (AVX_W40) -- the false absence
    // claim that Atlas's own diagnostics module forbids.
    const lowerName = String(token.name || '').toLowerCase();
    if (lowerName === '@if' || lowerName === '@elseif') {
      const header = template.slice(token.nameEnd, token.attrEnd);
      if (header.trim()) {
        events.push({
          type: 'condition',
          index: token.start,
          length: token.end - token.start,
          name: lowerName.slice(1),
          expr: header,
        });
      }
      continue;
    }

    for (const attr of token.attrs || []) {
      if (attr.value === null) continue;

      if (attr.name.startsWith('@')) {
        events.push({
          type: 'event',
          index: attr.start,
          length: attr.end - attr.start,
          name: attr.name.slice(1),
          expr: attr.value,
        });
        continue;
      }

      if (
        attr.name.startsWith('data-ax-') &&
        !NON_EXPRESSION_DIRECTIVES.has(attr.name.toLowerCase())
      ) {
        events.push({
          type: 'directive',
          index: attr.start,
          length: attr.end - attr.start,
          name: attr.name,
          expr: attr.value,
        });
        continue;
      }

      // `data-props-<name>="<expression>"` passes a prop to a child component,
      // and its value is an expression in *this* template's scope. It was not
      // collected, so both consumers of this walk were blind to it: a typo in a
      // prop expression was never reported, and state read only by one was
      // reported by AVX_W40 as read nowhere in the application -- the false
      // absence claim Atlas's diagnostics module opens by forbidding.
      //
      // An interpolated value (`data-props-x="{{ y }}"`) is skipped, because
      // the interpolation pass above has already emitted an event for `{{ y }}`
      // and reading the braces as an expression here would report nonsense.
      if (attr.name.startsWith('data-props-') && attr.value.trim() && !attr.value.includes('{{')) {
        events.push({
          type: 'directive',
          index: attr.start,
          length: attr.end - attr.start,
          name: attr.name,
          expr: attr.value,
        });
        continue;
      }

      if (attr.name.toLowerCase() === 'id' && !attr.value.includes('{{')) {
        events.push({
          type: 'id_attribute',
          index: attr.start,
          length: attr.end - attr.start,
          idValue: attr.value,
        });
      }
    }
  }

  events.sort((a, b) => a.index - b.index);
  return events;
}

export default collectTemplateEvents;
