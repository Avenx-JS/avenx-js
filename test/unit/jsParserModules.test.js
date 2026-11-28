/**
 * Direct unit tests for the extracted JavaScript parser modules under
 * `lib/compiler/parser/js/`. Each module is imported and exercised directly
 * against `Parser` instances.
 */
import assert from 'assert';
import { Parser } from '../../lib/compiler/parser/js/parser.js';
import {
  SCOPE_VAR,
  SCOPE_BLOCK,
  SCOPE_SIMPLE_CATCH,
  BindingScope,
  enterScope,
  exitScope,
  currentScope,
  addBinding,
  declareName,
} from '../../lib/compiler/parser/js/scope.js';
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
} from '../../lib/compiler/parser/js/tokens.js';
import {
  startNode,
  startNodeAt,
  finishNode,
  finishNodeAt,
  saveState,
  restoreState,
} from '../../lib/compiler/parser/js/nodes.js';
import {
  parseTopLevel,
  flushShorthandDefaults,
  isDirective,
  parseStatement,
  isLetDeclaration,
  parseBlock,
  parseVarStatement,
  parseIf,
  parseFor,
  parseSwitch,
  parseTry,
  parseLabeledStatement,
} from '../../lib/compiler/parser/js/statements.js';
import {
  parseImport,
  parseImportSpecifiers,
  parseModuleExportName,
  parseImportAttributes,
  parseExport,
} from '../../lib/compiler/parser/js/modules.js';
import {
  parseFunctionStatement,
  enterFunction,
  exitFunction,
  parseClass,
  usePrivateName,
  declarePrivateName,
  resolvePrivateNames,
  parsePropertyName,
} from '../../lib/compiler/parser/js/classes.js';
import {
  BINARY_PRECEDENCE,
  ASSIGN_OPERATORS,
  UNARY_OPERATORS,
  parseExpression,
  parseMaybeAssign,
  checkSimpleTarget,
  tryParseArrow,
  parseYield,
  currentBinaryOperator,
  parseMaybeUnary,
  parseSubscripts,
  parseArguments,
} from '../../lib/compiler/parser/js/expressions.js';
import {
  parseExprAtom,
  parseParenExpressionAtom,
  parseObject,
  cloneIdentifier,
  parseNew,
  metaIdentifier,
  parseImportExpression,
  parseLiteral,
  bigIntValue,
  regExpValue,
  parseTemplate,
  parseIdentifier,
  checkReference,
  parseIdentifierName,
} from '../../lib/compiler/parser/js/atoms.js';
import {
  STRICT_RESERVED,
  parseParams,
  declareParams,
  checkBindingName,
  parseBindingAtom,
  parseMaybeDefault,
  toAssignable,
} from '../../lib/compiler/parser/js/patterns.js';

console.log('🧪 Testing extracted JS parser modules directly...');

// ---------------------------------------------------------------------- scope
{
  const p = new Parser('');
  enterScope(p, SCOPE_VAR);
  assert.ok(currentScope(p) instanceof BindingScope);
  declareName(p, 'a', 'lexical', 0);
  assert.throws(() => declareName(p, 'a', 'lexical', 6), /already been declared/);

  enterScope(p, SCOPE_BLOCK);
  declareName(p, 'v', 'var', 10);
  assert.ok(p.scopeStack[0].var.has('v'));
  exitScope(p);

  enterScope(p, SCOPE_BLOCK | SCOPE_SIMPLE_CATCH);
  declareName(p, 'err', 'simple-catch', 20);
  declareName(p, 'err', 'var', 25);
  exitScope(p);

  addBinding(p, currentScope(p).lexical, 'b');
  assert.ok(currentScope(p).lexical.has('b'));
  exitScope(p);
  assert.strictEqual(p.scopeStack.length, 0);
}

// --------------------------------------------------------------------- tokens
{
  const p = new Parser('let x = 1;\ny');
  assert.strictEqual(isName(p, 'let'), true);
  assert.strictEqual(peek(p).value, 'x');
  assert.strictEqual(eatName(p, 'let'), true);
  expectName(p, 'x');
  assert.strictEqual(isPunct(p, '='), true);
  assert.strictEqual(eatPunct(p, '='), true);
  next(p); // consumes '1' -> now at ';'
  semicolon(p);
  assert.strictEqual(isName(p, 'y'), true);
  assert.strictEqual(canInsertSemicolon(p), true);
  assert.throws(() => expectPunct(p, ';'), /Expected ';'/);
  assert.throws(() => raise(p, 'Boom', 0), /Boom/);
  assert.throws(() => unexpected(p), /Unexpected token/);
}

// ---------------------------------------------------------------------- nodes
{
  const p = new Parser('foo = 1', { locations: true });
  enterScope(p, SCOPE_VAR);
  const state = saveState(p);
  declareName(p, 'temp', 'lexical', 0);
  p.pendingShorthandDefaults.push({ start: 0 });

  const node = startNode(p);
  next(p);
  const finished = finishNode(p, node, 'Identifier');
  assert.strictEqual(finished.type, 'Identifier');
  assert.strictEqual(finished.start, 0);
  assert.strictEqual(finished.end, 3);
  assert.strictEqual(finished.loc.start.line, 1);

  const manual = startNodeAt(p, 0);
  finishNodeAt(p, manual, 'Test', 3);
  assert.strictEqual(manual.end, 3);

  restoreState(p, state);
  assert.strictEqual(p.tok.value, 'foo');
  assert.strictEqual(currentScope(p).lexical.has('temp'), false);
  assert.strictEqual(p.pendingShorthandDefaults.length, 0);
}

// ----------------------------------------------------------------- statements
{
  const p = new Parser('"use strict"; if (letFlag) { let a = 1; }');
  const prog = parseTopLevel(p);
  assert.strictEqual(prog.type, 'Program');
  assert.strictEqual(isDirective(prog.body[0]), true);
  assert.strictEqual(prog.body[0].directive, 'use strict');
  assert.strictEqual(prog.body[1].type, 'IfStatement');

  assert.strictEqual(isLetDeclaration(new Parser('let x = 1')), true);
  assert.strictEqual(isLetDeclaration(new Parser('let.x')), false);

  const pBlock = new Parser('{ const k = 1; }');
  enterScope(pBlock, SCOPE_VAR);
  assert.strictEqual(parseBlock(pBlock).type, 'BlockStatement');

  const pVar = new Parser('var x = 1;');
  enterScope(pVar, SCOPE_VAR);
  assert.strictEqual(parseVarStatement(pVar, 'var').type, 'VariableDeclaration');

  const pIf = new Parser('if (a) b; else c;');
  assert.strictEqual(parseIf(pIf).type, 'IfStatement');

  const pFor = new Parser('for (let i = 0; i < 1; i++) {}');
  assert.strictEqual(parseFor(pFor).type, 'ForStatement');

  const pSwitch = new Parser('switch (x) { case 1: break; default: break; }');
  assert.strictEqual(parseSwitch(pSwitch).type, 'SwitchStatement');

  const pTry = new Parser('try { a(); } catch (e) { b(); } finally { c(); }');
  assert.strictEqual(parseTry(pTry).type, 'TryStatement');

  const pLabel = new Parser('outer: while (true) break outer;');
  assert.strictEqual(parseLabeledStatement(pLabel).type, 'LabeledStatement');

  const pStmt = new Parser('debugger;');
  assert.strictEqual(parseStatement(pStmt).type, 'DebuggerStatement');

  const pBad = new Parser('({ a = 1 });');
  assert.throws(() => parseTopLevel(pBad), /shorthand property default/);
  const pFlush = new Parser('');
  pFlush.pendingShorthandDefaults.push({ start: 2 });
  assert.throws(() => flushShorthandDefaults(pFlush), /shorthand property default/);
}

// -------------------------------------------------------------------- modules
{
  const pImp = new Parser("import def, { a as b } from './x.js' with { type: 'json' };", { sourceType: 'module' });
  const imp = parseImport(pImp);
  assert.strictEqual(imp.type, 'ImportDeclaration');
  assert.strictEqual(imp.specifiers.length, 2);
  assert.strictEqual(imp.attributes.length, 1);

  const pSpec = new Parser('* as ns', { sourceType: 'module' });
  assert.strictEqual(parseImportSpecifiers(pSpec)[0].type, 'ImportNamespaceSpecifier');

  assert.strictEqual(parseModuleExportName(new Parser('"str"')).type, 'Literal');
  assert.strictEqual(parseImportAttributes(new Parser('with { type: "json" }')).length, 1);

  const pExp = new Parser('export default function () {}', { sourceType: 'module' });
  assert.strictEqual(parseExport(pExp).type, 'ExportDefaultDeclaration');
}

// -------------------------------------------------------------------- classes
{
  const pFn = new Parser('async function* gen(a) { return a; }');
  enterScope(pFn, SCOPE_VAR);
  const fnNode = parseFunctionStatement(pFn, true);
  assert.strictEqual(fnNode.type, 'FunctionDeclaration');
  assert.strictEqual(fnNode.async, true);
  assert.strictEqual(fnNode.generator, true);

  const pCls = new Parser('class A extends B { #x = 1; get y() { return this.#x; } }');
  enterScope(pCls, SCOPE_VAR);
  const clsNode = parseClass(pCls, startNode(pCls), true);
  assert.strictEqual(clsNode.type, 'ClassDeclaration');
  assert.strictEqual(clsNode.body.body.length, 2);

  const pPriv = new Parser('');
  pPriv.privateNameStack.push({ declared: new Set(), used: [], roles: new Map() });
  declarePrivateName(pPriv, { kind: 'method', key: { name: 'a', start: 0 } });
  usePrivateName(pPriv, 'a', 5);
  resolvePrivateNames(pPriv);
  assert.strictEqual(pPriv.privateNameStack.length, 0);

  const pState = new Parser('');
  const outer = enterFunction(pState, true, false);
  assert.strictEqual(pState.inAsync, true);
  exitFunction(pState, outer);
  assert.strictEqual(pState.inAsync, false);

  const propTarget = {};
  parsePropertyName(new Parser('[k]'), propTarget);
  assert.strictEqual(propTarget.computed, true);
}

// ---------------------------------------------------------------- expressions
{
  assert.strictEqual(BINARY_PRECEDENCE['**'], 12);
  assert.ok(ASSIGN_OPERATORS.has('??='));
  assert.ok(UNARY_OPERATORS.has('!'));

  assert.strictEqual(parseExpression(new Parser('a, b')).type, 'SequenceExpression');
  assert.strictEqual(parseMaybeAssign(new Parser('a = 1')).type, 'AssignmentExpression');
  assert.strictEqual(checkSimpleTarget(new Parser(''), { type: 'Identifier', start: 0 }).type, 'Identifier');
  assert.strictEqual(tryParseArrow(new Parser('(x) => x')).type, 'ArrowFunctionExpression');

  const pYield = new Parser('yield* xs');
  pYield.inGenerator = true;
  assert.strictEqual(parseYield(pYield, false).delegate, true);

  assert.strictEqual(currentBinaryOperator(new Parser('in'), false).operator, 'in');
  assert.strictEqual(currentBinaryOperator(new Parser('in'), true), null);
  assert.strictEqual(parseMaybeUnary(new Parser('!x')).type, 'UnaryExpression');

  const pSub = new Parser('.a?.b(1)');
  const base = { type: 'Identifier', start: 0, end: 1, name: 'o' };
  assert.strictEqual(parseSubscripts(pSub, base, 0, false).type, 'ChainExpression');
  assert.strictEqual(parseArguments(new Parser('(1, ...xs)')).length, 2);
}

// ---------------------------------------------------------------------- atoms
{
  assert.strictEqual(parseExprAtom(new Parser('[1, , 2]')).type, 'ArrayExpression');
  assert.strictEqual(parseParenExpressionAtom(new Parser('(a)')).parenthesised, true);
  assert.strictEqual(parseObject(new Parser('{ a, ...b }')).properties.length, 2);
  assert.strictEqual(cloneIdentifier(new Parser('', { locations: false }), { start: 0, end: 1, name: 'x' }).name, 'x');
  assert.strictEqual(parseNew(new Parser('new Foo(1)')).type, 'NewExpression');
  assert.strictEqual(metaIdentifier(new Parser(''), 0, 'new').name, 'new');
  assert.strictEqual(parseImportExpression(new Parser("import('./a.js')")).type, 'ImportExpression');
  assert.strictEqual(parseLiteral(new Parser('42n')).bigint, '42');
  assert.strictEqual(bigIntValue('10'), 10n);
  assert.ok(regExpValue({ pattern: 'a', flags: 'g' }) instanceof RegExp);
  assert.strictEqual(parseTemplate(new Parser('`a${1}b`')).expressions.length, 1);
  assert.strictEqual(parseIdentifier(new Parser('foo')).name, 'foo');
  assert.strictEqual(parseIdentifierName(new Parser('class')).name, 'class');
  assert.throws(() => checkReference(new Parser('', { strict: true }), 'implements', 0), /reserved/);
}

// ------------------------------------------------------------------- patterns
{
  assert.ok(STRICT_RESERVED.has('yield'));
  const pParams = new Parser('(a, ...b)');
  const params = parseParams(pParams);
  assert.strictEqual(params.length, 2);

  const pDecl = new Parser('');
  enterScope(pDecl, SCOPE_VAR);
  declareParams(pDecl, params);
  assert.ok(currentScope(pDecl).var.has('a'));
  assert.ok(currentScope(pDecl).var.has('b'));

  assert.throws(() => checkBindingName(new Parser('', { strict: true }), 'eval', 'lexical', 0), /strict mode/);
  assert.strictEqual(parseBindingAtom(new Parser('{ a = 1 }')).type, 'ObjectPattern');
  assert.strictEqual(parseMaybeDefault(new Parser('x = 2')).type, 'AssignmentPattern');

  const pAssign = new Parser('');
  const arr = { type: 'ArrayExpression', start: 0, end: 3, elements: [{ type: 'Identifier', start: 1, end: 2, name: 'a' }] };
  assert.strictEqual(toAssignable(pAssign, arr, true).type, 'ArrayPattern');
}

console.log('✅ All extracted JS parser module unit tests passed');
