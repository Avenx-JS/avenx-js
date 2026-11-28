/**
 * @file classes.js
 * @description Function and class declaration/body parsing for the JavaScript parser.
 * @module lib/compiler/parser/js/classes
 */

import { RESERVED_WORDS } from './tokenizer.js';
import { SCOPE_VAR } from './scope.js';

/**
 * Parses a function declaration.
 * @param {object} p - The parser instance.
 * @param {boolean} isAsync - Whether it is `async function`.
 * @returns {object} A FunctionDeclaration.
 */
export function parseFunctionStatement(p, isAsync) {
  const node = p.startNode();
  if (isAsync) p.next();
  p.expectName('function');
  const isGenerator = p.eatPunct('*');
  const namePos = p.tok.start;
  node.id = p.parseIdentifier();
  p.declareName(node.id.name, 'function', namePos);
  return p.parseFunctionRest(node, 'FunctionDeclaration', isAsync, isGenerator);
}

/**
 * Parses the parameters and body of a function.
 * @param {object} p - The parser instance.
 * @param {object} node - The started node.
 * @param {string} type - FunctionDeclaration or FunctionExpression.
 * @param {boolean} isAsync - Whether it is async.
 * @param {boolean} isGenerator - Whether it is a generator.
 * @returns {object} The finished node.
 */
export function parseFunctionRest(p, node, type, isAsync, isGenerator) {
  node.expression = false;
  node.generator = isGenerator;
  node.async = isAsync;
  node.params = p.parseParams();
  const outer = p.enterFunction(isAsync, isGenerator);
  p.declareParams(node.params);
  node.body = p.parseFunctionBody();
  p.exitFunction(outer);
  return p.finishNode(node, type);
}

/**
 * Enters a function scope.
 * @param {object} p - The parser instance.
 * @param {boolean} isAsync - Whether it is async.
 * @param {boolean} isGenerator - Whether it is a generator.
 * @returns {object} The state to restore.
 */
export function enterFunction(p, isAsync, isGenerator) {
  const outer = {
    inFunction: p.inFunction,
    inAsync: p.inAsync,
    inGenerator: p.inGenerator,
    inNewTargetScope: p.inNewTargetScope,
    labels: p.labels,
    breakDepth: p.breakDepth,
    continueDepth: p.continueDepth,
  };
  p.inFunction = true;
  p.inAsync = isAsync;
  p.inGenerator = isGenerator;
  p.inNewTargetScope = true;
  p.labels = [];
  p.breakDepth = 0;
  p.continueDepth = 0;
  p.enterScope(SCOPE_VAR);
  return outer;
}

/**
 * Leaves a function scope.
 * @param {object} p - The parser instance.
 * @param {object} outer - The state from {@link enterFunction}.
 */
export function exitFunction(p, outer) {
  p.exitScope();
  Object.assign(p, outer);
}

/**
 * Parses a function body, honouring a `'use strict'` directive in it.
 * @param {object} p - The parser instance.
 * @returns {object} A BlockStatement.
 */
export function parseFunctionBody(p) {
  const node = p.startNode();
  p.expectPunct('{');
  node.body = [];
  const outerStrict = p.strict;
  let prologue = true;
  while (!p.eatPunct('}')) {
    if (p.tok.type === 'eof') p.raise("Expected '}'");
    const statement = p.parseStatement();
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
  p.strict = outerStrict;
  return p.finishNode(node, 'BlockStatement');
}

/**
 * Parses a class declaration or expression.
 * @param {object} p - The parser instance.
 * @param {object} node - The started node.
 * @param {boolean|'nullable'} isStatement - Whether it is a declaration, and
 *   whether its name may be omitted.
 * @returns {object} The class node.
 */
export function parseClass(p, node, isStatement) {
  p.expectName('class');
  const outerStrict = p.strict;
  // A class body is always strict code.
  p.strict = true;

  if (p.tok.type === 'name' && !RESERVED_WORDS.has(p.tok.value) && !p.isName('extends')) {
    const namePos = p.tok.start;
    node.id = p.parseIdentifier();
    if (isStatement === true) {
      // The name is lexical in the enclosing scope, but the class body is
      // already strict, so the reserved-word check uses the outer strictness.
      p.strict = outerStrict;
      p.checkBindingName(node.id.name, 'lexical', namePos);
      p.strict = true;
    }
  } else if (isStatement === true) {
    p.raise('A class declaration needs a name');
  } else {
    node.id = null;
  }

  node.superClass = p.eatName('extends') ? p.parseExprSubscripts() : null;
  node.body = p.parseClassBody(node.superClass !== null);
  p.strict = outerStrict;
  return p.finishNode(node, isStatement ? 'ClassDeclaration' : 'ClassExpression');
}

/**
 * Parses a class body.
 * @param {object} p - The parser instance.
 * @param {boolean} derived - Whether the class extends another.
 * @returns {object} A ClassBody.
 */
export function parseClassBody(p, derived) {
  const node = p.startNode();
  p.expectPunct('{');
  p.privateNameStack.push({ declared: new Set(), used: [], roles: new Map() });
  node.body = [];
  while (!p.eatPunct('}')) {
    if (p.tok.type === 'eof') p.raise("Expected '}'");
    if (p.eatPunct(';')) continue;
    const element = p.parseClassElement(derived);
    if (element.key && element.key.type === 'PrivateIdentifier') {
      p.declarePrivateName(element);
    }
    node.body.push(element);
  }
  p.resolvePrivateNames();
  return p.finishNode(node, 'ClassBody');
}

/**
 * Records a use of a private name, to be resolved when the class body ends.
 * @param {object} p - The parser instance.
 * @param {string} name - The name without its `#`.
 * @param {number} pos - Where it is written.
 */
export function usePrivateName(p, name, pos) {
  const frame = p.privateNameStack[p.privateNameStack.length - 1];
  if (!frame) {
    p.raise(`Private field '#${name}' must be declared in an enclosing class`, pos);
    return;
  }
  frame.used.push({ name, pos });
}

/**
 * Declares the private name a class element defines.
 *
 * A name may appear twice only as a getter and its setter, which is the one
 * case where two elements describe one field.
 * @param {object} p - The parser instance.
 * @param {object} element - The parsed class element.
 */
export function declarePrivateName(p, element) {
  const frame = p.privateNameStack[p.privateNameStack.length - 1];
  const name = element.key.name;
  const role = element.kind === 'get' || element.kind === 'set' ? element.kind : 'field';
  const previous = frame.roles ? frame.roles.get(name) : undefined;
  if (!frame.roles) frame.roles = new Map();
  const pairs = previous !== undefined && previous !== role && previous !== 'field' && role !== 'field';
  if (previous !== undefined && !pairs) {
    p.raise(`Identifier '#${name}' has already been declared`, element.key.start);
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
 * @param {object} p - The parser instance.
 */
export function resolvePrivateNames(p) {
  const frame = p.privateNameStack.pop();
  const outer = p.privateNameStack[p.privateNameStack.length - 1];
  for (const use of frame.used) {
    if (frame.declared.has(use.name)) continue;
    if (outer) outer.used.push(use);
    else p.raise(`Private field '#${use.name}' must be declared in an enclosing class`, use.pos);
  }
}

/**
 * Parses one class element: a method, a field or a static block.
 * @param {object} p - The parser instance.
 * @param {boolean} derived - Whether the class extends another.
 * @returns {object} The element node.
 */
export function parseClassElement(p, derived) {
  const node = p.startNode();
  node.static = false;

  if (p.isName('static')) {
    const after = p.peek();
    // `static` is a modifier unless what follows shows it is the member's
    // own name: `static() {}`, `static = 1`, `static;` or `static}`.
    const isModifier = !(
      after.type === 'punct' &&
      (after.value === '(' || after.value === '=' || after.value === ';' || after.value === '}')
    );
    if (after.type === 'punct' && after.value === '{') {
      // A static initialisation block.
      p.next();
      node.body = [];
      p.expectPunct('{');
      const outer = p.enterFunction(false, false);
      p.inFunction = false;
      while (!p.eatPunct('}')) {
        if (p.tok.type === 'eof') p.raise("Expected '}'");
        node.body.push(p.parseStatement());
      }
      p.exitFunction(outer);
      delete node.static;
      return p.finishNode(node, 'StaticBlock');
    }
    if (isModifier) {
      p.next();
      node.static = true;
    }
  }

  let isAsync = false;
  let isGenerator = false;
  let kind = 'method';

  if (p.isName('async')) {
    const after = p.peek();
    const stops = after.type === 'punct' && (after.value === '(' || after.value === '=' || after.value === ';' || after.value === '}');
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
    const stops = after.type === 'punct' && (after.value === '(' || after.value === '=' || after.value === ';' || after.value === '}');
    if (!stops) {
      kind = p.tok.value;
      p.next();
    }
  }

  p.parsePropertyName(node);

  if (p.isPunct('(')) {
    if (kind === 'method' && !node.computed && node.key.type === 'Identifier' && node.key.name === 'constructor') {
      kind = 'constructor';
      if (isAsync || isGenerator) p.raise('A constructor may not be async or a generator', node.key.start);
    }
    node.kind = kind;
    node.value = p.parseMethod(isAsync, isGenerator, kind === 'constructor' && derived, kind);
    return p.finishNode(node, 'MethodDefinition');
  }

  if (kind !== 'method' || isAsync || isGenerator) p.unexpected();

  if (p.eatPunct('=')) {
    const outer = p.enterFunction(false, false);
    p.inFunction = false;
    p.inMethod = true;
    node.value = p.parseMaybeAssign();
    p.exitFunction(outer);
  } else {
    node.value = null;
  }
  p.semicolon();
  return p.finishNode(node, 'PropertyDefinition');
}

/**
 * Parses a method's parameters and body.
 * @param {object} p - The parser instance.
 * @param {boolean} isAsync - Whether it is async.
 * @param {boolean} isGenerator - Whether it is a generator.
 * @param {boolean} derivedConstructor - Whether `super()` is legal in it.
 * @param {string} [kind] - `get` or `set` when it is an accessor, so its
 *   parameter count can be checked.
 * @returns {object} A FunctionExpression.
 */
export function parseMethod(p, isAsync, isGenerator, derivedConstructor, kind = 'method') {
  const node = p.startNode();
  node.id = null;
  node.expression = false;
  node.generator = isGenerator;
  node.async = isAsync;
  node.params = p.parseParams();
  if (kind === 'get' && node.params.length !== 0) {
    p.raise('A getter takes no parameters', node.start);
  }
  if (kind === 'set') {
    if (node.params.length !== 1) p.raise('A setter takes exactly one parameter', node.start);
    if (node.params[0].type === 'RestElement') p.raise('A setter cannot take a rest parameter', node.params[0].start);
  }
  const outer = p.enterFunction(isAsync, isGenerator);
  p.declareParams(node.params);
  const outerMethod = p.inMethod;
  const outerDerived = p.inDerivedConstructor;
  p.inMethod = true;
  p.inDerivedConstructor = !!derivedConstructor;
  node.body = p.parseFunctionBody();
  p.inMethod = outerMethod;
  p.inDerivedConstructor = outerDerived;
  p.exitFunction(outer);
  return p.finishNode(node, 'FunctionExpression');
}

/**
 * Reads a property name into `node.key` and `node.computed`.
 * @param {object} p - The parser instance.
 * @param {object} node - The node to fill.
 */
export function parsePropertyName(p, node) {
  if (p.eatPunct('[')) {
    node.computed = true;
    node.key = p.parseMaybeAssign();
    p.expectPunct(']');
    return;
  }
  node.computed = false;
  if (p.tok.type === 'num' || p.tok.type === 'string' || p.tok.type === 'bigint') {
    node.key = p.parseLiteral();
    return;
  }
  if (p.tok.type === 'privatename') {
    const key = p.startNode();
    key.name = p.tok.value;
    p.next();
    node.key = p.finishNode(key, 'PrivateIdentifier');
    return;
  }
  node.key = p.parseIdentifierName();
}
