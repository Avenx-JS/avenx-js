/**
 * @file parser.js
 * @description The compiler's own ECMAScript parser, producing ESTree.
 *
 * ## Why the compiler owns a JavaScript parser
 *
 * Four places in the compiler have to understand real JavaScript rather than
 * the small expression language templates use: the action compiler rewrites
 * free identifiers in an `<action>` body, the `csp.strict` check proves an
 * emitted bundle contains no `eval`, the component reader decides whether a
 * `.component.js` file is markup or a module, and the declaration reader
 * evaluates a constant initialiser. All four used `acorn`, which made a parser
 * the published package's only runtime dependency.
 *
 * That dependency is now gone. `acorn` stays in `devDependencies`, where
 * {@link ../../../../test/unit/jsParserDifferential.test.js} runs it against
 * this parser over the whole repository and over generated sources: it is the
 * oracle that keeps this file honest, and it is never on a build path.
 *
 * ## What it supports, and what it refuses
 *
 * Everything through ES2024 that appears in real source: modules, classes with
 * private names and static blocks, generators, `async`/`await` including
 * top-level await, optional chaining, destructuring with defaults and rest,
 * template literals with nesting, regular-expression literals, labels, `for
 * await`, BigInt, numeric separators, dynamic `import()`, `import.meta` and
 * `new.target`.
 *
 * What it does not recognise, it refuses with a position. There is no
 * permissive branch and no recovery: the compiler's rule is compile-or-refuse,
 * and a parser that guessed at syntax it did not model would turn a build error
 * into a silent miscompile.
 *
 * ## Shape
 *
 * Nodes are ESTree with acorn's conventions, because that is what the code
 * reading them already expects: `start`/`end` offsets on every node, `loc`
 * under `locations: true`, `ChainExpression` around an optional chain,
 * `directive` on a directive-prologue statement, `attributes` on an import.
 * The differential test compares property-for-property, so the two cannot
 * drift.
 * @module lib/compiler/parser/js/parser
 */

import { Tokenizer, JsParseError, RESERVED_WORDS } from './tokenizer.js';

/**
 * Thrown internally to abandon a speculative parse. Never escapes.
 * @type {object}
 */
const BAIL = { bail: true };

/**
 * Binary operator precedence. Higher binds tighter.
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
 * Assignment operators.
 * @type {Set<string>}
 */
const ASSIGN_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '>>>=', '|=', '^=', '&=',
  '**=', '&&=', '||=', '??=',
]);

/**
 * Unary operators that take a prefix argument.
 * @type {Set<string>}
 */
const UNARY_OPERATORS = new Set(['-', '+', '!', '~']);

/**
 * Words that are reserved only in strict mode.
 * @type {Set<string>}
 */
const STRICT_RESERVED = new Set([
  'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield',
]);

/** A scope that `var` reaches: the top level or a function body. @type {number} */
const SCOPE_VAR = 1;
/** A scope that only holds lexical declarations. @type {number} */
const SCOPE_BLOCK = 2;
/** A `catch (e)` scope, whose single simple binding `var` may redeclare. @type {number} */
const SCOPE_SIMPLE_CATCH = 4;

/**
 * One binding scope.
 *
 * Duplicate-declaration errors are early errors rather than parse errors, but
 * they are errors all the same, and a compiler whose parser accepted
 * `const a = 1; const a = 2;` would hand the code generator a program that no
 * engine will run. Tracking names is what lets this parser refuse them with a
 * position, as acorn does.
 */
class BindingScope {
  /**
   * @param {number} flags - A combination of the SCOPE_ constants.
   */
  constructor(flags) {
    /** @type {number} */
    this.flags = flags;
    /** @type {Set<string>} Names declared with `var`, or as parameters. */
    this.var = new Set();
    /** @type {Set<string>} Names declared with `let`, `const` or `class`. */
    this.lexical = new Set();
    /** @type {Set<string>} Function declarations, which sloppy code may repeat. */
    this.functions = new Set();
    /** @type {string|null} The name a simple `catch` clause binds. */
    this.simpleCatchName = null;
  }
}

/**
 * A recursive-descent ECMAScript parser.
 */
class Parser {
  /**
   * @param {string} source - The source text.
   * @param {object} [options] - Parse options; see {@link parse}.
   */
  constructor(source, options = {}) {
    /** @type {string} */
    this.input = source;
    /** @type {object} */
    this.options = options;
    /** @type {boolean} */
    this.locations = !!options.locations;
    /** @type {'script'|'module'} */
    this.sourceType = options.sourceType === 'module' ? 'module' : 'script';
    /** @type {Tokenizer} */
    this.tz = new Tokenizer(source);
    if (options.allowHashBang !== false) this.tz.skipHashBang();
    /** @type {import('./tokenizer.js').Token} */
    this.tok = this.tz.nextToken();

    /** @type {boolean} Whether `return` is currently legal. */
    this.inFunction = !!options.allowReturnOutsideFunction;
    /** @type {boolean} Whether `await` is currently an operator. */
    this.inAsync = this.sourceType === 'module' || !!options.allowAwaitOutsideFunction;
    /** @type {boolean} Whether `yield` is currently an operator. */
    this.inGenerator = false;
    /** @type {boolean} Whether `super.x` is currently legal. */
    this.inMethod = !!options.allowSuperOutsideMethod;
    /** @type {boolean} Whether `super()` is currently legal. */
    this.inDerivedConstructor = !!options.allowSuperOutsideMethod;
    /** @type {boolean} Whether `new.target` is currently legal. */
    this.inNewTargetScope = !!options.allowNewTargetOutsideFunction;
    /** @type {boolean} Whether strict-mode-only rules apply. */
    this.strict = this.sourceType === 'module';
    /** @type {string[]} Labels in scope, for `break`/`continue`. */
    this.labels = [];
    /** @type {number} Loop and switch nesting, for unlabelled `break`. */
    this.breakDepth = 0;
    /** @type {number} Loop nesting, for unlabelled `continue`. */
    this.continueDepth = 0;
    /** @type {BindingScope[]} The scope chain. */
    this.scopeStack = [];
    /**
     * Every binding added, so a speculative parse can be undone exactly.
     * Cloning the scope chain on each guess would cost a pass over every name
     * in scope; an undo log costs one entry per binding.
     * @type {Array<{set: Set<string>, name: string}>}
     */
    this.bindingLog = [];
    /**
     * One frame per class body being parsed: the private names it declares,
     * and the ones used inside it that no inner class declared. A use that
     * reaches the bottom of the stack unresolved is an error, which is what
     * makes `this.#gone` a build failure rather than a runtime one.
     * @type {Array<{declared: Set<string>, used: Array<{name: string, pos: number}>,
     *   roles: Map<string, string>}>}
     */
    this.privateNameStack = [];
    /**
     * Shorthand properties with a default, `{ a = 1 }`, which are legal only
     * once the object turns out to be a destructuring pattern. Each is cleared
     * by {@link Parser#toAssignable}; whatever is left when the parse ends was
     * never a pattern.
     * @type {Array<{start: number}>}
     */
    this.pendingShorthandDefaults = [];
  }

  /**
   * Pushes a scope.
   * @param {number} flags - A combination of the SCOPE_ constants.
   */
  enterScope(flags) {
    this.scopeStack.push(new BindingScope(flags));
  }

  /**
   * Pops the current scope.
   */
  exitScope() {
    this.scopeStack.pop();
  }

  /**
   * @returns {BindingScope} The innermost scope.
   */
  currentScope() {
    return this.scopeStack[this.scopeStack.length - 1];
  }

  /**
   * Records a name in a set, so the undo log can remove it again.
   * @param {Set<string>} set - The set to add to.
   * @param {string} name - The name.
   */
  addBinding(set, name) {
    if (set.has(name)) return;
    set.add(name);
    this.bindingLog.push({ set, name });
  }

  /**
   * Declares a name, refusing a redeclaration the language forbids.
   * @param {string} name - The declared name.
   * @param {'var'|'lexical'|'function'|'param'|'simple-catch'} kind - How it is declared.
   * @param {number} pos - Where to report a clash.
   */
  declareName(name, kind, pos) {
    const scope = this.currentScope();
    if (!scope) return;

    if (kind === 'lexical' || kind === 'simple-catch' || (kind === 'function' && this.strict)) {
      if (scope.lexical.has(name) || scope.functions.has(name) || scope.var.has(name)) {
        this.raise(`Identifier '${name}' has already been declared`, pos);
      }
      this.addBinding(scope.lexical, name);
      if (kind === 'simple-catch') scope.simpleCatchName = name;
      return;
    }

    if (kind === 'param') {
      this.addBinding(scope.var, name);
      return;
    }

    // `var` and a sloppy function declaration reach the nearest var scope, and
    // may not pass a lexical binding of the same name on the way.
    for (let i = this.scopeStack.length - 1; i >= 0; i -= 1) {
      const current = this.scopeStack[i];
      const shadowedByCatch = (current.flags & SCOPE_SIMPLE_CATCH) !== 0 && current.simpleCatchName === name;
      if (current.lexical.has(name) && !shadowedByCatch) {
        this.raise(`Identifier '${name}' has already been declared`, pos);
      }
      if (kind === 'function' && current.functions.has(name) && (current.flags & SCOPE_VAR) === 0) {
        // Two function declarations in one block are allowed in sloppy code.
        break;
      }
      this.addBinding(current.var, name);
      if (kind === 'function') this.addBinding(current.functions, name);
      if ((current.flags & SCOPE_VAR) !== 0) break;
    }
  }

  // ---------------------------------------------------------------- utilities

  /**
   * Raises a positioned error.
   * @param {string} message - What went wrong.
   * @param {number} [pos] - Where.
   * @throws {import('./tokenizer.js').JsParseError} Always.
   */
  raise(message, pos = this.tok.start) {
    this.tz.raise(message, pos);
  }

  /**
   * Reports the current token as unexpected.
   * @throws {import('./tokenizer.js').JsParseError} Always.
   */
  unexpected() {
    this.raise('Unexpected token');
  }

  /**
   * Advances to the next token.
   */
  next() {
    this.tok = this.tz.nextToken();
  }

  /**
   * @param {string} value - A punctuator.
   * @returns {boolean} Whether the current token is it.
   */
  isPunct(value) {
    return this.tok.type === 'punct' && this.tok.value === value;
  }

  /**
   * @param {string} value - A word.
   * @returns {boolean} Whether the current token is that identifier or keyword.
   */
  isName(value) {
    return this.tok.type === 'name' && this.tok.value === value;
  }

  /**
   * Consumes the current token when it is the given punctuator.
   * @param {string} value - A punctuator.
   * @returns {boolean} Whether it was consumed.
   */
  eatPunct(value) {
    if (!this.isPunct(value)) return false;
    this.next();
    return true;
  }

  /**
   * Consumes the current token when it is the given word.
   * @param {string} value - A word.
   * @returns {boolean} Whether it was consumed.
   */
  eatName(value) {
    if (!this.isName(value)) return false;
    this.next();
    return true;
  }

  /**
   * Consumes the given punctuator or fails.
   * @param {string} value - A punctuator.
   */
  expectPunct(value) {
    if (!this.eatPunct(value)) this.raise(`Expected '${value}'`);
  }

  /**
   * Consumes the given word or fails.
   * @param {string} value - A word.
   */
  expectName(value) {
    if (!this.eatName(value)) this.raise(`Expected '${value}'`);
  }

  /**
   * @returns {boolean} Whether a semicolon may be inserted here.
   */
  canInsertSemicolon() {
    return this.tok.type === 'eof' || this.isPunct('}') || this.tok.nlBefore;
  }

  /**
   * Consumes a statement-ending semicolon, real or inserted.
   */
  semicolon() {
    if (this.eatPunct(';')) return;
    if (!this.canInsertSemicolon()) this.raise('Expected a semicolon');
  }

  /**
   * Starts a node at the current token.
   * @returns {object} A bare node.
   */
  startNode() {
    return this.startNodeAt(this.tok.start);
  }

  /**
   * Starts a node at a given offset.
   * @param {number} pos - The offset.
   * @returns {object} A bare node.
   */
  startNodeAt(pos) {
    /** @type {any} */
    const node = { type: '', start: pos, end: 0 };
    if (this.locations) node.loc = { start: this.tz.locate(pos), end: null };
    return node;
  }

  /**
   * Finishes a node at the end of the previous token.
   * @param {object} node - The node.
   * @param {string} type - Its ESTree type.
   * @returns {object} The node.
   */
  finishNode(node, type) {
    return this.finishNodeAt(node, type, this.tz.lastEnd);
  }

  /**
   * Finishes a node at an explicit offset.
   * @param {object} node - The node.
   * @param {string} type - Its ESTree type.
   * @param {number} end - The end offset.
   * @returns {object} The node.
   */
  finishNodeAt(node, type, end) {
    /** @type {any} */
    const target = node;
    target.type = type;
    target.end = end;
    if (this.locations) target.loc.end = this.tz.locate(end);
    return target;
  }

  /**
   * Captures parser and tokenizer state for a speculative parse.
   * @returns {object} The state.
   */
  saveState() {
    return {
      tz: this.tz.save(),
      tok: this.tok,
      inFunction: this.inFunction,
      inAsync: this.inAsync,
      inGenerator: this.inGenerator,
      inMethod: this.inMethod,
      inDerivedConstructor: this.inDerivedConstructor,
      inNewTargetScope: this.inNewTargetScope,
      strict: this.strict,
      labels: this.labels.slice(),
      breakDepth: this.breakDepth,
      continueDepth: this.continueDepth,
      scopeDepth: this.scopeStack.length,
      privateDepth: this.privateNameStack.length,
      bindings: this.bindingLog.length,
      shorthandDefaults: this.pendingShorthandDefaults.length,
    };
  }

  /**
   * Restores state captured by {@link Parser#saveState}.
   * @param {object} state - The state.
   */
  restoreState(state) {
    this.tz.restore(state.tz);
    this.tok = state.tok;
    this.inFunction = state.inFunction;
    this.inAsync = state.inAsync;
    this.inGenerator = state.inGenerator;
    this.inMethod = state.inMethod;
    this.inDerivedConstructor = state.inDerivedConstructor;
    this.inNewTargetScope = state.inNewTargetScope;
    this.strict = state.strict;
    this.labels = state.labels;
    this.breakDepth = state.breakDepth;
    this.continueDepth = state.continueDepth;
    this.scopeStack.length = state.scopeDepth;
    this.privateNameStack.length = state.privateDepth;
    while (this.bindingLog.length > state.bindings) {
      const entry = this.bindingLog.pop();
      entry.set.delete(entry.name);
    }
    this.pendingShorthandDefaults.length = state.shorthandDefaults;
  }

  /**
   * Peeks at the token after the current one.
   * @returns {import('./tokenizer.js').Token} The next token.
   */
  peek() {
    const state = this.tz.save();
    const token = this.tz.nextToken();
    this.tz.restore(state);
    return token;
  }

  // --------------------------------------------------------------- statements

  /**
   * Parses the whole input.
   * @returns {object} A Program node.
   */
  parseTopLevel() {
    const node = this.startNodeAt(0);
    node.body = [];
    this.enterScope(SCOPE_VAR);
    let prologue = true;
    while (this.tok.type !== 'eof') {
      const statement = this.parseStatement(true);
      if (prologue) {
        if (this.isDirective(statement)) {
          statement.directive = statement.expression.raw.slice(1, -1);
          if (statement.directive === 'use strict') this.strict = true;
        } else {
          prologue = false;
        }
      }
      node.body.push(statement);
    }
    this.flushShorthandDefaults();
    this.exitScope();
    node.sourceType = this.sourceType;
    return this.finishNodeAt(node, 'Program', this.input.length);
  }

  /**
   * Reports any `{ a = 1 }` that never became a destructuring pattern.
   */
  flushShorthandDefaults() {
    if (this.pendingShorthandDefaults.length === 0) return;
    const first = this.pendingShorthandDefaults.reduce((a, b) => (a.start <= b.start ? a : b));
    this.raise('A shorthand property default is only valid in a destructuring pattern', first.start);
  }

  /**
   * Whether a statement is a directive-prologue entry.
   * @param {object} statement - The statement.
   * @returns {boolean} True when it is.
   */
  isDirective(statement) {
    return (
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'Literal' &&
      // `("use strict");` is an expression, not a directive, so the literal has
      // to begin where the statement does.
      statement.expression.start === statement.start &&
      typeof statement.expression.value === 'string' &&
      typeof statement.expression.raw === 'string' &&
      (statement.expression.raw[0] === '"' || statement.expression.raw[0] === "'")
    );
  }

  /**
   * Parses one statement.
   * @param {boolean} [topLevel] - Whether `import`/`export` are legal here.
   * @param {boolean} [declarations] - Whether a lexical declaration is legal here,
   *   which it is not as the body of an `if` or a loop.
   * @param {'list'|'single'|'none'} [functions] - Where a function declaration
   *   may stand: anywhere in a statement list, directly as a sloppy `if`
   *   branch, or nowhere.
   * @returns {object} The statement node.
   */
  parseStatement(topLevel = false, declarations = true, functions = 'list') {
    if (this.tok.type === 'punct') {
      switch (this.tok.value) {
        case '{':
          return this.parseBlock();
        case ';': {
          const node = this.startNode();
          this.next();
          return this.finishNode(node, 'EmptyStatement');
        }
        default:
          break;
      }
    }

    if (this.tok.type === 'name') {
      switch (this.tok.value) {
        case 'var':
          // `var` is a statement, so `if (a) var b = 1;` is legal; only a
          // lexical declaration is refused in a statement position.
          return this.parseVarStatement('var');
        case 'const':
          if (!declarations) this.raise('A lexical declaration cannot be the body of a statement');
          return this.parseVarStatement('const');
        case 'let':
          // Where a declaration is not allowed, `let` can only be a reference,
          // which is how `for (a of b) let x = 1` fails at `x` rather than here.
          if (declarations && this.isLetDeclaration()) return this.parseVarStatement('let');
          break;
        case 'function':
          // A statement list always allows one. Directly as an `if` branch,
          // sloppy code allows it too, which Annex B grandfathered in.
          // Everywhere else -- a loop body, a label inside one -- it is an error.
          if (functions === 'none' || (functions === 'single' && this.strict)) {
            this.raise('A function declaration cannot appear here');
          }
          // Annex B grandfathered a plain function, never a generator.
          if (functions !== 'list' && this.peek().value === '*') {
            this.raise('A generator declaration cannot appear here');
          }
          return this.parseFunctionStatement(false);
        case 'class':
          if (!declarations) this.raise('A lexical declaration cannot be the body of a statement');
          return this.parseClass(this.startNode(), true);
        case 'if':
          return this.parseIf();
        case 'for':
          return this.parseFor();
        case 'while':
          return this.parseWhile();
        case 'do':
          return this.parseDoWhile();
        case 'switch':
          return this.parseSwitch();
        case 'try':
          return this.parseTry();
        case 'with':
          return this.parseWith();
        case 'return':
          return this.parseReturn();
        case 'throw':
          return this.parseThrow();
        case 'break':
        case 'continue':
          return this.parseBreakContinue(this.tok.value);
        case 'debugger': {
          const node = this.startNode();
          this.next();
          this.semicolon();
          return this.finishNode(node, 'DebuggerStatement');
        }
        case 'import': {
          const after = this.peek();
          const isCall = after.type === 'punct' && (after.value === '(' || after.value === '.');
          if (!isCall) {
            if (this.sourceType !== 'module') this.raise("'import' is only allowed in a module");
            if (!topLevel) this.raise("'import' may only appear at the top level");
            return this.parseImport();
          }
          break;
        }
        case 'export':
          if (this.sourceType !== 'module') this.raise("'export' is only allowed in a module");
          if (!topLevel) this.raise("'export' may only appear at the top level");
          return this.parseExport();
        case 'async': {
          const after = this.peek();
          if (after.type === 'name' && after.value === 'function' && !after.nlBefore) {
            if (functions !== 'list') this.raise('A function declaration cannot appear here');
            return this.parseFunctionStatement(true);
          }
          break;
        }
        default:
          break;
      }
    }

    // A label is the one place a statement starts with an identifier followed
    // by a colon, and it has to be told apart from an expression before the
    // expression is parsed.
    if (this.tok.type === 'name' && !RESERVED_WORDS.has(this.tok.value)) {
      const after = this.peek();
      if (after.type === 'punct' && after.value === ':') {
        return this.parseLabeledStatement(functions);
      }
    }

    const node = this.startNode();
    node.expression = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, 'ExpressionStatement');
  }

  /**
   * Whether the `let` at the current token opens a declaration.
   *
   * `let` is not a reserved word, so `let` alone, `let.x` and `let(0)` are all
   * references to a variable called `let`. A declaration is `let` followed by a
   * binding: an identifier, `[` or `{`.
   * @returns {boolean} True when it declares.
   */
  isLetDeclaration() {
    const after = this.peek();
    if (after.type === 'name') return !RESERVED_WORDS.has(after.value) || after.value === 'let';
    if (after.type === 'punct') return after.value === '[' || after.value === '{';
    return false;
  }

  /**
   * Parses `{ … }`.
   * @param {boolean} [ownScope] - Whether the block introduces a scope of its
   *   own. A `catch` body shares the clause's scope, so its block does not.
   * @returns {object} A BlockStatement.
   */
  parseBlock(ownScope = true) {
    const node = this.startNode();
    this.expectPunct('{');
    if (ownScope) this.enterScope(SCOPE_BLOCK);
    node.body = [];
    while (!this.eatPunct('}')) {
      if (this.tok.type === 'eof') this.raise("Expected '}'");
      node.body.push(this.parseStatement());
    }
    if (ownScope) this.exitScope();
    return this.finishNode(node, 'BlockStatement');
  }

  /**
   * Parses a `var`, `let` or `const` statement.
   * @param {string} kind - The declaration keyword.
   * @returns {object} A VariableDeclaration.
   */
  parseVarStatement(kind) {
    const node = this.startNode();
    this.next();
    this.parseVarDeclarations(node, kind, false);
    this.semicolon();
    return this.finishNode(node, 'VariableDeclaration');
  }

  /**
   * Parses the declarator list of a variable declaration.
   * @param {object} node - The declaration node.
   * @param {string} kind - The declaration keyword.
   * @param {boolean} noIn - Whether `in` is an operator here.
   */
  parseVarDeclarations(node, kind, noIn) {
    node.declarations = [];
    node.kind = kind;
    for (;;) {
      const declarator = this.startNode();
      declarator.id = this.parseBindingAtom(kind === 'var' ? 'var' : 'lexical');
      declarator.init = this.eatPunct('=') ? this.parseMaybeAssign(noIn) : null;
      if (declarator.init === null && kind === 'const' && !noIn) {
        this.raise('A const declaration must have an initialiser', declarator.start);
      }
      if (declarator.init === null && declarator.id.type !== 'Identifier' && !noIn) {
        this.raise('A destructuring declaration must have an initialiser', declarator.start);
      }
      node.declarations.push(this.finishNode(declarator, 'VariableDeclarator'));
      if (!this.eatPunct(',')) break;
    }
  }

  /**
   * Parses a function declaration.
   * @param {boolean} isAsync - Whether it is `async function`.
   * @returns {object} A FunctionDeclaration.
   */
  parseFunctionStatement(isAsync) {
    const node = this.startNode();
    if (isAsync) this.next();
    this.expectName('function');
    const isGenerator = this.eatPunct('*');
    const namePos = this.tok.start;
    node.id = this.parseIdentifier();
    this.declareName(node.id.name, 'function', namePos);
    return this.parseFunctionRest(node, 'FunctionDeclaration', isAsync, isGenerator);
  }

  /**
   * Parses the parameters and body of a function.
   * @param {object} node - The started node.
   * @param {string} type - FunctionDeclaration or FunctionExpression.
   * @param {boolean} isAsync - Whether it is async.
   * @param {boolean} isGenerator - Whether it is a generator.
   * @returns {object} The finished node.
   */
  parseFunctionRest(node, type, isAsync, isGenerator) {
    node.expression = false;
    node.generator = isGenerator;
    node.async = isAsync;
    node.params = this.parseParams();
    const outer = this.enterFunction(isAsync, isGenerator);
    this.declareParams(node.params);
    node.body = this.parseFunctionBody();
    this.exitFunction(outer);
    return this.finishNode(node, type);
  }

  /**
   * Enters a function scope.
   * @param {boolean} isAsync - Whether it is async.
   * @param {boolean} isGenerator - Whether it is a generator.
   * @returns {object} The state to restore.
   */
  enterFunction(isAsync, isGenerator) {
    const outer = {
      inFunction: this.inFunction,
      inAsync: this.inAsync,
      inGenerator: this.inGenerator,
      inNewTargetScope: this.inNewTargetScope,
      labels: this.labels,
      breakDepth: this.breakDepth,
      continueDepth: this.continueDepth,
    };
    this.inFunction = true;
    this.inAsync = isAsync;
    this.inGenerator = isGenerator;
    this.inNewTargetScope = true;
    this.labels = [];
    this.breakDepth = 0;
    this.continueDepth = 0;
    this.enterScope(SCOPE_VAR);
    return outer;
  }

  /**
   * Leaves a function scope.
   * @param {object} outer - The state from {@link Parser#enterFunction}.
   */
  exitFunction(outer) {
    this.exitScope();
    Object.assign(this, outer);
  }

  /**
   * Parses a function body, honouring a `'use strict'` directive in it.
   * @returns {object} A BlockStatement.
   */
  parseFunctionBody() {
    const node = this.startNode();
    this.expectPunct('{');
    node.body = [];
    const outerStrict = this.strict;
    let prologue = true;
    while (!this.eatPunct('}')) {
      if (this.tok.type === 'eof') this.raise("Expected '}'");
      const statement = this.parseStatement();
      if (prologue) {
        if (this.isDirective(statement)) {
          statement.directive = statement.expression.raw.slice(1, -1);
          if (statement.directive === 'use strict') this.strict = true;
        } else {
          prologue = false;
        }
      }
      node.body.push(statement);
    }
    this.strict = outerStrict;
    return this.finishNode(node, 'BlockStatement');
  }

  /**
   * Parses a parenthesised parameter list.
   * @returns {object[]} The parameter patterns.
   */
  parseParams() {
    this.expectPunct('(');
    /** @type {object[]} */
    const params = [];
    let first = true;
    while (!this.eatPunct(')')) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct(')')) break;
      if (this.isPunct('...')) {
        const rest = this.startNode();
        this.next();
        rest.argument = this.parseBindingAtom();
        params.push(this.finishNode(rest, 'RestElement'));
        // A rest parameter must be last and cannot be followed by a comma.
        this.expectPunct(')');
        return params;
      }
      params.push(this.parseMaybeDefault());
    }
    return params;
  }

  /**
   * Declares a function's parameters into the scope it has just entered.
   *
   * Parameters are parsed before the scope exists, because a default value is
   * an ordinary expression in the enclosing context; the names are recorded
   * once the body's scope is open.
   * @param {object[]} params - The parameter patterns.
   */
  declareParams(params) {
    /** @type {string[]} */
    const names = [];
    const collect = (node) => {
      if (!node) return;
      switch (node.type) {
        case 'Identifier':
          names.push(node.name);
          return;
        case 'ObjectPattern':
          for (const property of node.properties) {
            collect(property.type === 'RestElement' ? property.argument : property.value);
          }
          return;
        case 'ArrayPattern':
          for (const element of node.elements) collect(element);
          return;
        case 'AssignmentPattern':
          collect(node.left);
          return;
        case 'RestElement':
          collect(node.argument);
          return;
        default:
      }
    };
    for (const param of params) collect(param);

    // A duplicate parameter name is only legal in a sloppy function whose
    // parameters are all plain identifiers.
    const simple = params.every((param) => param.type === 'Identifier');
    if (this.strict || !simple) {
      const seen = new Set();
      for (const name of names) {
        if (seen.has(name)) this.raise(`Duplicate parameter name '${name}'`);
        seen.add(name);
      }
    }
    for (const name of names) this.declareName(name, 'param', this.tok.start);
  }

  /**
   * Parses `if`.
   * @returns {object} An IfStatement.
   */
  parseIf() {
    const node = this.startNode();
    this.next();
    node.test = this.parseParenExpression();
    node.consequent = this.parseStatement(false, false, 'single');
    node.alternate = this.eatName('else') ? this.parseStatement(false, false, 'single') : null;
    return this.finishNode(node, 'IfStatement');
  }

  /**
   * Parses a parenthesised expression, as a control structure's head.
   * @returns {object} The expression.
   */
  parseParenExpression() {
    this.expectPunct('(');
    const expression = this.parseExpression();
    this.expectPunct(')');
    return expression;
  }

  /**
   * Parses `for`, `for…in`, `for…of` and `for await…of`.
   * @returns {object} The statement.
   */
  parseFor() {
    const node = this.startNode();
    this.next();
    // The whole head shares one block scope with the body, so `for (let i …)`
    // declares `i` once per loop rather than in the enclosing scope.
    this.enterScope(SCOPE_BLOCK);
    const isAwait = this.isName('await') && this.inAsync;
    if (isAwait) this.next();
    this.expectPunct('(');

    let init = null;
    let startsWithLet = false;
    if (this.isPunct(';')) {
      // No initialiser: `for (; test; update)`.
    } else if (
      this.isName('var') ||
      this.isName('const') ||
      (this.isName('let') && this.isLetDeclaration())
    ) {
      const declaration = this.startNode();
      const kind = this.tok.value;
      this.next();
      this.parseVarDeclarations(declaration, kind, true);
      init = this.finishNode(declaration, 'VariableDeclaration');
    } else {
      startsWithLet = this.isName('let');
      init = this.parseExpression(true);
    }

    if (this.isName('of') || this.isName('in')) {
      if (startsWithLet) {
        this.raise("The left-hand side of a for-in/of loop may not start with 'let'", init.start);
      }
      const isOf = this.tok.value === 'of';
      if (isAwait && !isOf) this.raise("'for await' requires 'of'");
      this.next();
      node.left = this.toForTarget(init);
      node.right = isOf ? this.parseMaybeAssign() : this.parseExpression();
      this.expectPunct(')');
      if (isOf) node.await = isAwait;
      node.body = this.parseLoopBody();
      this.exitScope();
      return this.finishNode(node, isOf ? 'ForOfStatement' : 'ForInStatement');
    }

    if (isAwait) this.raise("'for await' requires 'of'");
    if (init && init.type === 'VariableDeclaration') {
      for (const declarator of init.declarations) {
        if (declarator.init === null && declarator.id.type !== 'Identifier') {
          this.raise('A destructuring declaration must have an initialiser', declarator.start);
        }
        if (declarator.init === null && init.kind === 'const') {
          this.raise('A const declaration must have an initialiser', declarator.start);
        }
      }
    }
    node.init = init;
    this.expectPunct(';');
    node.test = this.isPunct(';') ? null : this.parseExpression();
    this.expectPunct(';');
    node.update = this.isPunct(')') ? null : this.parseExpression();
    this.expectPunct(')');
    node.body = this.parseLoopBody();
    this.exitScope();
    return this.finishNode(node, 'ForStatement');
  }

  /**
   * Converts a `for` head into an assignment target.
   * @param {object} node - The parsed head.
   * @returns {object} A declaration or a pattern.
   */
  toForTarget(node) {
    if (node.type === 'VariableDeclaration') {
      if (node.declarations.length !== 1) {
        this.raise('A for-in/of head may declare only one binding', node.start);
      }
      if (node.declarations[0].init !== null) {
        this.raise('A for-in/of binding may not have an initialiser', node.start);
      }
      return node;
    }
    return this.toAssignable(node, true);
  }

  /**
   * Parses a loop body, tracking that `break` and `continue` are legal in it.
   * @returns {object} The body statement.
   */
  parseLoopBody() {
    this.breakDepth += 1;
    this.continueDepth += 1;
    const body = this.parseStatement(false, false, 'none');
    this.breakDepth -= 1;
    this.continueDepth -= 1;
    return body;
  }

  /**
   * Parses `while`.
   * @returns {object} A WhileStatement.
   */
  parseWhile() {
    const node = this.startNode();
    this.next();
    node.test = this.parseParenExpression();
    node.body = this.parseLoopBody();
    return this.finishNode(node, 'WhileStatement');
  }

  /**
   * Parses `do … while`.
   * @returns {object} A DoWhileStatement.
   */
  parseDoWhile() {
    const node = this.startNode();
    this.next();
    node.body = this.parseLoopBody();
    this.expectName('while');
    node.test = this.parseParenExpression();
    // The semicolon after `do {} while ()` is optional even without a newline.
    this.eatPunct(';');
    return this.finishNode(node, 'DoWhileStatement');
  }

  /**
   * Parses `switch`.
   * @returns {object} A SwitchStatement.
   */
  parseSwitch() {
    const node = this.startNode();
    this.next();
    node.discriminant = this.parseParenExpression();
    node.cases = [];
    this.expectPunct('{');
    // Every clause of a switch shares one block scope.
    this.enterScope(SCOPE_BLOCK);
    this.breakDepth += 1;
    let current = null;
    let sawDefault = false;
    while (!this.isPunct('}')) {
      if (this.tok.type === 'eof') this.raise("Expected '}'");
      if (this.isName('case') || this.isName('default')) {
        const isCase = this.tok.value === 'case';
        if (current) this.finishNode(current, 'SwitchCase');
        current = this.startNode();
        node.cases.push(current);
        current.consequent = [];
        this.next();
        if (isCase) {
          current.test = this.parseExpression();
        } else {
          if (sawDefault) this.raise('Duplicate default clause', current.start);
          sawDefault = true;
          current.test = null;
        }
        this.expectPunct(':');
      } else {
        if (!current) this.unexpected();
        current.consequent.push(this.parseStatement());
      }
    }
    // A case ends where its last statement ends, not where the switch's brace
    // is, so the open case is closed before the brace is consumed.
    if (current) this.finishNode(current, 'SwitchCase');
    this.expectPunct('}');
    this.exitScope();
    this.breakDepth -= 1;
    return this.finishNode(node, 'SwitchStatement');
  }

  /**
   * Parses `try`.
   * @returns {object} A TryStatement.
   */
  parseTry() {
    const node = this.startNode();
    this.next();
    node.block = this.parseBlock();
    node.handler = null;
    if (this.isName('catch')) {
      const clause = this.startNode();
      this.next();
      if (this.eatPunct('(')) {
        // A single simple binding may be redeclared with `var` in the body,
        // which is why the parameter's own scope is the body's scope too.
        const simple = this.isName('(') === false && this.tok.type === 'name';
        this.enterScope(SCOPE_BLOCK | (simple ? SCOPE_SIMPLE_CATCH : 0));
        clause.param = this.parseBindingAtom(simple ? 'simple-catch' : 'lexical');
        this.expectPunct(')');
      } else {
        clause.param = null;
        this.enterScope(SCOPE_BLOCK);
      }
      clause.body = this.parseBlock(false);
      this.exitScope();
      node.handler = this.finishNode(clause, 'CatchClause');
    }
    node.finalizer = this.eatName('finally') ? this.parseBlock() : null;
    if (!node.handler && !node.finalizer) this.raise('Missing catch or finally clause', node.start);
    return this.finishNode(node, 'TryStatement');
  }

  /**
   * Parses `with`, which strict mode forbids.
   * @returns {object} A WithStatement.
   */
  parseWith() {
    if (this.strict) this.raise("'with' is not allowed in strict mode");
    const node = this.startNode();
    this.next();
    node.object = this.parseParenExpression();
    node.body = this.parseStatement(false, false, 'none');
    return this.finishNode(node, 'WithStatement');
  }

  /**
   * Parses `return`.
   * @returns {object} A ReturnStatement.
   */
  parseReturn() {
    if (!this.inFunction) this.raise("'return' outside of function");
    const node = this.startNode();
    this.next();
    node.argument = this.isPunct(';') || this.canInsertSemicolon() ? null : this.parseExpression();
    this.semicolon();
    return this.finishNode(node, 'ReturnStatement');
  }

  /**
   * Parses `throw`.
   * @returns {object} A ThrowStatement.
   */
  parseThrow() {
    const node = this.startNode();
    this.next();
    if (this.tok.nlBefore) this.raise('Illegal newline after throw');
    node.argument = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, 'ThrowStatement');
  }

  /**
   * Parses `break` or `continue`.
   * @param {string} keyword - Which one.
   * @returns {object} The statement.
   */
  parseBreakContinue(keyword) {
    const node = this.startNode();
    this.next();
    if (this.isPunct(';') || this.canInsertSemicolon()) {
      node.label = null;
    } else {
      node.label = this.parseIdentifier();
      if (!this.labels.includes(node.label.name)) {
        this.raise(`Unknown label '${node.label.name}'`, node.label.start);
      }
    }
    this.semicolon();
    if (node.label === null) {
      const depth = keyword === 'break' ? this.breakDepth : this.continueDepth;
      if (depth === 0) this.raise(`Unsyntactic ${keyword}`, node.start);
    }
    return this.finishNode(node, keyword === 'break' ? 'BreakStatement' : 'ContinueStatement');
  }

  /**
   * Parses `label: statement`.
   * @param {'list'|'single'|'none'} [functions] - The label's own position, which
   *   it passes to its body rather than widening.
   * @returns {object} A LabeledStatement.
   */
  parseLabeledStatement(functions = 'list') {
    const node = this.startNode();
    node.label = this.parseIdentifier();
    if (this.labels.includes(node.label.name)) {
      this.raise(`Label '${node.label.name}' is already declared`, node.label.start);
    }
    this.expectPunct(':');
    this.labels.push(node.label.name);
    // A labelled statement may be broken out of even when it is not a loop.
    this.breakDepth += 1;
    // `l: function f(){}` is legal in a sloppy statement list and nowhere else,
    // so the label passes its own position down rather than widening it.
    node.body = this.parseStatement(false, false, functions === 'list' ? 'single' : 'none');
    this.breakDepth -= 1;
    this.labels.pop();
    return this.finishNode(node, 'LabeledStatement');
  }

  // ------------------------------------------------------------------ modules

  /**
   * Parses an `import` declaration.
   * @returns {object} An ImportDeclaration.
   */
  parseImport() {
    const node = this.startNode();
    this.next();
    node.specifiers = [];
    if (this.tok.type === 'string') {
      node.source = this.parseLiteral();
    } else {
      node.specifiers = this.parseImportSpecifiers();
      this.expectName('from');
      if (this.tok.type !== 'string') this.raise('Expected a module specifier');
      node.source = this.parseLiteral();
    }
    node.attributes = this.parseImportAttributes();
    this.semicolon();
    return this.finishNode(node, 'ImportDeclaration');
  }

  /**
   * Parses the specifier list of an `import`.
   * @returns {object[]} The specifiers.
   */
  parseImportSpecifiers() {
    const specifiers = [];
    if (this.tok.type === 'name' && !RESERVED_WORDS.has(this.tok.value)) {
      const node = this.startNode();
      node.local = this.parseIdentifier();
      specifiers.push(this.finishNode(node, 'ImportDefaultSpecifier'));
      if (!this.eatPunct(',')) return specifiers;
    }
    if (this.isPunct('*')) {
      const node = this.startNode();
      this.next();
      this.expectName('as');
      node.local = this.parseIdentifier();
      specifiers.push(this.finishNode(node, 'ImportNamespaceSpecifier'));
      return specifiers;
    }
    this.expectPunct('{');
    let first = true;
    while (!this.eatPunct('}')) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct('}')) break;
      const node = this.startNode();
      node.imported = this.parseModuleExportName();
      if (this.eatName('as')) {
        node.local = this.parseIdentifier();
      } else {
        if (node.imported.type !== 'Identifier') this.raise('A string import name needs `as`', node.start);
        node.local = node.imported;
      }
      specifiers.push(this.finishNode(node, 'ImportSpecifier'));
    }
    return specifiers;
  }

  /**
   * Parses an export name, which may be a string since ES2022.
   * @returns {object} An Identifier or a string Literal.
   */
  parseModuleExportName() {
    if (this.tok.type === 'string') return this.parseLiteral();
    return this.parseIdentifierName();
  }

  /**
   * Parses a `with { … }` import attributes clause.
   * @returns {object[]} The attributes.
   */
  parseImportAttributes() {
    if (!this.isName('with') || this.tok.nlBefore) return [];
    this.next();
    this.expectPunct('{');
    const attributes = [];
    let first = true;
    while (!this.eatPunct('}')) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct('}')) break;
      const node = this.startNode();
      node.key = this.tok.type === 'string' ? this.parseLiteral() : this.parseIdentifierName();
      this.expectPunct(':');
      if (this.tok.type !== 'string') this.raise('An import attribute value must be a string');
      node.value = this.parseLiteral();
      attributes.push(this.finishNode(node, 'ImportAttribute'));
    }
    return attributes;
  }

  /**
   * Parses an `export` declaration in all its forms.
   * @returns {object} The export node.
   */
  parseExport() {
    const node = this.startNode();
    this.next();

    if (this.eatPunct('*')) {
      node.exported = this.eatName('as') ? this.parseModuleExportName() : null;
      this.expectName('from');
      if (this.tok.type !== 'string') this.raise('Expected a module specifier');
      node.source = this.parseLiteral();
      node.attributes = this.parseImportAttributes();
      this.semicolon();
      return this.finishNode(node, 'ExportAllDeclaration');
    }

    if (this.eatName('default')) {
      if (this.isName('function') || (this.isName('async') && this.peek().value === 'function')) {
        // The declaration node starts at `async`, not at `function`.
        const inner = this.startNode();
        const isAsync = this.eatName('async');
        this.expectName('function');
        const isGenerator = this.eatPunct('*');
        inner.id = this.tok.type === 'name' && !RESERVED_WORDS.has(this.tok.value) ? this.parseIdentifier() : null;
        node.declaration = this.parseFunctionRest(inner, 'FunctionDeclaration', isAsync, isGenerator);
      } else if (this.isName('class')) {
        node.declaration = this.parseClass(this.startNode(), 'nullable');
      } else {
        node.declaration = this.parseMaybeAssign();
        this.semicolon();
      }
      return this.finishNode(node, 'ExportDefaultDeclaration');
    }

    if (this.isPunct('{')) {
      node.declaration = null;
      node.specifiers = [];
      this.next();
      let first = true;
      while (!this.eatPunct('}')) {
        if (first) first = false;
        else this.expectPunct(',');
        if (this.eatPunct('}')) break;
        const specifier = this.startNode();
        specifier.local = this.parseModuleExportName();
        specifier.exported = this.eatName('as') ? this.parseModuleExportName() : specifier.local;
        node.specifiers.push(this.finishNode(specifier, 'ExportSpecifier'));
      }
      if (this.eatName('from')) {
        if (this.tok.type !== 'string') this.raise('Expected a module specifier');
        node.source = this.parseLiteral();
        node.attributes = this.parseImportAttributes();
      } else {
        node.source = null;
        node.attributes = [];
        for (const specifier of node.specifiers) {
          if (specifier.local.type !== 'Identifier') {
            this.raise('A string export name needs a module specifier', specifier.start);
          }
          // Without `from`, the local half names a binding in this module, so
          // it has to be a usable identifier: `export { default as x }` is only
          // meaningful when re-exporting.
          if (RESERVED_WORDS.has(specifier.local.name)) {
            this.raise(`Unexpected keyword '${specifier.local.name}'`, specifier.local.start);
          }
          this.checkReference(specifier.local.name, specifier.local.start);
        }
      }
      this.semicolon();
      return this.finishNode(node, 'ExportNamedDeclaration');
    }

    node.declaration = this.parseExportedDeclaration();
    node.specifiers = [];
    node.source = null;
    node.attributes = [];
    return this.finishNode(node, 'ExportNamedDeclaration');
  }

  /**
   * Parses the declaration after `export`.
   * @returns {object} The declaration.
   */
  parseExportedDeclaration() {
    if (this.isName('var') || this.isName('const') || (this.isName('let') && this.isLetDeclaration())) {
      return this.parseVarStatement(this.tok.value);
    }
    if (this.isName('function')) return this.parseFunctionStatement(false);
    if (this.isName('async') && this.peek().value === 'function') return this.parseFunctionStatement(true);
    if (this.isName('class')) return this.parseClass(this.startNode(), true);
    return this.unexpected();
  }

  // ------------------------------------------------------------------ classes

  /**
   * Parses a class declaration or expression.
   * @param {object} node - The started node.
   * @param {boolean|'nullable'} isStatement - Whether it is a declaration, and
   *   whether its name may be omitted.
   * @returns {object} The class node.
   */
  parseClass(node, isStatement) {
    this.expectName('class');
    const outerStrict = this.strict;
    // A class body is always strict code.
    this.strict = true;

    if (this.tok.type === 'name' && !RESERVED_WORDS.has(this.tok.value) && !this.isName('extends')) {
      const namePos = this.tok.start;
      node.id = this.parseIdentifier();
      if (isStatement === true) {
        // The name is lexical in the enclosing scope, but the class body is
        // already strict, so the reserved-word check uses the outer strictness.
        this.strict = outerStrict;
        this.checkBindingName(node.id.name, 'lexical', namePos);
        this.strict = true;
      }
    } else if (isStatement === true) {
      this.raise('A class declaration needs a name');
    } else {
      node.id = null;
    }

    node.superClass = this.eatName('extends') ? this.parseExprSubscripts() : null;
    node.body = this.parseClassBody(node.superClass !== null);
    this.strict = outerStrict;
    return this.finishNode(node, isStatement ? 'ClassDeclaration' : 'ClassExpression');
  }

  /**
   * Parses a class body.
   * @param {boolean} derived - Whether the class extends another.
   * @returns {object} A ClassBody.
   */
  parseClassBody(derived) {
    const node = this.startNode();
    this.expectPunct('{');
    this.privateNameStack.push({ declared: new Set(), used: [], roles: new Map() });
    node.body = [];
    while (!this.eatPunct('}')) {
      if (this.tok.type === 'eof') this.raise("Expected '}'");
      if (this.eatPunct(';')) continue;
      const element = this.parseClassElement(derived);
      if (element.key && element.key.type === 'PrivateIdentifier') {
        this.declarePrivateName(element);
      }
      node.body.push(element);
    }
    this.resolvePrivateNames();
    return this.finishNode(node, 'ClassBody');
  }

  /**
   * Records a use of a private name, to be resolved when the class body ends.
   * @param {string} name - The name without its `#`.
   * @param {number} pos - Where it is written.
   */
  usePrivateName(name, pos) {
    const frame = this.privateNameStack[this.privateNameStack.length - 1];
    if (!frame) {
      this.raise(`Private field '#${name}' must be declared in an enclosing class`, pos);
      return;
    }
    frame.used.push({ name, pos });
  }

  /**
   * Declares the private name a class element defines.
   *
   * A name may appear twice only as a getter and its setter, which is the one
   * case where two elements describe one field.
   * @param {object} element - The parsed class element.
   */
  declarePrivateName(element) {
    const frame = this.privateNameStack[this.privateNameStack.length - 1];
    const name = element.key.name;
    const role = element.kind === 'get' || element.kind === 'set' ? element.kind : 'field';
    const previous = frame.roles ? frame.roles.get(name) : undefined;
    if (!frame.roles) frame.roles = new Map();
    const pairs = previous !== undefined && previous !== role && previous !== 'field' && role !== 'field';
    if (previous !== undefined && !pairs) {
      this.raise(`Identifier '#${name}' has already been declared`, element.key.start);
    }
    frame.roles.set(name, pairs ? 'field' : role);
    frame.declared.add(name);
  }

  /**
   * Resolves the private names used in a class body that has just ended.
   *
   * A name the body declares is resolved; anything left belongs to an
   * enclosing class, so it is handed outwards. At the outermost class, an
   * unresolved name is an error with its position.
   */
  resolvePrivateNames() {
    const frame = this.privateNameStack.pop();
    const outer = this.privateNameStack[this.privateNameStack.length - 1];
    for (const use of frame.used) {
      if (frame.declared.has(use.name)) continue;
      if (outer) outer.used.push(use);
      else this.raise(`Private field '#${use.name}' must be declared in an enclosing class`, use.pos);
    }
  }

  /**
   * Parses one class element: a method, a field or a static block.
   * @param {boolean} derived - Whether the class extends another.
   * @returns {object} The element node.
   */
  parseClassElement(derived) {
    const node = this.startNode();
    node.static = false;

    if (this.isName('static')) {
      const after = this.peek();
      // `static` is a modifier unless what follows shows it is the member's
      // own name: `static() {}`, `static = 1`, `static;` or `static}`.
      const isModifier = !(
        after.type === 'punct' &&
        (after.value === '(' || after.value === '=' || after.value === ';' || after.value === '}')
      );
      if (after.type === 'punct' && after.value === '{') {
        // A static initialisation block.
        this.next();
        node.body = [];
        this.expectPunct('{');
        const outer = this.enterFunction(false, false);
        this.inFunction = false;
        while (!this.eatPunct('}')) {
          if (this.tok.type === 'eof') this.raise("Expected '}'");
          node.body.push(this.parseStatement());
        }
        this.exitFunction(outer);
        delete node.static;
        return this.finishNode(node, 'StaticBlock');
      }
      if (isModifier) {
        this.next();
        node.static = true;
      }
    }

    let isAsync = false;
    let isGenerator = false;
    let kind = 'method';

    if (this.isName('async')) {
      const after = this.peek();
      const stops = after.type === 'punct' && (after.value === '(' || after.value === '=' || after.value === ';' || after.value === '}');
      if (!stops && !after.nlBefore) {
        this.next();
        isAsync = true;
      }
    }
    if (this.isPunct('*')) {
      this.next();
      isGenerator = true;
    }
    if ((this.isName('get') || this.isName('set')) && !isAsync && !isGenerator) {
      const after = this.peek();
      const stops = after.type === 'punct' && (after.value === '(' || after.value === '=' || after.value === ';' || after.value === '}');
      if (!stops) {
        kind = this.tok.value;
        this.next();
      }
    }

    this.parsePropertyName(node);

    if (this.isPunct('(')) {
      if (kind === 'method' && !node.computed && node.key.type === 'Identifier' && node.key.name === 'constructor') {
        kind = 'constructor';
        if (isAsync || isGenerator) this.raise('A constructor may not be async or a generator', node.key.start);
      }
      node.kind = kind;
      node.value = this.parseMethod(isAsync, isGenerator, kind === 'constructor' && derived, kind);
      return this.finishNode(node, 'MethodDefinition');
    }

    if (kind !== 'method' || isAsync || isGenerator) this.unexpected();

    if (this.eatPunct('=')) {
      const outer = this.enterFunction(false, false);
      this.inFunction = false;
      this.inMethod = true;
      node.value = this.parseMaybeAssign();
      this.exitFunction(outer);
    } else {
      node.value = null;
    }
    this.semicolon();
    return this.finishNode(node, 'PropertyDefinition');
  }

  /**
   * Parses a method's parameters and body.
   * @param {boolean} isAsync - Whether it is async.
   * @param {boolean} isGenerator - Whether it is a generator.
   * @param {boolean} derivedConstructor - Whether `super()` is legal in it.
   * @param {string} [kind] - `get` or `set` when it is an accessor, so its
   *   parameter count can be checked.
   * @returns {object} A FunctionExpression.
   */
  parseMethod(isAsync, isGenerator, derivedConstructor, kind = 'method') {
    const node = this.startNode();
    node.id = null;
    node.expression = false;
    node.generator = isGenerator;
    node.async = isAsync;
    node.params = this.parseParams();
    if (kind === 'get' && node.params.length !== 0) {
      this.raise('A getter takes no parameters', node.start);
    }
    if (kind === 'set') {
      if (node.params.length !== 1) this.raise('A setter takes exactly one parameter', node.start);
      if (node.params[0].type === 'RestElement') this.raise('A setter cannot take a rest parameter', node.params[0].start);
    }
    const outer = this.enterFunction(isAsync, isGenerator);
    this.declareParams(node.params);
    const outerMethod = this.inMethod;
    const outerDerived = this.inDerivedConstructor;
    this.inMethod = true;
    this.inDerivedConstructor = !!derivedConstructor;
    node.body = this.parseFunctionBody();
    this.inMethod = outerMethod;
    this.inDerivedConstructor = outerDerived;
    this.exitFunction(outer);
    return this.finishNode(node, 'FunctionExpression');
  }

  /**
   * Reads a property name into `node.key` and `node.computed`.
   * @param {object} node - The node to fill.
   */
  parsePropertyName(node) {
    if (this.eatPunct('[')) {
      node.computed = true;
      node.key = this.parseMaybeAssign();
      this.expectPunct(']');
      return;
    }
    node.computed = false;
    if (this.tok.type === 'num' || this.tok.type === 'string' || this.tok.type === 'bigint') {
      node.key = this.parseLiteral();
      return;
    }
    if (this.tok.type === 'privatename') {
      const key = this.startNode();
      key.name = this.tok.value;
      this.next();
      node.key = this.finishNode(key, 'PrivateIdentifier');
      return;
    }
    node.key = this.parseIdentifierName();
  }

  // -------------------------------------------------------------- expressions

  /**
   * Parses a comma-separated expression.
   * @param {boolean} [noIn] - Whether `in` is an operator here.
   * @returns {object} The expression.
   */
  parseExpression(noIn = false) {
    const start = this.tok.start;
    const first = this.parseMaybeAssign(noIn);
    if (!this.isPunct(',')) return first;
    const node = this.startNodeAt(start);
    node.expressions = [first];
    while (this.eatPunct(',')) {
      node.expressions.push(this.parseMaybeAssign(noIn));
    }
    return this.finishNode(node, 'SequenceExpression');
  }

  /**
   * Parses an assignment, an arrow function, or anything tighter.
   * @param {boolean} [noIn] - Whether `in` is an operator here.
   * @returns {object} The expression.
   */
  parseMaybeAssign(noIn = false) {
    if (this.inGenerator && this.isName('yield')) return this.parseYield(noIn);

    const arrow = this.tryParseArrow();
    if (arrow) return arrow;

    const start = this.tok.start;
    const left = this.parseMaybeConditional(noIn);
    if (this.tok.type === 'punct' && ASSIGN_OPERATORS.has(this.tok.value)) {
      const node = this.startNodeAt(start);
      node.operator = this.tok.value;
      node.left = node.operator === '=' ? this.toAssignable(left, true) : this.checkSimpleTarget(left);
      this.next();
      node.right = this.parseMaybeAssign(noIn);
      return this.finishNode(node, 'AssignmentExpression');
    }
    return left;
  }

  /**
   * Checks that a compound assignment's target is a simple reference.
   * @param {object} node - The parsed left side.
   * @returns {object} The same node.
   */
  checkSimpleTarget(node) {
    if (node.type !== 'Identifier' && node.type !== 'MemberExpression') {
      this.raise('Invalid assignment target', node.start);
    }
    return node;
  }

  /**
   * Attempts to parse an arrow function at the current position.
   *
   * Three shapes start one: `x => …`, `async x => …` and `(…) => …`, with
   * `async (…) => …`. Only the parenthesised forms need speculation, because
   * `(a, b)` is a valid expression as well as a valid parameter list; the parse
   * is attempted as parameters and re-wound when no `=>` follows.
   * @returns {object|null} The arrow function, or null when there is none.
   */
  tryParseArrow() {
    // `x => …`
    if (this.tok.type === 'name' && !RESERVED_WORDS.has(this.tok.value) && this.tok.value !== 'async') {
      const after = this.peek();
      if (after.type === 'punct' && after.value === '=>' && !after.nlBefore) {
        const node = this.startNode();
        const param = this.parseIdentifier();
        return this.parseArrowBody(node, [param], false);
      }
      return null;
    }

    // `async x => …` and `async (…) => …`
    if (this.isName('async')) {
      const after = this.peek();
      if (after.nlBefore) return null;
      if (after.type === 'name' && !RESERVED_WORDS.has(after.value)) {
        const node = this.startNode();
        const state = this.saveState();
        this.next();
        const param = this.parseIdentifier();
        if (this.isPunct('=>') && !this.tok.nlBefore) {
          return this.parseArrowBody(node, [param], true);
        }
        this.restoreState(state);
        return null;
      }
      if (after.type === 'punct' && after.value === '(') {
        return this.speculateParenArrow(true);
      }
      return null;
    }

    if (this.isPunct('(')) return this.speculateParenArrow(false);
    return null;
  }

  /**
   * Speculatively parses `(…) =>` as an arrow function.
   * @param {boolean} isAsync - Whether `async` precedes the parentheses.
   * @returns {object|null} The arrow function, or null.
   */
  speculateParenArrow(isAsync) {
    const state = this.saveState();
    const node = this.startNode();
    try {
      if (isAsync) this.next();
      const params = this.parseParams();
      if (!this.isPunct('=>') || this.tok.nlBefore) throw BAIL;
      return this.parseArrowBody(node, params, isAsync);
    } catch (error) {
      if (error !== BAIL && !(error instanceof JsParseError)) throw error;
      this.restoreState(state);
      return null;
    }
  }

  /**
   * Parses an arrow function's body, the parameters already in hand.
   * @param {object} node - The started node.
   * @param {object[]} params - The parameters.
   * @param {boolean} isAsync - Whether it is async.
   * @returns {object} An ArrowFunctionExpression.
   */
  parseArrowBody(node, params, isAsync) {
    this.expectPunct('=>');
    node.id = null;
    node.params = params;
    node.async = isAsync;
    node.generator = false;
    const outer = this.enterFunction(isAsync, false);
    this.declareParams(params);
    // An arrow keeps the enclosing `new.target`, and has no `this` of its own,
    // so the surrounding method context stays in force.
    this.inNewTargetScope = outer.inNewTargetScope;
    if (this.isPunct('{')) {
      node.body = this.parseFunctionBody();
      node.expression = false;
    } else {
      node.body = this.parseMaybeAssign();
      node.expression = true;
    }
    this.exitFunction(outer);
    return this.finishNode(node, 'ArrowFunctionExpression');
  }

  /**
   * Parses `yield` and `yield*`.
   * @param {boolean} noIn - Whether `in` is an operator here.
   * @returns {object} A YieldExpression.
   */
  parseYield(noIn) {
    const node = this.startNode();
    this.next();
    if (this.isPunct('*')) {
      this.next();
      node.delegate = true;
      node.argument = this.parseMaybeAssign(noIn);
    } else {
      node.delegate = false;
      const ends = this.canInsertSemicolon() ||
        (this.tok.type === 'punct' && [')', ']', '}', ',', ';', ':'].includes(this.tok.value));
      node.argument = ends ? null : this.parseMaybeAssign(noIn);
    }
    return this.finishNode(node, 'YieldExpression');
  }

  /**
   * Parses a conditional expression.
   * @param {boolean} noIn - Whether `in` is an operator here.
   * @returns {object} The expression.
   */
  parseMaybeConditional(noIn) {
    const start = this.tok.start;
    const test = this.parseExprOps(noIn);
    if (!this.isPunct('?')) return test;
    const node = this.startNodeAt(start);
    this.next();
    node.test = test;
    node.consequent = this.parseMaybeAssign();
    this.expectPunct(':');
    node.alternate = this.parseMaybeAssign(noIn);
    return this.finishNode(node, 'ConditionalExpression');
  }

  /**
   * Parses a run of binary and logical operators.
   * @param {boolean} noIn - Whether `in` is an operator here.
   * @returns {object} The expression.
   */
  parseExprOps(noIn) {
    const start = this.tok.start;
    const left = this.parseMaybeUnary();
    return this.parseExprOp(left, start, 0, noIn);
  }

  /**
   * The precedence of the current token as a binary operator.
   * @param {boolean} noIn - Whether `in` is an operator here.
   * @returns {{operator: string, precedence: number}|null} The operator, or null.
   */
  currentBinaryOperator(noIn) {
    if (this.tok.type === 'punct') {
      const precedence = BINARY_PRECEDENCE[this.tok.value];
      if (precedence) return { operator: this.tok.value, precedence };
      return null;
    }
    if (this.tok.type === 'name') {
      if (this.tok.value === 'instanceof') return { operator: 'instanceof', precedence: 8 };
      if (this.tok.value === 'in' && !noIn) return { operator: 'in', precedence: 8 };
    }
    return null;
  }

  /**
   * Climbs precedence from a parsed left operand.
   * @param {object} left - The left operand.
   * @param {number} start - Where the expression began.
   * @param {number} minPrecedence - The lowest precedence to bind here.
   * @param {boolean} noIn - Whether `in` is an operator here.
   * @returns {object} The expression.
   */
  parseExprOp(left, start, minPrecedence, noIn) {
    for (;;) {
      const op = this.currentBinaryOperator(noIn);
      if (!op || op.precedence <= minPrecedence) return left;

      const isLogical = op.operator === '||' || op.operator === '&&' || op.operator === '??';
      if (op.operator === '??' && left.type === 'LogicalExpression' && left.operator !== '??' && !left.parenthesised) {
        this.raise("'??' cannot be mixed with '||' or '&&' without parentheses");
      }
      if (
        (op.operator === '||' || op.operator === '&&') &&
        left.type === 'LogicalExpression' &&
        left.operator === '??' &&
        !left.parenthesised
      ) {
        this.raise("'??' cannot be mixed with '||' or '&&' without parentheses");
      }

      this.next();
      const rightStart = this.tok.start;
      let right = this.parseMaybeUnary();
      // `**` is right-associative, so it binds its own precedence again.
      right = this.parseExprOp(right, rightStart, op.operator === '**' ? op.precedence - 1 : op.precedence, noIn);

      // `a ?? b || c` is an error rather than a grouping, and `||` binds
      // tighter, so the offending operand arrives here as the right side.
      if (
        op.operator === '??' &&
        right.type === 'LogicalExpression' &&
        right.operator !== '??' &&
        !right.parenthesised
      ) {
        this.raise("'??' cannot be mixed with '||' or '&&' without parentheses", right.start);
      }

      const node = this.startNodeAt(start);
      node.left = left;
      node.operator = op.operator;
      node.right = right;
      left = this.finishNode(node, isLogical ? 'LogicalExpression' : 'BinaryExpression');
    }
  }

  /**
   * Parses a unary or update expression, or anything tighter.
   * @returns {object} The expression.
   */
  parseMaybeUnary() {
    const start = this.tok.start;

    if (this.isName('await') && this.inAsync) {
      const node = this.startNode();
      this.next();
      node.argument = this.parseMaybeUnary();
      const finished = this.finishNode(node, 'AwaitExpression');
      if (this.isPunct('**')) this.raise('Unary operand cannot be the left side of **');
      return finished;
    }

    if (this.tok.type === 'punct' && (UNARY_OPERATORS.has(this.tok.value) || this.tok.value === '++' || this.tok.value === '--')) {
      const isUpdate = this.tok.value === '++' || this.tok.value === '--';
      const node = this.startNode();
      node.operator = this.tok.value;
      node.prefix = true;
      this.next();
      node.argument = this.parseMaybeUnary();
      if (isUpdate) {
        this.checkSimpleTarget(node.argument);
        return this.finishNode(node, 'UpdateExpression');
      }
      const finished = this.finishNode(node, 'UnaryExpression');
      if (this.isPunct('**')) this.raise('Unary operand cannot be the left side of **');
      return finished;
    }

    if (this.tok.type === 'name' && (this.tok.value === 'typeof' || this.tok.value === 'void' || this.tok.value === 'delete')) {
      const node = this.startNode();
      node.operator = this.tok.value;
      node.prefix = true;
      this.next();
      node.argument = this.parseMaybeUnary();
      if (node.operator === 'delete' && this.strict && node.argument.type === 'Identifier') {
        this.raise('Deleting a local variable is not allowed in strict mode', node.start);
      }
      const finished = this.finishNode(node, 'UnaryExpression');
      if (this.isPunct('**')) this.raise('Unary operand cannot be the left side of **');
      return finished;
    }

    let expression = this.parseExprSubscripts();
    while (
      this.tok.type === 'punct' &&
      (this.tok.value === '++' || this.tok.value === '--') &&
      !this.tok.nlBefore
    ) {
      const node = this.startNodeAt(start);
      node.operator = this.tok.value;
      node.prefix = false;
      node.argument = this.checkSimpleTarget(expression);
      this.next();
      expression = this.finishNode(node, 'UpdateExpression');
    }
    return expression;
  }

  /**
   * Parses an atom and every subscript applied to it.
   * @returns {object} The expression.
   */
  parseExprSubscripts() {
    const start = this.tok.start;
    const base = this.parseExprAtom();
    return this.parseSubscripts(base, start, false);
  }

  /**
   * Applies member accesses, calls and tagged templates to a base expression.
   * @param {object} base - The base expression.
   * @param {number} start - Where the whole expression began.
   * @param {boolean} noCalls - Whether a call would belong to an enclosing `new`.
   * @returns {object} The expression, wrapped in a ChainExpression when any
   *   link was optional.
   */
  parseSubscripts(base, start, noCalls) {
    let optionalChained = false;
    let current = base;
    for (;;) {
      if (this.isPunct('.')) {
        this.next();
        const node = this.startNodeAt(start);
        node.object = current;
        node.property = this.parseMemberProperty();
        node.computed = false;
        node.optional = false;
        current = this.finishNode(node, 'MemberExpression');
        continue;
      }
      if (this.isPunct('[')) {
        this.next();
        const node = this.startNodeAt(start);
        node.object = current;
        node.property = this.parseExpression();
        node.computed = true;
        node.optional = false;
        this.expectPunct(']');
        current = this.finishNode(node, 'MemberExpression');
        continue;
      }
      if (this.isPunct('(') && !noCalls) {
        const node = this.startNodeAt(start);
        node.callee = current;
        node.arguments = this.parseArguments();
        node.optional = false;
        current = this.finishNode(node, 'CallExpression');
        continue;
      }
      if (this.isPunct('?.')) {
        // `new a?.b()` is an error, whatever follows the `?.`: an optional
        // chain can never be the callee of a `new` expression.
        if (noCalls) this.raise('Optional chaining cannot appear in the callee of new expressions');
        optionalChained = true;
        this.next();
        if (this.isPunct('(')) {
          const node = this.startNodeAt(start);
          node.callee = current;
          node.arguments = this.parseArguments();
          node.optional = true;
          current = this.finishNode(node, 'CallExpression');
          continue;
        }
        const node = this.startNodeAt(start);
        node.object = current;
        if (this.eatPunct('[')) {
          node.property = this.parseExpression();
          node.computed = true;
          this.expectPunct(']');
        } else {
          node.property = this.parseMemberProperty();
          node.computed = false;
        }
        node.optional = true;
        current = this.finishNode(node, 'MemberExpression');
        continue;
      }
      if (this.tok.type === 'template') {
        if (optionalChained) this.raise('A tagged template cannot appear in an optional chain');
        const node = this.startNodeAt(start);
        node.tag = current;
        node.quasi = this.parseTemplate();
        current = this.finishNode(node, 'TaggedTemplateExpression');
        continue;
      }
      break;
    }

    if (optionalChained) {
      const node = this.startNodeAt(start);
      node.expression = current;
      return this.finishNode(node, 'ChainExpression');
    }
    return current;
  }

  /**
   * Parses the property after a `.`, which may be a private name.
   * @returns {object} An Identifier or PrivateIdentifier.
   */
  parseMemberProperty() {
    if (this.tok.type === 'privatename') {
      const node = this.startNode();
      node.name = this.tok.value;
      this.usePrivateName(node.name, node.start);
      this.next();
      return this.finishNode(node, 'PrivateIdentifier');
    }
    return this.parseIdentifierName();
  }

  /**
   * Parses a call's argument list.
   * @returns {object[]} The arguments.
   */
  parseArguments() {
    this.expectPunct('(');
    const args = [];
    let first = true;
    while (!this.eatPunct(')')) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct(')')) break;
      if (this.isPunct('...')) {
        const spread = this.startNode();
        this.next();
        spread.argument = this.parseMaybeAssign();
        args.push(this.finishNode(spread, 'SpreadElement'));
      } else {
        args.push(this.parseMaybeAssign());
      }
    }
    return args;
  }

  /**
   * Parses a primary expression.
   * @returns {object} The expression.
   */
  parseExprAtom() {
    switch (this.tok.type) {
      case 'num':
      case 'bigint':
      case 'string':
        return this.parseLiteral();
      case 'regexp':
        return this.parseLiteral();
      case 'template':
        return this.parseTemplate();
      case 'privatename': {
        // `#field in obj` is the only place a private name stands alone.
        const node = this.startNode();
        node.name = this.tok.value;
        this.usePrivateName(node.name, node.start);
        this.next();
        if (!this.isName('in')) this.raise('A private name is only allowed in a member access or `in`', node.start);
        return this.finishNode(node, 'PrivateIdentifier');
      }
      default:
        break;
    }

    if (this.tok.type === 'punct') {
      switch (this.tok.value) {
        case '(': {
          return this.parseParenExpressionAtom();
        }
        case '[': {
          const node = this.startNode();
          this.next();
          node.elements = this.parseExpressionList(']', true);
          return this.finishNode(node, 'ArrayExpression');
        }
        case '{':
          return this.parseObject();
        case '/':
        case '/=': {
          this.tz.reScanAsRegExp();
          this.tok = this.tz.curr;
          return this.parseLiteral();
        }
        default:
          return this.unexpected();
      }
    }

    if (this.tok.type !== 'name') return this.unexpected();

    switch (this.tok.value) {
      case 'this': {
        const node = this.startNode();
        this.next();
        return this.finishNode(node, 'ThisExpression');
      }
      case 'super': {
        const node = this.startNode();
        if (!this.inMethod) this.raise("'super' is only allowed in a method");
        this.next();
        if (this.isPunct('(') && !this.inDerivedConstructor && !this.options.allowSuperOutsideMethod) {
          this.raise("'super' call is only allowed in a derived constructor", node.start);
        }
        if (!this.isPunct('(') && !this.isPunct('.') && !this.isPunct('[')) {
          this.raise("'super' must be called or accessed", node.start);
        }
        return this.finishNode(node, 'Super');
      }
      case 'null':
      case 'true':
      case 'false': {
        const node = this.startNode();
        node.value = this.tok.value === 'null' ? null : this.tok.value === 'true';
        node.raw = this.tok.value;
        this.next();
        return this.finishNode(node, 'Literal');
      }
      case 'function': {
        const node = this.startNode();
        this.next();
        const isGenerator = this.eatPunct('*');
        node.id = this.tok.type === 'name' && !RESERVED_WORDS.has(this.tok.value) ? this.parseIdentifier() : null;
        return this.parseFunctionRest(node, 'FunctionExpression', false, isGenerator);
      }
      case 'class':
        return this.parseClass(this.startNode(), false);
      case 'new':
        return this.parseNew();
      case 'import':
        return this.parseImportExpression();
      case 'async': {
        const after = this.peek();
        if (after.type === 'name' && after.value === 'function' && !after.nlBefore) {
          const node = this.startNode();
          this.next();
          this.next();
          const isGenerator = this.eatPunct('*');
          node.id = this.tok.type === 'name' && !RESERVED_WORDS.has(this.tok.value) ? this.parseIdentifier() : null;
          return this.parseFunctionRest(node, 'FunctionExpression', true, isGenerator);
        }
        return this.parseIdentifier();
      }
      default:
        if (RESERVED_WORDS.has(this.tok.value)) return this.unexpected();
        return this.parseIdentifier();
    }
  }

  /**
   * Parses a parenthesised expression.
   *
   * Parentheses are not kept as nodes, matching ESTree, but the fact that an
   * expression was parenthesised is remembered on it: `(a ?? b) || c` is legal
   * where `a ?? b || c` is not.
   * @returns {object} The inner expression.
   */
  parseParenExpressionAtom() {
    this.next();
    if (this.isPunct(')')) this.raise('Expected an expression');
    const innerStart = this.tok.start;
    const expressions = [];
    let first = true;
    while (!this.isPunct(')')) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.isPunct(')')) break;
      if (this.isPunct('...')) this.raise('A rest element needs an arrow function');
      expressions.push(this.parseMaybeAssign());
    }
    const innerEnd = this.tz.lastEnd;
    this.expectPunct(')');
    if (expressions.length === 0) this.raise('Expected an expression', innerStart);

    let value;
    if (expressions.length > 1) {
      const node = this.startNodeAt(innerStart);
      node.expressions = expressions;
      value = this.finishNodeAt(node, 'SequenceExpression', innerEnd);
    } else {
      value = expressions[0];
    }
    // Not enumerable, so a consumer walking own keys — the CSP scan, the action
    // analyser — never sees it, and the differential test compares equal.
    Object.defineProperty(value, 'parenthesised', { value: true, enumerable: false, configurable: true });
    return value;
  }

  /**
   * Parses a comma-separated list up to a closing punctuator.
   * @param {string} close - The closing punctuator.
   * @param {boolean} allowHoles - Whether elisions produce null elements.
   * @returns {Array<object|null>} The elements.
   */
  parseExpressionList(close, allowHoles) {
    const elements = [];
    let first = true;
    while (!this.eatPunct(close)) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct(close)) break;
      if (allowHoles && this.isPunct(',')) {
        elements.push(null);
        continue;
      }
      if (this.isPunct('...')) {
        const spread = this.startNode();
        this.next();
        spread.argument = this.parseMaybeAssign();
        elements.push(this.finishNode(spread, 'SpreadElement'));
        continue;
      }
      elements.push(this.parseMaybeAssign());
    }
    return elements;
  }

  /**
   * Parses an object literal.
   * @returns {object} An ObjectExpression.
   */
  parseObject() {
    const node = this.startNode();
    this.expectPunct('{');
    node.properties = [];
    let first = true;
    while (!this.eatPunct('}')) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct('}')) break;
      node.properties.push(this.parseObjectMember());
    }
    return this.finishNode(node, 'ObjectExpression');
  }

  /**
   * Parses one object literal member.
   * @returns {object} A Property or SpreadElement.
   */
  parseObjectMember() {
    if (this.isPunct('...')) {
      const spread = this.startNode();
      this.next();
      spread.argument = this.parseMaybeAssign();
      return this.finishNode(spread, 'SpreadElement');
    }

    const node = this.startNode();
    let isAsync = false;
    let isGenerator = false;

    if (this.isName('async')) {
      const after = this.peek();
      const stops = after.type === 'punct' && (after.value === ':' || after.value === '(' || after.value === ',' || after.value === '}' || after.value === '=');
      if (!stops && !after.nlBefore) {
        this.next();
        isAsync = true;
      }
    }
    if (this.isPunct('*')) {
      this.next();
      isGenerator = true;
    }
    if ((this.isName('get') || this.isName('set')) && !isAsync && !isGenerator) {
      const after = this.peek();
      const stops = after.type === 'punct' && (after.value === ':' || after.value === '(' || after.value === ',' || after.value === '}' || after.value === '=');
      if (!stops) {
        const kind = this.tok.value;
        this.next();
        this.parsePropertyName(node);
        node.kind = kind;
        node.method = false;
        node.shorthand = false;
        node.value = this.parseMethod(false, false, false, kind);
        return this.finishNode(node, 'Property');
      }
    }

    this.parsePropertyName(node);

    if (this.isPunct('(')) {
      node.kind = 'init';
      node.method = true;
      node.shorthand = false;
      node.value = this.parseMethod(isAsync, isGenerator, false);
      return this.finishNode(node, 'Property');
    }
    if (isAsync || isGenerator) this.unexpected();

    node.kind = 'init';
    node.method = false;

    if (this.eatPunct(':')) {
      node.shorthand = false;
      node.value = this.parseMaybeAssign();
      return this.finishNode(node, 'Property');
    }

    if (node.computed || node.key.type !== 'Identifier') this.unexpected();
    if (RESERVED_WORDS.has(node.key.name)) this.raise(`'${node.key.name}' cannot be a shorthand property`, node.key.start);
    this.checkReference(node.key.name, node.key.start);
    node.shorthand = true;
    if (this.isPunct('=')) {
      // `{ a = 1 }` is only legal as a destructuring pattern. It is parsed here
      // and rejected by toAssignable if the object never becomes one.
      const assignment = this.startNodeAt(node.key.start);
      assignment.operator = '=';
      assignment.left = this.cloneIdentifier(node.key);
      this.next();
      assignment.right = this.parseMaybeAssign();
      node.value = this.finishNode(assignment, 'AssignmentExpression');
      const pending = { start: node.key.start };
      this.pendingShorthandDefaults.push(pending);
      // Not enumerable, so the node's shape stays exactly ESTree's.
      Object.defineProperty(node, 'shorthandDefault', { value: pending, enumerable: false, configurable: true });
    } else {
      node.value = this.cloneIdentifier(node.key);
    }
    return this.finishNode(node, 'Property');
  }

  /**
   * Copies an identifier node, so a shorthand property's key and value are
   * distinct nodes with the same range, as acorn produces them.
   * @param {object} node - The identifier.
   * @returns {object} A copy.
   */
  cloneIdentifier(node) {
    /** @type {any} */
    const copy = { type: 'Identifier', start: node.start, end: node.end, name: node.name };
    if (this.locations) copy.loc = { start: { ...node.loc.start }, end: { ...node.loc.end } };
    return copy;
  }

  /**
   * Parses `new X(…)`, `new X` and `new.target`.
   * @returns {object} A NewExpression or MetaProperty.
   */
  parseNew() {
    const node = this.startNode();
    this.next();
    if (this.isPunct('.')) {
      this.next();
      const property = this.parseIdentifierName();
      if (property.name !== 'target') this.raise("The only valid meta property for new is 'new.target'", property.start);
      if (!this.inNewTargetScope) this.raise("'new.target' can only be used in functions and class static block", node.start);
      node.meta = this.metaIdentifier(node.start, 'new');
      node.property = property;
      return this.finishNode(node, 'MetaProperty');
    }
    const calleeStart = this.tok.start;
    node.callee = this.parseSubscripts(this.parseExprAtom(), calleeStart, true);
    node.arguments = this.isPunct('(') ? this.parseArguments() : [];
    return this.finishNode(node, 'NewExpression');
  }

  /**
   * Builds the identifier half of a meta property.
   * @param {number} start - Where the keyword begins.
   * @param {string} name - The keyword.
   * @returns {object} An Identifier.
   */
  metaIdentifier(start, name) {
    /** @type {any} */
    const node = { type: 'Identifier', start, end: start + name.length, name };
    if (this.locations) {
      node.loc = { start: this.tz.locate(start), end: this.tz.locate(start + name.length) };
    }
    return node;
  }

  /**
   * Parses `import(…)` and `import.meta`.
   * @returns {object} An ImportExpression or MetaProperty.
   */
  parseImportExpression() {
    const node = this.startNode();
    this.next();
    if (this.isPunct('.')) {
      this.next();
      const property = this.parseIdentifierName();
      if (property.name !== 'meta') this.raise("The only valid meta property for import is 'import.meta'", property.start);
      if (this.sourceType !== 'module' && !this.options.allowImportExpressionEverywhere) {
        this.raise("'import.meta' is only allowed in a module", node.start);
      }
      node.meta = this.metaIdentifier(node.start, 'import');
      node.property = property;
      return this.finishNode(node, 'MetaProperty');
    }
    if (!this.isPunct('(')) this.unexpected();
    this.next();
    node.source = this.parseMaybeAssign();
    node.options = this.eatPunct(',') && !this.isPunct(')') ? this.parseMaybeAssign() : null;
    this.eatPunct(',');
    this.expectPunct(')');
    return this.finishNode(node, 'ImportExpression');
  }

  /**
   * Parses a literal token into a Literal node.
   * @returns {object} A Literal.
   */
  parseLiteral() {
    const node = this.startNode();
    const token = this.tok;
    node.value = token.type === 'bigint' ? this.bigIntValue(token.value) : token.value;
    node.raw = token.raw !== undefined ? token.raw : this.input.slice(token.start, token.end);
    if (token.type === 'regexp') {
      node.value = this.regExpValue(token.value);
      node.regex = { pattern: token.value.pattern, flags: token.value.flags };
    } else if (token.type === 'bigint') {
      // The written digits may be hexadecimal; the node carries the value.
      node.bigint = node.value === null ? token.value : String(node.value);
    }
    this.next();
    return this.finishNode(node, 'Literal');
  }

  /**
   * Builds a BigInt for a literal, when the host supports it.
   * @param {string} digits - The digits without the `n`.
   * @returns {bigint|null} The value, or null.
   */
  bigIntValue(digits) {
    try {
      return BigInt(digits);
    } catch {
      return null;
    }
  }

  /**
   * Builds a RegExp for a literal, or null when the host rejects the pattern.
   *
   * A pattern this engine cannot compile is still a syntactically valid literal
   * in source the compiler only has to copy through, so the node is produced
   * with a null value rather than refused.
   * @param {{pattern: string, flags: string}} regex - The literal's parts.
   * @returns {RegExp|null} The value.
   */
  regExpValue(regex) {
    try {
      return new RegExp(regex.pattern, regex.flags);
    } catch {
      return null;
    }
  }

  /**
   * Parses a template literal, including its substitutions.
   * @returns {object} A TemplateLiteral.
   */
  parseTemplate() {
    const node = this.startNode();
    node.quasis = [];
    node.expressions = [];

    let chunk = this.tok.value;
    node.quasis.push(this.templateElement(chunk));
    while (!chunk.tail) {
      this.next();
      node.expressions.push(this.parseExpression());
      if (!this.isPunct('}')) this.raise("Expected '}' to close a template substitution");
      this.tz.reScanTemplateContinue();
      this.tok = this.tz.curr;
      chunk = this.tok.value;
      node.quasis.push(this.templateElement(chunk));
    }
    this.next();
    return this.finishNode(node, 'TemplateLiteral');
  }

  /**
   * Builds one TemplateElement.
   * @param {{cooked: (string|null), raw: string, tail: boolean, rawStart: number,
   *   rawEnd: number}} chunk - The lexed chunk.
   * @returns {object} A TemplateElement.
   */
  templateElement(chunk) {
    /** @type {any} */
    const node = {
      type: 'TemplateElement',
      start: chunk.rawStart,
      end: chunk.rawEnd,
      value: { raw: chunk.raw, cooked: chunk.cooked },
      tail: chunk.tail,
    };
    if (this.locations) {
      node.loc = { start: this.tz.locate(chunk.rawStart), end: this.tz.locate(chunk.rawEnd) };
    }
    return node;
  }

  /**
   * Parses an identifier that must not be a reserved word.
   * @returns {object} An Identifier.
   */
  parseIdentifier() {
    if (this.tok.type !== 'name') this.unexpected();
    if (RESERVED_WORDS.has(this.tok.value)) this.unexpected();
    this.checkReference(this.tok.value, this.tok.start);
    return this.parseIdentifierName();
  }

  /**
   * Refuses a word that cannot name a variable in the current mode.
   *
   * Strict code reserves nine further words, and a module is always strict, so
   * `let`, `static` and `yield` are references only in sloppy scripts. A
   * property name is not a reference and goes through
   * {@link Parser#parseIdentifierName}, which does not check: `obj.let` and
   * `{ let: 1 }` are fine everywhere.
   * @param {string} name - The word.
   * @param {number} pos - Where it is written.
   */
  checkReference(name, pos) {
    if (this.strict && STRICT_RESERVED.has(name)) {
      this.raise(`The keyword '${name}' is reserved`, pos);
    }
    if (name === 'await' && (this.inAsync || this.sourceType === 'module')) {
      this.raise("'await' is reserved here", pos);
    }
    if (name === 'yield' && this.inGenerator) {
      this.raise("'yield' is reserved in a generator", pos);
    }
  }

  /**
   * Parses any word as an identifier, reserved or not. Used for property names.
   * @returns {object} An Identifier.
   */
  parseIdentifierName() {
    if (this.tok.type !== 'name') this.unexpected();
    const node = this.startNode();
    node.name = this.tok.value;
    this.next();
    return this.finishNode(node, 'Identifier');
  }

  // ----------------------------------------------------------------- patterns

  /**
   * Validates and records a declared name.
   * @param {string} name - The name.
   * @param {string} kind - How it is declared; `'none'` only validates.
   * @param {number} pos - Where it is written.
   */
  checkBindingName(name, kind, pos) {
    if (this.strict && STRICT_RESERVED.has(name)) {
      this.raise(`The keyword '${name}' is reserved`, pos);
    }
    if (this.strict && (name === 'eval' || name === 'arguments')) {
      this.raise(`Binding ${name} in strict mode`, pos);
    }
    if (name === 'let' && kind === 'lexical') {
      this.raise("'let' is disallowed as a lexically bound name", pos);
    }
    if (name === 'yield' && this.inGenerator) {
      this.raise("'yield' cannot be a binding name in a generator", pos);
    }
    if (name === 'await' && (this.inAsync || this.sourceType === 'module')) {
      this.raise("'await' cannot be a binding name here", pos);
    }
    if (kind !== 'none') this.declareName(name, kind, pos);
  }

  /**
   * Parses an identifier in a binding position.
   * @param {string} kind - How it is being declared.
   * @returns {object} An Identifier.
   */
  parseBindingIdentifier(kind) {
    const pos = this.tok.start;
    const name = this.tok.type === 'name' ? this.tok.value : '';
    const node = this.parseIdentifier();
    this.checkBindingName(name, kind, pos);
    return node;
  }

  /**
   * Parses a binding target: an identifier or a destructuring pattern.
   * @param {string} [kind] - How the names in it are being declared.
   * @returns {object} The pattern.
   */
  parseBindingAtom(kind = 'none') {
    if (this.isPunct('[')) {
      const node = this.startNode();
      this.next();
      node.elements = this.parseBindingList(']', kind);
      return this.finishNode(node, 'ArrayPattern');
    }
    if (this.isPunct('{')) {
      const node = this.startNode();
      this.next();
      node.properties = this.parseObjectPatternProperties(kind);
      return this.finishNode(node, 'ObjectPattern');
    }
    return this.parseBindingIdentifier(kind);
  }

  /**
   * Parses an array pattern's elements.
   * @param {string} close - The closing punctuator.
   * @param {string} [kind] - How the names in it are being declared.
   * @returns {Array<object|null>} The elements.
   */
  parseBindingList(close, kind = 'none') {
    const elements = [];
    let first = true;
    while (!this.eatPunct(close)) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct(close)) break;
      if (this.isPunct(',')) {
        elements.push(null);
        continue;
      }
      if (this.isPunct('...')) {
        const rest = this.startNode();
        this.next();
        rest.argument = this.parseBindingAtom(kind);
        elements.push(this.finishNode(rest, 'RestElement'));
        this.expectPunct(close);
        return elements;
      }
      elements.push(this.parseMaybeDefault(kind));
    }
    return elements;
  }

  /**
   * Parses an object pattern's properties.
   * @param {string} [kind] - How the names in it are being declared.
   * @returns {object[]} The properties.
   */
  parseObjectPatternProperties(kind = 'none') {
    const properties = [];
    let first = true;
    while (!this.eatPunct('}')) {
      if (first) first = false;
      else this.expectPunct(',');
      if (this.eatPunct('}')) break;
      if (this.isPunct('...')) {
        const rest = this.startNode();
        this.next();
        rest.argument = this.parseBindingIdentifier(kind);
        properties.push(this.finishNode(rest, 'RestElement'));
        this.expectPunct('}');
        return properties;
      }
      const node = this.startNode();
      this.parsePropertyName(node);
      node.kind = 'init';
      node.method = false;
      if (this.eatPunct(':')) {
        node.shorthand = false;
        node.value = this.parseMaybeDefault(kind);
      } else {
        if (node.computed || node.key.type !== 'Identifier') this.unexpected();
        if (RESERVED_WORDS.has(node.key.name)) this.raise(`'${node.key.name}' cannot be a binding name`, node.key.start);
        node.shorthand = true;
        this.checkReference(node.key.name, node.key.start);
        this.checkBindingName(node.key.name, kind, node.key.start);
        if (this.isPunct('=')) {
          const assignment = this.startNodeAt(node.key.start);
          assignment.left = this.cloneIdentifier(node.key);
          this.next();
          assignment.right = this.parseMaybeAssign();
          node.value = this.finishNode(assignment, 'AssignmentPattern');
        } else {
          node.value = this.cloneIdentifier(node.key);
        }
      }
      properties.push(this.finishNode(node, 'Property'));
    }
    return properties;
  }

  /**
   * Parses a binding with an optional default value.
   * @param {string} [kind] - How the names in it are being declared.
   * @returns {object} The pattern.
   */
  parseMaybeDefault(kind = 'none') {
    const start = this.tok.start;
    const left = this.parseBindingAtom(kind);
    if (!this.isPunct('=')) return left;
    const node = this.startNodeAt(start);
    this.next();
    node.left = left;
    node.right = this.parseMaybeAssign();
    return this.finishNode(node, 'AssignmentPattern');
  }

  /**
   * Re-reads an expression as an assignment target.
   *
   * `[a, b] = c` is parsed as an ArrayExpression and only then known to be a
   * pattern, which is the one place ECMAScript genuinely needs this. The
   * conversion is in place, so the node's range is unchanged.
   * @param {object} node - The parsed expression.
   * @param {boolean} top - Whether this is the outermost target.
   * @returns {object} The pattern.
   */
  toAssignable(node, top = false) {
    switch (node.type) {
      case 'Identifier':
      case 'MemberExpression':
        if (node.type === 'MemberExpression' && node.optional) {
          this.raise('An optional member access is not a valid assignment target', node.start);
        }
        return node;
      case 'ObjectPattern':
      case 'ArrayPattern':
      case 'AssignmentPattern':
      case 'RestElement':
        return node;
      case 'ObjectExpression': {
        node.type = 'ObjectPattern';
        const properties = node.properties;
        for (let i = 0; i < properties.length; i += 1) {
          const property = properties[i];
          if (property.type === 'SpreadElement') {
            if (i !== properties.length - 1) this.raise('A rest element must be last', property.start);
            property.type = 'RestElement';
            if (property.argument.type !== 'Identifier' && property.argument.type !== 'MemberExpression') {
              this.raise('An object rest target must be a simple reference', property.argument.start);
            }
            continue;
          }
          if (property.kind !== 'init' || property.method) {
            this.raise('A method is not a valid assignment target', property.start);
          }
          if (property.shorthandDefault) {
            const index = this.pendingShorthandDefaults.indexOf(property.shorthandDefault);
            if (index !== -1) this.pendingShorthandDefaults.splice(index, 1);
            delete property.shorthandDefault;
          }
          property.value = this.toAssignable(property.value);
        }
        return node;
      }
      case 'ArrayExpression': {
        node.type = 'ArrayPattern';
        const elements = node.elements;
        for (let i = 0; i < elements.length; i += 1) {
          const element = elements[i];
          if (element === null) continue;
          if (element.type === 'SpreadElement') {
            if (i !== elements.length - 1) this.raise('A rest element must be last', element.start);
            element.type = 'RestElement';
            element.argument = this.toAssignable(element.argument);
            continue;
          }
          elements[i] = this.toAssignable(element);
        }
        return node;
      }
      case 'AssignmentExpression': {
        if (node.operator !== '=') this.raise('Invalid assignment target', node.start);
        node.type = 'AssignmentPattern';
        delete node.operator;
        node.left = this.toAssignable(node.left);
        return node;
      }
      default:
        if (top) this.raise('Invalid assignment target', node.start);
        this.raise('Invalid destructuring target', node.start);
        return node;
    }
  }
}

/**
 * Parses a complete program.
 * @param {string} source - The source text.
 * @param {object} [options] - Parse options. `sourceType` (`'script'` by
 *   default), `locations`, `allowReturnOutsideFunction`,
 *   `allowAwaitOutsideFunction`, `allowSuperOutsideMethod`,
 *   `allowNewTargetOutsideFunction` and `allowHashBang` behave as acorn's do.
 *   `ecmaVersion` is accepted and ignored: this parser implements one version
 *   of the language, the current one.
 * @returns {object} An ESTree Program node.
 * @throws {JsParseError} When the source is not valid JavaScript.
 */
export function parse(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('parse() expects a source string');
  const parser = new Parser(source, options);
  return runGuarded(parser, () => parser.parseTopLevel());
}

/**
 * Runs a parse, turning a stack overflow into an ordinary parse error.
 *
 * The parser is recursive, so source nested a few thousand levels deep — which
 * only ever arrives from a generator — exhausts the stack. A `RangeError`
 * escaping into the build would surface as an internal crash rather than as a
 * diagnostic, so it is reported like any other thing the parser cannot read:
 * with a position, and as a reason the build can print.
 * @template T
 * @param {Parser} parser - The parser, for its position.
 * @param {() => T} run - The parse to attempt.
 * @returns {T} Whatever the parse produced.
 * @throws {JsParseError} When the source nests too deeply to parse.
 */
function runGuarded(parser, run) {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) {
      parser.raise('Not enough stack space to parse input');
    }
    throw error;
  }
}

/**
 * Parses a single expression starting at an offset.
 *
 * Stops as soon as the expression ends, leaving whatever follows unread, which
 * is how the declaration reader tells `{ a: 1 }` from `{ a: 1 } and more`: it
 * compares the node's `end` against the length of what it handed in.
 * @param {string} source - The source text.
 * @param {number} [offset] - Where to start.
 * @param {object} [options] - Parse options, as {@link parse} takes them.
 * @returns {object} The expression node.
 * @throws {JsParseError} When no expression can be read there.
 */
export function parseExpressionAt(source, offset = 0, options = {}) {
  if (typeof source !== 'string') throw new TypeError('parseExpressionAt() expects a source string');
  const parser = new Parser(source, { ...options, allowHashBang: false });
  parser.enterScope(SCOPE_VAR);
  parser.tz.pos = offset;
  parser.tok = parser.tz.nextToken();
  return runGuarded(parser, () => {
    const expression = parser.parseExpression();
    parser.flushShorthandDefaults();
    return expression;
  });
}

export { JsParseError };
