/**
 * @file validateExpressions.js
 * @description Checks template expressions at build time, not at render time.
 *
 * Template interpolations, computed values and directive bindings are evaluated
 * by Avenx's own expression evaluator, which covers the expression language and
 * refuses anything outside it. Without this pass a developer finds that out
 * when the component renders — possibly in production, possibly on a branch a
 * test never took.
 *
 * The compiler already holds every one of those expressions as source text.
 * Parsing them here means an unsupported expression fails the build, with the
 * file, the line and the reason, instead of becoming an AVX_R32 at runtime.
 *
 * Action bodies are deliberately not checked. They are statement JavaScript and
 * always have been; `if`, `for` and `return` are not expressions, and the
 * runtime runs them as statements.
 * @module lib/compiler/validateExpressions
 */

import { compileExpression, describeParseFailure } from '../core/expression/compile.js';
import { createInterpolationRegex } from '../core/utils/templateUtils.js';
import { createLineIndex } from './parser/tokenizer.js';
import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { TemplateValidationError } from './errors/TemplateValidationError.js';

/**
 * Attributes whose value is an expression rather than a statement.
 *
 * `data-ax-event` holds handler statements and is excluded: a handler may
 * legitimately be a statement sequence.
 * @type {string[]}
 */
const EXPRESSION_ATTRIBUTES = [
  'data-ax-for',
  'data-ax-key',
  'data-ax-show',
  'data-ax-html',
  'data-ax-class',
  'data-ax-style',
  'data-ax-if',
];

/**
 * Finds every expression in a template, with its source offset.
 *
 * Interpolations and directive attribute values only. Reading them out of the
 * rewritten template rather than the original source means the offsets point at
 * a string the developer never wrote, so the location is reported against the
 * original file by searching for the expression text — imprecise for a repeated
 * expression, and honest about it: the message names the expression itself,
 * which is what a developer searches for.
 * @param {string} template - The rewritten template.
 * @returns {Array<{source: string, kind: string}>} The expressions found.
 */
export function collectTemplateExpressions(template) {
  /** @type {Array<{source: string, kind: string}>} */
  const found = [];
  if (typeof template !== 'string' || template === '') {
    return found;
  }

  const interpolation = createInterpolationRegex();
  let match;
  while ((match = interpolation.exec(template)) !== null) {
    const source = (match[1] !== undefined ? match[1] : match[2] || '').trim();
    if (source) {
      found.push({ source, kind: 'interpolation' });
    }
  }

  for (const name of EXPRESSION_ATTRIBUTES) {
    const attribute = new RegExp(`${name}="([^"]*)"`, 'g');
    let attrMatch;
    while ((attrMatch = attribute.exec(template)) !== null) {
      const source = attrMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
      if (source) {
        found.push({ source, kind: name });
      }
    }
  }

  return found;
}

/**
 * Validates every expression a component evaluates as an expression.
 * @param {object} unit - The component being compiled.
 * @param {string} unit.name - The component name.
 * @param {string} unit.filePath - Absolute path to the component file.
 * @param {string} unit.content - The original source, for locating errors.
 * @param {string} unit.template - The rewritten template.
 * @param {Object<string, string>} unit.computed - Computed expressions by name.
 * @returns {TemplateValidationError[]} One error per unsupported expression.
 */
export function validateComponentExpressions({ name, filePath, content, template, computed }) {
  /** @type {TemplateValidationError[]} */
  const errors = [];
  const lines = content ? createLineIndex(content) : null;

  /**
   * Records an error for one unsupported expression.
   * @param {string} source - The expression source.
   * @param {string} where - What kind of binding it is.
   */
  const reject = (source, where) => {
    const error = new TemplateValidationError(
      AvenxErrorCodes.EXPRESSION_UNSUPPORTED,
      source,
      `${describeParseFailure(source)} (in ${where} of <${name}>)`,
    );
    if (content && lines) {
      const index = content.indexOf(source);
      if (index >= 0) {
        error.setLocation({ source: content, index, filename: filePath });
      }
    }
    errors.push(error);
  };

  for (const [key, expression] of Object.entries(computed || {})) {
    if (typeof expression !== 'string' || expression.trim() === '') continue;
    if (!compileExpression(expression)) {
      reject(expression, `<computed name="${key}">`);
    }
  }

  for (const { source, kind } of collectTemplateExpressions(template)) {
    if (!compileExpression(source)) {
      reject(source, kind === 'interpolation' ? 'a template interpolation' : `a ${kind} binding`);
    }
  }

  return errors;
}
