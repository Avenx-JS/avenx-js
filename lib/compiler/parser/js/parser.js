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

import { Tokenizer, JsParseError } from './tokenizer.js';
import {
  SCOPE_VAR,
  enterScope,
  exitScope,
  currentScope,
  addBinding,
  declareName,
} from './scope.js';
import {
  raise,
  unexpected,
  next,
  isPunct,
  isName,
  eatPunct,
  eatName,
  expectPunct,
  expectName,
  canInsertSemicolon,
  semicolon,
  peek,
} from './tokens.js';
import {
  startNode,
  startNodeAt,
  finishNode,
  finishNodeAt,
  saveState,
  restoreState,
} from './nodes.js';
import {
  parseTopLevel,
  flushShorthandDefaults,
  isDirective,
  parseStatement,
  isLetDeclaration,
  parseBlock,
  parseVarStatement,
  parseVarDeclarations,
  parseIf,
  parseParenExpression,
  parseFor,
  toForTarget,
  parseLoopBody,
  parseWhile,
  parseDoWhile,
  parseSwitch,
  parseTry,
  parseWith,
  parseReturn,
  parseThrow,
  parseBreakContinue,
  parseLabeledStatement,
} from './statements.js';
import {
  parseImport,
  parseImportSpecifiers,
  parseModuleExportName,
  parseImportAttributes,
  parseExport,
  parseExportedDeclaration,
} from './modules.js';
import {
  parseFunctionStatement,
  parseFunctionRest,
  enterFunction,
  exitFunction,
  parseFunctionBody,
  parseClass,
  parseClassBody,
  usePrivateName,
  declarePrivateName,
  resolvePrivateNames,
  parseClassElement,
  parseMethod,
  parsePropertyName,
} from './classes.js';
import {
  parseExpression,
  parseMaybeAssign,
  checkSimpleTarget,
  tryParseArrow,
  speculateParenArrow,
  parseArrowBody,
  parseYield,
  parseMaybeConditional,
  parseExprOps,
  currentBinaryOperator,
  parseExprOp,
  parseMaybeUnary,
  parseExprSubscripts,
  parseSubscripts,
  parseMemberProperty,
  parseArguments,
} from './expressions.js';
import {
  parseExprAtom,
  parseParenExpressionAtom,
  parseExpressionList,
  parseObject,
  parseObjectMember,
  cloneIdentifier,
  parseNew,
  metaIdentifier,
  parseImportExpression,
  parseLiteral,
  bigIntValue,
  regExpValue,
  parseTemplate,
  templateElement,
  parseIdentifier,
  checkReference,
  parseIdentifierName,
} from './atoms.js';
import {
  parseParams,
  declareParams,
  checkBindingName,
  parseBindingIdentifier,
  parseBindingAtom,
  parseBindingList,
  parseObjectPatternProperties,
  parseMaybeDefault,
  toAssignable,
} from './patterns.js';

/**
 * A recursive-descent ECMAScript parser.
 */
export class Parser {
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
    this.strict = this.sourceType === 'module' || !!options.strict;
    /** @type {string[]} Labels in scope, for `break`/`continue`. */
    this.labels = [];
    /** @type {number} Loop and switch nesting, for unlabelled `break`. */
    this.breakDepth = 0;
    /** @type {number} Loop nesting, for unlabelled `continue`. */
    this.continueDepth = 0;
    /** @type {import('./scope.js').BindingScope[]} The scope chain. */
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

  /** @param {number} flags - Scope flags. */
  enterScope(flags) { enterScope(this, flags); }
  /** Pops the current scope. */
  exitScope() { exitScope(this); }
  /** @returns {import('./scope.js').BindingScope} The innermost scope. */
  currentScope() { return currentScope(this); }
  /**
   * @param {Set<string>} set - Target set.
   * @param {string} name - Binding name.
   */
  addBinding(set, name) { addBinding(this, set, name); }
  /**
   * @param {string} name - Binding name.
   * @param {'var'|'lexical'|'function'|'param'|'simple-catch'} kind - Declaration kind.
   * @param {number} pos - Source offset.
   */
  declareName(name, kind, pos) { declareName(this, name, kind, pos); }

  /**
   * @param {string} message - Error message.
   * @param {number} [pos] - Source offset.
   */
  raise(message, pos = this.tok.start) { raise(this, message, pos); }
  /** Reports an unexpected token. */
  unexpected() { unexpected(this); }
  /** Advances to the next token. */
  next() { next(this); }
  /** @param {string} value - Punctuator. */
  isPunct(value) { return isPunct(this, value); }
  /** @param {string} value - Name. */
  isName(value) { return isName(this, value); }
  /** @param {string} value - Punctuator. */
  eatPunct(value) { return eatPunct(this, value); }
  /** @param {string} value - Name. */
  eatName(value) { return eatName(this, value); }
  /** @param {string} value - Punctuator. */
  expectPunct(value) { expectPunct(this, value); }
  /** @param {string} value - Name. */
  expectName(value) { expectName(this, value); }
  /** @returns {boolean} Whether ASI applies. */
  canInsertSemicolon() { return canInsertSemicolon(this); }
  /** Consumes or inserts a semicolon. */
  semicolon() { semicolon(this); }
  /** @returns {import('./tokenizer.js').Token} The next token. */
  peek() { return peek(this); }

  /** @returns {object} A bare node. */
  startNode() { return startNode(this); }
  /** @param {number} pos - Start offset. */
  startNodeAt(pos) { return startNodeAt(this, pos); }
  /**
   * @param {object} node - Node.
   * @param {string} type - ESTree type.
   */
  finishNode(node, type) { return finishNode(this, node, type); }
  /**
   * @param {object} node - Node.
   * @param {string} type - ESTree type.
   * @param {number} end - End offset.
   */
  finishNodeAt(node, type, end) { return finishNodeAt(this, node, type, end); }
  /** @returns {object} Saved state. */
  saveState() { return saveState(this); }
  /** @param {object} state - Saved state. */
  restoreState(state) { restoreState(this, state); }

  /** @returns {object} A Program node. */
  parseTopLevel() { return parseTopLevel(this); }
  /** Reports leftover shorthand defaults. */
  flushShorthandDefaults() { flushShorthandDefaults(this); }
  /** @param {object} statement - Statement node. */
  isDirective(statement) { return isDirective(statement); }
  /**
   * @param {boolean} [topLevel] - Whether top-level statements are allowed.
   * @param {boolean} [declarations] - Whether lexical declarations are allowed.
   * @param {'list'|'single'|'none'} [functions] - Function declaration mode.
   */
  parseStatement(topLevel = false, declarations = true, functions = 'list') {
    return parseStatement(this, topLevel, declarations, functions);
  }
  /** @returns {boolean} Whether `let` starts a declaration. */
  isLetDeclaration() { return isLetDeclaration(this); }
  /** @param {boolean} [ownScope] - Whether to push a block scope. */
  parseBlock(ownScope = true) { return parseBlock(this, ownScope); }
  /** @param {string} kind - Declaration keyword. */
  parseVarStatement(kind) { return parseVarStatement(this, kind); }
  /**
   * @param {object} node - VariableDeclaration node.
   * @param {string} kind - Declaration keyword.
   * @param {boolean} noIn - Disallow `in`.
   */
  parseVarDeclarations(node, kind, noIn) { parseVarDeclarations(this, node, kind, noIn); }
  /** @returns {object} An IfStatement. */
  parseIf() { return parseIf(this); }
  /** @returns {object} Expression inside parentheses. */
  parseParenExpression() { return parseParenExpression(this); }
  /** @returns {object} A For/ForIn/ForOfStatement. */
  parseFor() { return parseFor(this); }
  /** @param {object} node - Parsed for-head. */
  toForTarget(node) { return toForTarget(this, node); }
  /** @returns {object} Loop body statement. */
  parseLoopBody() { return parseLoopBody(this); }
  /** @returns {object} A WhileStatement. */
  parseWhile() { return parseWhile(this); }
  /** @returns {object} A DoWhileStatement. */
  parseDoWhile() { return parseDoWhile(this); }
  /** @returns {object} A SwitchStatement. */
  parseSwitch() { return parseSwitch(this); }
  /** @returns {object} A TryStatement. */
  parseTry() { return parseTry(this); }
  /** @returns {object} A WithStatement. */
  parseWith() { return parseWith(this); }
  /** @returns {object} A ReturnStatement. */
  parseReturn() { return parseReturn(this); }
  /** @returns {object} A ThrowStatement. */
  parseThrow() { return parseThrow(this); }
  /** @param {string} keyword - `'break'` or `'continue'`. */
  parseBreakContinue(keyword) { return parseBreakContinue(this, keyword); }
  /** @param {'list'|'single'|'none'} [functions] - Function declaration mode. */
  parseLabeledStatement(functions = 'list') { return parseLabeledStatement(this, functions); }

  /** @returns {object} An ImportDeclaration. */
  parseImport() { return parseImport(this); }
  /** @returns {object[]} Import specifiers. */
  parseImportSpecifiers() { return parseImportSpecifiers(this); }
  /** @returns {object} Identifier or string Literal. */
  parseModuleExportName() { return parseModuleExportName(this); }
  /** @returns {object[]} Import attributes. */
  parseImportAttributes() { return parseImportAttributes(this); }
  /** @returns {object} Export declaration node. */
  parseExport() { return parseExport(this); }
  /** @returns {object} Exported declaration. */
  parseExportedDeclaration() { return parseExportedDeclaration(this); }

  /** @param {boolean} isAsync - Whether async. */
  parseFunctionStatement(isAsync) { return parseFunctionStatement(this, isAsync); }
  /**
   * @param {object} node - Started node.
   * @param {string} type - Node type.
   * @param {boolean} isAsync - Whether async.
   * @param {boolean} isGenerator - Whether generator.
   */
  parseFunctionRest(node, type, isAsync, isGenerator) {
    return parseFunctionRest(this, node, type, isAsync, isGenerator);
  }
  /**
   * @param {boolean} isAsync - Whether async.
   * @param {boolean} isGenerator - Whether generator.
   */
  enterFunction(isAsync, isGenerator) { return enterFunction(this, isAsync, isGenerator); }
  /** @param {object} outer - Saved function state. */
  exitFunction(outer) { exitFunction(this, outer); }
  /** @returns {object} A BlockStatement. */
  parseFunctionBody() { return parseFunctionBody(this); }
  /**
   * @param {object} node - Started node.
   * @param {boolean|'nullable'} isStatement - Statement mode.
   */
  parseClass(node, isStatement) { return parseClass(this, node, isStatement); }
  /** @param {boolean} derived - Whether derived class. */
  parseClassBody(derived) { return parseClassBody(this, derived); }
  /**
   * @param {string} name - Private name.
   * @param {number} pos - Source offset.
   */
  usePrivateName(name, pos) { usePrivateName(this, name, pos); }
  /** @param {object} element - Class element. */
  declarePrivateName(element) { declarePrivateName(this, element); }
  /** Resolves private names at class body end. */
  resolvePrivateNames() { resolvePrivateNames(this); }
  /** @param {boolean} derived - Whether derived class. */
  parseClassElement(derived) { return parseClassElement(this, derived); }
  /**
   * @param {boolean} isAsync - Whether async.
   * @param {boolean} isGenerator - Whether generator.
   * @param {boolean} derivedConstructor - Whether derived constructor.
   * @param {string} [kind] - Method kind.
   */
  parseMethod(isAsync, isGenerator, derivedConstructor, kind = 'method') {
    return parseMethod(this, isAsync, isGenerator, derivedConstructor, kind);
  }
  /** @param {object} node - Node to populate with `key` and `computed`. */
  parsePropertyName(node) { parsePropertyName(this, node); }

  /** @param {boolean} [noIn] - Disallow `in`. */
  parseExpression(noIn = false) { return parseExpression(this, noIn); }
  /** @param {boolean} [noIn] - Disallow `in`. */
  parseMaybeAssign(noIn = false) { return parseMaybeAssign(this, noIn); }
  /** @param {object} node - Target node. */
  checkSimpleTarget(node) { return checkSimpleTarget(this, node); }
  /** @returns {object|null} Arrow function or null. */
  tryParseArrow() { return tryParseArrow(this); }
  /** @param {boolean} isAsync - Whether async. */
  speculateParenArrow(isAsync) { return speculateParenArrow(this, isAsync); }
  /**
   * @param {object} node - Started node.
   * @param {object[]} params - Parameter list.
   * @param {boolean} isAsync - Whether async.
   */
  parseArrowBody(node, params, isAsync) { return parseArrowBody(this, node, params, isAsync); }
  /** @param {boolean} noIn - Disallow `in`. */
  parseYield(noIn) { return parseYield(this, noIn); }
  /** @param {boolean} noIn - Disallow `in`. */
  parseMaybeConditional(noIn) { return parseMaybeConditional(this, noIn); }
  /** @param {boolean} noIn - Disallow `in`. */
  parseExprOps(noIn) { return parseExprOps(this, noIn); }
  /** @param {boolean} noIn - Disallow `in`. */
  currentBinaryOperator(noIn) { return currentBinaryOperator(this, noIn); }
  /**
   * @param {object} left - Left operand.
   * @param {number} start - Start offset.
   * @param {number} minPrecedence - Minimum precedence.
   * @param {boolean} noIn - Disallow `in`.
   */
  parseExprOp(left, start, minPrecedence, noIn) {
    return parseExprOp(this, left, start, minPrecedence, noIn);
  }
  /** @returns {object} Unary or update expression. */
  parseMaybeUnary() { return parseMaybeUnary(this); }
  /** @returns {object} Subscript expression. */
  parseExprSubscripts() { return parseExprSubscripts(this); }
  /**
   * @param {object} base - Base expression.
   * @param {number} start - Start offset.
   * @param {boolean} noCalls - Disallow call subscripts.
   */
  parseSubscripts(base, start, noCalls) { return parseSubscripts(this, base, start, noCalls); }
  /** @returns {object} Identifier or PrivateIdentifier. */
  parseMemberProperty() { return parseMemberProperty(this); }
  /** @returns {object[]} Argument list. */
  parseArguments() { return parseArguments(this); }

  /** @returns {object} Primary expression. */
  parseExprAtom() { return parseExprAtom(this); }
  /** @returns {object} Parenthesised expression. */
  parseParenExpressionAtom() { return parseParenExpressionAtom(this); }
  /**
   * @param {string} close - Closing punctuator.
   * @param {boolean} allowHoles - Allow elisions.
   */
  parseExpressionList(close, allowHoles) { return parseExpressionList(this, close, allowHoles); }
  /** @returns {object} An ObjectExpression. */
  parseObject() { return parseObject(this); }
  /** @returns {object} A Property or SpreadElement. */
  parseObjectMember() { return parseObjectMember(this); }
  /** @param {object} node - Identifier node. */
  cloneIdentifier(node) { return cloneIdentifier(this, node); }
  /** @returns {object} A NewExpression or MetaProperty. */
  parseNew() { return parseNew(this); }
  /**
   * @param {number} start - Start offset.
   * @param {string} name - Keyword name.
   */
  metaIdentifier(start, name) { return metaIdentifier(this, start, name); }
  /** @returns {object} An ImportExpression or MetaProperty. */
  parseImportExpression() { return parseImportExpression(this); }
  /** @returns {object} A Literal. */
  parseLiteral() { return parseLiteral(this); }
  /** @param {string} digits - BigInt digits. */
  bigIntValue(digits) { return bigIntValue(digits); }
  /** @param {{pattern: string, flags: string}} regex - Regex parts. */
  regExpValue(regex) { return regExpValue(regex); }
  /** @returns {object} A TemplateLiteral. */
  parseTemplate() { return parseTemplate(this); }
  /** @param {object} chunk - Template chunk. */
  templateElement(chunk) { return templateElement(this, chunk); }
  /** @returns {object} An Identifier. */
  parseIdentifier() { return parseIdentifier(this); }
  /**
   * @param {string} name - Identifier name.
   * @param {number} pos - Source offset.
   */
  checkReference(name, pos) { checkReference(this, name, pos); }
  /** @returns {object} An Identifier. */
  parseIdentifierName() { return parseIdentifierName(this); }

  /** @returns {object[]} Parameter list. */
  parseParams() { return parseParams(this); }
  /** @param {object[]} params - Parameter list. */
  declareParams(params) { declareParams(this, params); }
  /**
   * @param {string} name - Binding name.
   * @param {string} kind - Declaration kind.
   * @param {number} pos - Source offset.
   */
  checkBindingName(name, kind, pos) { checkBindingName(this, name, kind, pos); }
  /** @param {string} kind - Declaration kind. */
  parseBindingIdentifier(kind) { return parseBindingIdentifier(this, kind); }
  /** @param {string} [kind] - Declaration kind. */
  parseBindingAtom(kind = 'none') { return parseBindingAtom(this, kind); }
  /**
   * @param {string} close - Closing punctuator.
   * @param {string} [kind] - Declaration kind.
   */
  parseBindingList(close, kind = 'none') { return parseBindingList(this, close, kind); }
  /** @param {string} [kind] - Declaration kind. */
  parseObjectPatternProperties(kind = 'none') { return parseObjectPatternProperties(this, kind); }
  /** @param {string} [kind] - Declaration kind. */
  parseMaybeDefault(kind = 'none') { return parseMaybeDefault(this, kind); }
  /**
   * @param {object} node - Expression node.
   * @param {boolean} [top] - Whether outermost target.
   */
  toAssignable(node, top = false) { return toAssignable(this, node, top); }
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
