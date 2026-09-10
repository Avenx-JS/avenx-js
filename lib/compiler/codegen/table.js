/**
 * @file table.js
 * @description Emits a component's compiled expressions as module source.
 *
 * ## Shape, and why it is keyed by source
 *
 * ```js
 * Counter.__axExprs = {
 *   "count": (scope) => axGet(scope, "count"),
 *   "item.qty": (scope) => axRead(axGet(scope, "item"), "qty", false),
 * };
 * ```
 *
 * Keying by the original source text rather than by an index is what lets every
 * evaluation site take the compiled path at once. The render program addresses
 * its bindings by index and could have used one; the list manager, the defer
 * manager and computed declarations all arrive holding *text*, read from a DOM
 * attribute or a declaration. One table keyed by that text serves all of them,
 * so no call site had to learn a new calling convention in order to stop being
 * interpreted.
 *
 * The cost is the key: a component's expression sources are in the bundle
 * twice, once as a key and once as compiled code. That is paid back many times
 * over by not shipping a parser and an interpreter, and it is temporary — once
 * every evaluation site addresses bindings by index, the keys go.
 *
 * ## What is not in the table
 *
 * An expression the generator refuses. Refusals are returned to the caller
 * rather than swallowed, because the two reasons are very different. A security
 * refusal (naming `window`, writing `__proto__`) must fail the build, while an
 * expression merely outside the supported language should leave the entry
 * absent and let the existing runtime path handle it.
 * @module lib/compiler/codegen/table
 */

import {
  compileExpressionToSource,
  compileStatementsToSource,
  ExpressionCodegenError,
} from './expression.js';

/**
 * Security refusals that must fail the build rather than fall back.
 *
 * An expression outside the supported language is a capability gap and falls
 * back. An expression that names a restricted global or touches a forbidden key
 * is a mistake in the application, and letting it fall back would mean the
 * developer learns about it from a runtime sandbox violation instead of from
 * the build.
 * @type {RegExp}
 */
const SECURITY_REFUSAL = /blocked for security reasons|restricted global/i;

/**
 * @typedef {object} CompiledTable
 * @property {string} source - The `Name.__axExprs = {...}` statements, or ''.
 * @property {number} compiled - How many sources compiled.
 * @property {number} skipped - How many were left to the runtime.
 * @property {Array<{source: string, reason: string}>} refusals - Security refusals.
 * @property {Array<{source: string, reason: string}>} gaps - Language gaps.
 */

/**
 * Compiles a set of sources into table entries.
 * @param {string[]} sources - The expression or statement sources.
 * @param {function(string): string} generate - The generator to apply.
 * @param {object} accumulator - Collects refusals and gaps.
 * @returns {string[]} Entry source lines.
 */
function buildEntries(sources, generate, accumulator) {
  const entries = [];
  for (const source of sources) {
    try {
      entries.push(`  ${JSON.stringify(source)}: ${generate(source)}`);
    } catch (error) {
      if (!(error instanceof ExpressionCodegenError)) {
        throw error;
      }
      const record = { source, reason: error.message };
      if (SECURITY_REFUSAL.test(error.message)) {
        accumulator.refusals.push(record);
      } else {
        accumulator.gaps.push(record);
      }
    }
  }
  return entries;
}

/**
 * Builds the compiled-expression statics for one component class.
 * @param {string} className - The generated class name.
 * @param {object} collected - Output of {@link module:lib/compiler/codegen/collect}.
 * @param {string[]} collected.expressions - Value expressions.
 * @param {string[]} collected.statements - Handler and action bodies.
 * @returns {CompiledTable} The generated source and what it covers.
 */
export function buildExpressionTable(className, collected) {
  const accumulator = { refusals: [], gaps: [] };

  const expressionEntries = buildEntries(collected.expressions || [], compileExpressionToSource, accumulator);
  const statementEntries = buildEntries(collected.statements || [], compileStatementsToSource, accumulator);

  const parts = [];
  if (expressionEntries.length > 0) {
    parts.push(`${className}.__axExprs = {\n${expressionEntries.join(',\n')}\n};`);
  }
  if (statementEntries.length > 0) {
    parts.push(`${className}.__axStmts = {\n${statementEntries.join(',\n')}\n};`);
  }

  return {
    source: parts.length > 0 ? `\n${parts.join('\n')}\n` : '',
    compiled: expressionEntries.length + statementEntries.length,
    skipped: accumulator.refusals.length + accumulator.gaps.length,
    refusals: accumulator.refusals,
    gaps: accumulator.gaps,
  };
}
