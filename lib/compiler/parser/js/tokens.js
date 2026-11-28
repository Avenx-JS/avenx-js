/**
 * @file tokens.js
 * @description Token plumbing, error reporting, and ASI helpers for the JavaScript parser.
 * @module lib/compiler/parser/js/tokens
 */

/**
 * Raises a positioned error.
 * @param {object} p - The parser instance.
 * @param {string} message - What went wrong.
 * @param {number} [pos] - Where.
 * @throws {import('./tokenizer.js').JsParseError} Always.
 */
export function raise(p, message, pos = p.tok.start) {
  p.tz.raise(message, pos);
}

/**
 * Reports the current token as unexpected.
 * @param {object} p - The parser instance.
 * @throws {import('./tokenizer.js').JsParseError} Always.
 */
export function unexpected(p) {
  p.raise('Unexpected token');
}

/**
 * Advances to the next token.
 * @param {object} p - The parser instance.
 */
export function next(p) {
  p.tok = p.tz.nextToken();
}

/**
 * @param {object} p - The parser instance.
 * @param {string} value - A punctuator.
 * @returns {boolean} Whether the current token is it.
 */
export function isPunct(p, value) {
  return p.tok.type === 'punct' && p.tok.value === value;
}

/**
 * @param {object} p - The parser instance.
 * @param {string} value - A word.
 * @returns {boolean} Whether the current token is that identifier or keyword.
 */
export function isName(p, value) {
  return p.tok.type === 'name' && p.tok.value === value;
}

/**
 * Consumes the current token when it is the given punctuator.
 * @param {object} p - The parser instance.
 * @param {string} value - A punctuator.
 * @returns {boolean} Whether it was consumed.
 */
export function eatPunct(p, value) {
  if (!p.isPunct(value)) return false;
  p.next();
  return true;
}

/**
 * Consumes the current token when it is the given word.
 * @param {object} p - The parser instance.
 * @param {string} value - A word.
 * @returns {boolean} Whether it was consumed.
 */
export function eatName(p, value) {
  if (!p.isName(value)) return false;
  p.next();
  return true;
}

/**
 * Consumes the given punctuator or fails.
 * @param {object} p - The parser instance.
 * @param {string} value - A punctuator.
 */
export function expectPunct(p, value) {
  if (!p.eatPunct(value)) p.raise(`Expected '${value}'`);
}

/**
 * Consumes the given word or fails.
 * @param {object} p - The parser instance.
 * @param {string} value - A word.
 */
export function expectName(p, value) {
  if (!p.eatName(value)) p.raise(`Expected '${value}'`);
}

/**
 * @param {object} p - The parser instance.
 * @returns {boolean} Whether a semicolon may be inserted here.
 */
export function canInsertSemicolon(p) {
  return p.tok.type === 'eof' || p.isPunct('}') || p.tok.nlBefore;
}

/**
 * Consumes a statement-ending semicolon, real or inserted.
 * @param {object} p - The parser instance.
 */
export function semicolon(p) {
  if (p.eatPunct(';')) return;
  if (!p.canInsertSemicolon()) p.raise('Expected a semicolon');
}

/**
 * Peeks at the token after the current one.
 * @param {object} p - The parser instance.
 * @returns {import('./tokenizer.js').Token} The next token.
 */
export function peek(p) {
  const state = p.tz.save();
  const token = p.tz.nextToken();
  p.tz.restore(state);
  return token;
}
