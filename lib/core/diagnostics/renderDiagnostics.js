/**
 * @file renderDiagnostics.js
 * @description Runtime diagnostics formatting for template rendering and directive evaluation errors.
 * Enriches AVX_R08, AVX_W21-W23 with component names, source files, line:column positions,
 * and code frames when available.
 */

import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { formatCodeFrame } from '../utils/codeFrame.js';

/**
 * Resolves the location of an expression from an exprLocations map/object.
 * Handles duplicate occurrences of expressions by index.
 * @param {object|null} exprLocations - Location metadata emitted by the compiler.
 * @param {string} expr - The expression string to look up.
 * @param {number} [occurrence=0] - 0-based occurrence index for duplicate expressions.
 * @param {string|null} [type=null] - Optional expression type ('interpolation', 'show', 'class', 'html', 'attr').
 * @returns {{ line: number, column: number, file?: string, expr?: string, type?: string }|null}
 */
export function findExpressionLocation(exprLocations, expr, occurrence = 0, type = null) {
  if (!exprLocations || typeof exprLocations !== 'object') {
    return null;
  }

  // If exprLocations provides a custom findLocation method
  if (typeof exprLocations.findLocation === 'function') {
    return exprLocations.findLocation(expr, occurrence, type);
  }

  const trimmed = typeof expr === 'string' ? expr.trim() : String(expr || '');

  // 1. By type if specified
  if (type && exprLocations.byType && Array.isArray(exprLocations.byType[type])) {
    const matching = exprLocations.byType[type].filter((l) => l.expr === trimmed);
    if (matching.length > 0) {
      return matching[Math.min(occurrence, matching.length - 1)];
    }
  }

  // 2. By expression string
  if (exprLocations.byExpr && Array.isArray(exprLocations.byExpr[trimmed])) {
    const list = exprLocations.byExpr[trimmed];
    if (list.length > 0) {
      return list[Math.min(occurrence, list.length - 1)];
    }
  }

  // 3. Fallback to locations list
  if (Array.isArray(exprLocations.locations)) {
    const matching = exprLocations.locations.filter(
      (l) => l.expr === trimmed && (!type || l.type === type)
    );
    if (matching.length > 0) {
      return matching[Math.min(occurrence, matching.length - 1)];
    }
  }

  return null;
}

/**
 * Formats a diagnostic message for a render failure (AVX_R08 or AVX_W21-W23).
 * Resolves component name and source position (file:line:col), appending code frames when source is present.
 * @param {string} code - The AvenxErrorCode (e.g. AVX_R08, AVX_W21).
 * @param {string} expr - The expression that threw or failed.
 * @param {Error|string} error - The underlying error.
 * @param {object} [context] - Component context ($logContext, options, or component instance).
 * @param {object} [options]
 * @param {number} [options.occurrenceIndex=0] - Occurrence index of duplicate expression.
 * @param {string} [options.type=null] - Expression type ('interpolation', 'show', etc.).
 * @param {object} [options.loc=null] - Explicitly provided location object { line, column, file }.
 * @returns {string} The formatted message string ready for logging.
 */
export function formatRenderDiagnostic(code, expr, error, context = {}, options = {}) {
  const comp = context?.component || context;
  let compName =
    context?.componentName ||
    (comp && comp.constructor && comp.constructor.name !== 'AvenxComponent' && comp.constructor.name !== 'Object'
      ? comp.constructor.name
      : null) ||
    context?.name ||
    comp?.name ||
    'AnonymousComponent';

  const exprStr = typeof expr === 'string' ? expr.trim() : String(expr ?? '');

  // Look up source location
  const loc =
    options.loc ||
    (context?.exprLocations
      ? findExpressionLocation(context.exprLocations, exprStr, options.occurrenceIndex || 0, options.type || null)
      : null);

  const file = loc?.file || context?.fileName || comp?.__filename || null;
  const line = loc?.line;
  const col = loc?.column;

  let locStr = '';
  if (line && col) {
    locStr = file ? ` at ${file}:${line}:${col}` : ` at line ${line}:${col}`;
  }

  let formatted = formatMessage(code, exprStr, error, compName, locStr);

  // In development, append caret-annotated code frame if source/template text is available
  const source =
    context?.source ||
    context?.template ||
    comp?.__source ||
    (comp && comp.constructor && comp.constructor.__template) ||
    null;

  if (source && line && col) {
    const frame = formatCodeFrame(source, line, col, { length: exprStr.length });
    if (frame && !formatted.includes(frame)) {
      formatted += `\n\n${frame}`;
    }
  }

  return formatted;
}

