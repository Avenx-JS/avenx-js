/**
 * @file compile.js
 * @description Turns expression source into a reusable compiled accessor.
 *
 * One parse per unique expression, cached, then every evaluation walks the AST.
 * That is the same cost profile the previous implementation had — it compiled a
 * `Function` once per unique source and cached that — minus the `eval`.
 *
 * ## The fallback, and why it is visible
 *
 * The parser covers the expression language templates use, not all of
 * ECMAScript: statements, `async`/`await`, destructuring and regular-expression
 * literals are out of scope, and action bodies are arbitrary JavaScript.
 * Anything the parser cannot read is handed to the legacy evaluator, which
 * still uses `new Function`.
 *
 * That fallback is recorded rather than silent. {@link getFallbackReport} lists
 * every expression that took it, so "does this application still need
 * `unsafe-eval`?" has an answer that comes from the code rather than from a
 * claim — and `avenx check` can print it. A framework that quietly degraded
 * here would be making exactly the kind of promise this work exists to stop
 * making.
 * @module lib/core/expression/compile
 */

import { parseExpression, parseExpressionProgram, ExpressionParseError } from './parser.js';
import { evaluate } from './evaluator.js';
import { LruCache } from '../utils/LruCache.js';

/**
 * Compiled ASTs by source text.
 * @type {LruCache}
 */
let astCache = new LruCache(1000);

/**
 * Sources the parser could not read, and why.
 * @type {Map<string, string>}
 */
const fallbacks = new Map();

/**
 * A sentinel stored for sources known to be unparseable, so a failing
 * expression is not re-parsed on every evaluation.
 * @type {object}
 */
const UNPARSEABLE = { unparseable: true };

/**
 * Sets the compiled-expression cache capacity.
 * @param {number} capacity - Positive integer limit.
 */
export function setExpressionCacheCapacity(capacity) {
  if (typeof capacity !== 'number' || capacity <= 0 || !Number.isInteger(capacity)) {
    throw new Error('Expression cache capacity must be a positive integer');
  }
  const previous = astCache;
  astCache = new LruCache(capacity);
  for (const [key, value] of previous.cache.entries()) {
    if (astCache.size >= capacity) break;
    astCache.set(key, value);
  }
}

/**
 * Empties the compiled-expression cache and the fallback report.
 */
export function clearExpressionCache() {
  astCache.clear();
  fallbacks.clear();
}

/**
 * Current cache occupancy, for diagnostics and tests.
 * @returns {{size: number, fallbacks: number}} Cache statistics.
 */
export function getExpressionCacheStats() {
  return { size: astCache.size, fallbacks: fallbacks.size };
}

/**
 * Every expression that could not be parsed, with the reason.
 *
 * An application whose report is empty evaluates entirely through the AST
 * evaluator and needs no `'unsafe-eval'` for its expressions.
 * @returns {Array<{source: string, reason: string}>} The fallback list.
 */
export function getFallbackReport() {
  return [...fallbacks.entries()].map(([source, reason]) => ({ source, reason }));
}

/**
 * Parses an expression, returning null when it is outside the language.
 * @param {string} source - The expression source.
 * @returns {object|null} The AST, or null when it cannot be parsed.
 */
export function compileExpression(source) {
  const cached = astCache.get(source);
  if (cached === UNPARSEABLE) {
    return null;
  }
  if (cached) {
    return cached;
  }

  try {
    const ast = parseExpression(source);
    astCache.set(source, ast);
    return ast;
  } catch (error) {
    if (error instanceof ExpressionParseError) {
      astCache.set(source, UNPARSEABLE);
      fallbacks.set(source, error.message);
      return null;
    }
    throw error;
  }
}

/**
 * Parses a statement body as a run of expressions, or returns null.
 * @param {string} source - The statement source.
 * @returns {object|null} A Program AST, or null when it is not expression-only.
 */
export function compileStatements(source) {
  const key = `stmt\u0000${source}`;
  const cached = astCache.get(key);
  if (cached === UNPARSEABLE) {
    return null;
  }
  if (cached) {
    return cached;
  }

  try {
    const ast = parseExpressionProgram(source);
    astCache.set(key, ast);
    return ast;
  } catch (error) {
    if (error instanceof ExpressionParseError) {
      astCache.set(key, UNPARSEABLE);
      fallbacks.set(source, error.message);
      return null;
    }
    throw error;
  }
}

/**
 * Why an expression could not be parsed.
 * @param {string} source - The expression source.
 * @returns {string} The parser's reason, or a generic message.
 */
export function describeParseFailure(source) {
  if (fallbacks.has(source)) {
    return fallbacks.get(source);
  }
  try {
    parseExpression(source);
    return 'the expression parsed on a second attempt';
  } catch (error) {
    return error.message;
  }
}

/**
 * Whether an expression can be evaluated without `new Function`.
 * @param {string} source - The expression source.
 * @returns {boolean} True when the AST evaluator can handle it.
 */
export function isCompilable(source) {
  return compileExpression(source) !== null;
}

/**
 * Evaluates an expression against a scope.
 * @param {string} source - The expression source.
 * @param {object} scope - The evaluation scope.
 * @returns {{handled: boolean, value: any}} Whether the AST evaluator ran, and
 *   the value it produced. `handled: false` means the caller should fall back.
 */
export function runExpression(source, scope) {
  const ast = compileExpression(source);
  if (!ast) {
    return { handled: false, value: undefined };
  }
  return { handled: true, value: evaluate(ast, scope) };
}
