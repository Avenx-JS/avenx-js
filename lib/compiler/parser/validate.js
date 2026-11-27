/**
 * @file validate.js
 * @description Template validation and front-end diagnostics entry point.
 */
import { validateAccessibility as runAccessibilityRules } from '../rules/accessibility.js';

export {
  frontEndLocation,
  templateOffsetToContentOffset,
  locateTemplateIdentifier,
} from './validate/locations.js';

export {
  assertDeclarationsTerminated,
  reportFrontEndDiagnostics,
  assertFrontEndComplete,
  reportUnterminatedInterpolations,
} from './validate/frontEnd.js';

export {
  validateReconciliationMarkers,
  validateDeferTriggers,
  assertWellFormedTemplate,
  validateComponentTags,
} from './validate/structure.js';

export {
  validateEventHandlerAttributes,
  validateDynamicAttributeBindings,
} from './validate/attributes.js';

export { validateTemplate } from './validate/expressions.js';

export {
  formatDollarMemberSuggestion,
  validateActionBareDollarMembers,
  validateBareDollarMembers,
} from './validate/dollarMembers.js';

/**
 * Checks template accessibility rules (AVX_W65–AVX_W75).
 * @param {string} template - Preprocessed template markup.
 * @param {string} filePath - Component file path.
 * @param {string} name - Component class name.
 * @param {object|null} [config] - Resolved project config.
 */
export function validateAccessibility(template, filePath, name, config = null) {
  return runAccessibilityRules(template, filePath, name, config);
}
