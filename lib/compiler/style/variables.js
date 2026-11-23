import path from 'path';
import { AvenxErrorCodes, formatMessage } from '../../core/runtime/AvenxError.js';
import { getLineAndColumn } from '../errors/index.js';
import { reportWarning } from '../utils/warningReporter.js';
import { getClosestKey } from '../../config.js';

const STANDARD_AT_RULES = new Set([
  '@media',
  '@supports',
  '@keyframes',
  '@font-face',
  '@layer',
  '@container',
  '@import',
  '@charset',
  '@namespace',
  '@property',
  '@page',
  '@scope',
  '@starting-style',
  '@counter-style',
  '@document',
]);

/**
 * Turns a stylesheet path into the form a warning should show: relative to the
 * working directory when the stylesheet sits under it, absolute otherwise. A
 * build almost always runs from the project root, so the common case reads as
 * the path the reader sees in their editor rather than a machine-specific one.
 * @param {string} sourceFile - The stylesheet path as the compiler knows it.
 * @returns {string} The path to name in a diagnostic, or 'the stylesheet'.
 */
function displayStylesheetPath(sourceFile) {
  if (!sourceFile) {
    return 'the stylesheet';
  }
  const relative = path.relative(process.cwd(), sourceFile);
  const inside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  return (inside ? relative : sourceFile).split(path.sep).join('/');
}

/**
 * Adds a declaration to the current build.
 * @param {object} cssVariables - Declaration table.
 * @param {string} name - Variable name without @.
 * @param {string} value - Variable value.
 * @returns {void} The result.
 */
export function addVariable(cssVariables, name, value) {
  cssVariables[name] = value;
}

/**
 * Substitutes declared @def variables and reports unresolved references.
 * @param {object} cssVariables - Declaration table.
 * @param {object|null} config - Diagnostic configuration.
 * @param {string} cssContent - Authored CSS.
 * @param {string} [sourceFile] - Diagnostic source path.
 * @returns {string} The result.
 */
export function applyVariables(cssVariables, config, cssContent, sourceFile = '') {
  let content = cssContent;
  const sortedVars = Object.entries(cssVariables).sort((a, b) => b[0].length - a[0].length);

  for (const [varName, varValue] of sortedVars) {
    const varRegex = new RegExp(`@${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
    content = content.replace(varRegex, varValue);
  }

  // --- NEW: Check for unresolved @def variables ---
  const remainingAtTokens = content.matchAll(/@[\w-]+/g);
  const knownVarNames = Object.keys(cssVariables);
  const stylesheetPath = displayStylesheetPath(sourceFile);

  for (const match of remainingAtTokens) {
    const token = match[0];
    if (STANDARD_AT_RULES.has(token.toLowerCase())) {
      continue;
    }

    const varNameWithoutAt = token.slice(1);
    const closest = getClosestKey(varNameWithoutAt, knownVarNames);
    const suggestion = closest ? ` Did you mean "@${closest}"?` : '';
    const { line, column } = getLineAndColumn(content, match.index);

    reportWarning(
      AvenxErrorCodes.COMPILER_UNRESOLVED_DEF_REFERENCE,
      formatMessage(
        AvenxErrorCodes.COMPILER_UNRESOLVED_DEF_REFERENCE,
        token,
        stylesheetPath,
        suggestion,
      ),
      config,
      { source: content, line, column, filename: stylesheetPath },
    );
  }

  return content;
}
