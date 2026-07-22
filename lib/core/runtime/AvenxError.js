/**
 * @file AvenxError.js
 * @description Centralized error registry and formatting utilities for the Avenx-JS framework.
 * Defines standard error codes (AVX_C* for compiler, AVX_R* for runtime), error templates,
 * and the custom AvenxError class.
 */

/**
 * Registry of unique Avenx error/warning codes.
 * @typedef {object} AvenxErrorCodesType
 * @property {string} COMPILER_DIST_CREATION_FAILED - AVX_C01: Failed to create the build output directory.
 * @property {string} COMPILER_SRC_DIR_MISSING - AVX_C02: The source directory ('src') does not exist.
 * @property {string} MOUNT_TARGET_NOT_FOUND - AVX_R01: The specified target container element was not found in the DOM.
 * @property {string} PAGE_NOT_FOUND - AVX_R02: The requested page class was not registered with the application.
 * @property {string} COMPONENT_NOT_FOUND - AVX_R03: The requested component class was not registered with the application.
 * @property {string} COMPUTED_CIRCULAR_DEPENDENCY - AVX_R04: Circular references/loops detected in active computed property evaluations.
 * @property {string} COMPUTED_EVALUTION_FAILED - AVX_R05: An error occurred during evaluation of a computed property.
 * @property {string} ROUTER_GUARD_DENIED - AVX_R06: A navigation guard explicitly rejected the route transition.
 * @property {string} ROUTER_GUARD_ERROR - AVX_R07: An unhandled exception occurred within a route guard's canActivate method.
 * @property {string} TEMPLATE_RENDER_ERROR - AVX_R08: Failed to interpolate expression values within component template.
 * @property {string} EVENT_HANDLER_ERROR - AVX_R09: Executing an event action callback statement failed.
 * @property {string} ROUTER_GUARD_TIMEOUT - AVX_R14: A navigation guard execution timed out.
 * @property {string} SANDBOX_VIOLATION - AVX_R15: A sandbox security violation occurred.
 * @property {string} STATE_DIRECT_REASSIGNMENT - AVX_R16: Component state was reassigned directly instead of mutated.
 * @property {string} BRIDGE_CONSTRUCTION_FAILED - AVX_R17: Failed to construct a bridge instance from a class function.
 */

/** @type {AvenxErrorCodesType} */
export const AvenxErrorCodes = {
  // Compiler Errors (AVX_C*)
  COMPILER_DIST_CREATION_FAILED: 'AVX_C01',
  COMPILER_SRC_DIR_MISSING: 'AVX_C02',
  COMPILER_DUPLICATE_COMPONENT_NAME: 'AVX_C03',

  // Runtime Errors (AVX_R*)
  MOUNT_TARGET_NOT_FOUND: 'AVX_R01',
  PAGE_NOT_FOUND: 'AVX_R02',
  COMPONENT_NOT_FOUND: 'AVX_R03',
  COMPUTED_CIRCULAR_DEPENDENCY: 'AVX_R04',
  COMPUTED_EVALUTION_FAILED: 'AVX_R05',
  ROUTER_GUARD_DENIED: 'AVX_R06',
  ROUTER_GUARD_ERROR: 'AVX_R07',
  TEMPLATE_RENDER_ERROR: 'AVX_R08',
  EVENT_HANDLER_ERROR: 'AVX_R09',
  BRIDGE_ALREADY_EXISTS: 'AVX_R10',
  STATE_MUTATION_IN_UPDATE: 'AVX_R11',
  LIFECYCLE_HOOK_ERROR: 'AVX_R12',
  DOM_PARSING_FAILED: 'AVX_R13',
  ROUTER_GUARD_TIMEOUT: 'AVX_R14',
  SANDBOX_VIOLATION: 'AVX_R15',
  STATE_DIRECT_REASSIGNMENT: 'AVX_R16',
  BRIDGE_CONSTRUCTION_FAILED: 'AVX_R17',

  // Compiler Warnings (AVX_W*)
  COMPILER_BUNDLE_SIZE_EXCEEDED: 'AVX_W01',
  COMPILER_EMPTY_TEMPLATE: 'AVX_W02',
  COMPILER_UNDECLARED_REFERENCE: 'AVX_W03',
  COMPILER_UNMATCHED_FOR_TAG: 'AVX_W04',
  COMPILER_TRANSITION_PARSE_FAILED: 'AVX_W05',
  COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED: 'AVX_W06',
  COMPILER_PREPROCESSOR_MISSING: 'AVX_W24',
  COMPILER_INVALID_CONFIG: 'AVX_W25',

  // Runtime Warnings (AVX_W*)
  PAGE_ALREADY_REGISTERED: 'AVX_W07',
  ROUTE_PATH_MISSING_LEADING_SLASH: 'AVX_W08',
  ROUTE_PARAM_DECODE_FAILED: 'AVX_W09',
  ROUTE_NOT_FOUND: 'AVX_W10',
  ROUTE_TITLE_EVALUATION_FAILED: 'AVX_W11',
  PAGE_PROP_EVALUATION_FAILED: 'AVX_W12',
  PAGE_COMPONENT_NOT_REGISTERED: 'AVX_W13',
  COMPONENT_RESTORE_SLOT_CONTENT_FAILED: 'AVX_W14',
  COMPONENT_INJECT_KEY_NOT_FOUND: 'AVX_W15',
  SECURITY_SANITIZED_TAG: 'AVX_W16',
  SECURITY_SANITIZED_ATTRIBUTE: 'AVX_W17',
  RENDER_LIST_EVALUATION_FAILED: 'AVX_W18',
  RENDER_KEY_EVALUATION_FAILED: 'AVX_W19',
  RENDER_LIST_DUPLICATE_KEY: 'AVX_W20',
  DIRECTIVE_HTML_EVALUATION_FAILED: 'AVX_W21',
  DIRECTIVE_SHOW_EVALUATION_FAILED: 'AVX_W22',
  DIRECTIVE_CLASS_EVALUATION_FAILED: 'AVX_W23',
};

/**
 * Message templates mapping for each AvenxErrorCodes identifier.
 * Placeholders are specified as {0}, {1}, etc. and replaced at formatting time.
 * @type {Object<string, string>}
 */
export const AvenxErrorMessages = {
  [AvenxErrorCodes.COMPILER_DIST_CREATION_FAILED]: 'Could not create dist directory at "{0}".',
  [AvenxErrorCodes.COMPILER_SRC_DIR_MISSING]:
    '"src" directory not found at "{0}". Run "avenx init" to scaffold a project.',
  [AvenxErrorCodes.COMPILER_DUPLICATE_COMPONENT_NAME]:
    'Duplicate component name(s) detected. These files compile to the same class name:\n{0}\nFix by renaming or moving one of the files (e.g. "card.component.js" -> "profile-card.component.js").',
  [AvenxErrorCodes.MOUNT_TARGET_NOT_FOUND]: 'Mount target selector "{0}" was not found in the DOM.',
  [AvenxErrorCodes.PAGE_NOT_FOUND]: 'Page "{0}" is not registered. Ensure page class is named correctly.',
  [AvenxErrorCodes.COMPONENT_NOT_FOUND]: 'Component "{0}" is not registered. Registered components: {1}',
  [AvenxErrorCodes.COMPUTED_CIRCULAR_DEPENDENCY]: 'Circular dependency detected in computed property "{0}".',
  [AvenxErrorCodes.COMPUTED_EVALUTION_FAILED]:
    'Failed to evaluate computed property "{0}". Expression: "{1}". Error: {2}',
  [AvenxErrorCodes.ROUTER_GUARD_DENIED]: 'Navigation guard denied transition to route "{0}".',
  [AvenxErrorCodes.ROUTER_GUARD_ERROR]: 'Navigation guard threw an error during evaluation for route "{0}": {1}',
  [AvenxErrorCodes.TEMPLATE_RENDER_ERROR]: 'Failed to render interpolation expression "{0}". Error: {1}',
  [AvenxErrorCodes.EVENT_HANDLER_ERROR]: 'Event handler execution failed for statement "{0}". Error: {1}',
  [AvenxErrorCodes.BRIDGE_ALREADY_EXISTS]:
    'Bridge "{0}" is already registered. Available bridges: {1}. Suggestion: {2}',
  [AvenxErrorCodes.STATE_MUTATION_IN_UPDATE]:
    'State mutation detected during the update/render lifecycle. Avoid modifying component state inside templates, getters, computed property definitions, or lifecycle hooks like onUpdate.',
  [AvenxErrorCodes.LIFECYCLE_HOOK_ERROR]: 'Error in component "{0}" during lifecycle hook "{1}": {2}',
  [AvenxErrorCodes.DOM_PARSING_FAILED]:
    'DOM parsing failed due to malformed HTML. Parser error: {0}. HTML context: "{1}"',
  [AvenxErrorCodes.ROUTER_GUARD_TIMEOUT]: 'Navigation guard timed out after {0}ms for route "{1}".',
  [AvenxErrorCodes.SANDBOX_VIOLATION]: 'Sandbox security violation: {0}',
  [AvenxErrorCodes.STATE_DIRECT_REASSIGNMENT]:
    'Cannot reassign component state directly (e.g. "this.state = {...}"). Reassigning the entire state object replaces the reactive Proxy and breaks change detection. Mutate individual properties instead, e.g. "this.state.propertyName = value" or "Object.assign(this.state, {...})".',
  [AvenxErrorCodes.BRIDGE_CONSTRUCTION_FAILED]:
    'Failed to construct bridge "{0}". Constructor threw an error: {1}',

  // Compiler Warnings (AVX_W01 - AVX_W06)
  [AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED]: 'WARNING: {0} exceeds {1} KB ({2} KB)',
  [AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE]: 'Component "{0}" has an empty template.',
  [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]: 'Undeclared variable or method "{0}" referenced in template of {1}.',
  [AvenxErrorCodes.COMPILER_UNMATCHED_FOR_TAG]: 'Unmatched <@for> tags in template.',
  [AvenxErrorCodes.COMPILER_TRANSITION_PARSE_FAILED]: 'Failed to parse transition tags: {0}',
  [AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED]: 'Failed to optimize static subtrees: {0}',
  [AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING]: 'Preprocessor module "{0}" is not installed. Falling back to raw CSS.',
  [AvenxErrorCodes.COMPILER_INVALID_CONFIG]: 'Failed to parse avenx.config.json at "{0}": {1}',

  // Runtime Warnings (AVX_W07 - AVX_W23)
  [AvenxErrorCodes.PAGE_ALREADY_REGISTERED]: 'Page "{0}" is already registered and will be overwritten.',
  [AvenxErrorCodes.ROUTE_PATH_MISSING_LEADING_SLASH]: 'Route path "{0}" lacks a leading slash. This may prevent hash paths from resolving properly.',
  [AvenxErrorCodes.ROUTE_PARAM_DECODE_FAILED]: 'Failed to decode route parameter "{0}": {1}',
  [AvenxErrorCodes.ROUTE_NOT_FOUND]: 'No route defined for hash: {0}',
  [AvenxErrorCodes.ROUTE_TITLE_EVALUATION_FAILED]: 'title() threw an error: {0}',
  [AvenxErrorCodes.PAGE_PROP_EVALUATION_FAILED]: 'Failed to evaluate prop expression: {0}. Error: {1}',
  [AvenxErrorCodes.PAGE_COMPONENT_NOT_REGISTERED]: 'Component \'{0}\' not found in registry.',
  [AvenxErrorCodes.COMPONENT_RESTORE_SLOT_CONTENT_FAILED]: 'Failed to restore default slot content. Error: {0}',
  [AvenxErrorCodes.COMPONENT_INJECT_KEY_NOT_FOUND]: 'Injected key "{0}" not found in any ancestor component.',
  [AvenxErrorCodes.SECURITY_SANITIZED_TAG]: 'Sanitized tag "<{0}>" when stripping content.',
  [AvenxErrorCodes.SECURITY_SANITIZED_ATTRIBUTE]: 'Sanitized attribute "{0}" when stripping content.',
  [AvenxErrorCodes.RENDER_LIST_EVALUATION_FAILED]: 'Failed to evaluate list expression: {0}. Error: {1}',
  [AvenxErrorCodes.RENDER_KEY_EVALUATION_FAILED]: 'Failed to evaluate key expression: {0}. Error: {1}',
  [AvenxErrorCodes.RENDER_LIST_DUPLICATE_KEY]: 'Duplicate key "{0}" detected in list expression "{1}". Appending index suffix to prevent node reuse conflict.',
  [AvenxErrorCodes.DIRECTIVE_HTML_EVALUATION_FAILED]: 'Failed to evaluate data-ax-html: {0}. Error: {1}',
  [AvenxErrorCodes.DIRECTIVE_SHOW_EVALUATION_FAILED]: 'Failed to evaluate data-ax-show: {0}. Error: {1}',
  [AvenxErrorCodes.DIRECTIVE_CLASS_EVALUATION_FAILED]: 'Failed to evaluate data-ax-class: {0}. Error: {1}',
};

/**
 * Custom Error class representing an Avenx-JS framework error.
 * Includes structured code identifiers and formatted messages.
 * @augments Error
 */
export class AvenxError extends Error {
  /**
   * Creates an instance of AvenxError.
   * @param {string} code - The AvenxErrorCode identifier.
   * @param {...any} args - Arguments to format within the template message.
   */
  constructor(code, ...args) {
    let message = AvenxErrorMessages[code] || 'An unknown framework error occurred.';
    args.forEach((arg, idx) => {
      message = message.replace(`{${idx}}`, String(arg));
    });
    super(`[${code}] ${message}`);
    /**
     * The unique framework error code.
     * @type {string}
     */
    this.code = code;
    /**
     * Custom name identifier for the error.
     * @type {string}
     */
    this.name = 'AvenxError';
  }
}

/**
 * Formats a message template with arguments for safe non-throwing console reporting.
 * @param {string} code - The AvenxErrorCode identifier.
 * @param {...any} args - Arguments to format within the template message.
 * @returns {string} The formatted warning message containing the error code and content.
 */
export function formatMessage(code, ...args) {
  let message = AvenxErrorMessages[code] || 'An unknown framework error occurred.';
  args.forEach((arg, idx) => {
    message = message.replace(`{${idx}}`, String(arg));
  });
  return `[${code}] ${message}`;
}
