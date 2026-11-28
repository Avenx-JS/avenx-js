/**
 * @file expressions.js
 * @description Operator precedence tables, assignment, arrow, and unary/subscript expression parsing.
 * @module lib/compiler/parser/js/expressions
 */

import { JsParseError, RESERVED_WORDS } from './tokenizer.js';

/**
 * Thrown internally to abandon a speculative parse. Never escapes.
 * @type {object}
 */
const BAIL = { bail: true };

/**
 * Binary operator precedence. Higher binds tighter.
 * @type {Object<string, number>}
 */
export const BINARY_PRECEDENCE = {
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
export const ASSIGN_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '>>>=', '|=', '^=', '&=',
  '**=', '&&=', '||=', '??=',
]);

/**
 * Unary operators that take a prefix argument.
 * @type {Set<string>}
 */
export const UNARY_OPERATORS = new Set(['-', '+', '!', '~']);

/**
 * Parses a comma-separated expression.
 * @param {object} p - The parser instance.
 * @param {boolean} [noIn] - Whether `in` is an operator here.
 * @returns {object} The expression.
 */
export function parseExpression(p, noIn = false) {
  const start = p.tok.start;
  const first = p.parseMaybeAssign(noIn);
  if (!p.isPunct(',')) return first;
  const node = p.startNodeAt(start);
  node.expressions = [first];
  while (p.eatPunct(',')) {
    node.expressions.push(p.parseMaybeAssign(noIn));
  }
  return p.finishNode(node, 'SequenceExpression');
}

/**
 * Parses an assignment, an arrow function, or anything tighter.
 * @param {object} p - The parser instance.
 * @param {boolean} [noIn] - Whether `in` is an operator here.
 * @returns {object} The expression.
 */
export function parseMaybeAssign(p, noIn = false) {
  if (p.inGenerator && p.isName('yield')) return p.parseYield(noIn);

  const arrow = p.tryParseArrow();
  if (arrow) return arrow;

  const start = p.tok.start;
  const left = p.parseMaybeConditional(noIn);
  if (p.tok.type === 'punct' && ASSIGN_OPERATORS.has(p.tok.value)) {
    const node = p.startNodeAt(start);
    node.operator = p.tok.value;
    node.left = node.operator === '=' ? p.toAssignable(left, true) : p.checkSimpleTarget(left);
    p.next();
    node.right = p.parseMaybeAssign(noIn);
    return p.finishNode(node, 'AssignmentExpression');
  }
  return left;
}

/**
 * Checks that a compound assignment's target is a simple reference.
 * @param {object} p - The parser instance.
 * @param {object} node - The parsed left side.
 * @returns {object} The same node.
 */
export function checkSimpleTarget(p, node) {
  if (node.type !== 'Identifier' && node.type !== 'MemberExpression') {
    p.raise('Invalid assignment target', node.start);
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
 * @param {object} p - The parser instance.
 * @returns {object|null} The arrow function, or null when there is none.
 */
export function tryParseArrow(p) {
  // `x => …`
  if (p.tok.type === 'name' && !RESERVED_WORDS.has(p.tok.value) && p.tok.value !== 'async') {
    const after = p.peek();
    if (after.type === 'punct' && after.value === '=>' && !after.nlBefore) {
      const node = p.startNode();
      const param = p.parseIdentifier();
      return p.parseArrowBody(node, [param], false);
    }
    return null;
  }

  // `async x => …` and `async (…) => …`
  if (p.isName('async')) {
    const after = p.peek();
    if (after.nlBefore) return null;
    if (after.type === 'name' && !RESERVED_WORDS.has(after.value)) {
      const node = p.startNode();
      const state = p.saveState();
      p.next();
      const param = p.parseIdentifier();
      if (p.isPunct('=>') && !p.tok.nlBefore) {
        return p.parseArrowBody(node, [param], true);
      }
      p.restoreState(state);
      return null;
    }
    if (after.type === 'punct' && after.value === '(') {
      return p.speculateParenArrow(true);
    }
    return null;
  }

  if (p.isPunct('(')) return p.speculateParenArrow(false);
  return null;
}

/**
 * Speculatively parses `(…) =>` as an arrow function.
 * @param {object} p - The parser instance.
 * @param {boolean} isAsync - Whether `async` precedes the parentheses.
 * @returns {object|null} The arrow function, or null.
 */
export function speculateParenArrow(p, isAsync) {
  const state = p.saveState();
  const node = p.startNode();
  try {
    if (isAsync) p.next();
    const params = p.parseParams();
    if (!p.isPunct('=>') || p.tok.nlBefore) throw BAIL;
    return p.parseArrowBody(node, params, isAsync);
  } catch (error) {
    if (error !== BAIL && !(error instanceof JsParseError)) throw error;
    p.restoreState(state);
    return null;
  }
}

/**
 * Parses an arrow function's body, the parameters already in hand.
 * @param {object} p - The parser instance.
 * @param {object} node - The started node.
 * @param {object[]} params - The parameters.
 * @param {boolean} isAsync - Whether it is async.
 * @returns {object} An ArrowFunctionExpression.
 */
export function parseArrowBody(p, node, params, isAsync) {
  p.expectPunct('=>');
  node.id = null;
  node.params = params;
  node.async = isAsync;
  node.generator = false;
  const outer = p.enterFunction(isAsync, false);
  p.declareParams(params);
  // An arrow keeps the enclosing `new.target`, and has no `this` of its own,
  // so the surrounding method context stays in force.
  p.inNewTargetScope = outer.inNewTargetScope;
  if (p.isPunct('{')) {
    node.body = p.parseFunctionBody();
    node.expression = false;
  } else {
    node.body = p.parseMaybeAssign();
    node.expression = true;
  }
  p.exitFunction(outer);
  return p.finishNode(node, 'ArrowFunctionExpression');
}

/**
 * Parses `yield` and `yield*`.
 * @param {object} p - The parser instance.
 * @param {boolean} noIn - Whether `in` is an operator here.
 * @returns {object} A YieldExpression.
 */
export function parseYield(p, noIn) {
  const node = p.startNode();
  p.next();
  if (p.isPunct('*')) {
    p.next();
    node.delegate = true;
    node.argument = p.parseMaybeAssign(noIn);
  } else {
    node.delegate = false;
    const ends = p.canInsertSemicolon() ||
      (p.tok.type === 'punct' && [')', ']', '}', ',', ';', ':'].includes(p.tok.value));
    node.argument = ends ? null : p.parseMaybeAssign(noIn);
  }
  return p.finishNode(node, 'YieldExpression');
}

/**
 * Parses a conditional expression.
 * @param {object} p - The parser instance.
 * @param {boolean} noIn - Whether `in` is an operator here.
 * @returns {object} The expression.
 */
export function parseMaybeConditional(p, noIn) {
  const start = p.tok.start;
  const test = p.parseExprOps(noIn);
  if (!p.isPunct('?')) return test;
  const node = p.startNodeAt(start);
  p.next();
  node.test = test;
  node.consequent = p.parseMaybeAssign();
  p.expectPunct(':');
  node.alternate = p.parseMaybeAssign(noIn);
  return p.finishNode(node, 'ConditionalExpression');
}

/**
 * Parses a run of binary and logical operators.
 * @param {object} p - The parser instance.
 * @param {boolean} noIn - Whether `in` is an operator here.
 * @returns {object} The expression.
 */
export function parseExprOps(p, noIn) {
  const start = p.tok.start;
  const left = p.parseMaybeUnary();
  return p.parseExprOp(left, start, 0, noIn);
}

/**
 * The precedence of the current token as a binary operator.
 * @param {object} p - The parser instance.
 * @param {boolean} noIn - Whether `in` is an operator here.
 * @returns {{operator: string, precedence: number}|null} The operator, or null.
 */
export function currentBinaryOperator(p, noIn) {
  if (p.tok.type === 'punct') {
    const precedence = BINARY_PRECEDENCE[p.tok.value];
    if (precedence) return { operator: p.tok.value, precedence };
    return null;
  }
  if (p.tok.type === 'name') {
    if (p.tok.value === 'instanceof') return { operator: 'instanceof', precedence: 8 };
    if (p.tok.value === 'in' && !noIn) return { operator: 'in', precedence: 8 };
  }
  return null;
}

/**
 * Climbs precedence from a parsed left operand.
 * @param {object} p - The parser instance.
 * @param {object} left - The left operand.
 * @param {number} start - Where the expression began.
 * @param {number} minPrecedence - The lowest precedence to bind here.
 * @param {boolean} noIn - Whether `in` is an operator here.
 * @returns {object} The expression.
 */
export function parseExprOp(p, left, start, minPrecedence, noIn) {
  for (;;) {
    const op = p.currentBinaryOperator(noIn);
    if (!op || op.precedence <= minPrecedence) return left;

    const isLogical = op.operator === '||' || op.operator === '&&' || op.operator === '??';
    if (op.operator === '??' && left.type === 'LogicalExpression' && left.operator !== '??' && !left.parenthesised) {
      p.raise("'??' cannot be mixed with '||' or '&&' without parentheses");
    }
    if (
      (op.operator === '||' || op.operator === '&&') &&
      left.type === 'LogicalExpression' &&
      left.operator === '??' &&
      !left.parenthesised
    ) {
      p.raise("'??' cannot be mixed with '||' or '&&' without parentheses");
    }

    p.next();
    const rightStart = p.tok.start;
    let right = p.parseMaybeUnary();
    // `**` is right-associative, so it binds its own precedence again.
    right = p.parseExprOp(right, rightStart, op.operator === '**' ? op.precedence - 1 : op.precedence, noIn);

    // `a ?? b || c` is an error rather than a grouping, and `||` binds
    // tighter, so the offending operand arrives here as the right side.
    if (
      op.operator === '??' &&
      right.type === 'LogicalExpression' &&
      right.operator !== '??' &&
      !right.parenthesised
    ) {
      p.raise("'??' cannot be mixed with '||' or '&&' without parentheses", right.start);
    }

    const node = p.startNodeAt(start);
    node.left = left;
    node.operator = op.operator;
    node.right = right;
    left = p.finishNode(node, isLogical ? 'LogicalExpression' : 'BinaryExpression');
  }
}

/**
 * Parses a unary or update expression, or anything tighter.
 * @param {object} p - The parser instance.
 * @returns {object} The expression.
 */
export function parseMaybeUnary(p) {
  const start = p.tok.start;

  if (p.isName('await') && p.inAsync) {
    const node = p.startNode();
    p.next();
    node.argument = p.parseMaybeUnary();
    const finished = p.finishNode(node, 'AwaitExpression');
    if (p.isPunct('**')) p.raise('Unary operand cannot be the left side of **');
    return finished;
  }

  if (p.tok.type === 'punct' && (UNARY_OPERATORS.has(p.tok.value) || p.tok.value === '++' || p.tok.value === '--')) {
    const isUpdate = p.tok.value === '++' || p.tok.value === '--';
    const node = p.startNode();
    node.operator = p.tok.value;
    node.prefix = true;
    p.next();
    node.argument = p.parseMaybeUnary();
    if (isUpdate) {
      p.checkSimpleTarget(node.argument);
      return p.finishNode(node, 'UpdateExpression');
    }
    const finished = p.finishNode(node, 'UnaryExpression');
    if (p.isPunct('**')) p.raise('Unary operand cannot be the left side of **');
    return finished;
  }

  if (p.tok.type === 'name' && (p.tok.value === 'typeof' || p.tok.value === 'void' || p.tok.value === 'delete')) {
    const node = p.startNode();
    node.operator = p.tok.value;
    node.prefix = true;
    p.next();
    node.argument = p.parseMaybeUnary();
    if (node.operator === 'delete' && p.strict && node.argument.type === 'Identifier') {
      p.raise('Deleting a local variable is not allowed in strict mode', node.start);
    }
    const finished = p.finishNode(node, 'UnaryExpression');
    if (p.isPunct('**')) p.raise('Unary operand cannot be the left side of **');
    return finished;
  }

  let expression = p.parseExprSubscripts();
  while (
    p.tok.type === 'punct' &&
    (p.tok.value === '++' || p.tok.value === '--') &&
    !p.tok.nlBefore
  ) {
    const node = p.startNodeAt(start);
    node.operator = p.tok.value;
    node.prefix = false;
    node.argument = p.checkSimpleTarget(expression);
    p.next();
    expression = p.finishNode(node, 'UpdateExpression');
  }
  return expression;
}

/**
 * Parses an atom and every subscript applied to it.
 * @param {object} p - The parser instance.
 * @returns {object} The expression.
 */
export function parseExprSubscripts(p) {
  const start = p.tok.start;
  const base = p.parseExprAtom();
  return p.parseSubscripts(base, start, false);
}

/**
 * Applies member accesses, calls and tagged templates to a base expression.
 * @param {object} p - The parser instance.
 * @param {object} base - The base expression.
 * @param {number} start - Where the whole expression began.
 * @param {boolean} noCalls - Whether a call would belong to an enclosing `new`.
 * @returns {object} The expression, wrapped in a ChainExpression when any
 *   link was optional.
 */
export function parseSubscripts(p, base, start, noCalls) {
  let optionalChained = false;
  let current = base;
  for (;;) {
    if (p.isPunct('.')) {
      p.next();
      const node = p.startNodeAt(start);
      node.object = current;
      node.property = p.parseMemberProperty();
      node.computed = false;
      node.optional = false;
      current = p.finishNode(node, 'MemberExpression');
      continue;
    }
    if (p.isPunct('[')) {
      p.next();
      const node = p.startNodeAt(start);
      node.object = current;
      node.property = p.parseExpression();
      node.computed = true;
      node.optional = false;
      p.expectPunct(']');
      current = p.finishNode(node, 'MemberExpression');
      continue;
    }
    if (p.isPunct('(') && !noCalls) {
      const node = p.startNodeAt(start);
      node.callee = current;
      node.arguments = p.parseArguments();
      node.optional = false;
      current = p.finishNode(node, 'CallExpression');
      continue;
    }
    if (p.isPunct('?.')) {
      // `new a?.b()` is an error, whatever follows the `?.`: an optional
      // chain can never be the callee of a `new` expression.
      if (noCalls) p.raise('Optional chaining cannot appear in the callee of new expressions');
      optionalChained = true;
      p.next();
      if (p.isPunct('(')) {
        const node = p.startNodeAt(start);
        node.callee = current;
        node.arguments = p.parseArguments();
        node.optional = true;
        current = p.finishNode(node, 'CallExpression');
        continue;
      }
      const node = p.startNodeAt(start);
      node.object = current;
      if (p.eatPunct('[')) {
        node.property = p.parseExpression();
        node.computed = true;
        p.expectPunct(']');
      } else {
        node.property = p.parseMemberProperty();
        node.computed = false;
      }
      node.optional = true;
      current = p.finishNode(node, 'MemberExpression');
      continue;
    }
    if (p.tok.type === 'template') {
      if (optionalChained) p.raise('A tagged template cannot appear in an optional chain');
      const node = p.startNodeAt(start);
      node.tag = current;
      node.quasi = p.parseTemplate();
      current = p.finishNode(node, 'TaggedTemplateExpression');
      continue;
    }
    break;
  }

  if (optionalChained) {
    const node = p.startNodeAt(start);
    node.expression = current;
    return p.finishNode(node, 'ChainExpression');
  }
  return current;
}

/**
 * Parses the property after a `.`, which may be a private name.
 * @param {object} p - The parser instance.
 * @returns {object} An Identifier or PrivateIdentifier.
 */
export function parseMemberProperty(p) {
  if (p.tok.type === 'privatename') {
    const node = p.startNode();
    node.name = p.tok.value;
    p.usePrivateName(node.name, node.start);
    p.next();
    return p.finishNode(node, 'PrivateIdentifier');
  }
  return p.parseIdentifierName();
}

/**
 * Parses a call's argument list.
 * @param {object} p - The parser instance.
 * @returns {object[]} The arguments.
 */
export function parseArguments(p) {
  p.expectPunct('(');
  const args = [];
  let first = true;
  while (!p.eatPunct(')')) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct(')')) break;
    if (p.isPunct('...')) {
      const spread = p.startNode();
      p.next();
      spread.argument = p.parseMaybeAssign();
      args.push(p.finishNode(spread, 'SpreadElement'));
    } else {
      args.push(p.parseMaybeAssign());
    }
  }
  return args;
}
