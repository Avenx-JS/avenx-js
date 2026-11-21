/**
 * @file interpreter.js
 * @description The expression interpreter, as a development-only plug-in.
 *
 * This is the only module that reaches the parser, the tree-walking evaluator
 * and the old source-text sandbox, and the only thing that imports *it* is the
 * module the compiler adds to a development entry. That is what keeps all three
 * out of a production bundle: they are unreachable there, so the bundler drops
 * them.
 *
 * It exists because a development build should keep working while a developer
 * is still writing the template — an expression mid-edit, or one using a
 * construct the generator does not cover, should render rather than fail, with
 * the build's AVX_W48 warning saying which. A production build makes the
 * opposite trade: an uncompiled expression is a defect to fix, not a cost to
 * absorb on every page load.
 * @module lib/core/expression/interpreter
 */

import { compileExpression, compileStatements, describeParseFailure } from './compile.js';
import { evaluate as evaluateAst } from './evaluator.js';
import { installExpressionInterpreter } from './fallback.js';
import { AvenxSandbox } from '../security/sandbox.js';
import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';
import { LruCache } from '../utils/LruCache.js';

/**
 * Function bodies built for statement sources the AST evaluator cannot run.
 * @type {LruCache}
 */
const statementCache = new LruCache(1000);

/**
 * Every source this interpreter has been handed, in first-seen order.
 *
 * In a development build the interpreter runs exactly the expressions the
 * build did not compile, and the build is supposed to have named each of them
 * as AVX_W48. Recording them is what lets that be checked: a source that
 * reaches here with no warning behind it renders in development, throws
 * AVX_R32 in production, and nothing at build time said so. The E2E parity
 * fixture asserts this stays empty; a developer can read it from the console
 * as `Avenx.interpretedSources()`.
 * @type {Set<string>}
 */
const interpreted = new Set();

/**
 * The expressions and statement bodies interpreted so far, rather than run from
 * the compiled table.
 * @returns {string[]} The sources, in the order they were first interpreted.
 */
export function interpretedSources() {
  return [...interpreted];
}

installExpressionInterpreter({
  /**
   * Evaluates an expression the compiler did not compile.
   * @param {string} source - The expression source.
   * @param {object} scope - The evaluation scope.
   * @returns {any} The value.
   */
  evaluate(source, scope) {
    interpreted.add(source);
    const ast = compileExpression(source);
    if (!ast) {
      // Refused, not handed to the engine. The interpreter exists to evaluate
      // what the *parser* understands; an expression outside the language is
      // outside it in a development build too, and gets the same AVX_R32 it
      // always did -- there is no path from a parse failure to `new Function`
      // on the expression side, in either mode.
      throw new AvenxError(
        AvenxErrorCodes.EXPRESSION_UNSUPPORTED,
        source,
        describeParseFailure(source),
      );
    }
    return evaluateAst(ast, scope);
  },

  /**
   * Runs a statement body the compiler did not compile.
   *
   * This is the last `new Function` in the framework, and it is reachable only
   * from a development build. A body that gets here is one the action compiler
   * refused, which the build reported.
   * @param {string} source - The statement source.
   * @param {object} scope - The evaluation scope.
   * @returns {any} Whatever the body returned.
   */
  execute(source, scope) {
    interpreted.add(source);
    const ast = compileStatements(source);
    if (ast) {
      return evaluateAst(ast, scope);
    }

    let fn = statementCache.get(source);
    if (!fn) {
      AvenxSandbox.validateSource(source);
      fn = new Function(`with(this) { ${source} }`);
      statementCache.set(source, fn);
    }
    return fn.call(AvenxSandbox.createProxy(scope, scope));
  },
});
