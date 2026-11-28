/**
 * @file locals.js
 * @description Pass 1 of Atlas expression resolution: collecting local bindings.
 *
 * Runs before reference scanning so that a use appearing textually ahead of its
 * declaration is still recognised as local.
 * @module lib/compiler/atlas/resolve/locals
 */

import { isIdentPart, isIdentStart, matchBracket, skipLiteral, skipSpace } from './lex.js';

/**
 * Statements that begin a binding.
 * @type {Set<string>}
 */
export const DECLARATION_KEYWORDS = new Set(['const', 'let', 'var']);

/**
 * Collects every identifier bound inside a destructuring pattern.
 *
 * Handles `{ a, b: c, d = 1, ...rest }` and `[x, , y]`, including nesting.
 * Renaming (`b: c`) binds `c`, and the key `b` is reported separately as a
 * member read of the initialiser by `scanReferences`.
 * @param {string} pattern - The pattern text, brackets included.
 * @returns {{names: string[], keys: string[], hasRest: boolean}} What it binds.
 */
export function patternBindings(pattern) {
  const names = [];
  const keys = [];
  let hasRest = false;

  const isObject = pattern.trim().startsWith('{');
  const inner = pattern.trim().slice(1, -1);

  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < inner.length; i++) {
    const literal = skipLiteral(inner, i);
    if (literal.end > i) {
      i = literal.end - 1;
      continue;
    }
    const ch = inner[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));

  for (const raw of parts) {
    let part = raw.trim();
    if (part === '') continue;

    if (part.startsWith('...')) {
      hasRest = true;
      part = part.slice(3).trim();
    }

    // Strip a default value: `a = 1`. An `=` at depth zero separates them.
    let depth2 = 0;
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (ch === '{' || ch === '[' || ch === '(') depth2++;
      else if (ch === '}' || ch === ']' || ch === ')') depth2--;
      else if (ch === '=' && depth2 === 0 && part[i + 1] !== '=' && part[i - 1] !== '=' && part[i + 1] !== '>') {
        part = part.slice(0, i);
        break;
      }
    }
    part = part.trim();
    if (part === '') continue;

    // Object shorthand vs renaming: `a` binds a; `a: b` reads a and binds b.
    if (isObject) {
      const colon = part.indexOf(':');
      if (colon !== -1) {
        const key = part.slice(0, colon).trim();
        const target = part.slice(colon + 1).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(key)) keys.push(key);
        if (target.startsWith('{') || target.startsWith('[')) {
          const nested = patternBindings(target);
          names.push(...nested.names);
        } else if (/^[A-Za-z_$][\w$]*$/.test(target)) {
          names.push(target);
        }
        continue;
      }
    }

    if (part.startsWith('{') || part.startsWith('[')) {
      const nested = patternBindings(part);
      names.push(...nested.names);
      keys.push(...nested.keys);
      continue;
    }

    if (/^[A-Za-z_$][\w$]*$/.test(part)) {
      names.push(part);
      if (isObject) keys.push(part);
    }
  }

  return { names, keys, hasRest };
}

/**
 * Collects every name the body binds locally.
 *
 * Runs before reference scanning so that a use appearing textually before its
 * declaration is still treated as local. Scoping is deliberately flat: a name
 * declared anywhere in the body shadows an application declaration everywhere
 * in it. That over-approximates shadowing, which is the safe direction —
 * Atlas loses an edge and says so, rather than inventing one.
 * @param {string} code - The expression or action body.
 * @returns {Set<string>} Locally bound names.
 */
export function collectLocals(code) {
  const locals = new Set();
  if (!code) return locals;

  let i = 0;
  while (i < code.length) {
    const literal = skipLiteral(code, i);
    if (literal.end > i) {
      for (const part of literal.interpolations) {
        for (const name of collectLocals(part.code)) locals.add(name);
      }
      i = literal.end;
      continue;
    }

    // `(a, b) => ...` — a parenthesised group is a parameter list only when an
    // arrow follows it, so the group has to be matched before it can be judged.
    if (code[i] === '(') {
      const close = matchBracket(code, i);
      if (close !== -1) {
        const after = skipSpace(code, close + 1);
        if (code[after] === '=' && code[after + 1] === '>') {
          const params = code.slice(i + 1, close);
          for (const name of patternBindings(`[${params}]`).names) locals.add(name);
        }
      }
      i++;
      continue;
    }

    if (!isIdentStart(code[i])) {
      i++;
      continue;
    }

    let j = i;
    while (j < code.length && isIdentPart(code[j])) j++;
    const word = code.slice(i, j);
    const before = i > 0 ? code[i - 1] : '';

    // A property name is not a binding: skip `.const` and friends.
    if (before === '.') {
      i = j;
      continue;
    }

    if (DECLARATION_KEYWORDS.has(word)) {
      let k = skipSpace(code, j);
      // A declaration list can bind several names: `let a = 1, b = 2`.
      while (k < code.length) {
        if (code[k] === '{' || code[k] === '[') {
          const close = matchBracket(code, k);
          if (close === -1) break;
          for (const name of patternBindings(code.slice(k, close + 1)).names) locals.add(name);
          k = close + 1;
        } else if (isIdentStart(code[k])) {
          let m = k;
          while (m < code.length && isIdentPart(code[m])) m++;
          locals.add(code.slice(k, m));
          k = m;
        } else {
          break;
        }
        // Skip the initialiser to find a following comma at depth zero.
        let depth = 0;
        while (k < code.length) {
          const lit = skipLiteral(code, k);
          if (lit.end > k) {
            k = lit.end;
            continue;
          }
          const ch = code[k];
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) break;
            depth--;
          } else if (ch === ';' && depth === 0) break;
          else if (ch === ',' && depth === 0) {
            k++;
            break;
          }
          k++;
        }
        k = skipSpace(code, k);
        if (k >= code.length || code[k] === ';' || !(isIdentStart(code[k]) || code[k] === '{' || code[k] === '[')) {
          break;
        }
      }
      i = j;
      continue;
    }

    if (word === 'function') {
      let k = skipSpace(code, j);
      if (isIdentStart(code[k])) {
        let m = k;
        while (m < code.length && isIdentPart(code[m])) m++;
        locals.add(code.slice(k, m));
        k = skipSpace(code, m);
      }
      if (code[k] === '(') {
        const close = matchBracket(code, k);
        if (close !== -1) {
          for (const name of patternBindings(`[${code.slice(k + 1, close)}]`).names) locals.add(name);
        }
      }
      i = j;
      continue;
    }

    if (word === 'catch') {
      const k = skipSpace(code, j);
      if (code[k] === '(') {
        const close = matchBracket(code, k);
        if (close !== -1) {
          for (const name of patternBindings(`[${code.slice(k + 1, close)}]`).names) locals.add(name);
        }
      }
      i = j;
      continue;
    }

    // A bare `x => ...` parameter.
    const after = skipSpace(code, j);
    if (code[after] === '=' && code[after + 1] === '>') {
      locals.add(word);
    }

    i = j;
  }

  return locals;
}
