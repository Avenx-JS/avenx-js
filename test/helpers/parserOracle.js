/**
 * @file parserOracle.js
 * @description Compares the compiler's own JavaScript parser against acorn.
 *
 * The compiler parses JavaScript with {@link ../../lib/compiler/parser/js/parser.js},
 * which the project owns, so that the published package has no runtime
 * dependency. A parser the project owns needs an independent check that it
 * reads the language the same way the ecosystem does, and acorn is that check:
 * a development dependency used as a differential-testing oracle, never on a
 * build path.
 *
 * {@link compareAst} is deliberately strict in both directions. Every property
 * either parser puts on a node must be present on the other and must be equal,
 * and every node's `start` and `end` must agree, because the action compiler
 * rewrites source by offset — a range that is off by one silently corrupts
 * generated code rather than failing a parse.
 * @module test/helpers/parserOracle
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as acornParse } from 'acorn';
import { parse as ownParse } from '../../lib/compiler/parser/js/parser.js';

/**
 * Properties compared separately or carried only by one parser's plumbing.
 * @type {Set<string>}
 */
const IGNORED_KEYS = new Set(['loc', 'range', 'sourceFile', 'start', 'end']);

/**
 * Deep-compares two ASTs, returning the first difference found.
 * @param {any} expected - The acorn node.
 * @param {any} actual - The node from the compiler's parser.
 * @param {string} [where] - Path for the message.
 * @returns {string|null} A description of the difference, or null when equal.
 */
export function compareAst(expected, actual, where = '$') {
  if (expected === actual) return null;

  if (typeof expected === 'bigint' || typeof actual === 'bigint') {
    return String(expected) === String(actual) ? null : `${where}: ${expected} vs ${actual}`;
  }
  if (typeof expected !== typeof actual) {
    return `${where}: ${typeof expected} vs ${typeof actual}`;
  }
  if (expected === null || actual === null) {
    return `${where}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`;
  }
  if (typeof expected !== 'object') {
    if (typeof expected === 'number' && Number.isNaN(expected) && Number.isNaN(actual)) return null;
    return `${where}: ${String(expected)} vs ${String(actual)}`;
  }
  if (expected instanceof RegExp || actual instanceof RegExp) {
    return String(expected) === String(actual) ? null : `${where}: ${String(expected)} vs ${String(actual)}`;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    return `${where}: array vs non-array`;
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) return `${where}: ${expected.length} items vs ${actual.length}`;
    for (let i = 0; i < expected.length; i += 1) {
      const difference = compareAst(expected[i], actual[i], `${where}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }

  if (expected.type !== undefined || actual.type !== undefined) {
    if (expected.type !== actual.type) return `${where}: node ${expected.type} vs ${actual.type}`;
    if (expected.start !== actual.start || expected.end !== actual.end) {
      return `${where} (${expected.type}): range ${expected.start}-${expected.end} vs ${actual.start}-${actual.end}`;
    }
  }

  const keys = new Set(
    [...Object.keys(expected), ...Object.keys(actual)].filter((key) => !IGNORED_KEYS.has(key)),
  );
  for (const key of keys) {
    if (!(key in expected)) return `${where}.${key}: only the compiler's parser has it (${expected.type})`;
    if (!(key in actual)) return `${where}.${key}: only acorn has it (${expected.type})`;
    const difference = compareAst(expected[key], actual[key], `${where}.${key}`);
    if (difference) return difference;
  }
  return null;
}

/**
 * Parses one source with both parsers and compares the result.
 *
 * Agreement on a refusal counts: a source acorn rejects must be rejected here
 * too, since accepting invalid syntax is the failure mode the compile-or-refuse
 * rule exists to prevent.
 * @param {string} source - The source text.
 * @param {object} [options] - Parse options passed to both.
 * @returns {string|null} A description of the disagreement, or null.
 */
export function differential(source, options = {}) {
  const acornOptions = { ecmaVersion: 'latest', ...options };
  let expected = null;
  let expectedError = null;
  try {
    expected = acornParse(source, acornOptions);
  } catch (error) {
    expectedError = error;
  }

  let actual = null;
  let actualError = null;
  try {
    actual = ownParse(source, options);
  } catch (error) {
    actualError = error;
  }

  if (expectedError && actualError) return null;
  if (expectedError) return `acorn rejects it (${expectedError.message}) but the compiler's parser accepts it`;
  if (actualError) return `the compiler's parser rejects it (${actualError.message}) but acorn accepts it`;
  return compareAst(expected, actual);
}

/**
 * Lists every JavaScript file beneath a directory.
 * @param {string} dir - Where to start.
 * @param {object} [options] - `skip` names directories to leave out.
 * @returns {string[]} Absolute file paths.
 */
export function listJsFiles(dir, options = {}) {
  const skip = new Set(options.skip || ['node_modules', '.git', 'coverage', 'dist', 'dist-dev']);
  /** @type {string[]} */
  const out = [];
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
    }
  };
  walk(dir);
  return out;
}
