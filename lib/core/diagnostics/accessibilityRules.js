import { AvenxErrorCodes } from '../runtime/AvenxError.js';

/**
 * Built-in accessibility warning codes and rule identifiers.
 */
export const ACCESSIBILITY_RULES = {
  IMAGE_ALT: {
    code: AvenxErrorCodes.COMPILER_A11Y_IMAGE_ALT,
    name: 'img-alt',
  },
  INTERACTIVE_ROLE: {
    code: AvenxErrorCodes.COMPILER_A11Y_INTERACTIVE_ROLE,
    name: 'interactive-role',
  },
  ANCHOR_HREF: {
    code: AvenxErrorCodes.COMPILER_A11Y_ANCHOR_HREF,
    name: 'anchor-href',
  },
  FORM_LABEL: {
    code: AvenxErrorCodes.COMPILER_A11Y_FORM_LABEL,
    name: 'form-control-label',
  },
  BUTTON_NAME: {
    code: AvenxErrorCodes.COMPILER_A11Y_BUTTON_NAME,
    name: 'button-name',
  },
  POSITIVE_TABINDEX: {
    code: AvenxErrorCodes.COMPILER_A11Y_POSITIVE_TABINDEX,
    name: 'positive-tabindex',
  },
  ARIA_UNKNOWN_ROLE: {
    code: AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ROLE,
    name: 'aria-unknown-role',
  },
  ARIA_UNKNOWN_ATTRIBUTE: {
    code: AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ATTRIBUTE,
    name: 'aria-unknown-attribute',
  },
  ARIA_INVALID_VALUE: {
    code: AvenxErrorCodes.COMPILER_A11Y_ARIA_INVALID_VALUE,
    name: 'aria-invalid-value',
  },
  ARIA_HIDDEN_FOCUSABLE: {
    code: AvenxErrorCodes.COMPILER_A11Y_ARIA_HIDDEN_FOCUSABLE,
    name: 'aria-hidden-focusable',
  },
};

/**
 * All warning codes belonging to the static accessibility rules pass.
 * @type {Set<string>}
 */
export const A11Y_WARNING_CODES = new Set(
  Object.values(ACCESSIBILITY_RULES).map((rule) => rule.code)
);

