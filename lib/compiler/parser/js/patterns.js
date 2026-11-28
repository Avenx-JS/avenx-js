/**
 * @file patterns.js
 * @description Destructuring patterns, function parameters, and defaults for the JavaScript parser.
 * @module lib/compiler/parser/js/patterns
 */

import { RESERVED_WORDS } from './tokenizer.js';

/**
 * Words that are reserved only in strict mode.
 * @type {Set<string>}
 */
export const STRICT_RESERVED = new Set([
  'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield',
]);

/**
 * Parses a parenthesised parameter list.
 * @param {object} p - The parser instance.
 * @returns {object[]} The parameter patterns.
 */
export function parseParams(p) {
  p.expectPunct('(');
  /** @type {object[]} */
  const params = [];
  let first = true;
  while (!p.eatPunct(')')) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct(')')) break;
    if (p.isPunct('...')) {
      const rest = p.startNode();
      p.next();
      rest.argument = p.parseBindingAtom();
      params.push(p.finishNode(rest, 'RestElement'));
      // A rest parameter must be last and cannot be followed by a comma.
      p.expectPunct(')');
      return params;
    }
    params.push(p.parseMaybeDefault());
  }
  return params;
}

/**
 * Declares a function's parameters into the scope it has just entered.
 *
 * Parameters are parsed before the scope exists, because a default value is
 * an ordinary expression in the enclosing context; the names are recorded
 * once the body's scope is open.
 * @param {object} p - The parser instance.
 * @param {object[]} params - The parameter patterns.
 */
export function declareParams(p, params) {
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
  if (p.strict || !simple) {
    const seen = new Set();
    for (const name of names) {
      if (seen.has(name)) p.raise(`Duplicate parameter name '${name}'`);
      seen.add(name);
    }
  }
  for (const name of names) p.declareName(name, 'param', p.tok.start);
}

/**
 * Validates and records a declared name.
 * @param {object} p - The parser instance.
 * @param {string} name - The name.
 * @param {string} kind - How it is declared; `'none'` only validates.
 * @param {number} pos - Where it is written.
 */
export function checkBindingName(p, name, kind, pos) {
  if (p.strict && STRICT_RESERVED.has(name)) {
    p.raise(`The keyword '${name}' is reserved`, pos);
  }
  if (p.strict && (name === 'eval' || name === 'arguments')) {
    p.raise(`Binding ${name} in strict mode`, pos);
  }
  if (name === 'let' && kind === 'lexical') {
    p.raise("'let' is disallowed as a lexically bound name", pos);
  }
  if (name === 'yield' && p.inGenerator) {
    p.raise("'yield' cannot be a binding name in a generator", pos);
  }
  if (name === 'await' && (p.inAsync || p.sourceType === 'module')) {
    p.raise("'await' cannot be a binding name here", pos);
  }
  if (kind !== 'none') p.declareName(name, kind, pos);
}

/**
 * Parses an identifier in a binding position.
 * @param {object} p - The parser instance.
 * @param {string} kind - How it is being declared.
 * @returns {object} An Identifier.
 */
export function parseBindingIdentifier(p, kind) {
  const pos = p.tok.start;
  const name = p.tok.type === 'name' ? p.tok.value : '';
  const node = p.parseIdentifier();
  p.checkBindingName(name, kind, pos);
  return node;
}

/**
 * Parses a binding target: an identifier or a destructuring pattern.
 * @param {object} p - The parser instance.
 * @param {string} [kind] - How the names in it are being declared.
 * @returns {object} The pattern.
 */
export function parseBindingAtom(p, kind = 'none') {
  if (p.isPunct('[')) {
    const node = p.startNode();
    p.next();
    node.elements = p.parseBindingList(']', kind);
    return p.finishNode(node, 'ArrayPattern');
  }
  if (p.isPunct('{')) {
    const node = p.startNode();
    p.next();
    node.properties = p.parseObjectPatternProperties(kind);
    return p.finishNode(node, 'ObjectPattern');
  }
  return p.parseBindingIdentifier(kind);
}

/**
 * Parses an array pattern's elements.
 * @param {object} p - The parser instance.
 * @param {string} close - The closing punctuator.
 * @param {string} [kind] - How the names in it are being declared.
 * @returns {Array<object|null>} The elements.
 */
export function parseBindingList(p, close, kind = 'none') {
  const elements = [];
  let first = true;
  while (!p.eatPunct(close)) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct(close)) break;
    if (p.isPunct(',')) {
      elements.push(null);
      continue;
    }
    if (p.isPunct('...')) {
      const rest = p.startNode();
      p.next();
      rest.argument = p.parseBindingAtom(kind);
      elements.push(p.finishNode(rest, 'RestElement'));
      p.expectPunct(close);
      return elements;
    }
    elements.push(p.parseMaybeDefault(kind));
  }
  return elements;
}

/**
 * Parses an object pattern's properties.
 * @param {object} p - The parser instance.
 * @param {string} [kind] - How the names in it are being declared.
 * @returns {object[]} The properties.
 */
export function parseObjectPatternProperties(p, kind = 'none') {
  const properties = [];
  let first = true;
  while (!p.eatPunct('}')) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct('}')) break;
    if (p.isPunct('...')) {
      const rest = p.startNode();
      p.next();
      rest.argument = p.parseBindingIdentifier(kind);
      properties.push(p.finishNode(rest, 'RestElement'));
      p.expectPunct('}');
      return properties;
    }
    const node = p.startNode();
    p.parsePropertyName(node);
    node.kind = 'init';
    node.method = false;
    if (p.eatPunct(':')) {
      node.shorthand = false;
      node.value = p.parseMaybeDefault(kind);
    } else {
      if (node.computed || node.key.type !== 'Identifier') p.unexpected();
      if (RESERVED_WORDS.has(node.key.name)) p.raise(`'${node.key.name}' cannot be a binding name`, node.key.start);
      node.shorthand = true;
      p.checkReference(node.key.name, node.key.start);
      p.checkBindingName(node.key.name, kind, node.key.start);
      if (p.isPunct('=')) {
        const assignment = p.startNodeAt(node.key.start);
        assignment.left = p.cloneIdentifier(node.key);
        p.next();
        assignment.right = p.parseMaybeAssign();
        node.value = p.finishNode(assignment, 'AssignmentPattern');
      } else {
        node.value = p.cloneIdentifier(node.key);
      }
    }
    properties.push(p.finishNode(node, 'Property'));
  }
  return properties;
}

/**
 * Parses a binding with an optional default value.
 * @param {object} p - The parser instance.
 * @param {string} [kind] - How the names in it are being declared.
 * @returns {object} The pattern.
 */
export function parseMaybeDefault(p, kind = 'none') {
  const start = p.tok.start;
  const left = p.parseBindingAtom(kind);
  if (!p.isPunct('=')) return left;
  const node = p.startNodeAt(start);
  p.next();
  node.left = left;
  node.right = p.parseMaybeAssign();
  return p.finishNode(node, 'AssignmentPattern');
}

/**
 * Re-reads an expression as an assignment target.
 *
 * `[a, b] = c` is parsed as an ArrayExpression and only then known to be a
 * pattern, which is the one place ECMAScript genuinely needs this. The
 * conversion is in place, so the node's range is unchanged.
 * @param {object} p - The parser instance.
 * @param {object} node - The parsed expression.
 * @param {boolean} top - Whether this is the outermost target.
 * @returns {object} The pattern.
 */
export function toAssignable(p, node, top = false) {
  switch (node.type) {
    case 'Identifier':
    case 'MemberExpression':
      if (node.type === 'MemberExpression' && node.optional) {
        p.raise('An optional member access is not a valid assignment target', node.start);
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
          if (i !== properties.length - 1) p.raise('A rest element must be last', property.start);
          property.type = 'RestElement';
          if (property.argument.type !== 'Identifier' && property.argument.type !== 'MemberExpression') {
            p.raise('An object rest target must be a simple reference', property.argument.start);
          }
          continue;
        }
        if (property.kind !== 'init' || property.method) {
          p.raise('A method is not a valid assignment target', property.start);
        }
        if (property.shorthandDefault) {
          const index = p.pendingShorthandDefaults.indexOf(property.shorthandDefault);
          if (index !== -1) p.pendingShorthandDefaults.splice(index, 1);
          delete property.shorthandDefault;
        }
        property.value = p.toAssignable(property.value);
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
          if (i !== elements.length - 1) p.raise('A rest element must be last', element.start);
          element.type = 'RestElement';
          element.argument = p.toAssignable(element.argument);
          continue;
        }
        elements[i] = p.toAssignable(element);
      }
      return node;
    }
    case 'AssignmentExpression': {
      if (node.operator !== '=') p.raise('Invalid assignment target', node.start);
      node.type = 'AssignmentPattern';
      delete node.operator;
      node.left = p.toAssignable(node.left);
      return node;
    }
    default:
      if (top) p.raise('Invalid assignment target', node.start);
      p.raise('Invalid destructuring target', node.start);
      return node;
  }
}
