import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';
import { getExpressionInterpreter } from '../expression/fallback.js';
import { deriveScope } from '../reactive/scopeProxy.js';
import { Sanitizer } from './sanitize.js';
import { tracer } from '../trace/tracer.js';
import { TraceNodeType } from '../trace/schema.js';
import { journal } from '../reactive/journal.js';

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
   * @param {object} [compiled] - The compiled tables the compiler emitted for
   *   the owning class.
   * @param {Object<string, function(object): any>} [compiled.expressions] - Value
   *   expressions, keyed by their source text.
   * @param {Object<string, function(object): any>} [compiled.statements] - Handler
   *   and action bodies, keyed by their source text.
   */
  constructor(compiled = null) {
    /**
     * Expressions the compiler already turned into closures.
     *
     * When an entry exists it is used, and neither the parser nor the
     * interpreter is reached. That is the whole point: a build in which every
     * expression compiled never executes the interpreter, which is what allows
     * it to be dropped from a production bundle.
     * @type {Object<string, function(object): any>|null}
     */
    this.compiledExpressions = (compiled && compiled.expressions) || null;

    /**
     * Compiled closures addressed by index, for the render program.
     *
     * Separate from the source-keyed table rather than overloading it. A
     * program op carries an index and a legacy binding carries source text;
     * one table serving both would have to guess which it was handed, and a
     * numeric string key is a real expression source.
     * @type {Array<function(object): any>|null}
     */
    this.indexedExpressions = (compiled && compiled.indexedExpressions) || null;

    /**
     * Compiled statement closures addressed by index, for event ops.
     * @type {Array<function(object): any>|null}
     */
    this.indexedStatements = (compiled && compiled.indexedStatements) || null;
    /**
     * Statement bodies the compiler already turned into closures.
     * @type {Object<string, function(object): any>|null}
     */
    this.compiledStatements = (compiled && compiled.statements) || null;
  }

  /**
   * The closure the compiler emitted for a source, if there is one.
   * @param {Object<string, function(object): any>|null} table - The table to consult.
   * @param {string} source - The source text.
   * @returns {function(object): any|null} The closure, or null.
   * @private
   */
  #lookup(table, source) {
    if (!table || typeof source !== 'string') return null;
    // Own-property only: a source spelled `toString` or `constructor` must not
    // resolve to something inherited from Object.prototype and then be called.
    if (!Object.prototype.hasOwnProperty.call(table, source)) return null;
    const fn = table[source];
    return typeof fn === 'function' ? fn : null;
  }

  /**
   * Returns an indexed closure, or null when the table cannot serve it.
   * @param {Array<function(object): any>|null} table - The table to consult.
   * @param {number} index - The op's index.
   * @returns {function(object): any|null} The closure, or null.
   * @private
   */
  #indexed(table, index) {
    if (!Array.isArray(table) || !Number.isInteger(index) || index < 0 || index >= table.length) {
      return null;
    }
    const fn = table[index];
    return typeof fn === 'function' ? fn : null;
  }

  /**
   * Evaluates a compiled expression by index.
   *
   * There is no interpreter fallback here, and that is deliberate. An index
   * names a closure and nothing else -- the source it came from is not in the
   * bundle -- so a missing entry is a program and a table that disagree, which
   * is a build fault rather than a template the runtime could still render.
   * The compiler refuses to emit a program whose expressions did not all
   * compile, so this cannot be reached by an application that built.
   * @param {number} index - The expression index.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The `this` context.
   * @returns {any} The value.
   */
  evaluateIndexed(index, scope = {}, thisArg = scope) {
    const generated = this.#indexed(this.indexedExpressions, index);
    if (!generated) {
      throw new AvenxError(AvenxErrorCodes.EXPRESSION_UNSUPPORTED, `expression #${index}`, 'no compiled entry');
    }
    return generated(buildAstScope(scope, thisArg));
  }

  /**
   * Runs a compiled statement body by index.
   * @param {number} index - The statement index.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The `this` context.
   * @returns {any} Whatever the body returned.
   */
  executeIndexed(index, scope = {}, thisArg = scope) {
    const generated = this.#indexed(this.indexedStatements, index);
    if (!generated) {
      throw new AvenxError(AvenxErrorCodes.EXPRESSION_UNSUPPORTED, `statement #${index}`, 'no compiled entry');
    }
    return generated(buildAstScope(scope, thisArg));
  }

  /**
   * Evaluates a JavaScript expression within a scope.
   * @param {string} expression - The expression to evaluate.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The 'this' context for evaluation.
   * @returns {any} The result of evaluation.
   */
  evaluateExpression(expression, scope = {}, thisArg = scope) {
    const scopeForAst = buildAstScope(scope, thisArg);

    // The compiled path: the engine parsed this closure when it parsed the
    // bundle, so evaluating it is a call rather than a tree walk.
    const generated = this.#lookup(this.compiledExpressions, expression);
    if (generated) {
      return generated(scopeForAst);
    }

    // An empty binding is not an error, and not worth reporting.
    if (typeof expression !== 'string' || expression.trim() === '') {
      return undefined;
    }

    // Everything else is an expression the build did not compile. A development
    // build installs the interpreter and renders it anyway, so a template being
    // edited keeps working; a production build has no interpreter, so this is a
    // defect that surfaces rather than a parser shipped to every visitor.
    const interpreter = getExpressionInterpreter();
    if (interpreter) {
      return interpreter.evaluate(expression, scopeForAst);
    }

    throw new AvenxError(
      AvenxErrorCodes.EXPRESSION_UNSUPPORTED,
      expression,
      'it was not compiled, and this build carries no expression interpreter. ' +
        'The build reports every such expression as AVX_W48.',
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
    const generated = this.#lookup(this.compiledStatements, source);
    if (generated) {
      return generated(buildAstScope(scope, thisArg));
    }

    if (typeof source !== 'string' || source.trim() === '') {
      return undefined;
    }

    const interpreter = getExpressionInterpreter();
    if (interpreter) {
      return interpreter.execute(source, buildAstScope(scope, thisArg));
    }

    throw new AvenxError(
      AvenxErrorCodes.EXPRESSION_UNSUPPORTED,
      source,
      'it was not compiled, and this build carries no expression interpreter. ' +
        'The build reports every such body as AVX_W48.',
    );
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
   * @param {Object<string, function(object): any>} [context.compiled] - Bodies the
   *   compiler already turned into functions, keyed by action name. Keyed by
   *   name rather than by source so an action's text does not have to be in the
   *   bundle at all to find its implementation, and so a call does not hash a
   *   multi-line string to look one up.
   * @returns {object} A map of functions.
   */
  createMethodMap(methods = {}, getScope, getThisArg, context = null) {
    const executable = {};
    const owner = context && context.owner;
    const kind = (context && context.kind) || 'action';
    const contracts = context && context.contracts && context.contracts.length > 0 ? context.contracts : undefined;

    const atomicSpec = (context && context.atomic) || null;
    const compiledBodies = (context && context.compiled) || null;

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
        // The compiled body when the generator produced one, and the source
        // otherwise. Resolved once per action rather than per call: which of
        // the two applies is a property of the build, not of the invocation.
        const generated = compiledBodies && Object.prototype.hasOwnProperty.call(compiledBodies, name)
          ? compiledBodies[name]
          : null;
        const invoke = typeof generated === 'function'
          ? (scope) => generated(buildAstScope(scope, getThisArg()))
          : (scope) => this.executeStatement(source, scope, getThisArg());

        const runner = spec
          ? (args) =>
            journal.run(spec, () => invoke(deriveScope(getScope(executable), { args })))
          : (args) => invoke(deriveScope(getScope(executable), { args }));

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
// duplicate was removed; the implementation now lives in one place, and
// `avenx-core/runtime` exports it from there too.
export { LruCache } from '../utils/LruCache.js';
