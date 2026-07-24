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