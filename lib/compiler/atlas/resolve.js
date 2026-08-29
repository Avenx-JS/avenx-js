/**
 * @file resolve.js
 * @description Turns Avenx expression source text into resolved semantic
 * references.
 *
 * This is the part of Atlas that cannot be had for free. The compiler keeps
 * template expressions, computed expressions and action bodies as **source
 * text** all the way to evaluation, which is exactly what makes Atlas possible
 * — and it means Atlas has to read that text itself.
 *
 * Two passes, deliberately:
 *
 * 1. {@link collectLocals} finds every name the body binds itself — `const`,
 *    `let`, `var`, function and arrow parameters, `catch` bindings,
 *    destructuring patterns. It runs first so that a reference appearing
 *    ahead of the declaration that shadows it is still recognised as local.
 * 2. {@link scanReferences} walks the text and records every member chain,
 *    what was done to it (read, write, invoke) and where it sat in the source.
 *
 * {@link resolveReference} then maps a chain onto a declaration in scope.
 *
 * ## What this is not
 *
 * It is not a JavaScript parser, and an action body is arbitrary JavaScript.
 * The scanner is string- and comment-aware and understands member access,
 * optional chaining, computed members, calls, assignment and destructuring —
 * which covers the shapes Avenx components actually contain. Everything it
 * cannot follow is reported as an {@link UnresolvedReason}, never dropped and
 * never guessed. The house rule for this file is that a missing edge must be
 * visible somewhere; an uncertain answer beats a confidently wrong one.
 * @module lib/compiler/atlas/resolve
 */

import { Confidence, UnresolvedReason } from './AppModel.js';

/**
 * Identifiers that resolve to something outside the application's own model.
 *
 * The first group mirrors the sandbox's allowlist in
 * `lib/core/security/sandbox.js` — an expression may legitimately name these
 * and they are not application state. The second group is the scope the
 * runtime injects around a template expression or an action body.
 * @type {Set<string>}
 */
export const AMBIENT_ROOTS = new Set([
  // Sandbox-allowed globals.
  'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Error',
  'Map', 'Set', 'Promise', 'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'undefined', 'NaN', 'Infinity',
  // Language keywords the scanner may still hand back as identifiers.
  'true', 'false', 'null', 'typeof', 'instanceof', 'new', 'delete', 'void', 'in', 'of',
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'try', 'catch', 'finally', 'throw', 'await', 'async', 'function', 'class', 'extends',
  'let', 'const', 'var', 'yield', 'this', 'super', 'default', 'debugger', 'with', 'static',
  // Runtime-injected scope that is not application state.
  'props', 'styles', 'event', 'args', 'arguments', 'window', 'document', 'fetch',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'localStorage',
  'sessionStorage', 'location', 'navigator', 'history',
]);

/**
 * Statements that begin a binding.
 * @type {Set<string>}
 */
const DECLARATION_KEYWORDS = new Set(['const', 'let', 'var']);

/**
 * Methods that mutate the receiver rather than returning a new value.
 *
 * `cart.items.push(item)` is a write to `cart.items`, and modelling it as a
 * read would make `avenx impact cart.items` miss the code that changes it —
 * the single most important question the command answers.
 * @type {Set<string>}
 */
/**
 * Members every bridge exposes as protocol rather than declaring.
 *
 * `declaredMembers()` in BridgeParser appends the same three, so accessing one
 * is not an unknown member.
 * @type {Set<string>}
 */
export const BRIDGE_BUILTINS = new Set(['on', 'emit', '$dispose', '$name']);

/**
 * Collection methods that yield one element rather than another collection.
 *
 * `const item = this.items.find(...)` binds an element of `items`, so a later
 * `item.qty = n` is a write to `items`. Which element is not knowable, which
 * is why an alias resolved this way is only ever `possible`.
 * @type {Set<string>}
 */
export const ELEMENT_METHODS = new Set(['find', 'at', 'pop', 'shift']);

/**
 * Collection methods that yield another collection of the same elements.
 * @type {Set<string>}
 */
export const COLLECTION_METHODS = new Set(['filter', 'slice', 'concat', 'sort', 'reverse', 'flat']);

/**
 * Methods that mutate the receiver rather than returning a new value.
 *
 * `cart.items.push(item)` is a write to `cart.items`, and modelling it as a
 * read would make `avenx impact cart.items` miss the code that changes it —
 * the single most important question the command answers.
 * @type {Set<string>}
 */
export const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'add', 'clear', 'delete', 'set',
]);

/**
 * Assignment operators, longest first so `??=` is matched before `?`.
 * @type {string[]}
 */
const ASSIGN_OPERATORS = ['>>>=', '<<=', '>>=', '**=', '&&=', '||=', '??=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='];

/**
 * Whether a character can start an identifier.
 * @param {string} ch - A single character.
 * @returns {boolean} True when the character may begin an identifier.
 */
function isIdentStart(ch) {
  return !!ch && /[A-Za-z_$]/.test(ch);
}

/**
 * Whether a character can continue an identifier.
 * @param {string} ch - A single character.
 * @returns {boolean} True when the character may continue an identifier.
 */
function isIdentPart(ch) {
  return !!ch && /[\w$]/.test(ch);
}

/**
 * Advances past whitespace.
 * @param {string} code - The source.
 * @param {number} i - Start offset.
 * @returns {number} The first non-whitespace offset at or after `i`.
 */
function skipSpace(code, i) {
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
function matchBracket(code, open) {
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

/**
 * Collects every identifier bound inside a destructuring pattern.
 *
 * Handles `{ a, b: c, d = 1, ...rest }` and `[x, , y]`, including nesting.
 * Renaming (`b: c`) binds `c`, and the key `b` is reported separately as a
 * member read of the initialiser by {@link scanReferences}.
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

/**
 * Reads a member chain that begins at `i`.
 * @param {string} code - The source.
 * @param {number} i - Offset of the root identifier.
 * @returns {object} The chain: root, segments, flags, extent and any nested
 *   expressions found inside computed members.
 */
function readChain(code, i) {
  let j = i;
  while (j < code.length && isIdentPart(code[j])) j++;
  const root = code.slice(i, j);

  const segments = [];
  const nested = [];
  let dynamic = false;
  let optional = false;

  for (;;) {
    const k = skipSpace(code, j);

    if (code[k] === '?' && code[k + 1] === '.' && code[k + 2] !== '(') {
      optional = true;
      const m = skipSpace(code, k + 2);
      if (code[m] === '[') {
        const close = matchBracket(code, m);
        if (close === -1) break;
        const inner = code.slice(m + 1, close);
        const literalKey = staticKey(inner);
        if (literalKey !== null) {
          segments.push(literalKey);
        } else {
          segments.push('[]');
          if (!isNumericIndex(inner)) {
            dynamic = true;
            nested.push({ code: inner, offset: m + 1 });
          }
        }
        j = close + 1;
        continue;
      }
      if (!isIdentStart(code[m])) break;
      let n = m;
      while (n < code.length && isIdentPart(code[n])) n++;
      segments.push(code.slice(m, n));
      j = n;
      continue;
    }

    if (code[k] === '.') {
      const m = skipSpace(code, k + 1);
      if (!isIdentStart(code[m])) break;
      let n = m;
      while (n < code.length && isIdentPart(code[n])) n++;
      segments.push(code.slice(m, n));
      j = n;
      continue;
    }

    if (code[k] === '[') {
      const close = matchBracket(code, k);
      if (close === -1) break;
      const inner = code.slice(k + 1, close);
      const literalKey = staticKey(inner);
      if (literalKey !== null) {
        segments.push(literalKey);
      } else {
        segments.push('[]');
        if (!isNumericIndex(inner)) {
          dynamic = true;
          nested.push({ code: inner, offset: k + 1 });
        }
      }
      j = close + 1;
      continue;
    }

    break;
  }

  return { root, segments, dynamic, optional, start: i, end: j, nested };
}

/**
 * Reads a computed member key when it is a literal.
 *
 * `items['qty']` names a member as precisely as `items.qty` does, so it should
 * not be downgraded to a dynamic access. A numeric index is an element, not a
 * member, and is normalised to `[]` alongside genuinely computed keys.
 * @param {string} inner - The text between the brackets.
 * @returns {string|null} The member name, or null when the key is not a literal.
 */
function staticKey(inner) {
  const trimmed = inner.trim();
  const match = trimmed.match(/^(['"])((?:\\.|(?!\1)[^\\])*)\1$/);
  if (!match) return null;
  if (!/^[A-Za-z_$][\w$]*$/.test(match[2])) return null;
  return match[2];
}

/**
 * Whether a computed member is a literal element index.
 *
 * `items[0]` is fully determined, so it becomes an `[]` path segment without
 * being reported as unresolved: Atlas models declared symbols and does not
 * model individual elements, and there is nothing here it failed to follow.
 * @param {string} inner - The text between the brackets.
 * @returns {boolean} True for a numeric literal index.
 */
function isNumericIndex(inner) {
  return /^\s*\d+\s*$/.test(inner);
}

/**
 * Detects an assignment or update immediately following a chain.
 * @param {string} code - The source.
 * @param {number} end - Offset just past the chain.
 * @returns {{usage: string, alsoReads: boolean}|null} What was done to the chain.
 */
function readUsage(code, end) {
  const k = skipSpace(code, end);
  if (k >= code.length) return null;

  if (code[k] === '(') {
    return { usage: 'invoke', alsoReads: false };
  }

  if ((code[k] === '+' && code[k + 1] === '+') || (code[k] === '-' && code[k + 1] === '-')) {
    return { usage: 'write', alsoReads: true };
  }

  for (const op of ASSIGN_OPERATORS) {
    if (code.startsWith(op, k)) {
      return { usage: 'write', alsoReads: true };
    }
  }

  if (code[k] === '=' && code[k + 1] !== '=' && code[k + 1] !== '>') {
    return { usage: 'write', alsoReads: false };
  }

  return null;
}

/**
 * Scans expression source for member chains and what is done to them.
 * @param {string} code - The expression or action body.
 * @param {object} [options] - Scan options.
 * @param {Set<string>} [options.locals] - Names bound locally; computed when omitted.
 * @param {number} [options.base] - Offset of `code` within its containing file.
 * @returns {{references: object[], locals: Set<string>, aliases: object[], notes: object[]}}
 *   Every chain found, the local bindings, destructuring aliases and syntactic
 *   observations worth reporting (a spread, for instance).
 */
export function scanReferences(code, options = {}) {
  const locals = options.locals || collectLocals(code);
  const base = options.base || 0;
  /** @type {object[]} */
  const references = [];
  /** @type {object[]} */
  const aliases = [];
  /** @type {object[]} */
  const notes = [];

  if (!code) {
    return { references, locals, aliases, notes };
  }

  /** @type {object[]} */
  const localAliases = [];

  let i = 0;
  let pendingPattern = null;
  let pendingAlias = null;

  while (i < code.length) {
    const literal = skipLiteral(code, i);
    if (literal.end > i) {
      for (const part of literal.interpolations) {
        const sub = scanReferences(part.code, { locals, base: base + part.offset });
        references.push(...sub.references);
        aliases.push(...sub.aliases);
        notes.push(...sub.notes);
      }
      i = literal.end;
      continue;
    }

    // `const { a, b } = someChain` — remember the pattern so the chain that
    // follows can be recorded as a read of each destructured member.
    if (code[i] === '{' || code[i] === '[') {
      const close = matchBracket(code, i);
      if (close !== -1) {
        const after = skipSpace(code, close + 1);
        if (code[after] === '=' && code[after + 1] !== '=' && code[after + 1] !== '>') {
          pendingPattern = patternBindings(code.slice(i, close + 1));
          if (pendingPattern.hasRest) {
            notes.push({ reason: UnresolvedReason.SPREAD, expr: code.slice(i, close + 1).trim(), index: base + i });
          }
          i = after + 1;
          continue;
        }
      }
    }

    if (code[i] === '.' && code[i + 1] === '.' && code[i + 2] === '.') {
      notes.push({ reason: UnresolvedReason.SPREAD, expr: '...', index: base + i });
      i += 3;
      continue;
    }

    if (!isIdentStart(code[i])) {
      i++;
      continue;
    }

    // `const item = this.items.find(...)` binds a local to something that
    // comes from application state. Remembering that is what lets a later
    // `item.qty = n` be recorded as a write to `items` rather than vanishing
    // into a local nobody models.
    {
      let w = i;
      while (w < code.length && isIdentPart(code[w])) w++;
      const word = code.slice(i, w);
      if (DECLARATION_KEYWORDS.has(word)) {
        const k = skipSpace(code, w);
        if (isIdentStart(code[k])) {
          let m = k;
          while (m < code.length && isIdentPart(code[m])) m++;
          const bound = code.slice(k, m);
          const eq = skipSpace(code, m);
          if (code[eq] === '=' && code[eq + 1] !== '=' && code[eq + 1] !== '>') {
            pendingAlias = bound;
            i = eq + 1;
            continue;
          }
        }
        i = w;
        continue;
      }
    }

    // A property name is consumed as part of its chain, never as a new root.
    let back = i - 1;
    while (back >= 0 && /\s/.test(code[back])) back--;
    if (code[back] === '.' || (code[back] === '.' && code[back - 1] === '?')) {
      let j = i;
      while (j < code.length && isIdentPart(code[j])) j++;
      i = j;
      continue;
    }

    const chain = readChain(code, i);

    // Keywords never start a chain, but their operand does.
    if (AMBIENT_ROOTS.has(chain.root) && chain.segments.length === 0) {
      i = chain.end;
      continue;
    }

    for (const part of chain.nested) {
      const sub = scanReferences(part.code, { locals, base: base + part.offset });
      references.push(...sub.references);
      aliases.push(...sub.aliases);
      notes.push(...sub.notes);
    }

    // An object literal key (`{ qty: 1 }`) is not a reference.
    const nextIdx = skipSpace(code, chain.end);
    const isLabelled = chain.segments.length === 0 && code[nextIdx] === ':' && code[nextIdx + 1] !== ':';
    if (isLabelled) {
      i = chain.end;
      continue;
    }

    const usage = readUsage(code, chain.end);
    let kind = 'read';
    if (usage && usage.usage === 'write') kind = 'write';
    else if (usage && usage.usage === 'invoke') kind = 'invoke';

    // `--x` and `++x` mutate the chain that follows them.
    if (kind === 'read') {
      let pre = i - 1;
      while (pre >= 0 && /\s/.test(code[pre])) pre--;
      if (pre >= 1 && ((code[pre] === '+' && code[pre - 1] === '+') || (code[pre] === '-' && code[pre - 1] === '-'))) {
        kind = 'write';
      }
    }

    // `list.push(x)` mutates `list`. The method name leaves the path; what is
    // recorded is a write to the receiver.
    const segments = chain.segments;
    let builtinMethod = false;
    if (kind === 'invoke' && segments.length > 0 && MUTATING_METHODS.has(segments[segments.length - 1])) {
      builtinMethod = true;
      const receiver = segments.slice(0, -1);
      if (receiver.length > 0 || !AMBIENT_ROOTS.has(chain.root)) {
        references.push({
          kind: 'write',
          root: chain.root,
          segments: receiver,
          dynamic: chain.dynamic,
          optional: chain.optional,
          method: segments[segments.length - 1],
          index: base + chain.start,
          length: chain.end - chain.start,
          text: code.slice(chain.start, chain.end),
        });
      }
    }

    references.push({
      kind,
      root: chain.root,
      segments,
      dynamic: chain.dynamic,
      optional: chain.optional,
      index: base + chain.start,
      length: chain.end - chain.start,
      text: code.slice(chain.start, chain.end),
      ...(builtinMethod ? { builtinMethod: true } : {}),
      ...(kind === 'write' && usage && usage.alsoReads ? { alsoReads: true } : {}),
    });

    if (pendingPattern) {
      for (const key of pendingPattern.keys) {
        aliases.push({
          member: key,
          root: chain.root,
          segments: chain.segments,
          index: base + chain.start,
        });
      }
      pendingPattern = null;
    }

    if (pendingAlias) {
      localAliases.push({
        name: pendingAlias,
        root: chain.root,
        segments: chain.segments,
        index: base + chain.start,
      });
      pendingAlias = null;
    }

    i = chain.end;
  }

  return { references, locals, aliases, localAliases, notes };
}

/**
 * Formats a member path for display, with `[]` for element access.
 * @param {string[]} segments - The path segments.
 * @returns {string} A dotted path, e.g. `items[].qty`.
 */
export function formatPath(segments) {
  let out = '';
  for (const segment of segments) {
    if (segment === '[]') out += '[]';
    else out += out === '' ? segment : `.${segment}`;
  }
  return out;
}

/**
 * Maps a scanned reference onto a declaration in scope.
 *
 * The result names a **declared symbol**, not a property path: a read of
 * `cart.items[2].qty` resolves to the state key `cart.items`, and the rest of
 * the path travels alongside as metadata. Modelling it the other way — a node
 * per observed path — would invent entities the application never declared.
 * @param {object} ref - A reference from {@link scanReferences}.
 * @param {object} scope - The resolution scope.
 * @param {string} scope.ownerId - The owning node's id.
 * @param {string} scope.ownerKind - `component`, `page` or `bridge`.
 * @param {Set<string>} [scope.state] - Declared state keys.
 * @param {Set<string>} [scope.computed] - Declared computed names.
 * @param {Set<string>} [scope.actions] - Declared action names.
 * @param {Set<string>} [scope.resources] - Declared resource names.
 * @param {Map<string, object>} [scope.bridges] - Imported bridges by local name.
 * @param {Map<string, object>} [scope.loopVars] - Loop variables by name.
 * @param {Set<string>} [scope.slotProps] - Scoped-slot variable names.
 * @param {Set<string>} [scope.locals] - Locally bound names.
 * @param {object} [scope.selfBridge] - The bridge descriptor when resolving inside one.
 * @returns {{target: object|null, path: string[], confidence: string, unresolved: object|null}}
 *   The declaration reached, the remaining path, how much to trust it, and the
 *   reason nothing was reached when nothing was.
 */
export function resolveReference(ref, scope) {
  const miss = (reason, extra = {}) => ({
    target: null,
    path: ref.segments,
    confidence: Confidence.POSSIBLE,
    unresolved: { reason, expr: ref.text, ...extra },
  });

  const hit = (target, path, confidence = Confidence.CERTAIN) => ({
    target,
    path: path || [],
    confidence,
    unresolved: null,
  });

  const root = ref.root;

  // A loop variable stands for an element of the list it iterates, so a read of
  // `item.qty` is a read of `cart.items` — the whole point of tracking them.
  const loopVar = scope.loopVars && scope.loopVars.get(root);
  if (loopVar) {
    if (!loopVar.resolved || !loopVar.resolved.target) {
      return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: root });
    }
    return hit(loopVar.resolved.target, [...loopVar.resolved.path, '[]', ...ref.segments], loopVar.resolved.confidence);
  }

  if (scope.slotProps && scope.slotProps.has(root)) {
    return miss(UnresolvedReason.SLOT_SCOPE, { name: root });
  }

  // A local bound from application state carries that provenance. The result
  // is never `certain`: which element `items.find(...)` returned is not
  // knowable, only that it came from `items`.
  const alias = scope.aliases && scope.aliases.get(root);
  if (alias && alias.target) {
    return hit(alias.target, [...alias.path, ...ref.segments], Confidence.POSSIBLE);
  }

  // A local binding wins over an application declaration. When it shadows one,
  // that is reported: a diagnostic that concluded "never read" from a body it
  // could not follow would be worse than no diagnostic.
  if (scope.locals && scope.locals.has(root)) {
    const shadows =
      (scope.state && scope.state.has(root)) ||
      (scope.computed && scope.computed.has(root)) ||
      (scope.actions && scope.actions.has(root)) ||
      (scope.resources && scope.resources.has(root));
    if (shadows) {
      return miss(UnresolvedReason.SHADOWED_IDENTIFIER, { name: root });
    }
    return { target: null, path: ref.segments, confidence: Confidence.CERTAIN, unresolved: null };
  }

  // `state.count` inside an action, and `this.state.count` inside a computed,
  // reach the same declaration a bare `count` does.
  if (root === 'state' || (root === 'this' && ref.segments[0] === 'state')) {
    const offset = root === 'state' ? 0 : 1;
    const key = ref.segments[offset];
    if (!key) {
      return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: root });
    }
    if (scope.state && scope.state.has(key)) {
      return hit({ kind: 'state', owner: scope.ownerId, name: key }, ref.segments.slice(offset + 1));
    }
    return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: key });
  }

  if (root === 'this') {
    const member = ref.segments[0];
    if (!member) {
      return { target: null, path: [], confidence: Confidence.CERTAIN, unresolved: null };
    }
    // Inside a bridge, `this` is the bridge itself.
    if (scope.selfBridge) {
      const resolved = resolveBridgeMember(scope.selfBridge, ref.segments, scope.ownerId);
      if (resolved) return hit(resolved.target, resolved.path);
      return miss(UnresolvedReason.UNKNOWN_BRIDGE_MEMBER, { name: member });
    }
    if (scope.computed && scope.computed.has(member)) {
      return hit({ kind: 'computed', owner: scope.ownerId, name: member }, ref.segments.slice(1));
    }
    if (scope.actions && scope.actions.has(member)) {
      return hit({ kind: 'action', owner: scope.ownerId, name: member }, ref.segments.slice(1));
    }
    if (scope.state && scope.state.has(member)) {
      return hit({ kind: 'state', owner: scope.ownerId, name: member }, ref.segments.slice(1));
    }
    return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: `this.${member}` });
  }

  const bridge = scope.bridges && scope.bridges.get(root);
  if (bridge) {
    const resolved = resolveBridgeMember(bridge.descriptor, ref.segments, `bridge:${bridge.descriptor.name}`);
    if (resolved) return hit(resolved.target, resolved.path);
    if (ref.segments.length === 0) {
      return hit({ kind: 'bridge', owner: null, name: bridge.descriptor.name }, []);
    }
    return miss(UnresolvedReason.UNKNOWN_BRIDGE_MEMBER, { name: `${bridge.descriptor.name}.${ref.segments[0]}` });
  }

  if (scope.selfBridge) {
    const resolved = resolveBridgeMember(scope.selfBridge, [root, ...ref.segments], scope.ownerId);
    if (resolved) return hit(resolved.target, resolved.path);
  }

  if (scope.computed && scope.computed.has(root)) {
    return hit({ kind: 'computed', owner: scope.ownerId, name: root }, ref.segments);
  }
  if (scope.actions && scope.actions.has(root)) {
    return hit({ kind: 'action', owner: scope.ownerId, name: root }, ref.segments);
  }
  if (scope.resources && scope.resources.has(root)) {
    return hit({ kind: 'resource', owner: scope.ownerId, name: root }, ref.segments);
  }
  if (scope.state && scope.state.has(root)) {
    return hit({ kind: 'state', owner: scope.ownerId, name: root }, ref.segments);
  }

  if (AMBIENT_ROOTS.has(root)) {
    return { target: null, path: ref.segments, confidence: Confidence.CERTAIN, unresolved: null };
  }

  return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: root });
}

/**
 * Resolves a member access against a bridge's declared surface.
 *
 * The compiler already resolves these names once, to warn about members a
 * bridge does not declare (AVX_W37). Atlas keeps the answer instead of
 * discarding it, which is what lets a query cross a file boundary.
 * @param {object} descriptor - A bridge descriptor from BridgeParser.
 * @param {string[]} segments - The member path.
 * @param {string} ownerId - The bridge's node id.
 * @returns {{target: object, path: string[]}|null} The declaration, or null.
 */
export function resolveBridgeMember(descriptor, segments, ownerId) {
  if (!descriptor || segments.length === 0) return null;
  const member = segments[0];
  const rest = segments.slice(1);

  // `on`, `$dispose` and `$name` are the bridge protocol rather than declared
  // members. `on` in particular carries a real relationship — a subscription —
  // which the model builder records from the event name, not from this chain.
  if (BRIDGE_BUILTINS.has(member)) {
    return { target: { kind: 'bridge', owner: null, name: descriptor.name }, path: rest };
  }

  if (Array.isArray(descriptor.stateKeys) && descriptor.stateKeys.includes(member)) {
    return { target: { kind: 'state', owner: ownerId, name: member }, path: rest };
  }
  if (Array.isArray(descriptor.getters) && descriptor.getters.includes(member)) {
    return { target: { kind: 'getter', owner: ownerId, name: member }, path: rest };
  }
  if (Array.isArray(descriptor.actions) && descriptor.actions.includes(member)) {
    return { target: { kind: 'action', owner: ownerId, name: member }, path: rest };
  }
  return null;
}

export default { scanReferences, collectLocals, resolveReference, formatPath };
