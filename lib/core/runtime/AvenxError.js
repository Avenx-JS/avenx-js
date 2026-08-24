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
 * @property {string} ROUTER_GUARD_UNDEFINED_RETURN - AVX_W27: A navigation guard returned undefined.
 * @property {string} COMPILER_MULTIPLE_STATE_TAGS - AVX_W28: Multiple <state> tags; only the first is used.
 * @property {string} SANDBOX_VIOLATION - AVX_R15: A sandbox security violation occurred.
 * @property {string} STATE_DIRECT_REASSIGNMENT - AVX_R16: Component state was reassigned directly instead of mutated.
 * @property {string} BRIDGE_CONSTRUCTION_FAILED - AVX_R17: Failed to construct a bridge instance from a class function.
 * @property {string} REACTIVE_DEADLOCK_DETECTED - AVX_R18: Circular reactive update chain or deadlock detected.
 * @property {string} COMPILER_DEADLOCK_PARSE_FAILED - AVX_W35: Failed to parse <@deadlock> tags or attributes in template.
 * @property {string} BRIDGE_INVALID_DEFINITION - AVX_R19: bridge() received something other than a definition object.
 * @property {string} BRIDGE_RESERVED_KEY - AVX_R20: A bridge definition declares a key reserved by the Bridge API.
 * @property {string} BRIDGE_INVALID_MEMBER - AVX_R21: A bridge definition declares a top-level value outside of `state`.
 * @property {string} BRIDGE_READONLY_STATE - AVX_R22: Bridge state was assigned from outside the bridge.
 * @property {string} BRIDGE_INVALID_EVENT - AVX_R23: A bridge event name or listener has an unusable type.
 * @property {string} BRIDGE_LISTENER_ERROR - AVX_W36: A bridge event listener threw while handling an event.
 * @property {string} BRIDGE_SETUP_FAILED - AVX_R24: A bridge setup() hook threw during lazy initialization.
 * @property {string} COMPILER_BRIDGE_NOT_FOUND - AVX_C07: A component imports a bridge module that does not exist.
 * @property {string} COMPILER_BRIDGE_DUPLICATE_NAME - AVX_C08: Two bridge files resolve to the same bridge name.
 * @property {string} COMPILER_BRIDGE_UNSUPPORTED_IMPORT - AVX_C09: A bridge module imports a module the bundler cannot inline.
 * @property {string} COMPILER_BRIDGE_ISOLATED_IMPORT - AVX_C10: An isolated component imports a bridge.
 * @property {string} COMPILER_BRIDGE_CIRCULAR_IMPORT - AVX_C11: Bridge modules import each other in a cycle.
 * @property {string} COMPILER_BRIDGE_UNKNOWN_MEMBER - AVX_W37: A template reads a member that the bridge does not declare.
 * @property {string} COMPILER_BRIDGE_UNKNOWN_EVENT - AVX_W38: Code subscribes to an event the bridge never emits.
 */

/** @type {AvenxErrorCodesType} */
export const AvenxErrorCodes = {
  // Compiler Errors (AVX_C*)
  COMPILER_DIST_CREATION_FAILED: 'AVX_C01',
  COMPILER_SRC_DIR_MISSING: 'AVX_C02',
  COMPILER_DUPLICATE_COMPONENT_NAME: 'AVX_C03',
  COMPILER_CONTRACT_STATIC_VIOLATION: 'AVX_C04',
  COMPILER_CONTRACT_ISOLATED_VIOLATION: 'AVX_C05',
  COMPILER_CONTRACT_INVALID_DECLARATION: 'AVX_C06',
  COMPILER_BRIDGE_NOT_FOUND: 'AVX_C07',
  COMPILER_BRIDGE_DUPLICATE_NAME: 'AVX_C08',
  COMPILER_BRIDGE_UNSUPPORTED_IMPORT: 'AVX_C09',
  COMPILER_BRIDGE_ISOLATED_IMPORT: 'AVX_C10',
  COMPILER_BRIDGE_CIRCULAR_IMPORT: 'AVX_C11',

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
  REACTIVE_DEADLOCK_DETECTED: 'AVX_R18',
  BRIDGE_INVALID_DEFINITION: 'AVX_R19',
  BRIDGE_RESERVED_KEY: 'AVX_R20',
  BRIDGE_INVALID_MEMBER: 'AVX_R21',
  BRIDGE_READONLY_STATE: 'AVX_R22',
  BRIDGE_INVALID_EVENT: 'AVX_R23',
  BRIDGE_SETUP_FAILED: 'AVX_R24',

  // Compiler Warnings (AVX_W*)
  COMPILER_BUNDLE_SIZE_EXCEEDED: 'AVX_W01',
  COMPILER_EMPTY_TEMPLATE: 'AVX_W02',
  COMPILER_UNDECLARED_REFERENCE: 'AVX_W03',
  COMPILER_UNMATCHED_FOR_TAG: 'AVX_W04',
  COMPILER_TRANSITION_PARSE_FAILED: 'AVX_W05',
  COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED: 'AVX_W06',
  COMPILER_PREPROCESSOR_MISSING: 'AVX_W24',
  COMPILER_INVALID_CONFIG: 'AVX_W25',
  COMPONENT_METHOD_RESERVED_KEY_COLLISION: 'AVX_W26',
  COMPILER_CIRCULAR_DEPENDENCY: 'AVX_W29',
  COMPILER_DUPLICATE_ID_ATTRIBUTE: 'AVX_W30',
  COMPILER_PREPROCESSOR_FAILED: 'AVX_W31',
  COMPILER_CONTRACT_PURE_VIOLATION: 'AVX_W32',
  COMPILER_CONTRACT_DETERMINISTIC_VIOLATION: 'AVX_W33',
  COMPILER_CONTRACT_REDUNDANT: 'AVX_W34',
  COMPILER_DEADLOCK_PARSE_FAILED: 'AVX_W35',
  COMPILER_BRIDGE_UNKNOWN_MEMBER: 'AVX_W37',
  COMPILER_BRIDGE_UNKNOWN_EVENT: 'AVX_W38',

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
  ROUTER_GUARD_UNDEFINED_RETURN: 'AVX_W27',
  COMPILER_MULTIPLE_STATE_TAGS: 'AVX_W28',
  BRIDGE_LISTENER_ERROR: 'AVX_W36',
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
  [AvenxErrorCodes.BRIDGE_CONSTRUCTION_FAILED]: 'Failed to construct bridge "{0}". Constructor threw an error: {1}',
  [AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED]:
    'Circular reactive update chain detected{0}. Update chain aborted to prevent infinite loop:\n{1}',
  [AvenxErrorCodes.BRIDGE_INVALID_DEFINITION]:
    'bridge() expects a definition object, received {0}. Example: bridge({ state: { count: 0 }, increment() { this.count++; } }).',
  [AvenxErrorCodes.BRIDGE_RESERVED_KEY]:
    'Bridge definition declares "{0}", which is reserved by the Bridge API. Reserved names: {1}. Rename the member.',
  [AvenxErrorCodes.BRIDGE_INVALID_MEMBER]:
    'Bridge definition declares "{0}" as a top-level value of type {1}. Only actions (functions), getters and the reserved keys "state" and "setup" may live at the top level. Move it into the state object: bridge({ state: { {2}: ... } }).',
  [AvenxErrorCodes.BRIDGE_READONLY_STATE]:
    'Cannot assign to "{0}.{1}" from outside the bridge. Bridge state is read-only for consumers so that every mutation has a single, traceable origin. Add an action to the bridge and call it instead, e.g. {2}.',
  [AvenxErrorCodes.BRIDGE_INVALID_EVENT]:
    'Invalid bridge event {0}: expected a non-empty event name string and a listener function, received ({1}, {2}).',
  [AvenxErrorCodes.BRIDGE_SETUP_FAILED]: 'Bridge "{0}" failed during setup(): {1}',

  // Compiler Warnings (AVX_W01 - AVX_W06, AVX_W35)
  [AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED]: 'WARNING: {0} exceeds {1} KB ({2} KB)',
  [AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE]: 'Component "{0}" has an empty template.',
  [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]: 'Undeclared variable or method "{0}" referenced in template of {1}.',
  [AvenxErrorCodes.COMPILER_UNMATCHED_FOR_TAG]: 'Unmatched <@for> tags in template.',
  [AvenxErrorCodes.COMPILER_TRANSITION_PARSE_FAILED]: 'Failed to parse transition tags: {0}',
  [AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED]: 'Failed to optimize static subtrees: {0}',
  [AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING]:
    'Preprocessor module "{0}" is not installed. Falling back to raw CSS.',
  [AvenxErrorCodes.COMPILER_INVALID_CONFIG]: 'Failed to parse avenx.config.json at "{0}": {1}',
  [AvenxErrorCodes.COMPONENT_METHOD_RESERVED_KEY_COLLISION]:
    'Method name "{0}" in component "{1}" collides with a reserved lifecycle hook or instance method.',
  [AvenxErrorCodes.COMPILER_PREPROCESSOR_FAILED]: 'Error compiling {0}: {1}',
  [AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED]: 'Failed to parse <@deadlock> tag in component "{0}": {1}',
  [AvenxErrorCodes.COMPILER_BRIDGE_NOT_FOUND]:
    'Bridge import "{0}" in {1} could not be resolved to a bridge module.\nExpected a file at "{2}". Bridges discovered in this project: {3}.',
  [AvenxErrorCodes.COMPILER_BRIDGE_DUPLICATE_NAME]:
    'Duplicate bridge name(s) detected. These files resolve to the same bridge name:\n{0}\nBridge names are derived from the file name, so rename one of the files (e.g. "auth.bridge.js" -> "admin-auth.bridge.js").',
  [AvenxErrorCodes.COMPILER_BRIDGE_UNSUPPORTED_IMPORT]:
    'Bridge "{0}" imports "{1}", which the Avenx bundler cannot inline. A bridge module may only import the Avenx runtime and other *.bridge.js modules.\nMove the shared logic into a bridge, or attach it to globalThis from index.html.',
  [AvenxErrorCodes.COMPILER_BRIDGE_CIRCULAR_IMPORT]:
    'Bridge import cycle: {0}.\nBridges are initialised in dependency order, so a cycle has no valid order and would fail at load time. Break the cycle by moving the shared state into a third bridge that both import, or by passing the value as an action argument instead of reaching across.',
  [AvenxErrorCodes.COMPILER_BRIDGE_ISOLATED_IMPORT]:
    'Component "{0}" declares the "isolated" contract but imports the bridge "{1}". An isolated component may not reach outside its own state. Remove the import or drop the isolated contract.',
  [AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_MEMBER]:
    'Bridge "{0}" has no member "{1}" (used in {2}).{3}\nDeclared members: {4}.',
  [AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_EVENT]:
    'Bridge "{0}" never emits the event "{1}" (subscribed in {2}).{3}\nEmitted events: {4}.',

  // Runtime Warnings (AVX_W07 - AVX_W23)
  [AvenxErrorCodes.PAGE_ALREADY_REGISTERED]: 'Page "{0}" is already registered and will be overwritten.',
  [AvenxErrorCodes.ROUTE_PATH_MISSING_LEADING_SLASH]:
    'Route path "{0}" lacks a leading slash. This may prevent hash paths from resolving properly.',
  [AvenxErrorCodes.ROUTE_PARAM_DECODE_FAILED]: 'Failed to decode route parameter "{0}": {1}',
  [AvenxErrorCodes.ROUTE_NOT_FOUND]: 'No route defined for hash: {0}',
  [AvenxErrorCodes.ROUTE_TITLE_EVALUATION_FAILED]: 'title() threw an error: {0}',
  [AvenxErrorCodes.PAGE_PROP_EVALUATION_FAILED]: 'Failed to evaluate prop expression: {0}. Error: {1}',
  [AvenxErrorCodes.PAGE_COMPONENT_NOT_REGISTERED]: "Component '{0}' not found in registry.",
  [AvenxErrorCodes.COMPONENT_RESTORE_SLOT_CONTENT_FAILED]: 'Failed to restore default slot content. Error: {0}',
  [AvenxErrorCodes.COMPONENT_INJECT_KEY_NOT_FOUND]: 'Injected key "{0}" not found in any ancestor component.',
  [AvenxErrorCodes.SECURITY_SANITIZED_TAG]: 'Sanitized tag "<{0}>" when stripping content.',
  [AvenxErrorCodes.SECURITY_SANITIZED_ATTRIBUTE]: 'Sanitized attribute "{0}" when stripping content.',
  [AvenxErrorCodes.RENDER_LIST_EVALUATION_FAILED]: 'Failed to evaluate list expression: {0} in component <{2}>. Error: {1}',
  [AvenxErrorCodes.RENDER_KEY_EVALUATION_FAILED]: 'Failed to evaluate key expression: {0}. Error: {1}',
  [AvenxErrorCodes.RENDER_LIST_DUPLICATE_KEY]:
    'Duplicate key "{0}" detected in list expression "{1}". Appending index suffix to prevent node reuse conflict.',
  [AvenxErrorCodes.DIRECTIVE_HTML_EVALUATION_FAILED]: 'Failed to evaluate data-ax-html: {0}. Error: {1}',
  [AvenxErrorCodes.DIRECTIVE_SHOW_EVALUATION_FAILED]: 'Failed to evaluate data-ax-show: {0}. Error: {1}',
  [AvenxErrorCodes.DIRECTIVE_CLASS_EVALUATION_FAILED]: 'Failed to evaluate data-ax-class: {0}. Error: {1}',
  [AvenxErrorCodes.ROUTER_GUARD_UNDEFINED_RETURN]:
    'Navigation guard for route "{0}" returned undefined. Guards should explicitly return true, false, a redirect string, or a control object. Defaulting to allow.',
  [AvenxErrorCodes.COMPILER_MULTIPLE_STATE_TAGS]:
    'Multiple <state> tags found in component source. Only the first <state> declaration is reactive; subsequent tags are ignored.',
  [AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION]:
    'Node or component tagged with "static" contract contains dynamic expression or binding: {0}',
  [AvenxErrorCodes.COMPILER_CONTRACT_ISOLATED_VIOLATION]:
    'Isolated component "{0}" violates isolation boundary by accessing external scope or bridge: {1}',
  [AvenxErrorCodes.COMPILER_CONTRACT_INVALID_DECLARATION]:
    'Invalid contract declaration "{0}" in {1}: {2}',
  [AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION]:
    'Pure contract violation in component "{0}": expression or action contains potential side-effect: {1}',
  [AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION]:
    'Deterministic contract violation in component "{0}": contains non-deterministic expression or call: {1}',
  [AvenxErrorCodes.COMPILER_CONTRACT_REDUNDANT]:
    'Contract "{0}" is redundant in "{1}" because parent scope already enforces "{2}".',
  [AvenxErrorCodes.COMPILER_CIRCULAR_DEPENDENCY]:
    'Circular dependency detected in component imports: {0}',
  [AvenxErrorCodes.COMPILER_DUPLICATE_ID_ATTRIBUTE]:
    'Duplicate static id attribute "{0}" detected in template of {1}. Static IDs must be unique and should not be used inside loops.',
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
