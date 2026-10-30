/**
 * A set of known HTML boolean attributes.
 * @type {Set<string>}
 */

export const BOOLEAN_ATTRIBUTES = new Set([
  'checked',
  'disabled',
  'required',
  'readonly',
  'selected',
  'multiple',
  'autofocus',
  'novalidate',
  'formnovalidate',
  'hidden',
  'open',
  'reversed',
  'loop',
  'controls',
  'autoplay',
  'muted',
  'default',
  'ismap',
  'async',
  'defer',
]);

/**
 * Checks if a given attribute name is a standard HTML boolean attribute.
 * @param {string} name - The attribute name.
 * @returns {boolean} True if it is a boolean attribute.
 */
export function isBooleanAttribute(name) {
  if (!name || typeof name !== 'string') return false;
  return BOOLEAN_ATTRIBUTES.has(name.toLowerCase());
}

/**
 * The `data-ax-*` names the framework writes or reads itself, by the part
 * before any `.modifier`.
 *
 * A custom directive is any other `data-ax-*` name. Both render paths read this
 * set to tell the two apart, so a marker added elsewhere in the framework has
 * to be added here too or it will be mistaken for a directive.
 * `test/unit/reservedDirectiveNames.test.js` fails when a literal `data-ax-*`
 * name in `lib/` or `plugins/` is not listed.
 * @type {Set<string>}
 */
export const RESERVED_DIRECTIVE_NAMES = new Set([
  'as',
  'bind',
  'class',
  'comp',
  'contract',
  'deadlock',
  'deadlock-action',
  'deadlock-depth',
  'deadlock-fallback',
  'deadlock-isolated',
  'deadlock-loc',
  'deadlock-name',
  'defer',
  'defer-content',
  'defer-loading',
  'defer-placeholder',
  'defer-when',
  'deterministic',
  'dyn-attrs',
  'empty',
  'error-as',
  'error-boundary',
  'error-fallback',
  'event',
  'fallback',
  'for',
  'html',
  'if',
  'isolated',
  'key',
  'key-val',
  'link',
  'list-item',
  'memo',
  'page',
  'page-heading',
  'pure',
  'ref',
  'router-view',
  'show',
  'skip',
  'static',
  'style',
  'suspense',
  'transition',
  'validate',
  'validate-messages',
]);
