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
 */

/** @type {AvenxErrorCodesType} */
export const AvenxErrorCodes = {
  // Compiler Errors (AVX_C*)
  COMPILER_DIST_CREATION_FAILED: 'AVX_C01',
  COMPILER_SRC_DIR_MISSING: 'AVX_C02',

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
