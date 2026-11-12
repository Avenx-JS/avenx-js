/**
 * @file codeFrame.js
 * @description Formats code frames with carets (^) for syntax and runtime diagnostics.
 * Shared between compiler errors and runtime render diagnostics.
 */

/**
 * Formats a code frame snippet highlighting an error location with carets (^).
 * @param {string} source - The source code or template content.
 * @param {number} line - 1-based line number of the error.
 * @param {number} column - 1-based column offset of the error.
 * @param {object} [options]
 * @param {number} [options.linesBefore] - Context lines to include before.
 * @param {number} [options.linesAfter] - Context lines to include after.
 * @param {number} [options.length] - Number of carets to render under the error (e.g. ^^^).
 * @returns {string} The formatted visual code frame string.
 */
export function formatCodeFrame(source, line, column, options = {}) {
  if (!source || typeof source !== 'string' || !line || line < 1) {
    return '';
  }

  const lines = source.split(/\r?\n/);
  const totalLines = lines.length;
  if (line > totalLines) {
    return '';
  }

  const linesBefore = options.linesBefore !== undefined ? options.linesBefore : 1;
  const linesAfter = options.linesAfter !== undefined ? options.linesAfter : 1;
  const caretLength = Math.max(1, options.length || 1);

  const startLine = Math.max(1, line - linesBefore);
  const endLine = Math.min(totalLines, line + linesAfter);

  const maxLineNumWidth = String(endLine).length;

  const result = [];
  for (let l = startLine; l <= endLine; l++) {
    const lineNumStr = String(l).padStart(maxLineNumWidth, ' ');
    const lineContent = lines[l - 1];
    result.push(` ${lineNumStr} | ${lineContent}`);

    if (l === line) {
      const col = Math.max(1, Math.min(column || 1, lineContent.length + 1));
      const gutterPadding = ' '.repeat(maxLineNumWidth);
      const spacePadding = ' '.repeat(col - 1);
      const carets = '^'.repeat(caretLength);
      result.push(` ${gutterPadding} | ${spacePadding}${carets}`);
    }
  }

  return result.join('\n');
}

/**
 * Computes 1-based line and column coordinates from a character index in a source string.
 * @param {string} source - The source code or template string.
 * @param {number} index - Character offset.
 * @returns {{ line: number, column: number }}
 */
export function getLineAndColumn(source, index) {
  if (!source || typeof source !== 'string' || index === undefined || index < 0) {
    return { line: 1, column: 1 };
  }
  const safeIndex = Math.min(index, source.length);
  const substring = source.slice(0, safeIndex);
  const lines = substring.split(/\r?\n/);
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

