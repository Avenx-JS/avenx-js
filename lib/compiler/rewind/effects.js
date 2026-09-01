/**
 * @file effects.js
 * @description Classifies the effects a body performs, for the two features
 * that need to reason about them: compiler contracts and Avenx Rewind.
 *
 * `ContractValidator` has always asked "does this expression have side
 * effects?" as a yes/no question. Rewind asks a sharper one: *which* effects
 * are there, where are they, and can a rewind put them back? A `state.count++`
 * is a side effect and is perfectly reversible; a `localStorage.setItem()` is
 * a side effect and is not. Both questions are answered from the same pattern
 * table so the two features can never disagree about what an effect is.
 *
 * ## What this is not
 *
 * It is not a JavaScript parser. It is a string- and comment-aware scan, in
 * the same spirit as `atlas/resolve.js`, and it is deliberately conservative:
 * a pattern it cannot classify is reported, never assumed harmless. The one
 * place that judgement is inverted is the *tail effect* — a request whose
 * result the action returns or awaits is the very thing whose failure drives
 * the rewind, so flagging it would warn about the intended design.
 * @module lib/compiler/rewind/effects
 */

/**
 * Known non-deterministic identifiers and expressions.
 *
 * Moved here from `ContractValidator` so that the `deterministic` contract and
 * any future consumer read the same list.
 * @type {RegExp[]}
 */
export const NON_DETERMINISTIC_PATTERNS = [
  /\bMath\.random\s*\(/,
  /\bDate\.now\s*\(/,
  /\bnew\s+Date\s*\(/,
  /\bDate\s*\(/,
  /\bperformance\.now\s*\(/,
  /\bcrypto\.getRandomValues\s*\(/,
  /\bcrypto\.randomUUID\s*\(/,
];

/**
 * Known side-effecting / impure patterns in expressions.
 *
 * This is the `pure` contract's list and its meaning is unchanged: any of
 * these makes an expression impure, assignment included.
 * @type {RegExp[]}
 */
export const IMPURE_PATTERNS = [
  /\bwindow\s*\./,
  /\bdocument\s*\./,
  /\blocalStorage\s*\./,
  /\bsessionStorage\s*\./,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\s*\(/,
  /(?<![!=><])=(?![=><])/, // assignment = (excluding ==, ===, !=, !==, <=, >=, =>)
  /\+\+/,
  /--/,
  /\+=|-=|\*=\/=/,
];

/**
 * How an effect relates to a rewind.
 * @readonly
 * @enum {string}
 */
export const EffectKind = {
  /** A bridge event. Listeners have already run; a rewind cannot un-notify them. */
  EMIT: 'emit',
  /** Browser storage. Written outside the reactive graph. */
  STORAGE: 'storage',
  /** Direct DOM or `window` access. */
  DOM: 'dom',
  /** A timer whose callback runs after the transaction has ended. */
  TIMER: 'timer',
  /** A request whose result the action neither returns nor awaits. */
  REQUEST: 'request',
  /**
   * A state write inside a promise continuation. It happens after the
   * transaction's dynamic extent has closed, so the journal never sees it.
   */
  DEFERRED_WRITE: 'deferred-write',
};

/**
 * The effect patterns Rewind reports, in scan order.
 *
 * `test` is applied to the masked source; `label` is what a diagnostic prints.
 * Ordered longest-prefix-first so `sessionStorage` is not reported as
 * `Storage` twice.
 * @type {Array<{kind: string, pattern: RegExp, label: string}>}
 */
const IRREVERSIBLE_PATTERNS = [
  { kind: EffectKind.EMIT, pattern: /\bemit\s*\(\s*(['"`])([^'"`]*)\1/g, label: 'emit' },
  { kind: EffectKind.STORAGE, pattern: /\b(localStorage|sessionStorage)\s*\.\s*(setItem|removeItem|clear)\s*\(/g, label: 'storage' },
  { kind: EffectKind.DOM, pattern: /\bdocument\s*\.\s*[A-Za-z_$][\w$]*/g, label: 'document' },
  { kind: EffectKind.DOM, pattern: /\bwindow\s*\.\s*[A-Za-z_$][\w$]*/g, label: 'window' },
  { kind: EffectKind.TIMER, pattern: /\b(setTimeout|setInterval)\s*\(/g, label: 'timer' },
];

/**
 * Request-like calls, which are only irreversible when their result escapes
 * the action unobserved.
 * @type {RegExp}
 */
const REQUEST_PATTERN = /\b(fetch|XMLHttpRequest)\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/g;

/**
 * Promise continuations, where a state write lands outside the transaction.
 * @type {RegExp}
 */
const CONTINUATION_PATTERN = /\.\s*(then|catch|finally)\s*\(/g;

/**
 * Replaces a run of source with spaces, preserving newlines so that every
 * offset in the masked text still points at the same line as in the original.
 * @param {string} text - The run to blank out.
 * @returns {string} The blanked run.
 */
function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Masks string literals, template literals and comments.
 *
 * Without this an `emit` inside a string, or a `document.` written in a
 * comment explaining why it is *not* used, would be reported as an effect.
 * @param {string} source - The body source.
 * @returns {string} The source with literals and comments blanked, same length.
 */
export function maskLiterals(source) {
  if (typeof source !== 'string' || source === '') return '';
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      // Keep the quotes so callers can still recognise a literal argument.
      out += quote + blank(source.slice(i + 1, Math.max(i + 1, j - 1))) + (j <= source.length ? quote : '');
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Whether the statement containing an offset is returned or awaited.
 *
 * The transaction outcome *is* the value the action hands back, so a request
 * in that position is not a loose effect — it is the mechanism. Scans back to
 * the nearest statement boundary rather than parsing, which is enough to tell
 * `return api.save()` from `api.save();`.
 * @param {string} masked - The masked body source.
 * @param {number} offset - Where the call starts.
 * @returns {boolean} True when the call's result is returned or awaited.
 */
function isTailPosition(masked, offset) {
  let start = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const ch = masked[i];
    if (ch === ';' || ch === '{' || ch === '}') {
      start = i + 1;
      break;
    }
  }
  const head = masked.slice(start, offset);
  return /(^|[\s(=,])(return|await)\s+[^;]*$/.test(head) || /^\s*(return|await)\b/.test(head);
}

/**
 * Turns an offset into a 1-based line number within the body.
 * @param {string} source - The body source.
 * @param {number} offset - A character offset.
 * @returns {number} The 1-based line.
 */
function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/**
 * Finds every effect in a body that a rewind cannot undo.
 *
 * Returns descriptors rather than booleans because the diagnostic's whole
 * value is naming what will be left behind, and where.
 * @param {string} source - The action body source.
 * @param {object} [options] - Scan options.
 * @param {number} [options.baseLine] - Line the body starts on in its file, so
 *   reported lines are file lines rather than body lines. 1-based, defaults to 1.
 * @returns {Array<{kind: string, label: string, text: string, line: number}>}
 *   The effects, in source order.
 */
export function findIrreversibleEffects(source, options = {}) {
  if (typeof source !== 'string' || source.trim() === '') return [];
  const baseLine = typeof options.baseLine === 'number' && options.baseLine > 0 ? options.baseLine : 1;
  const masked = maskLiterals(source);
  /** @type {Array<{kind: string, label: string, text: string, line: number, offset: number}>} */
  const found = [];

  for (const entry of IRREVERSIBLE_PATTERNS) {
    const pattern = new RegExp(entry.pattern.source, entry.pattern.flags);
    let match;
    while ((match = pattern.exec(masked)) !== null) {
      // `emit('name')` keeps its quotes through masking but loses the name, so
      // the original text is read back at the same offset.
      const text = source.slice(match.index, match.index + match[0].length).trim();
      found.push({
        kind: entry.kind,
        label: entry.label,
        text,
        line: baseLine + lineAt(source, match.index) - 1,
        offset: match.index,
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }

  REQUEST_PATTERN.lastIndex = 0;
  let request;
  while ((request = REQUEST_PATTERN.exec(masked)) !== null) {
    if (isTailPosition(masked, request.index)) continue;
    found.push({
      kind: EffectKind.REQUEST,
      label: 'request',
      text: source.slice(request.index, request.index + request[0].length).trim(),
      line: baseLine + lineAt(source, request.index) - 1,
      offset: request.index,
    });
  }

  found.sort((a, b) => a.offset - b.offset);
  // `offset` is scan bookkeeping; callers report a line and a location.
  for (const entry of found) delete entry.offset;
  return found;
}

/**
 * Finds promise continuations, where a state write escapes the transaction.
 *
 * A write made inside `.then(...)` runs after the action has already returned,
 * so the journal — which follows the dynamic extent of the call — never sees
 * it. That is a completeness problem, not an irreversibility one, which is why
 * it is reported separately, under AVX_W42.
 * @param {string} source - The action body source.
 * @param {object} [options] - Scan options.
 * @param {number} [options.baseLine] - Line the body starts on in its file.
 * @returns {Array<{kind: string, text: string, line: number}>} The continuations.
 */
export function findDeferredWrites(source, options = {}) {
  if (typeof source !== 'string' || source.trim() === '') return [];
  const baseLine = typeof options.baseLine === 'number' && options.baseLine > 0 ? options.baseLine : 1;
  const masked = maskLiterals(source);
  const results = [];
  CONTINUATION_PATTERN.lastIndex = 0;
  let match;
  while ((match = CONTINUATION_PATTERN.exec(masked)) !== null) {
    const body = masked.slice(match.index);
    // Only a continuation that assigns something can hide a write. A bare
    // `.catch(reportError)` is not a completeness problem.
    if (!/(?<![!=><])=(?![=>])|\+\+|--|\.\s*(push|pop|shift|unshift|splice|sort|reverse|set|add|delete|clear)\s*\(/.test(
      body.slice(0, 400),
    )) {
      continue;
    }
    results.push({
      kind: EffectKind.DEFERRED_WRITE,
      text: source.slice(match.index, match.index + match[0].length).trim(),
      line: baseLine + lineAt(source, match.index) - 1,
    });
  }
  return results;
}
