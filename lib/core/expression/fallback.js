/**
 * @file fallback.js
 * @description Where the expression interpreter plugs in, when it is present.
 *
 * ## Why this indirection exists
 *
 * Every expression an application contains is compiled to a closure at build
 * time. When that succeeds for all of them — which is the normal case, and the
 * build says so when it is not — the interpreter has nothing to do, and a
 * production bundle should not carry a JavaScript parser and a tree-walking
 * evaluator that can never run.
 *
 * A bundler cannot work that out from a conditional `import`, so the dependency
 * is inverted instead. Nothing in the evaluation path imports the interpreter;
 * it registers itself here, and only the *development* entry pulls in the
 * module that does the registering. In a production build nothing references
 * it, so the parser, the evaluator and the old source-text sandbox are shaken
 * out of the graph entirely.
 *
 * This is the same mechanism the trace recorder uses, for the same reason: the
 * difference between a development and a production bundle should be which
 * modules are reachable, not a flag consulted at run time.
 *
 * ## What happens in production when an expression did not compile
 *
 * It throws, naming the expression, rather than silently doing something else.
 * The build already reported it as AVX_W48 and refused it outright if the
 * reason was a security one, so this is the last of three chances to notice —
 * and a loud failure is better than a bundle that quietly carries an
 * interpreter because one template used a construct nobody meant to use.
 * @module lib/core/expression/fallback
 */

/**
 * The interpreter, when a build has installed one.
 * @type {{evaluate: function(string, object): any, execute: function(string, object): any}|null}
 */
let interpreter = null;

/**
 * Installs the interpreter.
 *
 * Called by the development-only module the compiler adds to the entry. Nothing
 * else should call it: a production application that wants an expression to
 * work should compile it, not reinstate the interpreter.
 * @param {object} implementation - The interpreter.
 * @param {function(string, object): any} implementation.evaluate - Evaluates an expression.
 * @param {function(string, object): any} implementation.execute - Runs a statement body.
 */
export function installExpressionInterpreter(implementation) {
  interpreter = implementation || null;
}

/**
 * The installed interpreter, or null.
 * @returns {object|null} The interpreter.
 */
export function getExpressionInterpreter() {
  return interpreter;
}

/**
 * Whether an interpreter is available.
 *
 * Exposed so a diagnostic can tell "this build has no interpreter" apart from
 * "this expression did not compile", which are very different things to a
 * developer reading an error.
 * @returns {boolean} True when one is installed.
 */
export function hasExpressionInterpreter() {
  return interpreter !== null;
}
