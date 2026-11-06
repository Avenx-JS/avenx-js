/**
 * @file tokenizer.js
 * @description The lexical half of the compiler's own ECMAScript parser.
 *
 * ## Why this exists
 *
 * The compiler used to read action bodies, emitted bundles and module sources
 * with `acorn`. That made a parser the published package's only runtime
 * dependency, which contradicted the property the project actually advertises:
 * an application built with Avenx installs nothing but Avenx. This tokenizer,
 * and the parser built on it, replace that dependency with code the project
 * owns. `acorn` remains a development dependency and is used only as a
 * differential-testing oracle, never on a build path.
 *
 * ## What makes a hand-written JavaScript lexer tricky
 *
 * Three places in ECMAScript cannot be lexed without knowing what the parser
 * expects, so this tokenizer does not guess at them. Instead the parser asks:
 *
 * 1. `/` is division or the start of a regular expression. The tokenizer always
 *    reads it as a punctuator; {@link Tokenizer#reScanAsRegExp} re-reads it as a
 *    literal, and the parser calls that only where an operand is expected.
 * 2. `}` ends a block or resumes a template literal. Same resolution:
 *    {@link Tokenizer#reScanTemplateContinue} is called from the template
 *    parser, and nowhere else.
 * 3. Automatic semicolon insertion needs to know whether a line terminator was
 *    crossed to reach a token, so every token carries {@link Token#nlBefore}.
 *
 * {@link Tokenizer#save} and {@link Tokenizer#restore} make the tokenizer
 * re-windable, which is what lets the parser speculate — the only practical way
 * to tell `(a, b)` from `(a, b) => a + b` without unbounded lookahead.
 * @module lib/compiler/parser/js/tokenizer
 */

/**
 * Raised for both lexical and syntactic errors.
 *
 * The shape follows what the compiler already relied on from acorn: a
 * `SyntaxError` whose message ends in `(line:column)`, with `pos`, `loc` and
 * `raisedAt` available for callers that want the position structurally. Several
 * diagnostics in the compiler read `error.loc.line`, so that stays.
 */
export class JsParseError extends SyntaxError {
  /**
   * @param {string} message - What went wrong, without the position.
   * @param {number} pos - Zero-based source offset.
   * @param {{line: number, column: number}} loc - One-based line, zero-based column.
   */
  constructor(message, pos, loc) {
    super(`${message} (${loc.line}:${loc.column})`);
    this.name = 'SyntaxError';
    /** @type {number} */
    this.pos = pos;
    /** @type {{line: number, column: number}} */
    this.loc = loc;
    /** @type {number} */
    this.raisedAt = pos;
  }
}

/**
 * Reserved words that can never be a binding or a plain reference.
 *
 * `let`, `static`, `async`, `yield`, `await` and `get`/`set` are deliberately
 * absent: each is a valid identifier in some context, and the parser decides
 * from position rather than from the word.
 * @type {Set<string>}
 */
export const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with',
]);

/**
 * Every punctuator, longest first so that a prefix never shadows a longer one.
 * @type {string[]}
 */
const PUNCTUATORS = [
  '>>>=',
  '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/',
  '%', '&', '|', '^', '!', '~', '?', ':', '=', '.',
];

/**
 * Punctuators grouped by first character, so a token costs one map lookup and
 * a short scan rather than a walk of the whole table.
 * @type {Map<string, string[]>}
 */
const PUNCTUATORS_BY_FIRST = new Map();
for (const punctuator of PUNCTUATORS) {
  const list = PUNCTUATORS_BY_FIRST.get(punctuator[0]);
  if (list) list.push(punctuator);
  else PUNCTUATORS_BY_FIRST.set(punctuator[0], [punctuator]);
}

const ID_START = /[$_\p{ID_Start}]/u;
const ID_PART = /[$‌‍\p{ID_Continue}]/u;

/**
 * Whether a character can start an identifier.
 * @param {string} char - A single character.
 * @returns {boolean} True when it can.
 */
function isIdStart(char) {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  if (code < 128) {
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 36 || code === 95;
  }
  return ID_START.test(char);
}

/**
 * Whether a character can continue an identifier.
 * @param {string} char - A single character.
 * @returns {boolean} True when it can.
 */
function isIdPart(char) {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  if (code < 128) {
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 36 || code === 95;
  }
  return ID_PART.test(char);
}

/**
 * Normalises the line endings of a template literal's raw text.
 *
 * A template's cooked value and its raw value both see CRLF and a bare CR as a
 * single line feed, so a tag reading `raw` gets the same text whatever the file
 * was saved with.
 * @param {string} text - The raw slice.
 * @returns {string} The normalised text.
 */
function normaliseRaw(text) {
  return text.indexOf('\r') === -1 ? text : text.replace(/\r\n?/g, '\n');
}

/**
 * Whether a code point is a line terminator.
 * @param {number} code - A UTF-16 code unit.
 * @returns {boolean} True for LF, CR, LS or PS.
 */
function isLineTerminator(code) {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/**
 * Whether a code point is whitespace that separates tokens.
 * @param {number} code - A UTF-16 code unit.
 * @returns {boolean} True when it is skippable whitespace.
 */
function isSpace(code) {
  if (code === 32 || code === 9 || code === 11 || code === 12 || code === 0xfeff || code === 0xa0) return true;
  if (code < 0x1680) return false;
  return /\s/.test(String.fromCharCode(code));
}

/**
 * One token.
 * @typedef {object} Token
 * @property {string} type - One of `name`, `privatename`, `punct`, `num`,
 *   `bigint`, `string`, `template`, `regexp`, `eof`.
 * @property {any} value - The identifier text, punctuator text, or literal value.
 * @property {number} start - Inclusive start offset.
 * @property {number} end - Exclusive end offset.
 * @property {boolean} nlBefore - Whether a line terminator precedes this token.
 * @property {string} [raw] - Source text, for literals that keep it.
 */

/**
 * A re-windable ECMAScript tokenizer.
 */
export class Tokenizer {
  /**
   * @param {string} source - The source text.
   */
  constructor(source) {
    /** @type {string} */
    this.source = source;
    /** @type {number} */
    this.pos = 0;
    /** @type {Token} */
    this.curr = { type: 'eof', value: null, start: 0, end: 0, nlBefore: false };
    /** @type {number} */
    this.lastEnd = 0;
    /** @type {number[]} */
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i += 1) {
      const code = source.charCodeAt(i);
      if (isLineTerminator(code)) {
        if (code === 13 && source.charCodeAt(i + 1) === 10) i += 1;
        this.lineStarts.push(i + 1);
      }
    }
  }

  /**
   * Converts an offset into a one-based line and zero-based column.
   * @param {number} pos - The offset.
   * @returns {{line: number, column: number}} The position.
   */
  locate(pos) {
    const starts = this.lineStarts;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= pos) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: pos - starts[low] };
  }

  /**
   * Raises a positioned parse error.
   * @param {string} message - What went wrong.
   * @param {number} [pos] - Where, defaulting to the current token's start.
   * @throws {JsParseError} Always.
   * @returns {never} Never returns.
   */
  raise(message, pos = this.curr.start) {
    throw new JsParseError(message, pos, this.locate(pos));
  }

  /**
   * Captures enough state to re-wind to this exact point.
   * @returns {{pos: number, curr: Token, lastEnd: number}} The saved state.
   */
  save() {
    return { pos: this.pos, curr: this.curr, lastEnd: this.lastEnd };
  }

  /**
   * Restores a state taken from {@link Tokenizer#save}.
   * @param {{pos: number, curr: Token, lastEnd: number}} state - The state.
   */
  restore(state) {
    this.pos = state.pos;
    this.curr = state.curr;
    this.lastEnd = state.lastEnd;
  }

  /**
   * Skips whitespace and comments, reporting whether a newline was crossed.
   * @returns {boolean} True when a line terminator was skipped.
   */
  skipSpace() {
    let sawNewline = false;
    const source = this.source;
    while (this.pos < source.length) {
      const code = source.charCodeAt(this.pos);
      if (isLineTerminator(code)) {
        sawNewline = true;
        this.pos += 1;
        continue;
      }
      if (isSpace(code)) {
        this.pos += 1;
        continue;
      }
      if (code === 47 /* / */) {
        const next = source.charCodeAt(this.pos + 1);
        if (next === 47 /* / */) {
          this.pos += 2;
          while (this.pos < source.length && !isLineTerminator(source.charCodeAt(this.pos))) this.pos += 1;
          continue;
        }
        if (next === 42 /* * */) {
          const end = source.indexOf('*/', this.pos + 2);
          if (end === -1) this.raise('Unterminated comment', this.pos);
          for (let i = this.pos; i < end; i += 1) {
            if (isLineTerminator(source.charCodeAt(i))) {
              sawNewline = true;
              break;
            }
          }
          this.pos = end + 2;
          continue;
        }
      }
      break;
    }
    return sawNewline;
  }

  /**
   * Reads the next token and makes it current.
   * @returns {Token} The new current token.
   */
  nextToken() {
    this.lastEnd = this.curr.end;
    const nlBefore = this.skipSpace();
    const start = this.pos;
    if (this.pos >= this.source.length) {
      this.curr = { type: 'eof', value: null, start, end: start, nlBefore };
      return this.curr;
    }
    this.curr = this.readToken(start, nlBefore);
    return this.curr;
  }

  /**
   * Reads one token at `start`.
   * @param {number} start - Where the token begins.
   * @param {boolean} nlBefore - Whether a newline preceded it.
   * @returns {Token} The token.
   */
  readToken(start, nlBefore) {
    const source = this.source;
    const char = source[start];
    const code = source.charCodeAt(start);

    if (char === '"' || char === "'") {
      const { value, end } = this.readString(start);
      this.pos = end;
      return { type: 'string', value, start, end, nlBefore, raw: source.slice(start, end) };
    }

    if (char === '`') {
      // A template token is read by the parser through readTemplateChunk, which
      // needs to know where the substitution boundaries are. Reaching here
      // means the parser has asked for a token where a template may begin.
      const chunk = this.readTemplateChunk(start);
      this.pos = chunk.end;
      return { type: 'template', value: chunk, start, end: chunk.end, nlBefore };
    }

    if (code >= 48 && code <= 57) {
      return this.readNumber(start, nlBefore);
    }
    if (char === '.' && source.charCodeAt(start + 1) >= 48 && source.charCodeAt(start + 1) <= 57) {
      return this.readNumber(start, nlBefore);
    }

    if (char === '#') {
      this.pos = start + 1;
      if (!isIdStart(source[this.pos]) && source[this.pos] !== '\\') {
        this.raise('Unexpected character after #', start);
      }
      const name = this.readIdentifierName();
      return { type: 'privatename', value: name, start, end: this.pos, nlBefore };
    }

    if (isIdStart(char) || char === '\\') {
      this.pos = start;
      const name = this.readIdentifierName();
      return { type: 'name', value: name, start, end: this.pos, nlBefore };
    }

    const candidates = PUNCTUATORS_BY_FIRST.get(char);
    if (candidates) {
      for (const punctuator of candidates) {
        if (source.startsWith(punctuator, start)) {
          // `?.3` is a conditional followed by `.3`, not optional chaining.
          if (punctuator === '?.' && source.charCodeAt(start + 2) >= 48 && source.charCodeAt(start + 2) <= 57) {
            continue;
          }
          this.pos = start + punctuator.length;
          return { type: 'punct', value: punctuator, start, end: this.pos, nlBefore };
        }
      }
    }

    this.raise(`Unexpected character '${char}'`, start);
    return /** @type {never} */ (undefined);
  }

  /**
   * Reads an identifier name, decoding any `\\u` escapes it contains.
   * @returns {string} The name.
   */
  readIdentifierName() {
    const source = this.source;
    let out = '';
    let first = true;
    while (this.pos < source.length) {
      const char = source[this.pos];
      if (char === '\\') {
        if (source[this.pos + 1] !== 'u') this.raise('Invalid escape in identifier', this.pos);
        this.pos += 2;
        const decoded = this.readUnicodeEscapeValue();
        const text = String.fromCodePoint(decoded);
        if (first ? !isIdStart(text) : !isIdPart(text)) this.raise('Invalid identifier escape', this.pos);
        out += text;
        first = false;
        continue;
      }
      if (first ? !isIdStart(char) : !isIdPart(char)) break;
      // Astral identifier characters occupy a surrogate pair.
      const code = source.charCodeAt(this.pos);
      if (code >= 0xd800 && code <= 0xdbff) {
        out += source.slice(this.pos, this.pos + 2);
        this.pos += 2;
      } else {
        out += char;
        this.pos += 1;
      }
      first = false;
    }
    if (out === '') this.raise('Expected an identifier', this.pos);
    return out;
  }

  /**
   * Reads the code point of a `\\u` escape, the `\\u` already consumed.
   * @returns {number} The code point.
   */
  readUnicodeEscapeValue() {
    const source = this.source;
    if (source[this.pos] === '{') {
      const close = source.indexOf('}', this.pos);
      if (close === -1) this.raise('Unterminated unicode escape', this.pos);
      const digits = source.slice(this.pos + 1, close);
      if (!/^[0-9a-fA-F]+$/.test(digits)) this.raise('Invalid unicode escape', this.pos);
      const value = parseInt(digits, 16);
      if (value > 0x10ffff) this.raise('Code point out of range', this.pos);
      this.pos = close + 1;
      return value;
    }
    const digits = source.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.raise('Invalid unicode escape', this.pos);
    this.pos += 4;
    return parseInt(digits, 16);
  }

  /**
   * Reads a numeric literal.
   * @param {number} start - Where it begins.
   * @param {boolean} nlBefore - Whether a newline preceded it.
   * @returns {Token} A `num` or `bigint` token.
   */
  readNumber(start, nlBefore) {
    const source = this.source;
    let i = start;
    let radix = 10;

    if (source[i] === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
      radix = 16;
      i += 2;
    } else if (source[i] === '0' && (source[i + 1] === 'o' || source[i + 1] === 'O')) {
      radix = 8;
      i += 2;
    } else if (source[i] === '0' && (source[i + 1] === 'b' || source[i + 1] === 'B')) {
      radix = 2;
      i += 2;
    }

    const digitRe = radix === 16 ? /[0-9a-fA-F]/ : radix === 8 ? /[0-7]/ : radix === 2 ? /[01]/ : /[0-9]/;
    const digitsStart = i;
    let sawDigit = false;
    let sawSeparator = false;
    while (i < source.length) {
      const char = source[i];
      if (char === '_') {
        if (!sawDigit || source[i - 1] === '_') this.raise('Misplaced numeric separator', i);
        sawSeparator = true;
        i += 1;
        continue;
      }
      if (!digitRe.test(char)) break;
      sawDigit = true;
      i += 1;
    }
    if (radix !== 10 && !sawDigit) this.raise('Expected number in radix prefix', digitsStart);
    if (sawSeparator && source[i - 1] === '_') this.raise('Misplaced numeric separator', i - 1);

    let isBigInt = false;
    if (radix === 10) {
      // Legacy octal (`0755`) and the leading-zero decimals beside it are read
      // as written; they are only an error in strict mode, which the compiler
      // does not need to decide here.
      const legacyOctal = source[start] === '0' && /^[0-7_]+$/.test(source.slice(start + 1, i)) && i > start + 1;
      if (source[i] === '.' && !legacyOctal) {
        i += 1;
        while (i < source.length && (/[0-9]/.test(source[i]) || source[i] === '_')) i += 1;
      }
      if ((source[i] === 'e' || source[i] === 'E') && !legacyOctal) {
        let j = i + 1;
        if (source[j] === '+' || source[j] === '-') j += 1;
        if (!/[0-9]/.test(source[j] || '')) this.raise('Missing exponent', i);
        i = j;
        while (i < source.length && (/[0-9]/.test(source[i]) || source[i] === '_')) i += 1;
      } else if (source[i] === 'n' && !legacyOctal && !source.slice(start, i).includes('.')) {
        isBigInt = true;
        i += 1;
      }
    } else if (source[i] === 'n') {
      isBigInt = true;
      i += 1;
    }

    if (isIdStart(source[i]) || /[0-9]/.test(source[i] || '')) {
      this.raise('Identifier directly after number', i);
    }

    const raw = source.slice(start, i);
    this.pos = i;
    if (isBigInt) {
      const digits = raw.slice(0, -1).replace(/_/g, '');
      return { type: 'bigint', value: digits, start, end: i, nlBefore, raw };
    }
    const text = raw.replace(/_/g, '');
    let value;
    if (radix === 10) {
      value = Number(text);
      if (Number.isNaN(value)) {
        // A legacy octal such as `0755` is not a valid Number() argument.
        value = parseInt(text, 8);
      }
    } else {
      value = Number(text);
    }
    if (radix === 10 && /^0[0-7]+$/.test(text)) value = parseInt(text.slice(1), 8);
    return { type: 'num', value, start, end: i, nlBefore, raw };
  }

  /**
   * Reads a string literal.
   * @param {number} start - Offset of the opening quote.
   * @returns {{value: string, end: number}} The cooked value and the offset after
   *   the closing quote.
   */
  readString(start) {
    const source = this.source;
    const quote = source[start];
    let i = start + 1;
    let out = '';
    while (true) {
      if (i >= source.length) this.raise('Unterminated string constant', start);
      const char = source[i];
      if (char === quote) {
        i += 1;
        break;
      }
      if (char === '\\') {
        this.pos = i + 1;
        const escaped = this.readEscape(false);
        out += escaped === null ? '' : escaped;
        i = this.pos;
        continue;
      }
      if (isLineTerminator(source.charCodeAt(i)) && char !== ' ' && char !== ' ') {
        this.raise('Unterminated string constant', start);
      }
      out += char;
      i += 1;
    }
    return { value: out, end: i };
  }

  /**
   * Reads one escape sequence, the backslash already consumed.
   * @param {boolean} inTemplate - Whether an invalid escape is tolerated, which
   *   it is in a tagged template.
   * @returns {string|null} The text it stands for, or null for a line continuation
   *   and for an invalid escape in a template.
   */
  readEscape(inTemplate) {
    const source = this.source;
    const char = source[this.pos];
    if (char === undefined) this.raise('Unterminated escape', this.pos);
    this.pos += 1;
    switch (char) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0':
        if (/[0-9]/.test(source[this.pos] || '')) {
          if (inTemplate) return null;
          // Legacy octal escape; read the rest of it.
          let digits = '0';
          while (/[0-7]/.test(source[this.pos] || '') && digits.length < 3) {
            digits += source[this.pos];
            this.pos += 1;
          }
          return String.fromCharCode(parseInt(digits, 8));
        }
        return '\0';
      case 'x': {
        const digits = source.slice(this.pos, this.pos + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(digits)) {
          if (inTemplate) return null;
          this.raise('Invalid hexadecimal escape sequence', this.pos);
        }
        this.pos += 2;
        return String.fromCharCode(parseInt(digits, 16));
      }
      case 'u': {
        if (inTemplate) {
          const probe = source[this.pos] === '{'
            ? /^\{[0-9a-fA-F]+\}/.test(source.slice(this.pos))
            : /^[0-9a-fA-F]{4}/.test(source.slice(this.pos));
          if (!probe) return null;
        }
        return String.fromCodePoint(this.readUnicodeEscapeValue());
      }
      default:
        if (isLineTerminator(char.charCodeAt(0))) {
          if (char === '\r' && source[this.pos] === '\n') this.pos += 1;
          return null;
        }
        if (/[1-9]/.test(char)) {
          if (inTemplate) return null;
          let digits = char;
          while (/[0-7]/.test(source[this.pos] || '') && digits.length < 3) {
            digits += source[this.pos];
            this.pos += 1;
          }
          return String.fromCharCode(parseInt(digits, 8));
        }
        return char;
    }
  }

  /**
   * Reads one chunk of a template literal.
   *
   * `start` is the backtick that opens the literal, or the `}` that closes a
   * substitution and resumes it.
   * @param {number} start - Where the chunk's delimiter is.
   * @returns {{cooked: (string|null), raw: string, tail: boolean, rawStart: number,
   *   rawEnd: number, end: number}} The chunk.
   */
  readTemplateChunk(start) {
    const source = this.source;
    let i = start + 1;
    let cooked = '';
    let invalid = false;
    const rawStart = i;
    while (true) {
      if (i >= source.length) this.raise('Unterminated template', start);
      const char = source[i];
      if (char === '`') {
        return { cooked: invalid ? null : cooked, raw: normaliseRaw(source.slice(rawStart, i)), tail: true, rawStart, rawEnd: i, end: i + 1 };
      }
      if (char === '$' && source[i + 1] === '{') {
        return { cooked: invalid ? null : cooked, raw: normaliseRaw(source.slice(rawStart, i)), tail: false, rawStart, rawEnd: i, end: i + 2 };
      }
      if (char === '\\') {
        this.pos = i + 1;
        const escaped = this.readEscape(true);
        if (escaped === null && source[this.pos - 1] !== '\n' && !isLineTerminator((source[i + 1] || '').charCodeAt(0))) {
          invalid = true;
        }
        cooked += escaped === null ? '' : escaped;
        i = this.pos;
        continue;
      }
      if (char === '\r') {
        // Template literals normalise CRLF and CR to LF.
        cooked += '\n';
        i += source[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      cooked += char;
      i += 1;
    }
  }

  /**
   * Re-reads the current token as a regular-expression literal.
   *
   * Only valid when the current token is `/` or `/=`; the parser calls this
   * where an operand is expected, which is exactly where a regex may appear.
   * @returns {Token} The regexp token, now current.
   */
  reScanAsRegExp() {
    const start = this.curr.start;
    const source = this.source;
    let i = start + 1;
    let inClass = false;
    while (true) {
      if (i >= source.length) this.raise('Unterminated regular expression', start);
      const char = source[i];
      if (isLineTerminator(char.charCodeAt(0))) this.raise('Unterminated regular expression', start);
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) break;
      i += 1;
    }
    const pattern = source.slice(start + 1, i);
    i += 1;
    const flagsStart = i;
    while (i < source.length && isIdPart(source[i])) i += 1;
    const flags = source.slice(flagsStart, i);
    if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) {
      this.raise('Invalid regular expression flags', flagsStart);
    }
    this.pos = i;
    this.curr = {
      type: 'regexp',
      value: { pattern, flags },
      start,
      end: i,
      nlBefore: this.curr.nlBefore,
      raw: source.slice(start, i),
    };
    return this.curr;
  }

  /**
   * Re-reads the current `}` as the continuation of a template literal.
   * @returns {Token} The template token, now current.
   */
  reScanTemplateContinue() {
    const start = this.curr.start;
    const chunk = this.readTemplateChunk(start);
    this.pos = chunk.end;
    this.curr = { type: 'template', value: chunk, start, end: chunk.end, nlBefore: this.curr.nlBefore };
    return this.curr;
  }

  /**
   * Skips a `#!` line, which is legal only at offset zero.
   * @returns {boolean} True when one was skipped.
   */
  skipHashBang() {
    if (this.pos !== 0 || !this.source.startsWith('#!')) return false;
    while (this.pos < this.source.length && !isLineTerminator(this.source.charCodeAt(this.pos))) this.pos += 1;
    return true;
  }
}

