/**
 * @file parser.js
 * @description A JavaScript expression parser for Avenx template expressions.
 *
 * ## Why Avenx needs its own
 *
 * Template expressions used to be handed straight to the engine:
 *
 * ```js
 * new Function(`with(this) { return (${expression}) }`)
 * ```
 *
 * Two consequences followed from that line, and neither could be fixed while
 * it stood.
 *
 * **`unsafe-eval` was structural.** Any Content-Security-Policy without
 * `'unsafe-eval'` stopped the framework working, which excludes it from
 * regulated environments, browser extensions, and a good many default
 * enterprise policies.
 *
 * **The sandbox was not a boundary.** `AvenxSandbox` wrapped values that
 * reached an expression *through the scope* and blocked the literal identifiers
 * `constructor`, `__proto__` and `prototype` with a regular expression over the
 * source text. An object created *inside* the expression never passed through
 * the scope, so it was never wrapped, and the text check fell to string
 * concatenation:
 *
 * ```js
 * ({})['const'+'ructor']['const'+'ructor']('return 1')()   // executed
 * ```
 *
 * There is no version of a source-text blacklist that closes that. The value
 * being guarded is produced by the engine, inside code the guard has already
 * handed over.
 *
 * ## What parsing changes
 *
 * Once Avenx holds the AST, it decides what every operation means. A member
 * access is a call into {@link module:lib/core/expression/evaluator}, with the
 * property key already resolved — so `x['const'+'ructor']` and `x.constructor`
 * arrive at the same check, because by then they are the same string. Nothing
 * is handed to the engine as code, so nothing needs `unsafe-eval`.
 *
 * ## Scope
 *
 * This parses the expression language Avenx templates use — everything up to
 * and including arrow functions, which templates need for `items.filter(i =>
 * i.done)`. It is not a full ECMAScript parser and does not try to be:
 * statements, classes, generators, `async`/`await`, destructuring patterns and
 * regular-expression literals are out of scope. An expression it cannot parse
 * raises {@link ExpressionParseError} rather than guessing, and the caller
 * decides what to do about it.
 * @module lib/core/expression/parser
 */

/**
 * Raised when an expression is outside the supported language.
 */
export class ExpressionParseError extends Error {
  /**
   * @param {string} message - What went wrong.
   * @param {number} position - Character offset in the expression.
   * @param {string} source - The expression being parsed.
   */
  constructor(message, position, source) {
    super(message);
    this.name = 'ExpressionParseError';
    /** @type {number} */
    this.position = position;
    /** @type {string} */
    this.source = source;
  }
}

/**
 * Binary operator precedence, higher binds tighter.
 * @type {Object<string, number>}
 */
const BINARY_PRECEDENCE = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '&': 6,
  '==': 7, '!=': 7, '===': 7, '!==': 7,
  '<': 8, '>': 8, '<=': 8, '>=': 8, 'in': 8, 'instanceof': 8,
  '<<': 9, '>>': 9, '>>>': 9,
  '+': 10, '-': 10,
  '*': 11, '/': 11, '%': 11,
  '**': 12,
};

/**
 * Operators sorted longest-first, so `>>>=` is matched before `>>>`.
 * @type {string[]}
 */
const PUNCTUATORS = [
  '>>>=', '===', '!==', '**=', '<<=', '>>=', '&&=', '||=', '??=', '...', '>>>',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '**',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%',
  '&', '|', '^', '!', '~', '?', ':', '=', '.',
];

/**
 * Assignment operators.
 * @type {Set<string>}
 */
const ASSIGNMENT_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=',
]);

/**
 * Keywords that are values rather than identifiers.
 * @type {Object<string, any>}
 */
const LITERAL_KEYWORDS = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
};

/**
 * Prefix operators.
 * @type {Set<string>}
 */
const UNARY_OPERATORS = new Set(['!', '-', '+', '~', 'typeof', 'void']);

/**
 * Whether a character can start an identifier.
 * @param {string} ch - A single character.
 * @returns {boolean} True when it can begin an identifier.
 */
function isIdentStart(ch) {
  return !!ch && /[A-Za-z_$]/.test(ch);
}

/**
 * Whether a character can continue an identifier.
 * @param {string} ch - A single character.
 * @returns {boolean} True when it can continue an identifier.
 */
function isIdentPart(ch) {
  return !!ch && /[\w$]/.test(ch);
}

/**
 * Turns an expression into tokens.
 *
 * Template literals are tokenised whole and re-parsed by the parser, because
 * their `${}` holes contain expressions and nesting them in the tokenizer would
 * require a second stack for no benefit.
 * @param {string} source - The expression source.
 * @returns {Array<object>} The token stream, terminated by an `eof` token.
 * @throws {ExpressionParseError} On an unterminated string or unknown character.
 */
export function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Comments are legal inside an action body and harmless in an expression.
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      let value = '';
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          value += unescapeChar(source, i);
          i += escapeLength(source, i);
          continue;
        }
        if (c === ch) {
          i++;
          closed = true;
          break;
        }
        value += c;
        i++;
      }
      if (!closed) {
        throw new ExpressionParseError('Unterminated string literal', start, source);
      }
      tokens.push({ type: 'string', value, start });
      continue;
    }

    if (ch === '`') {
      const start = i;
      const raw = readTemplateLiteral(source, i);
      i = raw.end;
      tokens.push({ type: 'template', value: raw.text, start });
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1]))) {
      const start = i;
      while (i < source.length && /[0-9a-fA-FxXoObBeE._]/.test(source[i])) {
        // An exponent sign is part of the number; a following `-` otherwise is not.
        if ((source[i] === 'e' || source[i] === 'E') && (source[i + 1] === '+' || source[i + 1] === '-')) {
          i += 2;
          continue;
        }
        i++;
      }
      const text = source.slice(start, i).replace(/_/g, '');
      const value = Number(text);
      if (Number.isNaN(value) && text.toLowerCase() !== 'nan') {
        throw new ExpressionParseError(`Invalid number "${text}"`, start, source);
      }
      tokens.push({ type: 'number', value, start });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i])) i++;
      tokens.push({ type: 'name', value: source.slice(start, i), start });
      continue;
    }

    const punctuator = PUNCTUATORS.find((p) => source.startsWith(p, i));
    if (punctuator) {
      tokens.push({ type: 'punct', value: punctuator, start: i });
      i += punctuator.length;
      continue;
    }

    throw new ExpressionParseError(`Unexpected character "${ch}"`, i, source);
  }

  tokens.push({ type: 'eof', value: null, start: source.length });
  return tokens;
}

/**
 * How many source characters an escape sequence occupies.
 * @param {string} source - The source.
 * @param {number} i - Offset of the backslash.
 * @returns {number} The sequence length including the backslash.
 */
function escapeLength(source, i) {
  const next = source[i + 1];
  if (next === 'u') {
    return source[i + 2] === '{' ? source.indexOf('}', i) - i + 1 : 6;
  }
  if (next === 'x') return 4;
  return 2;
}

/**
 * Resolves an escape sequence to the character it denotes.
 * @param {string} source - The source.
 * @param {number} i - Offset of the backslash.
 * @returns {string} The unescaped character.
 */
function unescapeChar(source, i) {
  const next = source[i + 1];
  switch (next) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case 'b': return '\b';
    case 'f': return '\f';
    case 'v': return '\v';
    case '0': return '\0';
    case 'x': return String.fromCharCode(parseInt(source.slice(i + 2, i + 4), 16));
    case 'u': {
      if (source[i + 2] === '{') {
        const close = source.indexOf('}', i);
        return String.fromCodePoint(parseInt(source.slice(i + 3, close), 16));
      }
      return String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
    }
    default: return next;
  }
}

/**
 * Reads a template literal, tracking nested braces and strings inside holes.
 * @param {string} source - The source.
 * @param {number} start - Offset of the opening backtick.
 * @returns {{text: string, end: number}} The literal text and the offset after it.
 * @throws {ExpressionParseError} When the literal is unterminated.
 */
function readTemplateLiteral(source, start) {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      return { text: source.slice(start + 1, i), end: i + 1 };
    }
    if (ch === '$' && source[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
          const quote = source[i];
          i++;
          while (i < source.length && source[i] !== quote) {
            if (source[i] === '\\') i++;
            i++;
          }
        }
        i++;
      }
      continue;
    }
    i++;
  }
  throw new ExpressionParseError('Unterminated template literal', start, source);
}

/**
 * Parses a semicolon-separated run of expression statements.
 *
 * Most inline handlers and short action bodies are one or more expressions:
 * `count++`, `busy = true; count++`, `state.text = event.target.value`. Those
 * take the AST path and need no eval. A body with real statement syntax --
 * `if`, `for`, `return`, a declaration -- is not an expression program and
 * raises, so the caller falls back.
 * @param {string} source - The statement source.
 * @returns {object} A Program node.
 * @throws {ExpressionParseError} When the source is not a run of expressions.
 */
export function parseExpressionProgram(source) {
  const parser = new Parser(source);
  const body = [];

  for (;;) {
    while (parser.eat(';')) {
      // Empty statement.
    }
    if (parser.peek().type === 'eof') break;
    body.push(parser.parseExpressionStatement());
    if (parser.eat(';')) continue;
    break;
  }

  parser.expectEnd();
  return { type: 'Program', body };
}

/**
 * Parses an expression into an AST.
 * @param {string} source - The expression source.
 * @returns {object} The root AST node.
 * @throws {ExpressionParseError} When the source is outside the supported language.
 */
export function parseExpression(source) {
  const parser = new Parser(source);
  const node = parser.parseExpressionStatement();
  parser.expectEnd();
  return node;
}

/**
 * A recursive-descent parser over a token stream.
 */
class Parser {
  /**
   * @param {string} source - The expression source.
   */
  constructor(source) {
    /** @type {string} */
    this.source = source;
    /** @type {Array<object>} */
    this.tokens = tokenize(source);
    /** @type {number} */
    this.index = 0;
  }

  /**
   * The token at the cursor.
   * @returns {object} The current token.
   */
  peek() {
    return this.tokens[this.index];
  }

  /**
   * Advances past the current token.
   * @returns {object} The token consumed.
   */
  next() {
    return this.tokens[this.index++];
  }

  /**
   * Whether the current token is a given punctuator.
   * @param {string} value - The punctuator.
   * @returns {boolean} True when it matches.
   */
  atPunct(value) {
    const token = this.peek();
    return token.type === 'punct' && token.value === value;
  }

  /**
   * Whether the current token is a given keyword.
   * @param {string} value - The keyword.
   * @returns {boolean} True when it matches.
   */
  atName(value) {
    const token = this.peek();
    return token.type === 'name' && token.value === value;
  }

  /**
   * Consumes a punctuator if present.
   * @param {string} value - The punctuator.
   * @returns {boolean} Whether it was consumed.
   */
  eat(value) {
    if (this.atPunct(value)) {
      this.index++;
      return true;
    }
    return false;
  }

  /**
   * Consumes a punctuator, or fails.
   * @param {string} value - The punctuator.
   * @throws {ExpressionParseError} When the token does not match.
   */
  expect(value) {
    if (!this.eat(value)) {
      const token = this.peek();
      throw new ExpressionParseError(
        `Expected "${value}" but found ${token.type === 'eof' ? 'end of expression' : `"${token.value}"`}`,
        token.start,
        this.source,
      );
    }
  }

  /**
   * Asserts the token stream is exhausted.
   * @throws {ExpressionParseError} When tokens remain.
   */
  expectEnd() {
    const token = this.peek();
    if (token.type !== 'eof') {
      throw new ExpressionParseError(`Unexpected "${token.value}"`, token.start, this.source);
    }
  }

  /**
   * Parses a full expression, including the comma operator.
   * @returns {object} The AST node.
   */
  parseExpressionStatement() {
    const first = this.parseAssignment();
    if (!this.atPunct(',')) {
      return first;
    }
    const expressions = [first];
    while (this.eat(',')) {
      expressions.push(this.parseAssignment());
    }
    return { type: 'Sequence', expressions };
  }

  /**
   * Parses an assignment, arrow function or conditional.
   * @returns {object} The AST node.
   */
  parseAssignment() {
    const arrow = this.tryParseArrow();
    if (arrow) {
      return arrow;
    }

    const left = this.parseConditional();
    const token = this.peek();
    if (token.type === 'punct' && ASSIGNMENT_OPERATORS.has(token.value)) {
      if (left.type !== 'Identifier' && left.type !== 'Member') {
        throw new ExpressionParseError('Invalid assignment target', token.start, this.source);
      }
      this.next();
      const right = this.parseAssignment();
      return { type: 'Assignment', operator: token.value, target: left, value: right };
    }
    return left;
  }

  /**
   * Attempts to parse an arrow function at the cursor.
   *
   * Speculative because `(a, b)` is ambiguous until `=>` is or is not found.
   * The cursor is restored when the guess is wrong, which is cheap: the token
   * stream is already materialised.
   * @returns {object|null} The arrow node, or null when this is not one.
   */
  tryParseArrow() {
    const start = this.index;

    // `x => …`
    const token = this.peek();
    if (token.type === 'name' && !Object.prototype.hasOwnProperty.call(LITERAL_KEYWORDS, token.value)) {
      const after = this.tokens[this.index + 1];
      if (after && after.type === 'punct' && after.value === '=>') {
        this.next();
        this.next();
        return { type: 'Arrow', params: [token.value], body: this.parseArrowBody() };
      }
    }

    // `(a, b) => …`
    if (this.atPunct('(')) {
      const params = [];
      this.next();
      let valid = true;
      if (!this.atPunct(')')) {
        for (;;) {
          const param = this.peek();
          if (param.type !== 'name') {
            valid = false;
            break;
          }
          params.push(param.value);
          this.next();
          if (this.eat(',')) continue;
          break;
        }
      }
      if (valid && this.eat(')') && this.atPunct('=>')) {
        this.next();
        return { type: 'Arrow', params, body: this.parseArrowBody() };
      }
      this.index = start;
    }

    return null;
  }

  /**
   * Parses a parenthesised parameter name list.
   * @returns {string[]} The parameter names.
   */
  parseParameterList() {
    this.expect('(');
    const params = [];
    if (!this.atPunct(')')) {
      for (;;) {
        const param = this.next();
        if (param.type !== 'name') {
          throw new ExpressionParseError('Expected a parameter name', param.start, this.source);
        }
        params.push(param.value);
        if (this.eat(',')) continue;
        break;
      }
    }
    this.expect(')');
    return params;
  }

  /**
   * Parses an arrow function's body.
   *
   * A braced body is supported only when it is a single `return`; anything more
   * is a statement list, which belongs to the statement evaluator rather than
   * here.
   * @returns {object} The body expression.
   */
  parseArrowBody() {
    if (this.atPunct('{')) {
      this.next();
      if (this.atName('return')) {
        this.next();
        const value = this.parseAssignment();
        this.eat(';');
        this.expect('}');
        return value;
      }
      if (this.eat('}')) {
        return { type: 'Literal', value: undefined };
      }
      const token = this.peek();
      throw new ExpressionParseError(
        'An arrow function body must be an expression or a single return statement',
        token.start,
        this.source,
      );
    }
    return this.parseAssignment();
  }

  /**
   * Parses a conditional expression.
   * @returns {object} The AST node.
   */
  parseConditional() {
    const test = this.parseBinary(0);
    if (this.eat('?')) {
      const consequent = this.parseAssignment();
      this.expect(':');
      const alternate = this.parseAssignment();
      return { type: 'Conditional', test, consequent, alternate };
    }
    return test;
  }

  /**
   * Parses a binary expression using precedence climbing.
   * @param {number} minPrecedence - The lowest precedence to accept.
   * @returns {object} The AST node.
   */
  parseBinary(minPrecedence) {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      const operator =
        token.type === 'punct' || (token.type === 'name' && (token.value === 'in' || token.value === 'instanceof'))
          ? token.value
          : null;
      const precedence = operator ? BINARY_PRECEDENCE[operator] : undefined;
      if (precedence === undefined || precedence < minPrecedence) {
        break;
      }
      this.next();
      // `**` is right-associative; everything else is left-associative.
      const right = this.parseBinary(operator === '**' ? precedence : precedence + 1);
      const type = operator === '&&' || operator === '||' || operator === '??' ? 'Logical' : 'Binary';
      left = { type, operator, left, right };
    }

    return left;
  }

  /**
   * Parses a prefix expression.
   * @returns {object} The AST node.
   */
  parseUnary() {
    const token = this.peek();

    if (token.type === 'punct' && (token.value === '++' || token.value === '--')) {
      this.next();
      const argument = this.parseUnary();
      if (argument.type !== 'Identifier' && argument.type !== 'Member') {
        throw new ExpressionParseError('Invalid update target', token.start, this.source);
      }
      return { type: 'Update', operator: token.value, prefix: true, argument };
    }

    if ((token.type === 'punct' || token.type === 'name') && UNARY_OPERATORS.has(token.value)) {
      this.next();
      return { type: 'Unary', operator: token.value, argument: this.parseUnary() };
    }

    return this.parsePostfix();
  }

  /**
   * Parses a postfix update.
   * @returns {object} The AST node.
   */
  parsePostfix() {
    const argument = this.parseCallMember();
    const token = this.peek();
    if (token.type === 'punct' && (token.value === '++' || token.value === '--')) {
      if (argument.type !== 'Identifier' && argument.type !== 'Member') {
        throw new ExpressionParseError('Invalid update target', token.start, this.source);
      }
      this.next();
      return { type: 'Update', operator: token.value, prefix: false, argument };
    }
    return argument;
  }

  /**
   * Parses the constructor of a `new` expression: member access only, no calls.
   * @returns {object} The AST node.
   */
  parseNewCallee() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.eat('.')) {
        const name = this.next();
        if (name.type !== 'name') {
          throw new ExpressionParseError('Expected a property name after "."', name.start, this.source);
        }
        node = {
          type: 'Member',
          object: node,
          property: { type: 'Literal', value: name.value },
          computed: false,
          optional: false,
        };
        continue;
      }
      if (this.eat('[')) {
        const property = this.parseExpressionStatement();
        this.expect(']');
        node = { type: 'Member', object: node, property, computed: true, optional: false };
        continue;
      }
      break;
    }
    return node;
  }

  /**
   * Parses member access and calls, left to right.
   * @returns {object} The AST node.
   */
  parseCallMember() {
    let node = this.parsePrimary();

    for (;;) {
      if (this.eat('.')) {
        const name = this.next();
        if (name.type !== 'name') {
          throw new ExpressionParseError('Expected a property name after "."', name.start, this.source);
        }
        node = { type: 'Member', object: node, property: { type: 'Literal', value: name.value }, computed: false, optional: false };
        continue;
      }

      if (this.atPunct('?.')) {
        this.next();
        if (this.atPunct('(')) {
          node = { type: 'Call', callee: node, args: this.parseArguments(), optional: true };
          continue;
        }
        if (this.atPunct('[')) {
          this.next();
          const property = this.parseExpressionStatement();
          this.expect(']');
          node = { type: 'Member', object: node, property, computed: true, optional: true };
          continue;
        }
        const name = this.next();
        if (name.type !== 'name') {
          throw new ExpressionParseError('Expected a property name after "?."', name.start, this.source);
        }
        node = { type: 'Member', object: node, property: { type: 'Literal', value: name.value }, computed: false, optional: true };
        continue;
      }

      if (this.eat('[')) {
        const property = this.parseExpressionStatement();
        this.expect(']');
        node = { type: 'Member', object: node, property, computed: true, optional: false };
        continue;
      }

      if (this.atPunct('(')) {
        node = { type: 'Call', callee: node, args: this.parseArguments(), optional: false };
        continue;
      }

      break;
    }

    return node;
  }

  /**
   * Parses a parenthesised argument list.
   * @returns {Array<object>} The argument nodes.
   */
  parseArguments() {
    this.expect('(');
    const args = [];
    if (!this.atPunct(')')) {
      for (;;) {
        if (this.eat('...')) {
          args.push({ type: 'Spread', argument: this.parseAssignment() });
        } else {
          args.push(this.parseAssignment());
        }
        if (this.eat(',')) continue;
        break;
      }
    }
    this.expect(')');
    return args;
  }

  /**
   * Parses a primary expression.
   * @returns {object} The AST node.
   */
  parsePrimary() {
    const token = this.peek();

    if (token.type === 'number' || token.type === 'string') {
      this.next();
      return { type: 'Literal', value: token.value };
    }

    if (token.type === 'template') {
      this.next();
      return this.parseTemplateParts(token.value);
    }

    if (token.type === 'name') {
      if (Object.prototype.hasOwnProperty.call(LITERAL_KEYWORDS, token.value)) {
        this.next();
        return { type: 'Literal', value: LITERAL_KEYWORDS[token.value] };
      }
      if (token.value === 'function') {
        // A function expression used as a callback -- `items.map(function (i) {
        // return i.label; })` -- is ordinary template code, and refusing it
        // would push the expression onto a path that no longer exists. The body
        // is parsed on the same terms as an arrow's: an expression, or a single
        // return.
        this.next();
        if (this.peek().type === 'name') {
          this.next();
        }
        const params = this.parseParameterList();
        return { type: 'Arrow', params, body: this.parseArrowBody(), isFunction: true };
      }

      if (token.value === 'new') {
        this.next();
        // The constructor is a member expression *without* calls: in
        // `new Date().getTime()` the `new` binds to `Date`, and `.getTime()`
        // applies to the instance. Parsing the whole call chain first and then
        // unwrapping it gets that backwards.
        const callee = this.parseNewCallee();
        const args = this.atPunct('(') ? this.parseArguments() : [];
        return { type: 'New', callee, args };
      }
      this.next();
      return { type: 'Identifier', name: token.value, start: token.start };
    }

    if (this.atPunct('(')) {
      this.next();
      const inner = this.parseExpressionStatement();
      this.expect(')');
      return inner;
    }

    if (this.atPunct('[')) {
      this.next();
      const elements = [];
      if (!this.atPunct(']')) {
        for (;;) {
          if (this.atPunct(']')) break;
          if (this.eat('...')) {
            elements.push({ type: 'Spread', argument: this.parseAssignment() });
          } else {
            elements.push(this.parseAssignment());
          }
          if (this.eat(',')) continue;
          break;
        }
      }
      this.expect(']');
      return { type: 'ArrayLiteral', elements };
    }

    if (this.atPunct('{')) {
      this.next();
      const properties = [];
      if (!this.atPunct('}')) {
        for (;;) {
          if (this.atPunct('}')) break;
          if (this.eat('...')) {
            properties.push({ kind: 'spread', value: this.parseAssignment() });
            if (this.eat(',')) continue;
            break;
          }
          const key = this.parseObjectKey();
          if (this.eat(':')) {
            properties.push({ kind: 'init', key, value: this.parseAssignment() });
          } else if (key.computed) {
            throw new ExpressionParseError('A computed key needs a value', this.peek().start, this.source);
          } else {
            // Shorthand: `{ count }`.
            properties.push({
              kind: 'init',
              key,
              value: { type: 'Identifier', name: key.node.value },
            });
          }
          if (this.eat(',')) continue;
          break;
        }
      }
      this.expect('}');
      return { type: 'ObjectLiteral', properties };
    }

    throw new ExpressionParseError(
      token.type === 'eof' ? 'Unexpected end of expression' : `Unexpected "${token.value}"`,
      token.start,
      this.source,
    );
  }

  /**
   * Parses an object literal key.
   * @returns {{computed: boolean, node: object}} The key description.
   */
  parseObjectKey() {
    if (this.eat('[')) {
      const node = this.parseAssignment();
      this.expect(']');
      return { computed: true, node };
    }
    const token = this.next();
    if (token.type === 'name' || token.type === 'string' || token.type === 'number') {
      return { computed: false, node: { type: 'Literal', value: String(token.value) } };
    }
    throw new ExpressionParseError('Expected a property name', token.start, this.source);
  }

  /**
   * Splits a template literal into its static and interpolated parts.
   * @param {string} raw - The text between the backticks.
   * @returns {object} A TemplateLiteral node.
   */
  parseTemplateParts(raw) {
    const quasis = [];
    const expressions = [];
    let text = '';
    let i = 0;

    while (i < raw.length) {
      if (raw[i] === '\\') {
        text += unescapeChar(raw, i);
        i += escapeLength(raw, i);
        continue;
      }
      if (raw[i] === '$' && raw[i + 1] === '{') {
        let depth = 1;
        let j = i + 2;
        while (j < raw.length && depth > 0) {
          if (raw[j] === '{') depth++;
          else if (raw[j] === '}') depth--;
          if (depth === 0) break;
          j++;
        }
        quasis.push(text);
        text = '';
        expressions.push(parseExpression(raw.slice(i + 2, j)));
        i = j + 1;
        continue;
      }
      text += raw[i];
      i++;
    }

    quasis.push(text);
    return { type: 'TemplateLiteral', quasis, expressions };
  }
}
