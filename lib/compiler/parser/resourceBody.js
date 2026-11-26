/**
 * @file resourceBody.js
 * @description The executable body of a `<resource>`.
 * @module lib/compiler/parser/resourceBody
 */

import { parse } from './js/parser.js';

/**
 * Whether a source is one expression and nothing else.
 *
 * A trailing semicolon makes it a statement, so it is not one.
 * @param {string} source - The source as written.
 * @returns {boolean} True for a bare expression.
 */
function isBareExpression(source) {
  try {
    // The newline keeps a trailing line comment from swallowing the bracket.
    const program = parse(`(${source}\n)`, {
      sourceType: 'script',
      strict: true,
      allowAwaitOutsideFunction: true,
    });
    return program.body.length === 1 && program.body[0].type === 'ExpressionStatement';
  } catch {
    return false;
  }
}

/**
 * Turns the source of a resource handler into a function body.
 *
 * A bare expression is returned. Everything else is a function body already
 * and is kept as written, including a body that does not parse: it is reported
 * from its own text, not from a text with a `return` nobody wrote.
 *
 * The result is never a bare expression, so applying this twice is the same as
 * applying it once.
 * @param {string} source - The handler as written.
 * @returns {string} The function body.
 */
export function toResourceBody(source) {
  const body = source.trim();
  if (!isBareExpression(body)) return body;
  // `return` followed by a comment that spans a line break would return nothing.
  return /^\/[/*]/.test(body) ? `return (${body}\n);` : `return ${body};`;
}
