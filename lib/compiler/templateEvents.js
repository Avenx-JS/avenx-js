/**
 * @file templateEvents.js
 * @description One walk over a template, shared by everything that needs it.
 * @module lib/compiler/templateEvents
 */

import { scanTagEnd } from './parser/htmlTree.js';
import { parseForHeader } from './ir/build.js';

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

  // 3. Attributes carrying expressions, plus static ids for the duplicate-id
  //    check.
  const tagRegex = /<([a-zA-Z0-9@/!-][^>]*?)>/g;
  while ((match = tagRegex.exec(template)) !== null) {
    const tagIndex = match.index;

    const attrRegex = /@([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match[0])) !== null) {
      events.push({
        type: 'event',
        index: tagIndex + attrMatch.index,
        length: attrMatch[0].length,
        name: attrMatch[1],
        expr: attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3],
      });
    }

    const dirRegex = /\b(data-ax-[a-zA-Z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let dirMatch;
    while ((dirMatch = dirRegex.exec(match[0])) !== null) {
      events.push({
        type: 'directive',
        index: tagIndex + dirMatch.index,
        length: dirMatch[0].length,
        name: dirMatch[1],
        expr: dirMatch[2] !== undefined ? dirMatch[2] : dirMatch[3],
      });
    }

    const idAttrRegex = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let idMatch;
    while ((idMatch = idAttrRegex.exec(match[0])) !== null) {
      const idVal = idMatch[1] !== undefined ? idMatch[1] : idMatch[2];
      if (idVal && !idVal.includes('{{')) {
        events.push({
          type: 'id_attribute',
          index: tagIndex + idMatch.index,
          length: idMatch[0].length,
          idValue: idVal,
        });
      }
    }
  }

  events.sort((a, b) => a.index - b.index);
  return events;
}

export default collectTemplateEvents;
