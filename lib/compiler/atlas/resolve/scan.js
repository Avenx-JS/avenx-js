/**
 * @file scan.js
 * @description Pass 2 of Atlas expression resolution: scanning member chains
 * and their usages (read, write, invoke) from source text.
 * @module lib/compiler/atlas/resolve/scan
 */

import { UnresolvedReason } from '../AppModel.js';
import { isIdentPart, isIdentStart, matchBracket, skipLiteral, skipSpace } from './lex.js';
import { DECLARATION_KEYWORDS, collectLocals, patternBindings } from './locals.js';
import { AMBIENT_ROOTS } from './references.js';

/**
 * Methods that mutate the receiver rather than returning a new value.
 *
 * `cart.items.push(item)` is a write to `cart.items`, and modelling it as a
 * read would make `avenx impact cart.items` miss the code that changes it —
 * the single most important question the command answers.
 * @type {Set<string>}
 */
export const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse',
  'fill', 'copyWithin', 'add', 'clear', 'delete', 'set',
]);

/**
 * Assignment operators, longest first so `??=` is matched before `?`.
 * @type {string[]}
 */
const ASSIGN_OPERATORS = [
  '>>>=', '<<=', '>>=', '**=', '&&=', '||=', '??=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
];

/**
 * Reads a member chain that begins at `i`.
 * @param {string} code - The source.
 * @param {number} i - Offset of the root identifier.
 * @returns {object} The chain: root, segments, flags, extent and any nested
 *   expressions found inside computed members.
 */
export function readChain(code, i) {
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
export function staticKey(inner) {
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
export function isNumericIndex(inner) {
  return /^\s*\d+\s*$/.test(inner);
}

/**
 * Detects an assignment or update immediately following a chain.
 * @param {string} code - The source.
 * @param {number} end - Offset just past the chain.
 * @returns {{usage: string, alsoReads: boolean}|null} What was done to the chain.
 */
export function readUsage(code, end) {
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
