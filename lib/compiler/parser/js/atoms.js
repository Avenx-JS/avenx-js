/**
 * @file atoms.js
 * @description Primary expressions, literals, templates, objects, and identifiers for the JavaScript parser.
 * @module lib/compiler/parser/js/atoms
 */

import { RESERVED_WORDS } from './tokenizer.js';
import { STRICT_RESERVED } from './patterns.js';

/**
 * Parses a primary expression.
 * @param {object} p - The parser instance.
 * @returns {object} The expression.
 */
export function parseExprAtom(p) {
  switch (p.tok.type) {
    case 'num':
    case 'bigint':
    case 'string':
      return p.parseLiteral();
    case 'regexp':
      return p.parseLiteral();
    case 'template':
      return p.parseTemplate();
    case 'privatename': {
      // `#field in obj` is the only place a private name stands alone.
      const node = p.startNode();
      node.name = p.tok.value;
      p.usePrivateName(node.name, node.start);
      p.next();
      if (!p.isName('in')) p.raise('A private name is only allowed in a member access or `in`', node.start);
      return p.finishNode(node, 'PrivateIdentifier');
    }
    default:
      break;
  }

  if (p.tok.type === 'punct') {
    switch (p.tok.value) {
      case '(': {
        return p.parseParenExpressionAtom();
      }
      case '[': {
        const node = p.startNode();
        p.next();
        node.elements = p.parseExpressionList(']', true);
        return p.finishNode(node, 'ArrayExpression');
      }
      case '{':
        return p.parseObject();
      case '/':
      case '/=': {
        p.tz.reScanAsRegExp();
        p.tok = p.tz.curr;
        return p.parseLiteral();
      }
      default:
        return p.unexpected();
    }
  }

  if (p.tok.type !== 'name') return p.unexpected();

  switch (p.tok.value) {
    case 'this': {
      const node = p.startNode();
      p.next();
      return p.finishNode(node, 'ThisExpression');
    }
    case 'super': {
      const node = p.startNode();
      if (!p.inMethod) p.raise("'super' is only allowed in a method");
      p.next();
      if (p.isPunct('(') && !p.inDerivedConstructor && !p.options.allowSuperOutsideMethod) {
        p.raise("'super' call is only allowed in a derived constructor", node.start);
      }
      if (!p.isPunct('(') && !p.isPunct('.') && !p.isPunct('[')) {
        p.raise("'super' must be called or accessed", node.start);
      }
      return p.finishNode(node, 'Super');
    }
    case 'null':
    case 'true':
    case 'false': {
      const node = p.startNode();
      node.value = p.tok.value === 'null' ? null : p.tok.value === 'true';
      node.raw = p.tok.value;
      p.next();
      return p.finishNode(node, 'Literal');
    }
    case 'function': {
      const node = p.startNode();
      p.next();
      const isGenerator = p.eatPunct('*');
      node.id = p.tok.type === 'name' && !RESERVED_WORDS.has(p.tok.value) ? p.parseIdentifier() : null;
      return p.parseFunctionRest(node, 'FunctionExpression', false, isGenerator);
    }
    case 'class':
      return p.parseClass(p.startNode(), false);
    case 'new':
      return p.parseNew();
    case 'import':
      return p.parseImportExpression();
    case 'async': {
      const after = p.peek();
      if (after.type === 'name' && after.value === 'function' && !after.nlBefore) {
        const node = p.startNode();
        p.next();
        p.next();
        const isGenerator = p.eatPunct('*');
        node.id = p.tok.type === 'name' && !RESERVED_WORDS.has(p.tok.value) ? p.parseIdentifier() : null;
        return p.parseFunctionRest(node, 'FunctionExpression', true, isGenerator);
      }
      return p.parseIdentifier();
    }
    default:
      if (RESERVED_WORDS.has(p.tok.value)) return p.unexpected();
      return p.parseIdentifier();
  }
}

/**
 * Parses a parenthesised expression.
 *
 * Parentheses are not kept as nodes, matching ESTree, but the fact that an
 * expression was parenthesised is remembered on it: `(a ?? b) || c` is legal
 * where `a ?? b || c` is not.
 * @param {object} p - The parser instance.
 * @returns {object} The inner expression.
 */
export function parseParenExpressionAtom(p) {
  p.next();
  if (p.isPunct(')')) p.raise('Expected an expression');
  const innerStart = p.tok.start;
  const expressions = [];
  let first = true;
  while (!p.isPunct(')')) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.isPunct('...')) p.raise('A rest element needs an arrow function');
    expressions.push(p.parseMaybeAssign());
  }
  const innerEnd = p.tz.lastEnd;
  p.expectPunct(')');
  if (expressions.length === 0) p.raise('Expected an expression', innerStart);

  let value;
  if (expressions.length > 1) {
    const node = p.startNodeAt(innerStart);
    node.expressions = expressions;
    value = p.finishNodeAt(node, 'SequenceExpression', innerEnd);
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
 * @param {object} p - The parser instance.
 * @param {string} close - The closing punctuator.
 * @param {boolean} allowHoles - Whether elisions produce null elements.
 * @returns {Array<object|null>} The elements.
 */
export function parseExpressionList(p, close, allowHoles) {
  const elements = [];
  let first = true;
  while (!p.eatPunct(close)) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct(close)) break;
    if (allowHoles && p.isPunct(',')) {
      elements.push(null);
      continue;
    }
    if (p.isPunct('...')) {
      const spread = p.startNode();
      p.next();
      spread.argument = p.parseMaybeAssign();
      elements.push(p.finishNode(spread, 'SpreadElement'));
      continue;
    }
    elements.push(p.parseMaybeAssign());
  }
  return elements;
}

/**
 * Parses an object literal.
 * @param {object} p - The parser instance.
 * @returns {object} An ObjectExpression.
 */
export function parseObject(p) {
  const node = p.startNode();
  p.expectPunct('{');
  node.properties = [];
  let first = true;
  while (!p.eatPunct('}')) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct('}')) break;
    node.properties.push(p.parseObjectMember());
  }
  return p.finishNode(node, 'ObjectExpression');
}

/**
 * Parses one object literal member.
 * @param {object} p - The parser instance.
 * @returns {object} A Property or SpreadElement.
 */
export function parseObjectMember(p) {
  if (p.isPunct('...')) {
    const spread = p.startNode();
    p.next();
    spread.argument = p.parseMaybeAssign();
    return p.finishNode(spread, 'SpreadElement');
  }

  const node = p.startNode();
  let isAsync = false;
  let isGenerator = false;

  if (p.isName('async')) {
    const after = p.peek();
    const stops = after.type === 'punct' && (after.value === ':' || after.value === '(' || after.value === ',' || after.value === '}' || after.value === '=');
    if (!stops && !after.nlBefore) {
      p.next();
      isAsync = true;
    }
  }
  if (p.isPunct('*')) {
    p.next();
    isGenerator = true;
  }
  if ((p.isName('get') || p.isName('set')) && !isAsync && !isGenerator) {
    const after = p.peek();
    const stops = after.type === 'punct' && (after.value === ':' || after.value === '(' || after.value === ',' || after.value === '}' || after.value === '=');
    if (!stops) {
      const kind = p.tok.value;
      p.next();
      p.parsePropertyName(node);
      node.kind = kind;
      node.method = false;
      node.shorthand = false;
      node.value = p.parseMethod(false, false, false, kind);
      return p.finishNode(node, 'Property');
    }
  }

  p.parsePropertyName(node);

  if (p.isPunct('(')) {
    node.kind = 'init';
    node.method = true;
    node.shorthand = false;
    node.value = p.parseMethod(isAsync, isGenerator, false);
    return p.finishNode(node, 'Property');
  }
  if (isAsync || isGenerator) p.unexpected();

  node.kind = 'init';
  node.method = false;

  if (p.eatPunct(':')) {
    node.shorthand = false;
    node.value = p.parseMaybeAssign();
    return p.finishNode(node, 'Property');
  }

  if (node.computed || node.key.type !== 'Identifier') p.unexpected();
  if (RESERVED_WORDS.has(node.key.name)) p.raise(`'${node.key.name}' cannot be a shorthand property`, node.key.start);
  p.checkReference(node.key.name, node.key.start);
  node.shorthand = true;
  if (p.isPunct('=')) {
    // `{ a = 1 }` is only legal as a destructuring pattern. It is parsed here
    // and rejected by toAssignable if the object never becomes one.
    const assignment = p.startNodeAt(node.key.start);
    assignment.operator = '=';
    assignment.left = p.cloneIdentifier(node.key);
    p.next();
    assignment.right = p.parseMaybeAssign();
    node.value = p.finishNode(assignment, 'AssignmentExpression');
    const pending = { start: node.key.start };
    p.pendingShorthandDefaults.push(pending);
    // Not enumerable, so the node's shape stays exactly ESTree's.
    Object.defineProperty(node, 'shorthandDefault', { value: pending, enumerable: false, configurable: true });
  } else {
    node.value = p.cloneIdentifier(node.key);
  }
  return p.finishNode(node, 'Property');
}

/**
 * Copies an identifier node, so a shorthand property's key and value are
 * distinct nodes with the same range, as acorn produces them.
 * @param {object} p - The parser instance.
 * @param {object} node - The identifier.
 * @returns {object} A copy.
 */
export function cloneIdentifier(p, node) {
  /** @type {any} */
  const copy = { type: 'Identifier', start: node.start, end: node.end, name: node.name };
  if (p.locations) copy.loc = { start: { ...node.loc.start }, end: { ...node.loc.end } };
  return copy;
}

/**
 * Parses `new X(…)`, `new X` and `new.target`.
 * @param {object} p - The parser instance.
 * @returns {object} A NewExpression or MetaProperty.
 */
export function parseNew(p) {
  const node = p.startNode();
  p.next();
  if (p.isPunct('.')) {
    p.next();
    const property = p.parseIdentifierName();
    if (property.name !== 'target') p.raise("The only valid meta property for new is 'new.target'", property.start);
    if (!p.inNewTargetScope) p.raise("'new.target' can only be used in functions and class static block", node.start);
    node.meta = p.metaIdentifier(node.start, 'new');
    node.property = property;
    return p.finishNode(node, 'MetaProperty');
  }
  const calleeStart = p.tok.start;
  node.callee = p.parseSubscripts(p.parseExprAtom(), calleeStart, true);
  node.arguments = p.isPunct('(') ? p.parseArguments() : [];
  return p.finishNode(node, 'NewExpression');
}

/**
 * Builds the identifier half of a meta property.
 * @param {object} p - The parser instance.
 * @param {number} start - Where the keyword begins.
 * @param {string} name - The keyword.
 * @returns {object} An Identifier.
 */
export function metaIdentifier(p, start, name) {
  /** @type {any} */
  const node = { type: 'Identifier', start, end: start + name.length, name };
  if (p.locations) {
    node.loc = { start: p.tz.locate(start), end: p.tz.locate(start + name.length) };
  }
  return node;
}

/**
 * Parses `import(…)` and `import.meta`.
 * @param {object} p - The parser instance.
 * @returns {object} An ImportExpression or MetaProperty.
 */
export function parseImportExpression(p) {
  const node = p.startNode();
  p.next();
  if (p.isPunct('.')) {
    p.next();
    const property = p.parseIdentifierName();
    if (property.name !== 'meta') p.raise("The only valid meta property for import is 'import.meta'", property.start);
    if (p.sourceType !== 'module' && !p.options.allowImportExpressionEverywhere) {
      p.raise("'import.meta' is only allowed in a module", node.start);
    }
    node.meta = p.metaIdentifier(node.start, 'import');
    node.property = property;
    return p.finishNode(node, 'MetaProperty');
  }
  if (!p.isPunct('(')) p.unexpected();
  p.next();
  node.source = p.parseMaybeAssign();
  node.options = p.eatPunct(',') && !p.isPunct(')') ? p.parseMaybeAssign() : null;
  p.eatPunct(',');
  p.expectPunct(')');
  return p.finishNode(node, 'ImportExpression');
}

/**
 * Parses a literal token into a Literal node.
 * @param {object} p - The parser instance.
 * @returns {object} A Literal.
 */
export function parseLiteral(p) {
  const node = p.startNode();
  const token = p.tok;
  node.value = token.type === 'bigint' ? bigIntValue(token.value) : token.value;
  node.raw = token.raw !== undefined ? token.raw : p.input.slice(token.start, token.end);
  // `0755` and `09` are legacy octal or leading-zero decimal literals, which
  // strict code forbids. The prefixed forms (`0x`, `0o`, `0b`) never match.
  if (token.type === 'num' && p.strict && /^0[0-9]/.test(node.raw)) {
    p.raise('Legacy octal literals are not allowed in strict mode', token.start);
  }
  if (token.type === 'regexp') {
    node.value = regExpValue(token.value);
    node.regex = { pattern: token.value.pattern, flags: token.value.flags };
  } else if (token.type === 'bigint') {
    // The written digits may be hexadecimal; the node carries the value.
    node.bigint = node.value === null ? token.value : String(node.value);
  }
  p.next();
  return p.finishNode(node, 'Literal');
}

/**
 * Builds a BigInt for a literal, when the host supports it.
 * @param {string} digits - The digits without the `n`.
 * @returns {bigint|null} The value, or null.
 */
export function bigIntValue(digits) {
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
export function regExpValue(regex) {
  try {
    return new RegExp(regex.pattern, regex.flags);
  } catch {
    return null;
  }
}

/**
 * Parses a template literal, including its substitutions.
 * @param {object} p - The parser instance.
 * @returns {object} A TemplateLiteral.
 */
export function parseTemplate(p) {
  const node = p.startNode();
  node.quasis = [];
  node.expressions = [];

  let chunk = p.tok.value;
  node.quasis.push(p.templateElement(chunk));
  while (!chunk.tail) {
    p.next();
    node.expressions.push(p.parseExpression());
    if (!p.isPunct('}')) p.raise("Expected '}' to close a template substitution");
    p.tz.reScanTemplateContinue();
    p.tok = p.tz.curr;
    chunk = p.tok.value;
    node.quasis.push(p.templateElement(chunk));
  }
  p.next();
  return p.finishNode(node, 'TemplateLiteral');
}

/**
 * Builds one TemplateElement.
 * @param {object} p - The parser instance.
 * @param {{cooked: (string|null), raw: string, tail: boolean, rawStart: number,
 *   rawEnd: number}} chunk - The lexed chunk.
 * @returns {object} A TemplateElement.
 */
export function templateElement(p, chunk) {
  /** @type {any} */
  const node = {
    type: 'TemplateElement',
    start: chunk.rawStart,
    end: chunk.rawEnd,
    value: { raw: chunk.raw, cooked: chunk.cooked },
    tail: chunk.tail,
  };
  if (p.locations) {
    node.loc = { start: p.tz.locate(chunk.rawStart), end: p.tz.locate(chunk.rawEnd) };
  }
  return node;
}

/**
 * Parses an identifier that must not be a reserved word.
 * @param {object} p - The parser instance.
 * @returns {object} An Identifier.
 */
export function parseIdentifier(p) {
  if (p.tok.type !== 'name') p.unexpected();
  if (RESERVED_WORDS.has(p.tok.value)) p.unexpected();
  p.checkReference(p.tok.value, p.tok.start);
  return p.parseIdentifierName();
}

/**
 * Refuses a word that cannot name a variable in the current mode.
 *
 * Strict code reserves nine further words, and a module is always strict, so
 * `let`, `static` and `yield` are references only in sloppy scripts. A
 * property name is not a reference and goes through
 * {@link parseIdentifierName}, which does not check: `obj.let` and
 * `{ let: 1 }` are fine everywhere.
 * @param {object} p - The parser instance.
 * @param {string} name - The word.
 * @param {number} pos - Where it is written.
 */
export function checkReference(p, name, pos) {
  if (p.strict && STRICT_RESERVED.has(name)) {
    p.raise(`The keyword '${name}' is reserved`, pos);
  }
  if (name === 'await' && (p.inAsync || p.sourceType === 'module')) {
    p.raise("'await' is reserved here", pos);
  }
  if (name === 'yield' && p.inGenerator) {
    p.raise("'yield' is reserved in a generator", pos);
  }
}

/**
 * Parses any word as an identifier, reserved or not. Used for property names.
 * @param {object} p - The parser instance.
 * @returns {object} An Identifier.
 */
export function parseIdentifierName(p) {
  if (p.tok.type !== 'name') p.unexpected();
  const node = p.startNode();
  node.name = p.tok.value;
  p.next();
  return p.finishNode(node, 'Identifier');
}
