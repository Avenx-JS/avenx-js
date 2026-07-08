import { AvenxSandbox } from './sandbox.js';

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
    AvenxSandbox.validateSource(expression);
    const sandbox = AvenxSandbox.createProxy(scope, thisArg);
    const fn = new Function(`with(this) { return (${expression}) }`);
    return fn.call(sandbox);
  }

  /**
   * Executes a JavaScript statement within a scope.
   * @param {string} source - The statement(s) to execute.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The 'this' context for execution.
   * @returns {any} The result of execution.
   */
  executeStatement(source, scope = {}, thisArg = scope) {
    AvenxSandbox.validateSource(source);
    const sandbox = AvenxSandbox.createProxy(scope, thisArg);
    const fn = new Function(`with(this) { ${source} }`);
    return fn.call(sandbox);
  }

  /**
   * Creates a map of executable methods from string definitions.
   * @param {object} [methods] - An object containing method name and source code pairs.
   * @param {function(object): object} getScope - Function to retrieve the scope for a method.
   * @param {function(): object} getThisArg - Function to retrieve the 'this' context for methods.
   * @returns {object} A map of functions.
   */
  createMethodMap(methods = {}, getScope, getThisArg) {
    const executable = {};

    for (const [name, source] of Object.entries(methods)) {
      if (typeof source === 'function') {
        executable[name] = source.bind(getThisArg());
      } else {
        executable[name] = (...args) => this.executeStatement(source, { ...getScope(executable), args }, getThisArg());
      }
    }

    return executable;
  }
}
