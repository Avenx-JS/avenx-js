import { CodeMask } from '../../bundler/scanner.js';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { TemplateValidationError } from '../errors/TemplateValidationError.js';

const RESERVED = new Set(['idle', 'visible', 'hover', 'click', 'interaction']);

/**
 * Reads subscription triggers, or returns null for one reactive expression.
 * Only top-level semicolons separate triggers: a quoted semicolon or a
 * statement inside a function expression keeps its single-expression meaning.
 * Single triggers retain the historical permissive duration syntax; lists
 * require literal subscriptions and reject equivalent duration duplicates.
 * @param {string} value - The authored when attribute.
 * @returns {string[]|null} Subscriptions in source order, or a condition.
 */
export function parseDeferTriggers(value) {
  const source = String(value || 'idle').trim();
  const mask = new CodeMask(source);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    if (!mask.isCode(index)) continue;
    const char = source[index];
    const entity = char === '&' && source.slice(index).match(/^&(?:[a-zA-Z][\w]*|#x[\da-fA-F]+|#\d+);/);
    if (entity) {
      index += entity[0].length - 1;
      continue;
    }
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (char === ';' && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  if (parts.length === 1) {
    const when = source.toLowerCase();
    return RESERVED.has(when) || when.startsWith('timer(') || when.endsWith('ms') ? [source] : null;
  }

  const seen = new Set();
  return parts.map((part) => {
    const when = part.toLowerCase();
    const timer = when.match(/^(?:timer\(\s*(\d+)\s*\)|(\d+)\s*ms)$/);
    const digits = timer && (timer[1] ?? timer[2]).replace(/^0+(?=\d)/, '');
    const normalized = timer ? `timer(${digits})` : when;
    const reason =
      !RESERVED.has(when) && !timer
        ? 'only literal subscription triggers may be combined'
        : seen.has(normalized)
          ? 'the same trigger is listed more than once'
          : null;
    if (reason) {
      throw new TemplateValidationError(
        AvenxErrorCodes.COMPILER_INVALID_DEFER_TRIGGERS,
        source,
        part || '(empty)',
        reason,
      );
    }
    seen.add(normalized);
    return normalized;
  });
}
