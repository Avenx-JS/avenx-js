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
import { compileActionToSource } from './actions.js';

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
 * @property {Set<string>} [compiledActions] - Action names that compiled.
 * @property {Set<string>} [compiledResources] - Resource names that compiled.
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
 * Compiles a set of named bodies into table entries.
 *
 * Actions and resources are addressed by name at run time, not by source, so
 * they get their own table. Keying by name is what allows a production build to
 * leave the body text out of the bundle entirely: nothing has to match a string
 * in order to find the implementation.
 * @param {Object<string, string>} bodies - Sources keyed by name.
 * @param {object} accumulator - Collects refusals and gaps.
 * @returns {{entries: string[], compiledNames: Set<string>}} Entry lines and what compiled.
 */
function buildNamedEntries(bodies, accumulator) {
  const entries = [];
  const compiledNames = new Set();
  for (const [name, source] of Object.entries(bodies || {})) {
    if (typeof source !== 'string' || source.trim() === '') continue;
    try {
      entries.push(`  ${JSON.stringify(name)}: ${generateBody(source)}`);
      compiledNames.add(name);
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
  return { entries, compiledNames };
}

/**
 * Compiles one executable body, preferring the expression-program generator.
 *
 * A run of expressions -- `count++`, `busy = true; save()` -- takes the same
 * path a template binding does, so it emits the same guarded primitives.
 * Anything with real statement syntax goes to the action compiler, which parses
 * it properly and rewrites only how free identifiers resolve.
 * @param {string} source - The body source.
 * @returns {string} JavaScript source for the function.
 */
function generateBody(source) {
  try {
    return compileStatementsToSource(source);
  } catch (error) {
    if (!(error instanceof ExpressionCodegenError) || SECURITY_REFUSAL.test(error.message)) {
      throw error;
    }
    return compileActionToSource(source);
  }
}

/**
 * Builds the compiled-expression statics for one component class.
 * @param {string} className - The generated class name.
 * @param {object} collected - Output of {@link module:lib/compiler/codegen/collect}.
 * @param {string[]} collected.expressions - Value expressions.
 * @param {string[]} collected.statements - Inline handler bodies.
 * @param {Object<string, string>} [collected.actions] - Action bodies by name.
 * @param {Object<string, string>} [collected.resources] - Resource bodies by name.
 * @returns {CompiledTable} The generated source and what it covers.
 */
export function buildExpressionTable(className, collected) {
  const accumulator = { refusals: [], gaps: [] };

  const expressionEntries = buildEntries(collected.expressions || [], compileExpressionToSource, accumulator);

  const statementEntries = buildEntries(collected.statements || [], generateBody, accumulator);
  const actions = buildNamedEntries(collected.actions, accumulator);
  const resources = buildNamedEntries(collected.resources, accumulator);

  const parts = [];
  if (expressionEntries.length > 0) {
    parts.push(`${className}.__axExprs = {\n${expressionEntries.join(',\n')}\n};`);
  }
  if (statementEntries.length > 0) {
    parts.push(`${className}.__axStmts = {\n${statementEntries.join(',\n')}\n};`);
  }
  if (actions.entries.length > 0) {
    parts.push(`${className}.__axActions = {\n${actions.entries.join(',\n')}\n};`);
  }
  if (resources.entries.length > 0) {
    parts.push(`${className}.__axResources = {\n${resources.entries.join(',\n')}\n};`);
  }

  return {
    source: parts.length > 0 ? `\n${parts.join('\n')}\n` : '',
    compiled:
      expressionEntries.length + statementEntries.length + actions.entries.length + resources.entries.length,
    skipped: accumulator.refusals.length + accumulator.gaps.length,
    refusals: accumulator.refusals,
    gaps: accumulator.gaps,
    compiledActions: actions.compiledNames,
    compiledResources: resources.compiledNames,
  };
}
