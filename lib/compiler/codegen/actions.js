/**
 * @file actions.js
 * @description Compiles an `<action>` or `<resource>` body into a real function.
 *
 * ## What this replaces
 *
 * An action body is arbitrary JavaScript, so it could not take the expression
 * generator's path — that implements the expression language templates use, and
 * an action legitimately contains `if`, `for`, `try`, `const`, `await` and
 * everything else. Anything with real statement syntax therefore fell through
 * to:
 *
 * ```js
 * new Function(`with(this) { ${source} }`)
 * ```
 *
 * Two things followed from that line. The application needed `'unsafe-eval'`,
 * which is what made "Avenx runs under a strict CSP" true of templates and
 * false of most non-trivial actions. And the body ran against `AvenxSandbox`,
 * the source-text sandbox the expression evaluator was written to replace.
 *
 * ## What happens instead
 *
 * The body is parsed at build time and the only thing rewritten is how *free
 * identifiers* resolve. Everything else — control flow, declarations,
 * destructuring, template literals, regular expressions, `await` — is copied
 * through verbatim, because the engine that will run it understands it
 * perfectly well and this compiler does not need to.
 *
 * ```text
 * if (!text) { return; }              if (!text) { return; }
 * items.push({ label: text });   ->   axGet($s,"items").push({ label: axGet($s,"text") });
 * text = '';                          $s.text = '';
 * ```
 *
 * A read becomes `axGet`, which resolves scope-first and routes an allowed
 * global through the tracer's substitution point, so `Date.now()` in an action
 * is still recorded and replayed. A write becomes a plain property assignment
 * on the scope, which is exactly what the interpreter's `writeIdentifier` did
 * and what routes the value into reactive state.
 *
 * ## What this changes about security, precisely
 *
 * Nothing gets weaker, and one thing gets stronger.
 *
 * Action bodies never had the expression evaluator's guarantees: they went to
 * `new Function` with a source-text sandbox around them, and a source-text
 * check for `constructor` falls to string concatenation. That is unchanged
 * here — a body's member accesses are the developer's own JavaScript, as they
 * always were.
 *
 * What is new is that naming a restricted global (`window`, `fetch`,
 * `localStorage`) or writing a forbidden static key (`__proto__`,
 * `constructor`, `prototype`) is refused *at build time*, with the file and the
 * offending name, rather than at the moment that branch happens to run. And
 * there is no `eval`, no `new Function` and no `with` on this path at all.
 *
 * ## Why a real parser, and why only at build time
 *
 * Everything else in this compiler reads source with a purpose-built scanner,
 * and for template expressions that is right: the language is small, closed and
 * defined by Avenx. An action body is not — it is whatever JavaScript the
 * developer wrote, including every feature the language gains next year. A
 * hand-written parser would have permanent gaps, and each gap is either a
 * silent miscompile or a body pushed back onto `new Function`, which is the
 * thing being removed.
 *
 * So this uses `acorn`: MIT, no dependencies of its own, and the parser most of
 * the ecosystem's tooling already trusts. It is a dependency of the *compiler*.
 * Nothing under `lib/core` imports it, so the browser runtime keeps its zero
 * dependencies, which was always the property worth protecting.
 * @module lib/compiler/codegen/actions
 */

import { parse } from 'acorn';
import { RESTRICTED_GLOBALS, FORBIDDEN_KEYS } from '../../core/expression/ops.js';
import { ExpressionCodegenError, RUNTIME_BINDINGS } from './expression.js';

/**
 * Node types that introduce a function scope.
 * @type {Set<string>}
 */
const FUNCTION_NODES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * Node types that introduce a block scope.
 * @type {Set<string>}
 */
const BLOCK_NODES = new Set([
  'BlockStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'SwitchStatement',
  'CatchClause',
]);

/**
 * A lexical scope during analysis.
 */
class Scope {
  /**
   * @param {Scope|null} parent - The enclosing scope.
   * @param {boolean} isFunction - Whether this is a function scope.
   */
  constructor(parent, isFunction) {
    this.parent = parent;
    this.isFunction = isFunction;
    /** @type {Set<string>} */
    this.names = new Set();
  }

  /**
   * @param {string} name - The name to test.
   * @returns {boolean} Whether this scope or any enclosing one declares it.
   */
  has(name) {
    let scope = this;
    while (scope) {
      if (scope.names.has(name)) return true;
      scope = scope.parent;
    }
    return false;
  }
}

/**
 * Collects the names a binding pattern declares.
 * @param {object} node - A pattern node.
 * @param {Set<string>} into - Where to collect them.
 */
function declaredByPattern(node, into) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      into.add(node.name);
      return;
    case 'ObjectPattern':
      for (const property of node.properties) {
        declaredByPattern(property.type === 'RestElement' ? property.argument : property.value, into);
      }
      return;
    case 'ArrayPattern':
      for (const element of node.elements) {
        declaredByPattern(element, into);
      }
      return;
    case 'AssignmentPattern':
      declaredByPattern(node.left, into);
      return;
    case 'RestElement':
      declaredByPattern(node.argument, into);
      return;
    default:
  }
}

/**
 * Hoists the declarations a scope's statements introduce.
 *
 * Run on entering a scope rather than as the walk reaches each statement, so a
 * reference that appears before its declaration still resolves to the local —
 * `count` in `count; let count = 1;` is a local in a temporal dead zone, not a
 * free name to be routed to component state.
 * @param {object[]} body - Statements in the scope.
 * @param {Scope} scope - The scope to populate.
 * @param {boolean} functionLevel - Whether to also take `var` from nested blocks.
 */
function hoist(body, scope, functionLevel) {
  for (const statement of body || []) {
    if (!statement) continue;

    if (statement.type === 'VariableDeclaration') {
      const isVar = statement.kind === 'var';
      if (isVar === functionLevel || !isVar) {
        for (const declarator of statement.declarations) {
          declaredByPattern(declarator.id, scope.names);
        }
      }
      continue;
    }
    if (statement.type === 'FunctionDeclaration' && statement.id) {
      scope.names.add(statement.id.name);
      continue;
    }
    if (statement.type === 'ClassDeclaration' && statement.id) {
      scope.names.add(statement.id.name);
      continue;
    }

    // `var` is function-scoped, so a declaration nested in a block belongs to
    // the enclosing function and has to be found from here.
    if (functionLevel) {
      hoistVarsDeep(statement, scope);
    }
  }
}

/**
 * Finds `var` and function declarations nested inside blocks.
 * @param {object} node - The statement to search.
 * @param {Scope} scope - The function scope to populate.
 */
function hoistVarsDeep(node, scope) {
  if (!node || typeof node !== 'object') return;
  if (FUNCTION_NODES.has(node.type)) return;

  if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    for (const declarator of node.declarations) {
      declaredByPattern(declarator.id, scope.names);
    }
    return;
  }
  if (node.type === 'FunctionDeclaration' && node.id) {
    scope.names.add(node.id.name);
    return;
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) hoistVarsDeep(child, scope);
    } else if (value && typeof value.type === 'string') {
      hoistVarsDeep(value, scope);
    }
  }
}

/**
 * Walks a parsed body, recording how each free identifier is used.
 * @param {object} program - The acorn Program node.
 * @param {string} source - The original source, for error messages.
 * @returns {{reads: object[], writes: object[], thisNodes: object[], usesAwait: boolean}}
 *   The identifier references to rewrite.
 */
function analyse(program, source) {
  /** @type {object[]} */
  const reads = [];
  /** @type {object[]} */
  const writes = [];
  /** @type {object[]} */
  const thisNodes = [];
  let usesAwait = false;

  const root = new Scope(null, true);
  hoist(program.body, root, true);

  /**
   * Records a reference to a name that no enclosing scope declares.
   * @param {object} node - The Identifier node.
   * @param {Scope} scope - The scope it appears in.
   * @param {boolean} write - Whether it is being assigned to.
   */
  const reference = (node, scope, write) => {
    if (scope.has(node.name)) return;
    if (RESTRICTED_GLOBALS.has(node.name)) {
      throw new ExpressionCodegenError(
        `"${node.name}" is a restricted global and cannot be used in an action body. ` +
          'Pass what it produces in as state, or expose it through a bridge.',
        source,
      );
    }
    (write ? writes : reads).push(node);
  };

  /**
   * Walks one node.
   * @param {object} node - The node to walk.
   * @param {Scope} scope - The scope it sits in.
   * @param {boolean} inArrowChain - Whether `this` still means the caller's `this`.
   */
  const walk = (node, scope, inArrowChain) => {
    if (!node || typeof node.type !== 'string') return;

    switch (node.type) {
      case 'Identifier':
        reference(node, scope, false);
        return;

      case 'ThisExpression':
        // Only a `this` that is still the action's own `this` is rewritten. One
        // inside a nested `function` means that function's receiver, which
        // `with(this)` never changed either.
        if (inArrowChain) thisNodes.push(node);
        return;

      case 'AwaitExpression':
        usesAwait = true;
        walk(node.argument, scope, inArrowChain);
        return;

      case 'MemberExpression':
        walk(node.object, scope, inArrowChain);
        if (node.computed) {
          walk(node.property, scope, inArrowChain);
        } else if (node.property.type === 'Identifier' && FORBIDDEN_KEYS.has(node.property.name)) {
          throw new ExpressionCodegenError(
            `Access to property "${node.property.name}" is blocked for security reasons.`,
            source,
          );
        }
        return;

      case 'Property':
        if (node.computed) walk(node.key, scope, inArrowChain);
        else if (node.key.type === 'Identifier' && FORBIDDEN_KEYS.has(node.key.name)) {
          throw new ExpressionCodegenError(
            `Defining property "${node.key.name}" is blocked for security reasons.`,
            source,
          );
        }
        walk(node.value, scope, inArrowChain);
        return;

      case 'AssignmentExpression': {
        if (node.left.type === 'Identifier') {
          reference(node.left, scope, true);
        } else {
          walk(node.left, scope, inArrowChain);
        }
        walk(node.right, scope, inArrowChain);
        return;
      }

      case 'UpdateExpression':
        if (node.argument.type === 'Identifier') {
          reference(node.argument, scope, true);
        } else {
          walk(node.argument, scope, inArrowChain);
        }
        return;

      case 'LabeledStatement':
        walk(node.body, scope, inArrowChain);
        return;

      case 'BreakStatement':
      case 'ContinueStatement':
        return;

      case 'VariableDeclaration':
        for (const declarator of node.declarations) {
          // The pattern's own names are declarations, not references; only a
          // default value inside it is evaluated.
          walkPatternDefaults(declarator.id, scope, inArrowChain);
          walk(declarator.init, scope, inArrowChain);
        }
        return;

      default:
        break;
    }

    if (FUNCTION_NODES.has(node.type)) {
      const inner = new Scope(scope, true);
      if (node.id && node.type !== 'FunctionDeclaration') {
        inner.names.add(node.id.name);
      }
      for (const param of node.params) {
        declaredByPattern(param, inner.names);
      }
      if (node.body && node.body.type === 'BlockStatement') {
        hoist(node.body.body, inner, true);
      }
      // An arrow keeps the enclosing `this`; a `function` introduces its own.
      const arrowChain = inArrowChain && node.type === 'ArrowFunctionExpression';
      for (const param of node.params) {
        walkPatternDefaults(param, inner, arrowChain);
      }
      if (node.body && node.body.type === 'BlockStatement') {
        for (const statement of node.body.body) walk(statement, inner, arrowChain);
      } else {
        walk(node.body, inner, arrowChain);
      }
      return;
    }

    if (BLOCK_NODES.has(node.type)) {
      const inner = new Scope(scope, false);
      if (node.type === 'CatchClause') {
        declaredByPattern(node.param, inner.names);
        walk(node.body, inner, inArrowChain);
        return;
      }
      if (node.type === 'BlockStatement') {
        hoist(node.body, inner, false);
        for (const statement of node.body) walk(statement, inner, inArrowChain);
        return;
      }
      if (node.type === 'ForStatement') {
        if (node.init && node.init.type === 'VariableDeclaration') {
          hoist([node.init], inner, false);
        }
        walk(node.init, inner, inArrowChain);
        walk(node.test, inner, inArrowChain);
        walk(node.update, inner, inArrowChain);
        walk(node.body, inner, inArrowChain);
        return;
      }
      if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
        if (node.left.type === 'VariableDeclaration') {
          hoist([node.left], inner, false);
          walk(node.left, inner, inArrowChain);
        } else if (node.left.type === 'Identifier') {
          reference(node.left, inner, true);
        } else {
          walk(node.left, inner, inArrowChain);
        }
        walk(node.right, inner, inArrowChain);
        walk(node.body, inner, inArrowChain);
        return;
      }
      // SwitchStatement: the cases share one block scope.
      hoist(node.cases.flatMap((entry) => entry.consequent), inner, false);
      walk(node.discriminant, scope, inArrowChain);
      for (const entry of node.cases) {
        walk(entry.test, inner, inArrowChain);
        for (const statement of entry.consequent) walk(statement, inner, inArrowChain);
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) walk(child, scope, inArrowChain);
      } else if (value && typeof value.type === 'string') {
        walk(value, scope, inArrowChain);
      }
    }
  };

  /**
   * Walks only the default values inside a binding pattern.
   * @param {object} node - The pattern.
   * @param {Scope} scope - The scope defaults are evaluated in.
   * @param {boolean} inArrowChain - Whether `this` is still the action's.
   */
  function walkPatternDefaults(node, scope, inArrowChain) {
    if (!node) return;
    switch (node.type) {
      case 'AssignmentPattern':
        walkPatternDefaults(node.left, scope, inArrowChain);
        walk(node.right, scope, inArrowChain);
        return;
      case 'ObjectPattern':
        for (const property of node.properties) {
          if (property.type === 'RestElement') {
            walkPatternDefaults(property.argument, scope, inArrowChain);
            continue;
          }
          if (property.computed) walk(property.key, scope, inArrowChain);
          walkPatternDefaults(property.value, scope, inArrowChain);
        }
        return;
      case 'ArrayPattern':
        for (const element of node.elements) walkPatternDefaults(element, scope, inArrowChain);
        return;
      case 'RestElement':
        walkPatternDefaults(node.argument, scope, inArrowChain);
        return;
      default:
    }
  }

  for (const statement of program.body) {
    walk(statement, root, true);
  }

  return { reads, writes, thisNodes, usesAwait };
}

/**
 * Applies a set of source edits, right to left.
 * @param {string} source - The original source.
 * @param {Array<{start: number, end: number, text: string}>} edits - The edits.
 * @returns {string} The rewritten source.
 */
function applyEdits(source, edits) {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const edit of ordered) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/**
 * Compiles an action or resource body into a scope-taking function.
 * @param {string} source - The body as written.
 * @returns {string} JavaScript source for the function.
 * @throws {ExpressionCodegenError} When the body cannot be compiled.
 */
export function compileActionToSource(source) {
  const scopeName = RUNTIME_BINDINGS.scope;

  let program;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      // An action body is a function body, so both are legal in it even though
      // neither is legal at the top level of a script.
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: false,
    });
  } catch (error) {
    throw new ExpressionCodegenError(`could not be parsed: ${error.message}`, source);
  }

  const { reads, writes, thisNodes, usesAwait } = analyse(program, source);

  const edits = [];
  for (const node of reads) {
    edits.push({
      start: node.start,
      end: node.end,
      text: `${RUNTIME_BINDINGS.get}(${scopeName}, ${JSON.stringify(node.name)})`,
    });
  }
  for (const node of writes) {
    // A write target has to stay assignable, so it becomes a property of the
    // scope rather than a call. The scope's own `set` routes it into reactive
    // state, which is exactly what the interpreter's writeIdentifier did.
    edits.push({ start: node.start, end: node.end, text: `${scopeName}[${JSON.stringify(node.name)}]` });
  }
  for (const node of thisNodes) {
    edits.push({ start: node.start, end: node.end, text: `${RUNTIME_BINDINGS.get}(${scopeName}, "this")` });
  }

  const body = applyEdits(source, edits);
  const prefix = usesAwait ? 'async ' : '';
  return `${prefix}(${scopeName}) => { ${body}\n}`;
}

/**
 * Compiles an action body, returning the reason rather than throwing.
 * @param {string} source - The body as written.
 * @returns {{code: string}|{error: string}} The generated source, or the reason.
 */
export function tryCompileAction(source) {
  try {
    return { code: compileActionToSource(source) };
  } catch (error) {
    return { error: error.message };
  }
}
