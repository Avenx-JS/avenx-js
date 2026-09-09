import { AvenxSandbox } from './sandbox.js';
import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';
// One LruCache implementation, not two. This module carried a verbatim copy of
// lib/core/utils/LruCache.js, differing only in comments, and re-exported it as
// part of the public surface -- so both had to be kept in step by hand.
import { LruCache } from '../utils/LruCache.js';
import { compileExpression, compileStatements, describeParseFailure } from '../expression/compile.js';
import { evaluate as evaluateAst } from '../expression/evaluator.js';
import { deriveScope } from '../reactive/scopeProxy.js';
import { Sanitizer } from './sanitize.js';
import { tracer } from '../trace/tracer.js';
import { TraceNodeType } from '../trace/schema.js';
import { journal } from '../reactive/journal.js';

const DEFAULT_CACHE_CAPACITY = 1000;

// Module-scope LRU caches for compiled expressions and statements.
// Shared across all DynamicEvaluator instances to prevent redundant compilation across components.
let expressionCache = new LruCache(DEFAULT_CACHE_CAPACITY);
let statementCache = new LruCache(DEFAULT_CACHE_CAPACITY);

/**
 * Configure the capacity of the compiled expression and statement caches.
 * @param {number} capacity - Positive integer limit.
 */
export function setExpressionCacheCapacity(capacity) {
  if (typeof capacity !== 'number' || capacity <= 0 || !Number.isInteger(capacity)) {
    throw new Error('Expression cache capacity must be a positive integer');
  }
  const oldExpr = expressionCache;
  const oldStmt = statementCache;
  expressionCache = new LruCache(capacity);
  statementCache = new LruCache(capacity);

  if (oldExpr) {
    for (const [k, v] of oldExpr.cache.entries()) {
      if (expressionCache.size >= capacity) break;
      expressionCache.set(k, v);
    }
  }
  if (oldStmt) {
    for (const [k, v] of oldStmt.cache.entries()) {
      if (statementCache.size >= capacity) break;
      statementCache.set(k, v);
    }
  }
}

/**
 * Clears the evaluator expression and statement caches.
 */
export function clearExpressionCache() {
  expressionCache.clear();
  statementCache.clear();
}

/**
 * Inspect the current cache size (used for diagnostics and testing).
 */
export function getExpressionCacheStats() {
  return {
    expressionCacheSize: expressionCache.size,
    statementCacheSize: statementCache.size,
  };
}

/**
 * Presents the scope and the `this` context as one lookup surface.
 *
 * `with(this)` used to merge them. The AST evaluator resolves names against a
 * single object instead, so the two are layered here: the scope wins, and the
 * `this` context -- a component's reactive state -- fills in behind it, which
 * is what makes `count = 1` inside an action reach state rather than creating a
 * scope-local name.
 * @param {object} scope - The evaluation scope.
 * @param {object} thisArg - The `this` context, usually component state.
 * @returns {object} A combined lookup surface.
 */
function buildAstScope(scope, thisArg) {
  if (!thisArg) {
    return scope;
  }
  return new Proxy(scope, {
    /**
     * @param {object} target - The scope.
     * @param {string|symbol} key - The name to test.
     * @returns {boolean} Whether either layer binds it.
     */
    has(target, key) {
      // `with(this)` used to make `this` mean the sandbox proxy, which fell
      // through to the context. The AST evaluator resolves names against one
      // object, so the binding is made explicit here.
      if (key === 'this') return true;
      return key in target || key in thisArg;
    },
    /**
     * @param {object} target - The scope.
     * @param {string|symbol} key - The name to read.
     * @returns {any} The bound value.
     */
    get(target, key) {
      if (key === 'this') return thisArg;
      if (key in target) return target[key];
      return thisArg[key];
    },
    /**
     * @param {object} target - The scope.
     * @param {string|symbol} key - The name to write.
     * @param {any} value - The value to assign.
     * @returns {boolean} Always true.
     */
    set(target, key, value) {
      if (key === 'this') {
        return false;
      }
      if (key in thisArg) {
        thisArg[key] = value;
        return true;
      }
      target[key] = value;
      return true;
    },
  });
}

/**
 * Provides dynamic expression and statement evaluation within a given scope.
 */
export class DynamicEvaluator {
  /**
   * Evaluates a JavaScript expression within a scope.
   * @param {string} expression - The expression to evaluate.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The 'this' context for evaluation.
   * @returns {any} The result of evaluation.
   */
  evaluateExpression(expression, scope = {}, thisArg = scope) {
    // The AST evaluator is the primary path: it needs no `new Function`, so a
    // page whose expressions all take it needs no 'unsafe-eval', and it gates
    // every property access on the *resolved* key -- which is what closes the
    // `({})['const'+'ructor']` escape that no source-text check could.
    const scopeForAst = buildAstScope(scope, thisArg);
    const compiled = compileExpression(expression);
    if (compiled) {
      return evaluateAst(compiled, scopeForAst);
    }

    // An empty binding is not an error, and not worth a parse.
    if (typeof expression !== 'string' || expression.trim() === '') {
      return undefined;
    }

    // There is deliberately no eval fallback on this path.
    //
    // Template interpolations, computed values, directive bindings and list
    // keys are the surface the security boundary is about, and falling back to
    // `new Function` here would reopen every hole the AST evaluator closes --
    // an expression that merely failed to parse would be handed to the engine
    // with the old, escapable sandbox around it. Refusing instead is what makes
    // "template expressions never need 'unsafe-eval'" a property of the
    // implementation rather than a claim about it.
    //
    // The cost is bounded: statements, function declarations, `await` and
    // destructuring are not expressions, and an action is where they belong.
    throw new AvenxError(
      AvenxErrorCodes.EXPRESSION_UNSUPPORTED,
      expression,
      describeParseFailure(expression),
    );
  }

  /**
   * Executes a JavaScript statement within a scope.
   *
   * This used to accept a pre-compiled function as well, for handlers
   * `EventExecutor` had already built with `new Function`, and ran those
   * against the source-text sandbox rather than the AST evaluator. Nothing
   * produces such a function any more, and accepting one would be a door back
   * into the sandbox the evaluator exists to replace.
   * @param {string} source - The statement(s) to execute.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The 'this' context for execution.
   * @returns {any} The result of execution.
   */
  executeStatement(source, scope = {}, thisArg = scope) {
    // Most inline handlers and short action bodies -- `count++`,
    // `state.text = event.target.value`, `busy = true; save()` -- are runs of
    // expressions, and take the AST path with no eval. Anything with real
    // statement syntax (if, for, return, a declaration) does not.
    const compiled = compileStatements(source);
    if (compiled) {
      return evaluateAst(compiled, buildAstScope(scope, thisArg));
    }

    let fn = statementCache.get(source);
    if (!fn) {
      AvenxSandbox.validateSource(source);
      fn = new Function(`with(this) { ${source} }`);
      statementCache.set(source, fn);
    }
    const sandbox = AvenxSandbox.createProxy(scope, thisArg);
    return fn.call(sandbox);
  }

  /**
   * Creates a map of executable methods from string definitions.
   * @param {object} [methods] - An object containing method name and source code pairs.
   * @param {function(object): object} getScope - Function to retrieve the scope for a method.
   * @param {function(): object} getThisArg - Function to retrieve the 'this' context for methods.
   * @param {object} [context] - Trace context describing who owns these methods.
   * @param {string} [context.owner] - The component or page name, used in traces.
   * @param {string} [context.kind] - What sort of unit these are, e.g. `action` or `resource`.
   * @param {string[]} [context.contracts] - Compiler contracts the owner declared.
   * @param {Object<string, {onConflict: string=}>} [context.atomic] - Actions the
   *   compiler saw declared `atomic`, keyed by name. Each one runs inside a
   *   Rewind transaction: its writes are journaled and undone if it fails.
   * @returns {object} A map of functions.
   */
  createMethodMap(methods = {}, getScope, getThisArg, context = null) {
    const executable = {};
    const owner = context && context.owner;
    const kind = (context && context.kind) || 'action';
    const contracts = context && context.contracts && context.contracts.length > 0 ? context.contracts : undefined;

    const atomicSpec = (context && context.atomic) || null;

    for (const [name, source] of Object.entries(methods)) {
      if (typeof source === 'function') {
        executable[name] = source.bind(getThisArg());
      } else {
        // Resolved once per action rather than per call: the descriptor comes
        // from the compiler and cannot change while the component is alive, and
        // an action that is not atomic must not pay a closure for the branch on
        // every invocation.
        const transaction = atomicSpec && Object.prototype.hasOwnProperty.call(atomicSpec, name)
          ? atomicSpec[name] || {}
          : null;
        const spec = transaction ? { owner, name, onConflict: transaction.onConflict } : null;

        /**
         * Executes the action body, inside a transaction when it is atomic.
         * @param {any[]} args - The call arguments.
         * @returns {any} Whatever the body returned.
         */
        // Derived rather than spread. Spreading the scope reads every name it
        // binds -- every state key and every computed value -- on every action
        // call, which is the eager read that made bare identifiers
        // non-reactive and reported false dependency cycles.
        const runner = spec
          ? (args) =>
            journal.run(spec, () =>
              this.executeStatement(source, deriveScope(getScope(executable), { args }), getThisArg()),
            )
          : (args) => this.executeStatement(source, deriveScope(getScope(executable), { args }), getThisArg());

        executable[name] = (...args) => {
          if (!tracer.on) {
            return runner(args);
          }
          const token = tracer.enter(TraceNodeType.ACTION, {
            name,
            kind,
            component: owner,
            source,
            contracts,
            args: args.length > 0 ? tracer.sink.capture(args, `${name}.args`) : undefined,
          });
          try {
            return runner(args);
          } finally {
            tracer.leave(token);
          }
        };
      }
    }

    return executable;
  }

  /**
   * Sanitizes an HTML string using the Sanitizer utility with optional custom policy configuration.
   * @param {any} value - The HTML string or value to sanitize.
   * @param {object} [options] - Optional custom policy configuration for Sanitizer.
   * @returns {string} The sanitized HTML string.
   */
  sanitizeHTML(value, options = {}) {
    const sanitizer = new Sanitizer(options);
    return sanitizer.sanitize(value);
  }
}

// Re-exported because it was part of this module's public surface before the
// duplicate was removed; the implementation now lives in one place.
export { LruCache };
