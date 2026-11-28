/**
 * @file scope.js
 * @description Scope chain and binding-table helpers for the JavaScript parser.
 * @module lib/compiler/parser/js/scope
 */

/** A scope that `var` reaches: the top level or a function body. @type {number} */
export const SCOPE_VAR = 1;
/** A scope that only holds lexical declarations. @type {number} */
export const SCOPE_BLOCK = 2;
/** A `catch (e)` scope, whose single simple binding `var` may redeclare. @type {number} */
export const SCOPE_SIMPLE_CATCH = 4;

/**
 * One binding scope.
 *
 * Duplicate-declaration errors are early errors rather than parse errors, but
 * they are errors all the same, and a compiler whose parser accepted
 * `const a = 1; const a = 2;` would hand the code generator a program that no
 * engine will run. Tracking names is what lets this parser refuse them with a
 * position, as acorn does.
 */
export class BindingScope {
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
 * Pushes a scope.
 * @param {object} p - The parser instance.
 * @param {number} flags - A combination of the SCOPE_ constants.
 */
export function enterScope(p, flags) {
  p.scopeStack.push(new BindingScope(flags));
}

/**
 * Pops the current scope.
 * @param {object} p - The parser instance.
 */
export function exitScope(p) {
  p.scopeStack.pop();
}

/**
 * @param {object} p - The parser instance.
 * @returns {BindingScope} The innermost scope.
 */
export function currentScope(p) {
  return p.scopeStack[p.scopeStack.length - 1];
}

/**
 * Records a name in a set, so the undo log can remove it again.
 * @param {object} p - The parser instance.
 * @param {Set<string>} set - The set to add to.
 * @param {string} name - The name.
 */
export function addBinding(p, set, name) {
  if (set.has(name)) return;
  set.add(name);
  p.bindingLog.push({ set, name });
}

/**
 * Declares a name, refusing a redeclaration the language forbids.
 * @param {object} p - The parser instance.
 * @param {string} name - The declared name.
 * @param {'var'|'lexical'|'function'|'param'|'simple-catch'} kind - How it is declared.
 * @param {number} pos - Where to report a clash.
 */
export function declareName(p, name, kind, pos) {
  const scope = p.currentScope();
  if (!scope) return;

  if (kind === 'lexical' || kind === 'simple-catch' || (kind === 'function' && p.strict)) {
    if (scope.lexical.has(name) || scope.functions.has(name) || scope.var.has(name)) {
      p.raise(`Identifier '${name}' has already been declared`, pos);
    }
    p.addBinding(scope.lexical, name);
    if (kind === 'simple-catch') scope.simpleCatchName = name;
    return;
  }

  if (kind === 'param') {
    p.addBinding(scope.var, name);
    return;
  }

  // `var` and a sloppy function declaration reach the nearest var scope, and
  // may not pass a lexical binding of the same name on the way.
  for (let i = p.scopeStack.length - 1; i >= 0; i -= 1) {
    const current = p.scopeStack[i];
    const shadowedByCatch = (current.flags & SCOPE_SIMPLE_CATCH) !== 0 && current.simpleCatchName === name;
    if (current.lexical.has(name) && !shadowedByCatch) {
      p.raise(`Identifier '${name}' has already been declared`, pos);
    }
    if (kind === 'function' && current.functions.has(name) && (current.flags & SCOPE_VAR) === 0) {
      // Two function declarations in one block are allowed in sloppy code.
      break;
    }
    p.addBinding(current.var, name);
    if (kind === 'function') p.addBinding(current.functions, name);
    if ((current.flags & SCOPE_VAR) !== 0) break;
  }
}
