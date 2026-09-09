/**
 * @file scanner.js
 * @description Source-position primitives shared by every part of the bundler.
 *
 * ## Why Avenx scans rather than parses
 *
 * Everything else in this compiler reads source with a purpose-built scanner —
 * the HTML tokenizer, the declaration reader, the Atlas reference scanner — and
 * the bundler follows the same rule for the same reason: a dependency-free
 * build is a property of the project, not an accident of what was convenient.
 *
 * The bundler does not need a full ECMAScript parser. It needs to know three
 * things about a module: which `import`/`export` declarations it contains,
 * where each top-level statement begins and ends, and which top-level names it
 * declares. All three are answerable from a scanner that knows where source
 * text *is not* code.
 *
 * ## What "is not code" means here
 *
 * String literals, template literals (including nested `${}` expressions),
 * regular-expression literals, line comments and block comments. Every one of
 * them can contain the characters this file searches for — a `{` inside a
 * string would otherwise corrupt every depth calculation downstream, and the
 * word `import` inside a comment would otherwise become a phantom dependency.
 *
 * Distinguishing `/` as division from `/` as the start of a regex is the one
 * genuinely ambiguous case in JavaScript lexing. {@link regexAllowedAfter}
 * resolves it the way every hand-written JS lexer does: by looking at the last
 * significant token.
 * @module lib/bundler/scanner
 */

/**
 * Characters that can legally precede a regular-expression literal.
 *
 * After any of these, a `/` starts a regex; after an identifier, a number, or a
 * closing bracket it is division. The exceptions to "closing bracket means
 * division" are keywords such as `return` and `typeof`, handled by
 * {@link KEYWORDS_BEFORE_REGEX}.
 * @type {Set<string>}
 */
const PUNCTUATORS_BEFORE_REGEX = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>',
]);

/**
 * Keywords after which a `/` begins a regular expression rather than division.
 * @type {Set<string>}
 */
const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Decides whether a `/` at `index` opens a regular-expression literal.
 * @param {string} source - The full source text.
 * @param {number} index - Offset of the `/`.
 * @returns {boolean} True when a regex literal starts here.
 */
export function regexAllowedAfter(source, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i])) {
    i -= 1;
  }
  if (i < 0) {
    return true;
  }

  const char = source[i];
  if (PUNCTUATORS_BEFORE_REGEX.has(char)) {
    return true;
  }

  if (/[\w$]/.test(char)) {
    let start = i;
    while (start >= 0 && /[\w$]/.test(source[start])) {
      start -= 1;
    }
    return KEYWORDS_BEFORE_REGEX.has(source.slice(start + 1, i + 1));
  }

  return false;
}

/**
 * A single lexical region the scanner recognises.
 * @typedef {object} Region
 * @property {'code'|'string'|'template'|'regex'|'line-comment'|'block-comment'} kind - What the region is.
 * @property {number} start - Inclusive start offset.
 * @property {number} end - Exclusive end offset.
 */

/**
 * Walks a source and reports every non-code region.
 *
 * Template literals are reported as a single region spanning the whole literal,
 * including any `${}` substitutions. Code inside a substitution is therefore
 * not scanned at all — which is correct for this bundler's purposes, because an
 * `import` declaration cannot appear inside an expression and a top-level
 * statement boundary cannot fall inside a template literal.
 * @param {string} source - The source text.
 * @returns {Region[]} Regions in ascending order of `start`.
 */
export function scanRegions(source) {
  /** @type {Region[]} */
  const regions = [];
  const length = source.length;
  let i = 0;

  while (i < length) {
    const char = source[i];

    if (char === '/' && source[i + 1] === '/') {
      const start = i;
      while (i < length && source[i] !== '\n') {
        i += 1;
      }
      regions.push({ kind: 'line-comment', start, end: i });
      continue;
    }

    if (char === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < length && !(source[i] === '*' && source[i + 1] === '/')) {
        i += 1;
      }
      i = Math.min(i + 2, length);
      regions.push({ kind: 'block-comment', start, end: i });
      continue;
    }

    if (char === '"' || char === "'") {
      const start = i;
      const quote = char;
      i += 1;
      while (i < length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        // An unterminated string literal cannot span a line. Stopping at the
        // newline keeps a malformed file from swallowing the rest of the
        // module and reporting nonsense about its imports.
        if (source[i] === '\n') {
          break;
        }
        i += 1;
      }
      regions.push({ kind: 'string', start, end: i });
      continue;
    }

    if (char === '`') {
      const start = i;
      i += 1;
      let depth = 0;
      while (i < length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (depth === 0 && source[i] === '$' && source[i + 1] === '{') {
          depth += 1;
          i += 2;
          continue;
        }
        if (depth > 0) {
          if (source[i] === '{') depth += 1;
          else if (source[i] === '}') depth -= 1;
          else if (source[i] === '`') {
            // A nested template inside a substitution. Skip it whole so its
            // own braces cannot unbalance this one.
            const nested = scanRegions(source.slice(i));
            const first = nested[0];
            i += first && first.kind === 'template' && first.start === 0 ? first.end : 1;
            continue;
          }
          i += 1;
          continue;
        }
        if (source[i] === '`') {
          i += 1;
          break;
        }
        i += 1;
      }
      regions.push({ kind: 'template', start, end: i });
      continue;
    }

    if (char === '/' && regexAllowedAfter(source, i)) {
      const start = i;
      i += 1;
      let inClass = false;
      while (i < length) {
        const current = source[i];
        if (current === '\\') {
          i += 2;
          continue;
        }
        if (current === '\n') {
          break;
        }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) {
          i += 1;
          while (i < length && /[a-z]/i.test(source[i])) {
            i += 1;
          }
          break;
        }
        i += 1;
      }
      regions.push({ kind: 'regex', start, end: i });
      continue;
    }

    i += 1;
  }

  return regions;
}

/**
 * A lookup answering "is this offset inside a string, comment or literal?".
 *
 * Built once per module and consulted many times. A flat `Uint8Array` costs one
 * byte per source character and turns every query into an array read, which
 * matters because the export scanner asks the question for every identifier in
 * a module.
 */
export class CodeMask {
  /**
   * @param {string} source - The source the mask describes.
   */
  constructor(source) {
    /** @type {string} */
    this.source = source;
    /** @type {Region[]} */
    this.regions = scanRegions(source);
    /** @type {Uint8Array} */
    this.mask = new Uint8Array(source.length);

    for (const region of this.regions) {
      const end = Math.min(region.end, source.length);
      for (let i = region.start; i < end; i += 1) {
        this.mask[i] = 1;
      }
    }
  }

  /**
   * Whether an offset holds executable code rather than literal or comment text.
   * @param {number} index - The offset to test.
   * @returns {boolean} True when the offset is code.
   */
  isCode(index) {
    return index >= 0 && index < this.mask.length && this.mask[index] === 0;
  }

  /**
   * Whether an offset sits inside a literal whose text is data.
   *
   * Distinct from {@link CodeMask#isCode}: a comment is not code, but its
   * whitespace is still safe to remove, whereas a string or template literal
   * carries its spacing as a value. Anything that rewrites whitespace has to
   * tell those two apart.
   * @param {number} index - The offset to test.
   * @returns {boolean} True inside a string, template or regex literal.
   */
  isLiteral(index) {
    if (index < 0 || index >= this.source.length) return false;
    if (this.mask[index] === 0) return false;
    for (const region of this.regions) {
      if (region.start > index) break;
      if (index < region.end) {
        return region.kind === 'string' || region.kind === 'template' || region.kind === 'regex';
      }
    }
    return false;
  }

  /**
   * Returns the source with every comment replaced by equivalent whitespace.
   *
   * Offsets are preserved, so a position found in the blanked text is valid in
   * the original. String and template contents are left alone: they are values,
   * not noise, and blanking them would corrupt the module.
   * @returns {string} The comment-free source, same length as the original.
   */
  withoutComments() {
    const chars = this.source.split('');
    for (const region of this.regions) {
      if (region.kind !== 'line-comment' && region.kind !== 'block-comment') {
        continue;
      }
      for (let i = region.start; i < Math.min(region.end, chars.length); i += 1) {
        chars[i] = chars[i] === '\n' ? '\n' : ' ';
      }
    }
    return chars.join('');
  }
}

/**
 * Finds the offset just past a balanced bracket run starting at `index`.
 * @param {string} source - The source text.
 * @param {CodeMask} mask - Mask for the same source.
 * @param {number} index - Offset of the opening bracket.
 * @returns {number} Offset one past the matching close, or `source.length`.
 */
export function matchBracket(source, mask, index) {
  const open = source[index];
  const close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let depth = 0;

  for (let i = index; i < source.length; i += 1) {
    if (!mask.isCode(i)) continue;
    const char = source[i];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/**
 * Finds the end of the top-level statement that begins at `start`.
 *
 * "End" means the offset one past its terminating semicolon, or one past the
 * closing brace of a block-bodied declaration, or the end of the line for an
 * ASI-terminated statement. Only bracket depth at code positions is consulted,
 * so a `;` inside a string or an object literal never terminates anything.
 * @param {string} source - The source text.
 * @param {CodeMask} mask - Mask for the same source.
 * @param {number} start - Offset of the statement's first character.
 * @returns {number} Exclusive end offset.
 */
export function statementEnd(source, mask, start) {
  let depth = 0;
  let i = start;

  while (i < source.length) {
    if (!mask.isCode(i)) {
      i += 1;
      continue;
    }
    const char = source[i];

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        // A declaration whose body is a block ends at that block's close,
        // unless a semicolon or an operator follows on the same statement.
        let j = i + 1;
        while (j < source.length && /[ \t]/.test(source[j])) j += 1;
        if (source[j] === ';') return j + 1;
        if (j >= source.length || source[j] === '\n' || source[j] === '\r') {
          return i + 1;
        }
      }
      if (depth < 0) {
        return i;
      }
    } else if (char === ';' && depth === 0) {
      return i + 1;
    }

    i += 1;
  }

  return source.length;
}
