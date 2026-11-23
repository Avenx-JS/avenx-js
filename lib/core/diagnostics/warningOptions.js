import { DIAGNOSTIC_CATALOGUE } from './catalogue.js';
import { ACCESSIBILITY_RULES } from './accessibilityRules.js';

/** Categories that contain configurable warnings, derived from the catalogue. */
export const WARNING_CATEGORIES = [...new Set(
  Object.values(DIAGNOSTIC_CATALOGUE)
    .filter((diagnostic) => diagnostic.code.startsWith('AVX_W'))
    .map((diagnostic) => diagnostic.category),
)];

/** Accessibility rule names, indexed by their canonical warning code. */
export const WARNING_RULE_NAMES = Object.fromEntries(
  Object.values(ACCESSIBILITY_RULES).map((rule) => [rule.code, rule.name]),
);

/** All supported non-code keys in the warnings configuration. */
export const WARNING_GROUP_KEYS = [...WARNING_CATEGORIES, ...Object.values(WARNING_RULE_NAMES)];

/**
 * Resolve an exact code, a named rule, a category, then the default severity.
 * @param {object} warnings - Configured severity overrides.
 * @param {string} code - The canonical diagnostic code.
 * @returns {string|undefined} The selected override, if any.
 */
export function warningSeverity(warnings, code) {
  const rule = WARNING_RULE_NAMES[code];
  const category = DIAGNOSTIC_CATALOGUE[code]?.category;
  return warnings[code]
    ?? (rule ? warnings[rule] : undefined)
    ?? (category ? warnings[category] : undefined);
}
