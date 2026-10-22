/**
 * @file slots.js
 * @description Declared and addressed slot names for AVX_W62.
 *
 * Avenx projects content by matching a caller's `slot="…"` names against the
 * callee's `<slot>` / `<slot name="…">` outlets. A typo or a renamed slot
 * drops the content with no diagnostic; these helpers give Atlas both halves
 * of that comparison when it records a `renders` edge.
 * @module lib/compiler/atlas/slots
 */

import { findTagEnd } from '../../core/utils/markupLexer.js';
import { DEFAULT_VOID_TAGS } from '../parser/htmlTree.js';
import { getClosestKey } from '../../config.js';

/**
 * HTML void elements that never take children.
 * @type {Set<string>}
 */
const VOID_TAGS = new Set(DEFAULT_VOID_TAGS);

/**
 * Whether a slot name value is decided at run time.
 * @param {string} value - A `slot` or `name` attribute value.
 * @returns {boolean} True when the value is interpolated or empty after trim.
 */
function isDynamicName(value) {
  if (value == null) return true;
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  return trimmed.includes('{{') || trimmed.includes('{%');
}

/**
 * Reads a static attribute value from a tag's attribute text.
 * @param {string} attrText - Text between the tag name and `>`.
 * @param {string} attrName - Attribute name (`slot`, `name`, …).
 * @returns {{present: boolean, value: string|null, dynamic: boolean}}
 */
function readAttr(attrText, attrName) {
  const re = new RegExp(`(?:^|\\s)(:?)(${attrName})(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+)))?`, 'i');
  const match = re.exec(attrText);
  if (!match) return { present: false, value: null, dynamic: false };

  if (match[1] === ':') {
    return { present: true, value: null, dynamic: true };
  }

  const value = match[3] ?? match[4] ?? match[5];
  if (value === undefined) {
    return { present: true, value: null, dynamic: false };
  }
  if (isDynamicName(value)) {
    return { present: true, value: null, dynamic: true };
  }
  return { present: true, value, dynamic: false };
}

/**
 * Collects slot outlets a component template declares.
 *
 * `<slot>` and `<slot name="x">` count; a dynamic `name` marks the component
 * so callers cannot be checked against an incomplete set.
 * @param {string} content - Component or page source.
 * @returns {{slots: string[], dynamic: boolean}} Declared names and dynamism.
 */
export function collectDeclaredSlots(content) {
  const slots = new Set();
  let dynamic = false;
  if (!content) return { slots: [], dynamic: false };

  const re = /<slot\b([^>]*?)(\/)?>/gi;
  let match;
  while ((match = re.exec(content)) !== null) {
    const attrs = match[1] || '';
    const name = readAttr(attrs, 'name');
    if (name.dynamic) {
      dynamic = true;
      continue;
    }
    if (name.present && name.value) {
      slots.add(name.value);
    } else {
      slots.add('default');
    }
  }

  return { slots: [...slots].sort(), dynamic };
}

/**
 * Finds the inner HTML of an element that starts at `openIndex`.
 * @param {string} source - Full template source (preferably masked).
 * @param {string} tagName - Element name as written (case-sensitive for components).
 * @param {number} openIndex - Index of the opening `<`.
 * @returns {{inner: string, openEnd: number, closeStart: number}|null}
 */
export function findElementInner(source, tagName, openIndex) {
  const openEnd = findTagEnd(source, openIndex);
  if (openEnd === -1) return null;

  const openTag = source.slice(openIndex, openEnd + 1);
  if (/\/>\s*$/.test(openTag) || VOID_TAGS.has(tagName.toLowerCase())) {
    return { inner: '', openEnd, closeStart: openEnd + 1 };
  }

  let searchIndex = openEnd + 1;
  let depth = 1;
  const openRe = new RegExp(`^<${tagName}\\b`);
  const closeRe = new RegExp(`^</\\s*${tagName}\\s*>`);

  while (searchIndex < source.length) {
    if (source.startsWith('<!--', searchIndex)) {
      const end = source.indexOf('-->', searchIndex + 4);
      searchIndex = end === -1 ? source.length : end + 3;
      continue;
    }

    const slice = source.slice(searchIndex);
    const nextClose = slice.match(closeRe);
    const nextOpen = slice.match(openRe);

    if (nextClose) {
      depth -= 1;
      if (depth === 0) {
        return {
          inner: source.slice(openEnd + 1, searchIndex),
          openEnd,
          closeStart: searchIndex,
        };
      }
      searchIndex += nextClose[0].length;
      continue;
    }

    if (nextOpen) {
      const nestedEnd = findTagEnd(source, searchIndex);
      if (nestedEnd === -1) break;
      const nestedOpen = source.slice(searchIndex, nestedEnd + 1);
      if (!/\/>\s*$/.test(nestedOpen) && !VOID_TAGS.has(tagName.toLowerCase())) {
        depth += 1;
      }
      searchIndex = nestedEnd + 1;
      continue;
    }

    searchIndex += 1;
  }

  // Unclosed tag: treat as empty body rather than inventing content.
  return { inner: '', openEnd, closeStart: openEnd + 1 };
}

/**
 * Advances past one top-level element starting at `start`.
 * @param {string} source - Markup.
 * @param {number} start - Index of `<`.
 * @returns {{end: number, attrText: string, tagName: string}|null}
 */
function readTopLevelElement(source, start) {
  const openEnd = findTagEnd(source, start);
  if (openEnd === -1) return null;

  const openTag = source.slice(start, openEnd + 1);
  const nameMatch = /^<([A-Za-z@][\w:-]*)/.exec(openTag);
  if (!nameMatch) return null;
  const tagName = nameMatch[1];
  const attrText = openTag.slice(1 + tagName.length, openTag.length - (/\/>\s*$/.test(openTag) ? 2 : 1));

  if (/\/>\s*$/.test(openTag) || VOID_TAGS.has(tagName.toLowerCase())) {
    return { end: openEnd + 1, attrText, tagName };
  }

  const range = findElementInner(source, tagName, start);
  if (!range) return { end: openEnd + 1, attrText, tagName };

  const closeMatch = source.slice(range.closeStart).match(new RegExp(`^</\\s*${tagName}\\s*>`));
  const closeLen = closeMatch ? closeMatch[0].length : 0;
  return { end: range.closeStart + closeLen, attrText, tagName };
}

/**
 * Collects slot names addressed by the direct children of a component call.
 *
 * Matches runtime grouping: only direct children carry `slot`, and children
 * without a `slot` attribute address `default`.
 * @param {string} inner - Markup between the component's open and close tags.
 * @returns {{slots: string[], dynamic: boolean}} Addressed names and dynamism.
 */
export function collectAddressedSlots(inner) {
  const slots = new Set();
  let dynamic = false;
  if (!inner) return { slots: [], dynamic: false };

  let i = 0;
  const source = inner;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }

    if (ch !== '<') {
      const next = source.indexOf('<', i);
      const text = source.slice(i, next === -1 ? source.length : next);
      if (text.trim()) slots.add('default');
      i = next === -1 ? source.length : next;
      continue;
    }

    if (source.startsWith('</', i) || source.startsWith('<!', i)) {
      const gt = source.indexOf('>', i);
      i = gt === -1 ? source.length : gt + 1;
      continue;
    }

    const element = readTopLevelElement(source, i);
    if (!element) {
      i += 1;
      continue;
    }

    const slot = readAttr(element.attrText, 'slot');
    if (slot.dynamic) {
      dynamic = true;
    } else if (slot.present && slot.value) {
      slots.add(slot.value);
    } else {
      slots.add('default');
    }
    i = element.end;
  }

  return { slots: [...slots].sort(), dynamic };
}

/**
 * Names a caller addresses that the callee does not declare.
 * @param {Iterable<string>} callerSlots - Slots the caller fills.
 * @param {Iterable<string>} calleeSlots - Slots the component declares.
 * @returns {Array<{slot: string, suggestion: string|null}>} Undeclared names.
 */
export function findUndeclaredSlotNames(callerSlots, calleeSlots) {
  const declared = calleeSlots instanceof Set ? calleeSlots : new Set(calleeSlots);
  const allowed = [...declared];
  const findings = [];
  for (const slot of callerSlots) {
    if (!declared.has(slot)) {
      findings.push({
        slot,
        suggestion: getClosestKey(slot, allowed),
      });
    }
  }
  return findings;
}

export default {
  collectDeclaredSlots,
  collectAddressedSlots,
  findElementInner,
  findUndeclaredSlotNames,
};
