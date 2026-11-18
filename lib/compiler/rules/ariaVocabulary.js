/**
 * @file ariaVocabulary.js
 * @description Standard WAI-ARIA 1.2 dictionaries and type definitions for compiler accessibility linting.
 * @module lib/compiler/rules/ariaVocabulary
 */

/**
 * Concrete (authorable / non-abstract) WAI-ARIA 1.2 roles.
 * @type {Set<string>}
 */
export const ARIA_ROLES = new Set([
  'alert',
  'alertdialog',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

/**
 * Abstract WAI-ARIA 1.2 roles that must NOT be used by authors.
 * @type {Set<string>}
 */
export const ARIA_ABSTRACT_ROLES = new Set([
  'command',
  'composite',
  'input',
  'landmark',
  'range',
  'roletype',
  'section',
  'sectionhead',
  'select',
  'structure',
  'widget',
  'window',
]);

/**
 * Valid WAI-ARIA 1.2 attributes (states and properties).
 * @type {Set<string>}
 */
export const ARIA_ATTRIBUTES = new Set([
  'aria-activedescendant',
  'aria-atomic',
  'aria-autocomplete',
  'aria-braillelabel',
  'aria-brailleroledescription',
  'aria-busy',
  'aria-checked',
  'aria-colcount',
  'aria-colindex',
  'aria-colindextext',
  'aria-colspan',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-description',
  'aria-details',
  'aria-disabled',
  'aria-dropeffect',
  'aria-errormessage',
  'aria-expanded',
  'aria-flowto',
  'aria-grabbed',
  'aria-haspopup',
  'aria-hidden',
  'aria-invalid',
  'aria-keyshortcuts',
  'aria-label',
  'aria-labelledby',
  'aria-level',
  'aria-live',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-orientation',
  'aria-owns',
  'aria-placeholder',
  'aria-posinset',
  'aria-pressed',
  'aria-readonly',
  'aria-relevant',
  'aria-required',
  'aria-roledescription',
  'aria-rowcount',
  'aria-rowindex',
  'aria-rowindextext',
  'aria-rowspan',
  'aria-selected',
  'aria-setsize',
  'aria-sort',
  'aria-valuemax',
  'aria-valuemin',
  'aria-valuenow',
  'aria-valuetext',
]);

/**
 * Specification mapping of ARIA attributes to their expected data types and permitted values.
 * @type {Record<string, { type: 'boolean'|'tristate'|'token'|'tokenlist'|'id'|'idlist'|'integer'|'number'|'string', values?: string[] }>}
 */
export const ARIA_ATTRIBUTE_TYPES = {
  'aria-activedescendant': { type: 'id' },
  'aria-atomic': { type: 'boolean', values: ['true', 'false'] },
  'aria-autocomplete': { type: 'token', values: ['inline', 'list', 'both', 'none'] },
  'aria-braillelabel': { type: 'string' },
  'aria-brailleroledescription': { type: 'string' },
  'aria-busy': { type: 'boolean', values: ['true', 'false'] },
  'aria-checked': { type: 'tristate', values: ['true', 'false', 'mixed', 'undefined'] },
  'aria-colcount': { type: 'integer' },
  'aria-colindex': { type: 'integer' },
  'aria-colindextext': { type: 'string' },
  'aria-colspan': { type: 'integer' },
  'aria-controls': { type: 'idlist' },
  'aria-current': { type: 'token', values: ['page', 'step', 'location', 'date', 'time', 'true', 'false'] },
  'aria-describedby': { type: 'idlist' },
  'aria-description': { type: 'string' },
  'aria-details': { type: 'id' },
  'aria-disabled': { type: 'boolean', values: ['true', 'false'] },
  'aria-dropeffect': { type: 'tokenlist', values: ['copy', 'move', 'link', 'execute', 'popup', 'none'] },
  'aria-errormessage': { type: 'id' },
  'aria-expanded': { type: 'boolean', values: ['true', 'false', 'undefined'] },
  'aria-flowto': { type: 'idlist' },
  'aria-grabbed': { type: 'boolean', values: ['true', 'false', 'undefined'] },
  'aria-haspopup': { type: 'token', values: ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'] },
  'aria-hidden': { type: 'boolean', values: ['true', 'false', 'undefined'] },
  'aria-invalid': { type: 'token', values: ['grammar', 'false', 'spelling', 'true'] },
  'aria-keyshortcuts': { type: 'string' },
  'aria-label': { type: 'string' },
  'aria-labelledby': { type: 'idlist' },
  'aria-level': { type: 'integer' },
  'aria-live': { type: 'token', values: ['off', 'polite', 'assertive'] },
  'aria-modal': { type: 'boolean', values: ['true', 'false'] },
  'aria-multiline': { type: 'boolean', values: ['true', 'false'] },
  'aria-multiselectable': { type: 'boolean', values: ['true', 'false'] },
  'aria-orientation': { type: 'token', values: ['horizontal', 'vertical', 'undefined'] },
  'aria-owns': { type: 'idlist' },
  'aria-placeholder': { type: 'string' },
  'aria-posinset': { type: 'integer' },
  'aria-pressed': { type: 'tristate', values: ['true', 'false', 'mixed', 'undefined'] },
  'aria-readonly': { type: 'boolean', values: ['true', 'false'] },
  'aria-relevant': { type: 'tokenlist', values: ['additions', 'all', 'removals', 'text'] },
  'aria-required': { type: 'boolean', values: ['true', 'false'] },
  'aria-roledescription': { type: 'string' },
  'aria-rowcount': { type: 'integer' },
  'aria-rowindex': { type: 'integer' },
  'aria-rowindextext': { type: 'string' },
  'aria-rowspan': { type: 'integer' },
  'aria-selected': { type: 'boolean', values: ['true', 'false', 'undefined'] },
  'aria-setsize': { type: 'integer' },
  'aria-sort': { type: 'token', values: ['ascending', 'descending', 'none', 'other'] },
  'aria-valuemax': { type: 'number' },
  'aria-valuemin': { type: 'number' },
  'aria-valuenow': { type: 'number' },
  'aria-valuetext': { type: 'string' },
};

/**
 * Shorthand mapping of ARIA attributes to their expected type name string.
 * @type {Record<string, string>}
 */
export const ARIA_ATTRIBUTE_TYPE_NAMES = Object.freeze(
  Object.fromEntries(
    Object.entries(ARIA_ATTRIBUTE_TYPES).map(([attr, def]) => [attr, def.type])
  )
);

/** Alias for ARIA_ROLES */
export const VALID_ARIA_ROLES = ARIA_ROLES;

/** Alias for ARIA_ATTRIBUTES */
export const VALID_ARIA_ATTRIBUTES = ARIA_ATTRIBUTES;

/** Alias for ARIA_ATTRIBUTE_TYPES */
export const ARIA_ATTRIBUTE_DEFINITIONS = ARIA_ATTRIBUTE_TYPES;

/**
 * Checks whether a given role string is a valid non-abstract WAI-ARIA role.
 * @param {string} role
 * @returns {boolean}
 */
export function isValidAriaRole(role) {
  if (typeof role !== 'string') return false;
  const trimmed = role.trim();
  if (!trimmed) return false;
  return ARIA_ROLES.has(trimmed);
}

/**
 * Checks whether an attribute name is a valid WAI-ARIA attribute.
 * @param {string} attributeName
 * @returns {boolean}
 */
export function isValidAriaAttribute(attributeName) {
  if (typeof attributeName !== 'string') return false;
  return ARIA_ATTRIBUTES.has(attributeName.toLowerCase().trim());
}

/**
 * Validates an attribute value against its expected WAI-ARIA type definition.
 * Returns true if valid, false if invalid, or true if the attribute is unknown or dynamic.
 * @param {string} attributeName
 * @param {string} value
 * @returns {boolean}
 */
export function isValidAriaValue(attributeName, value) {
  if (typeof attributeName !== 'string' || typeof value !== 'string') return true;
  const def = ARIA_ATTRIBUTE_TYPES[attributeName.toLowerCase().trim()];
  if (!def) return true;

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  switch (def.type) {
    case 'boolean':
      return lower === 'true' || lower === 'false' || (def.values?.includes('undefined') && lower === 'undefined');
    case 'tristate':
      return lower === 'true' || lower === 'false' || lower === 'mixed' || lower === 'undefined';
    case 'token':
      return def.values ? def.values.includes(lower) : true;
    case 'tokenlist': {
      if (!trimmed) return false;
      const tokens = trimmed.split(/\s+/).map((t) => t.toLowerCase());
      return tokens.every((token) => def.values && def.values.includes(token));
    }
    case 'integer':
      return /^-?\d+$/.test(trimmed);
    case 'number':
      return /^-?\d+(\.\d+)?$/.test(trimmed);
    case 'id':
    case 'idlist':
    case 'string':
    default:
      return true;
  }
}
