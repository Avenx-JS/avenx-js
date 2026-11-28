/**
 * @file modules.js
 * @description Module `import` and `export` declaration parsing for the JavaScript parser.
 * @module lib/compiler/parser/js/modules
 */

import { RESERVED_WORDS } from './tokenizer.js';

/**
 * Parses an `import` declaration.
 * @param {object} p - The parser instance.
 * @returns {object} An ImportDeclaration.
 */
export function parseImport(p) {
  const node = p.startNode();
  p.next();
  node.specifiers = [];
  if (p.tok.type === 'string') {
    node.source = p.parseLiteral();
  } else {
    node.specifiers = p.parseImportSpecifiers();
    p.expectName('from');
    if (p.tok.type !== 'string') p.raise('Expected a module specifier');
    node.source = p.parseLiteral();
  }
  node.attributes = p.parseImportAttributes();
  p.semicolon();
  return p.finishNode(node, 'ImportDeclaration');
}

/**
 * Parses the specifier list of an `import`.
 * @param {object} p - The parser instance.
 * @returns {object[]} The specifiers.
 */
export function parseImportSpecifiers(p) {
  const specifiers = [];
  if (p.tok.type === 'name' && !RESERVED_WORDS.has(p.tok.value)) {
    const node = p.startNode();
    node.local = p.parseIdentifier();
    specifiers.push(p.finishNode(node, 'ImportDefaultSpecifier'));
    if (!p.eatPunct(',')) return specifiers;
  }
  if (p.isPunct('*')) {
    const node = p.startNode();
    p.next();
    p.expectName('as');
    node.local = p.parseIdentifier();
    specifiers.push(p.finishNode(node, 'ImportNamespaceSpecifier'));
    return specifiers;
  }
  p.expectPunct('{');
  let first = true;
  while (!p.eatPunct('}')) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct('}')) break;
    const node = p.startNode();
    node.imported = p.parseModuleExportName();
    if (p.eatName('as')) {
      node.local = p.parseIdentifier();
    } else {
      if (node.imported.type !== 'Identifier') p.raise('A string import name needs `as`', node.start);
      node.local = node.imported;
    }
    specifiers.push(p.finishNode(node, 'ImportSpecifier'));
  }
  return specifiers;
}

/**
 * Parses an export name, which may be a string since ES2022.
 * @param {object} p - The parser instance.
 * @returns {object} An Identifier or a string Literal.
 */
export function parseModuleExportName(p) {
  if (p.tok.type === 'string') return p.parseLiteral();
  return p.parseIdentifierName();
}

/**
 * Parses a `with { … }` import attributes clause.
 * @param {object} p - The parser instance.
 * @returns {object[]} The attributes.
 */
export function parseImportAttributes(p) {
  if (!p.isName('with') || p.tok.nlBefore) return [];
  p.next();
  p.expectPunct('{');
  const attributes = [];
  let first = true;
  while (!p.eatPunct('}')) {
    if (first) first = false;
    else p.expectPunct(',');
    if (p.eatPunct('}')) break;
    const node = p.startNode();
    node.key = p.tok.type === 'string' ? p.parseLiteral() : p.parseIdentifierName();
    p.expectPunct(':');
    if (p.tok.type !== 'string') p.raise('An import attribute value must be a string');
    node.value = p.parseLiteral();
    attributes.push(p.finishNode(node, 'ImportAttribute'));
  }
  return attributes;
}

/**
 * Parses an `export` declaration in all its forms.
 * @param {object} p - The parser instance.
 * @returns {object} The export node.
 */
export function parseExport(p) {
  const node = p.startNode();
  p.next();

  if (p.eatPunct('*')) {
    node.exported = p.eatName('as') ? p.parseModuleExportName() : null;
    p.expectName('from');
    if (p.tok.type !== 'string') p.raise('Expected a module specifier');
    node.source = p.parseLiteral();
    node.attributes = p.parseImportAttributes();
    p.semicolon();
    return p.finishNode(node, 'ExportAllDeclaration');
  }

  if (p.eatName('default')) {
    if (p.isName('function') || (p.isName('async') && p.peek().value === 'function')) {
      // The declaration node starts at `async`, not at `function`.
      const inner = p.startNode();
      const isAsync = p.eatName('async');
      p.expectName('function');
      const isGenerator = p.eatPunct('*');
      inner.id = p.tok.type === 'name' && !RESERVED_WORDS.has(p.tok.value) ? p.parseIdentifier() : null;
      node.declaration = p.parseFunctionRest(inner, 'FunctionDeclaration', isAsync, isGenerator);
    } else if (p.isName('class')) {
      node.declaration = p.parseClass(p.startNode(), 'nullable');
    } else {
      node.declaration = p.parseMaybeAssign();
      p.semicolon();
    }
    return p.finishNode(node, 'ExportDefaultDeclaration');
  }

  if (p.isPunct('{')) {
    node.declaration = null;
    node.specifiers = [];
    p.next();
    let first = true;
    while (!p.eatPunct('}')) {
      if (first) first = false;
      else p.expectPunct(',');
      if (p.eatPunct('}')) break;
      const specifier = p.startNode();
      specifier.local = p.parseModuleExportName();
      specifier.exported = p.eatName('as') ? p.parseModuleExportName() : specifier.local;
      node.specifiers.push(p.finishNode(specifier, 'ExportSpecifier'));
    }
    if (p.eatName('from')) {
      if (p.tok.type !== 'string') p.raise('Expected a module specifier');
      node.source = p.parseLiteral();
      node.attributes = p.parseImportAttributes();
    } else {
      node.source = null;
      node.attributes = [];
      for (const specifier of node.specifiers) {
        if (specifier.local.type !== 'Identifier') {
          p.raise('A string export name needs a module specifier', specifier.start);
        }
        // Without `from`, the local half names a binding in this module, so
        // it has to be a usable identifier: `export { default as x }` is only
        // meaningful when re-exporting.
        if (RESERVED_WORDS.has(specifier.local.name)) {
          p.raise(`Unexpected keyword '${specifier.local.name}'`, specifier.local.start);
        }
        p.checkReference(specifier.local.name, specifier.local.start);
      }
    }
    p.semicolon();
    return p.finishNode(node, 'ExportNamedDeclaration');
  }

  node.declaration = p.parseExportedDeclaration();
  node.specifiers = [];
  node.source = null;
  node.attributes = [];
  return p.finishNode(node, 'ExportNamedDeclaration');
}

/**
 * Parses the declaration after `export`.
 * @param {object} p - The parser instance.
 * @returns {object} The declaration.
 */
export function parseExportedDeclaration(p) {
  if (p.isName('var') || p.isName('const') || (p.isName('let') && p.isLetDeclaration())) {
    return p.parseVarStatement(p.tok.value);
  }
  if (p.isName('function')) return p.parseFunctionStatement(false);
  if (p.isName('async') && p.peek().value === 'function') return p.parseFunctionStatement(true);
  if (p.isName('class')) return p.parseClass(p.startNode(), true);
  return p.unexpected();
}
