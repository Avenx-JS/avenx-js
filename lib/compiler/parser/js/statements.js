/**
 * @file statements.js
 * @description Statement and top-level program parsing for the JavaScript parser.
 * @module lib/compiler/parser/js/statements
 */

import { RESERVED_WORDS } from './tokenizer.js';
import { SCOPE_VAR, SCOPE_BLOCK, SCOPE_SIMPLE_CATCH } from './scope.js';

/**
 * Parses the whole input.
 * @param {object} p - The parser instance.
 * @returns {object} A Program node.
 */
export function parseTopLevel(p) {
  const node = p.startNodeAt(0);
  node.body = [];
  p.enterScope(SCOPE_VAR);
  let prologue = true;
  while (p.tok.type !== 'eof') {
    const statement = p.parseStatement(true);
    if (prologue) {
      if (p.isDirective(statement)) {
        statement.directive = statement.expression.raw.slice(1, -1);
        if (statement.directive === 'use strict') p.strict = true;
      } else {
        prologue = false;
      }
    }
    node.body.push(statement);
  }
  p.flushShorthandDefaults();
  p.exitScope();
  node.sourceType = p.sourceType;
  return p.finishNodeAt(node, 'Program', p.input.length);
}

/**
 * Reports any `{ a = 1 }` that never became a destructuring pattern.
 * @param {object} p - The parser instance.
 */
export function flushShorthandDefaults(p) {
  if (p.pendingShorthandDefaults.length === 0) return;
  const first = p.pendingShorthandDefaults.reduce((a, b) => (a.start <= b.start ? a : b));
  p.raise('A shorthand property default is only valid in a destructuring pattern', first.start);
}

/**
 * Whether a statement is a directive-prologue entry.
 * @param {object} statement - The statement.
 * @returns {boolean} True when it is.
 */
export function isDirective(statement) {
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
 * @param {object} p - The parser instance.
 * @param {boolean} [topLevel] - Whether `import`/`export` are legal here.
 * @param {boolean} [declarations] - Whether a lexical declaration is legal here,
 *   which it is not as the body of an `if` or a loop.
 * @param {'list'|'single'|'none'} [functions] - Where a function declaration
 *   may stand: anywhere in a statement list, directly as a sloppy `if`
 *   branch, or nowhere.
 * @returns {object} The statement node.
 */
export function parseStatement(p, topLevel = false, declarations = true, functions = 'list') {
  if (p.tok.type === 'punct') {
    switch (p.tok.value) {
      case '{':
        return p.parseBlock();
      case ';': {
        const node = p.startNode();
        p.next();
        return p.finishNode(node, 'EmptyStatement');
      }
      default:
        break;
    }
  }

  if (p.tok.type === 'name') {
    switch (p.tok.value) {
      case 'var':
        // `var` is a statement, so `if (a) var b = 1;` is legal; only a
        // lexical declaration is refused in a statement position.
        return p.parseVarStatement('var');
      case 'const':
        if (!declarations) p.raise('A lexical declaration cannot be the body of a statement');
        return p.parseVarStatement('const');
      case 'let':
        // Where a declaration is not allowed, `let` can only be a reference,
        // which is how `for (a of b) let x = 1` fails at `x` rather than here.
        if (declarations && p.isLetDeclaration()) return p.parseVarStatement('let');
        break;
      case 'function':
        // A statement list always allows one. Directly as an `if` branch,
        // sloppy code allows it too, which Annex B grandfathered in.
        // Everywhere else -- a loop body, a label inside one -- it is an error.
        if (functions === 'none' || (functions === 'single' && p.strict)) {
          p.raise('A function declaration cannot appear here');
        }
        // Annex B grandfathered a plain function, never a generator.
        if (functions !== 'list' && p.peek().value === '*') {
          p.raise('A generator declaration cannot appear here');
        }
        return p.parseFunctionStatement(false);
      case 'class':
        if (!declarations) p.raise('A lexical declaration cannot be the body of a statement');
        return p.parseClass(p.startNode(), true);
      case 'if':
        return p.parseIf();
      case 'for':
        return p.parseFor();
      case 'while':
        return p.parseWhile();
      case 'do':
        return p.parseDoWhile();
      case 'switch':
        return p.parseSwitch();
      case 'try':
        return p.parseTry();
      case 'with':
        return p.parseWith();
      case 'return':
        return p.parseReturn();
      case 'throw':
        return p.parseThrow();
      case 'break':
      case 'continue':
        return p.parseBreakContinue(p.tok.value);
      case 'debugger': {
        const node = p.startNode();
        p.next();
        p.semicolon();
        return p.finishNode(node, 'DebuggerStatement');
      }
      case 'import': {
        const after = p.peek();
        const isCall = after.type === 'punct' && (after.value === '(' || after.value === '.');
        if (!isCall) {
          if (p.sourceType !== 'module') p.raise("'import' is only allowed in a module");
          if (!topLevel) p.raise("'import' may only appear at the top level");
          return p.parseImport();
        }
        break;
      }
      case 'export':
        if (p.sourceType !== 'module') p.raise("'export' is only allowed in a module");
        if (!topLevel) p.raise("'export' may only appear at the top level");
        return p.parseExport();
      case 'async': {
        const after = p.peek();
        if (after.type === 'name' && after.value === 'function' && !after.nlBefore) {
          if (functions !== 'list') p.raise('A function declaration cannot appear here');
          return p.parseFunctionStatement(true);
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
  if (p.tok.type === 'name' && !RESERVED_WORDS.has(p.tok.value)) {
    const after = p.peek();
    if (after.type === 'punct' && after.value === ':') {
      return p.parseLabeledStatement(functions);
    }
  }

  const node = p.startNode();
  node.expression = p.parseExpression();
  p.semicolon();
  return p.finishNode(node, 'ExpressionStatement');
}

/**
 * Whether the `let` at the current token opens a declaration.
 *
 * `let` is not a reserved word, so `let` alone, `let.x` and `let(0)` are all
 * references to a variable called `let`. A declaration is `let` followed by a
 * binding: an identifier, `[` or `{`.
 * @param {object} p - The parser instance.
 * @returns {boolean} True when it declares.
 */
export function isLetDeclaration(p) {
  const after = p.peek();
  if (after.type === 'name') return !RESERVED_WORDS.has(after.value) || after.value === 'let';
  if (after.type === 'punct') return after.value === '[' || after.value === '{';
  return false;
}

/**
 * Parses `{ … }`.
 * @param {object} p - The parser instance.
 * @param {boolean} [ownScope] - Whether the block introduces a scope of its
 *   own. A `catch` body shares the clause's scope, so its block does not.
 * @returns {object} A BlockStatement.
 */
export function parseBlock(p, ownScope = true) {
  const node = p.startNode();
  p.expectPunct('{');
  if (ownScope) p.enterScope(SCOPE_BLOCK);
  node.body = [];
  while (!p.eatPunct('}')) {
    if (p.tok.type === 'eof') p.raise("Expected '}'");
    node.body.push(p.parseStatement());
  }
  if (ownScope) p.exitScope();
  return p.finishNode(node, 'BlockStatement');
}

/**
 * Parses a `var`, `let` or `const` statement.
 * @param {object} p - The parser instance.
 * @param {string} kind - The declaration keyword.
 * @returns {object} A VariableDeclaration.
 */
export function parseVarStatement(p, kind) {
  const node = p.startNode();
  p.next();
  p.parseVarDeclarations(node, kind, false);
  p.semicolon();
  return p.finishNode(node, 'VariableDeclaration');
}

/**
 * Parses the declarator list of a variable declaration.
 * @param {object} p - The parser instance.
 * @param {object} node - The declaration node.
 * @param {string} kind - The declaration keyword.
 * @param {boolean} noIn - Whether `in` is an operator here.
 */
export function parseVarDeclarations(p, node, kind, noIn) {
  node.declarations = [];
  node.kind = kind;
  for (;;) {
    const declarator = p.startNode();
    declarator.id = p.parseBindingAtom(kind === 'var' ? 'var' : 'lexical');
    declarator.init = p.eatPunct('=') ? p.parseMaybeAssign(noIn) : null;
    if (declarator.init === null && kind === 'const' && !noIn) {
      p.raise('A const declaration must have an initialiser', declarator.start);
    }
    if (declarator.init === null && declarator.id.type !== 'Identifier' && !noIn) {
      p.raise('A destructuring declaration must have an initialiser', declarator.start);
    }
    node.declarations.push(p.finishNode(declarator, 'VariableDeclarator'));
    if (!p.eatPunct(',')) break;
  }
}

/**
 * Parses `if`.
 * @param {object} p - The parser instance.
 * @returns {object} An IfStatement.
 */
export function parseIf(p) {
  const node = p.startNode();
  p.next();
  node.test = p.parseParenExpression();
  node.consequent = p.parseStatement(false, false, 'single');
  node.alternate = p.eatName('else') ? p.parseStatement(false, false, 'single') : null;
  return p.finishNode(node, 'IfStatement');
}

/**
 * Parses a parenthesised expression, as a control structure's head.
 * @param {object} p - The parser instance.
 * @returns {object} The expression.
 */
export function parseParenExpression(p) {
  p.expectPunct('(');
  const expression = p.parseExpression();
  p.expectPunct(')');
  return expression;
}

/**
 * Parses `for`, `for…in`, `for…of` and `for await…of`.
 * @param {object} p - The parser instance.
 * @returns {object} The statement.
 */
export function parseFor(p) {
  const node = p.startNode();
  p.next();
  // The whole head shares one block scope with the body, so `for (let i …)`
  // declares `i` once per loop rather than in the enclosing scope.
  p.enterScope(SCOPE_BLOCK);
  const isAwait = p.isName('await') && p.inAsync;
  if (isAwait) p.next();
  p.expectPunct('(');

  let init = null;
  let startsWithLet = false;
  if (p.isPunct(';')) {
    // No initialiser: `for (; test; update)`.
  } else if (
    p.isName('var') ||
    p.isName('const') ||
    (p.isName('let') && p.isLetDeclaration())
  ) {
    const declaration = p.startNode();
    const kind = p.tok.value;
    p.next();
    p.parseVarDeclarations(declaration, kind, true);
    init = p.finishNode(declaration, 'VariableDeclaration');
  } else {
    startsWithLet = p.isName('let');
    init = p.parseExpression(true);
  }

  if (p.isName('of') || p.isName('in')) {
    if (startsWithLet) {
      p.raise("The left-hand side of a for-in/of loop may not start with 'let'", init.start);
    }
    const isOf = p.tok.value === 'of';
    if (isAwait && !isOf) p.raise("'for await' requires 'of'");
    p.next();
    node.left = p.toForTarget(init);
    node.right = isOf ? p.parseMaybeAssign() : p.parseExpression();
    p.expectPunct(')');
    if (isOf) node.await = isAwait;
    node.body = p.parseLoopBody();
    p.exitScope();
    return p.finishNode(node, isOf ? 'ForOfStatement' : 'ForInStatement');
  }

  if (isAwait) p.raise("'for await' requires 'of'");
  if (init && init.type === 'VariableDeclaration') {
    for (const declarator of init.declarations) {
      if (declarator.init === null && declarator.id.type !== 'Identifier') {
        p.raise('A destructuring declaration must have an initialiser', declarator.start);
      }
      if (declarator.init === null && init.kind === 'const') {
        p.raise('A const declaration must have an initialiser', declarator.start);
      }
    }
  }
  node.init = init;
  p.expectPunct(';');
  node.test = p.isPunct(';') ? null : p.parseExpression();
  p.expectPunct(';');
  node.update = p.isPunct(')') ? null : p.parseExpression();
  p.expectPunct(')');
  node.body = p.parseLoopBody();
  p.exitScope();
  return p.finishNode(node, 'ForStatement');
}

/**
 * Converts a `for` head into an assignment target.
 * @param {object} p - The parser instance.
 * @param {object} node - The parsed head.
 * @returns {object} A declaration or a pattern.
 */
export function toForTarget(p, node) {
  if (node.type === 'VariableDeclaration') {
    if (node.declarations.length !== 1) {
      p.raise('A for-in/of head may declare only one binding', node.start);
    }
    if (node.declarations[0].init !== null) {
      p.raise('A for-in/of binding may not have an initialiser', node.start);
    }
    return node;
  }
  return p.toAssignable(node, true);
}

/**
 * Parses a loop body, tracking that `break` and `continue` are legal in it.
 * @param {object} p - The parser instance.
 * @returns {object} The body statement.
 */
export function parseLoopBody(p) {
  p.breakDepth += 1;
  p.continueDepth += 1;
  const body = p.parseStatement(false, false, 'none');
  p.breakDepth -= 1;
  p.continueDepth -= 1;
  return body;
}

/**
 * Parses `while`.
 * @param {object} p - The parser instance.
 * @returns {object} A WhileStatement.
 */
export function parseWhile(p) {
  const node = p.startNode();
  p.next();
  node.test = p.parseParenExpression();
  node.body = p.parseLoopBody();
  return p.finishNode(node, 'WhileStatement');
}

/**
 * Parses `do … while`.
 * @param {object} p - The parser instance.
 * @returns {object} A DoWhileStatement.
 */
export function parseDoWhile(p) {
  const node = p.startNode();
  p.next();
  node.body = p.parseLoopBody();
  p.expectName('while');
  node.test = p.parseParenExpression();
  // The semicolon after `do {} while ()` is optional even without a newline.
  p.eatPunct(';');
  return p.finishNode(node, 'DoWhileStatement');
}

/**
 * Parses `switch`.
 * @param {object} p - The parser instance.
 * @returns {object} A SwitchStatement.
 */
export function parseSwitch(p) {
  const node = p.startNode();
  p.next();
  node.discriminant = p.parseParenExpression();
  node.cases = [];
  p.expectPunct('{');
  // Every clause of a switch shares one block scope.
  p.enterScope(SCOPE_BLOCK);
  p.breakDepth += 1;
  let current = null;
  let sawDefault = false;
  while (!p.isPunct('}')) {
    if (p.tok.type === 'eof') p.raise("Expected '}'");
    if (p.isName('case') || p.isName('default')) {
      const isCase = p.tok.value === 'case';
      if (current) p.finishNode(current, 'SwitchCase');
      current = p.startNode();
      node.cases.push(current);
      current.consequent = [];
      p.next();
      if (isCase) {
        current.test = p.parseExpression();
      } else {
        if (sawDefault) p.raise('Duplicate default clause', current.start);
        sawDefault = true;
        current.test = null;
      }
      p.expectPunct(':');
    } else {
      if (!current) p.unexpected();
      current.consequent.push(p.parseStatement());
    }
  }
  // A case ends where its last statement ends, not where the switch's brace
  // is, so the open case is closed before the brace is consumed.
  if (current) p.finishNode(current, 'SwitchCase');
  p.expectPunct('}');
  p.exitScope();
  p.breakDepth -= 1;
  return p.finishNode(node, 'SwitchStatement');
}

/**
 * Parses `try`.
 * @param {object} p - The parser instance.
 * @returns {object} A TryStatement.
 */
export function parseTry(p) {
  const node = p.startNode();
  p.next();
  node.block = p.parseBlock();
  node.handler = null;
  if (p.isName('catch')) {
    const clause = p.startNode();
    p.next();
    if (p.eatPunct('(')) {
      // A single simple binding may be redeclared with `var` in the body,
      // which is why the parameter's own scope is the body's scope too.
      const simple = p.isName('(') === false && p.tok.type === 'name';
      p.enterScope(SCOPE_BLOCK | (simple ? SCOPE_SIMPLE_CATCH : 0));
      clause.param = p.parseBindingAtom(simple ? 'simple-catch' : 'lexical');
      p.expectPunct(')');
    } else {
      clause.param = null;
      p.enterScope(SCOPE_BLOCK);
    }
    clause.body = p.parseBlock(false);
    p.exitScope();
    node.handler = p.finishNode(clause, 'CatchClause');
  }
  node.finalizer = p.eatName('finally') ? p.parseBlock() : null;
  if (!node.handler && !node.finalizer) p.raise('Missing catch or finally clause', node.start);
  return p.finishNode(node, 'TryStatement');
}

/**
 * Parses `with`, which strict mode forbids.
 * @param {object} p - The parser instance.
 * @returns {object} A WithStatement.
 */
export function parseWith(p) {
  if (p.strict) p.raise("'with' is not allowed in strict mode");
  const node = p.startNode();
  p.next();
  node.object = p.parseParenExpression();
  node.body = p.parseStatement(false, false, 'none');
  return p.finishNode(node, 'WithStatement');
}

/**
 * Parses `return`.
 * @param {object} p - The parser instance.
 * @returns {object} A ReturnStatement.
 */
export function parseReturn(p) {
  if (!p.inFunction) p.raise("'return' outside of function");
  const node = p.startNode();
  p.next();
  node.argument = p.isPunct(';') || p.canInsertSemicolon() ? null : p.parseExpression();
  p.semicolon();
  return p.finishNode(node, 'ReturnStatement');
}

/**
 * Parses `throw`.
 * @param {object} p - The parser instance.
 * @returns {object} A ThrowStatement.
 */
export function parseThrow(p) {
  const node = p.startNode();
  p.next();
  if (p.tok.nlBefore) p.raise('Illegal newline after throw');
  node.argument = p.parseExpression();
  p.semicolon();
  return p.finishNode(node, 'ThrowStatement');
}

/**
 * Parses `break` or `continue`.
 * @param {object} p - The parser instance.
 * @param {string} keyword - Which one.
 * @returns {object} The statement.
 */
export function parseBreakContinue(p, keyword) {
  const node = p.startNode();
  p.next();
  if (p.isPunct(';') || p.canInsertSemicolon()) {
    node.label = null;
  } else {
    node.label = p.parseIdentifier();
    if (!p.labels.includes(node.label.name)) {
      p.raise(`Unknown label '${node.label.name}'`, node.label.start);
    }
  }
  p.semicolon();
  if (node.label === null) {
    const depth = keyword === 'break' ? p.breakDepth : p.continueDepth;
    if (depth === 0) p.raise(`Unsyntactic ${keyword}`, node.start);
  }
  return p.finishNode(node, keyword === 'break' ? 'BreakStatement' : 'ContinueStatement');
}

/**
 * Parses `label: statement`.
 * @param {object} p - The parser instance.
 * @param {'list'|'single'|'none'} [functions] - The label's own position, which
 *   it passes to its body rather than widening.
 * @returns {object} A LabeledStatement.
 */
export function parseLabeledStatement(p, functions = 'list') {
  const node = p.startNode();
  node.label = p.parseIdentifier();
  if (p.labels.includes(node.label.name)) {
    p.raise(`Label '${node.label.name}' is already declared`, node.label.start);
  }
  p.expectPunct(':');
  p.labels.push(node.label.name);
  // A labelled statement may be broken out of even when it is not a loop.
  p.breakDepth += 1;
  // `l: function f(){}` is legal in a sloppy statement list and nowhere else,
  // so the label passes its own position down rather than widening it.
  node.body = p.parseStatement(false, false, functions === 'list' ? 'single' : 'none');
  p.breakDepth -= 1;
  p.labels.pop();
  return p.finishNode(node, 'LabeledStatement');
}
