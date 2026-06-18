/**
 * Provides dynamic expression and statement evaluation within a given scope.
 */
export class DynamicEvaluator {
    /**
     * Converts a scope object into binding names and values for Function constructor.
     * @param {Object} [scope={}] - The scope object.
     * @returns {{names: string[], values: any[]}}
     * @private
     */
    #toScopeBindings(scope = {}) {
        const names = [];
        const values = [];

        for (const [name, value] of Object.entries(scope)) {
            if (/^[A-Za-z_$][\w$]*$/.test(name)) {
                names.push(name);
                values.push(value);
            }
        }

        return { names, values };
    }

    /**
     * Evaluates a JavaScript expression within a scope.
     * @param {string} expression - The expression to evaluate.
     * @param {Object} [scope={}] - The scope variables.
     * @param {Object} [thisArg=scope] - The 'this' context for evaluation.
     * @returns {any} The result of evaluation.
     */
    evaluateExpression(expression, scope = {}, thisArg = scope) {
        const { names, values } = this.#toScopeBindings(scope);
        const fn = new Function(...names, `return (${expression})`);
        return fn.call(thisArg, ...values);
    }

    /**
     * Executes a JavaScript statement within a scope.
     * @param {string} source - The statement(s) to execute.
     * @param {Object} [scope={}] - The scope variables.
     * @param {Object} [thisArg=scope] - The 'this' context for execution.
     * @returns {any} The result of execution.
     */
    executeStatement(source, scope = {}, thisArg = scope) {
        const { names, values } = this.#toScopeBindings(scope);
        const fn = new Function(...names, `with(this) { ${source} }`);
        return fn.call(thisArg, ...values);
    }

    /**
     * Creates a map of executable methods from string definitions.
     * @param {Object} [methods={}] - An object containing method name and source code pairs.
     * @param {function(Object): Object} getScope - Function to retrieve the scope for a method.
     * @param {function(): Object} getThisArg - Function to retrieve the 'this' context for methods.
     * @returns {Object} A map of functions.
     */
    createMethodMap(methods = {}, getScope, getThisArg) {
        const executable = {};

        for (const [name, source] of Object.entries(methods)) {
            if (typeof source === 'function') {
                executable[name] = source.bind(getThisArg());
            } else {
                executable[name] = (...args) => this.executeStatement(
                    source,
                    { ...getScope(executable), args },
                    getThisArg()
                );
            }
        }

        return executable;
    }
}
