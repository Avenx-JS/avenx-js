/**
 * @file lex.js
 * @description Character-level lexing helpers for Atlas expression scanning.
 *
 * Provides identifier character predicates, whitespace skipping, string/comment/
 * template-literal skipping (with `${...}` interpolation extraction) and
 * balanced bracket matching.
 * @module lib/compiler/atlas/resolve/lex
 */

/**
 * Whether a character can start an identifier.
 * @param {string} ch - A single character.
 * @returns {boolean} True when the character may begin an identifier.
 */
export function isIdentStart(ch) {
  return !!ch && /[A-Za-z_$]/.test(ch);
}

/**
 * Whether a character can continue an identifier.
 * @param {string} ch - A single character.
 * @returns {boolean} True when the character may continue an identifier.
 */
export function isIdentPart(ch) {
  return !!ch && /[\w$]/.test(ch);
}

/**
 * Advances past whitespace.
 * @param {string} code - The source.
 * @param {number} i - Start offset.
 * @returns {number} The first non-whitespace offset at or after `i`.
 */
export function skipSpace(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  return i;
}

/**
 * Advances past a string, template literal or comment starting at `i`.
 *
 * Returns `i` unchanged when nothing at that position opens one, which lets
 * the callers use it as an unconditional first step in their loops.
 * @param {string} code - The source.
 * @param {number} i - Start offset.
 * @returns {{end: number, interpolations: Array<{code: string, offset: number}>}}
 *   Where the construct ends, plus any `${...}` bodies found inside a template
 *   literal so the caller can scan them too.
 */
export function skipLiteral(code, i) {
  const interpolations = [];
  const ch = code[i];

  if (ch === '/' && code[i + 1] === '/') {
    i += 2;
    while (i < code.length && code[i] !== '\n') i++;
    return { end: i, interpolations };
  }

  if (ch === '/' && code[i + 1] === '*') {
    i += 2;
    while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
    return { end: Math.min(i + 2, code.length), interpolations };
  }

  if (ch === '"' || ch === "'") {
    const quote = ch;
    i++;
    while (i < code.length && code[i] !== quote) {
      if (code[i] === '\\') i++;
      i++;
    }
    return { end: Math.min(i + 1, code.length), interpolations };
  }

  if (ch === '`') {
    i++;
    while (i < code.length && code[i] !== '`') {
      if (code[i] === '\\') {
        i += 2;
        continue;
      }
      if (code[i] === '$' && code[i + 1] === '{') {
        let depth = 1;
        let j = i + 2;
        while (j < code.length && depth > 0) {
          if (code[j] === '{') depth++;
          else if (code[j] === '}') depth--;
          if (depth > 0) j++;
        }
        interpolations.push({ code: code.slice(i + 2, j), offset: i + 2 });
        i = j;
        continue;
      }
      i++;
    }
    return { end: Math.min(i + 1, code.length), interpolations };
  }

  return { end: i, interpolations };
}

/**
 * Finds the offset of the bracket closing the one at `open`.
 * @param {string} code - The source.
 * @param {number} open - Offset of the opening bracket.
 * @returns {number} Offset of the matching close, or -1 when unbalanced.
 */
export function matchBracket(code, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const closer = pairs[code[open]];
  if (!closer) return -1;
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const literal = skipLiteral(code, i);
    if (literal.end > i) {
      i = literal.end;
      continue;
    }
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}
