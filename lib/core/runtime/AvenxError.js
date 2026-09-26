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
 * @property {string} REACTIVE_DEADLOCK_DETECTED - AVX_R18: Circular reactive update chain or deadlock detected.
 * @property {string} COMPILER_DEADLOCK_PARSE_FAILED - AVX_W35: Failed to parse <@deadlock> tags or attributes in template.
 * @property {string} BRIDGE_INVALID_DEFINITION - AVX_R19: bridge() received something other than a definition object.
 * @property {string} BRIDGE_RESERVED_KEY - AVX_R20: A bridge definition declares a key reserved by the Bridge API.
 * @property {string} BRIDGE_INVALID_MEMBER - AVX_R21: A bridge definition declares a top-level value outside of `state`.
 * @property {string} BRIDGE_READONLY_STATE - AVX_R22: Bridge state was assigned from outside the bridge.
 * @property {string} BRIDGE_INVALID_EVENT - AVX_R23: A bridge event name or listener has an unusable type.
 * @property {string} BRIDGE_LISTENER_ERROR - AVX_W36: A bridge event listener threw while handling an event.
 * @property {string} BRIDGE_SETUP_FAILED - AVX_R24: A bridge setup() hook threw during lazy initialization.
 * @property {string} TRACE_UNREADABLE - AVX_R25: A trace could not be read by this build.
 * @property {string} TRACE_NOT_DETERMINISTIC - AVX_R26: A best-effort trace was replayed without opting in.
 * @property {string} TRACE_REPLAY_DIVERGED - AVX_R27: Replay did not reproduce the recorded session.
 * @property {string} TRACE_REPLAY_FAILED - AVX_R28: A replay could not be set up.
 * @property {string} TRANSACTION_REWIND_FAILED - AVX_R29: A rewind could not restore every path it journaled.
 * @property {string} COMPONENT_INVALID_NAME - AVX_R30: A component registration received an invalid component name.
 * @property {string} COMPONENT_INVALID_CLASS - AVX_R31: A component registration received an invalid component class.
 * @property {string} EXPRESSION_UNSUPPORTED - AVX_R32: A template expression is outside the supported expression language.
 * @property {string} COMPILER_BRIDGE_NOT_FOUND - AVX_C07: A component imports a bridge module that does not exist.
 * @property {string} COMPILER_BRIDGE_DUPLICATE_NAME - AVX_C08: Two bridge files resolve to the same bridge name.
 * @property {string} COMPILER_BRIDGE_UNSUPPORTED_IMPORT - AVX_C09: Retired. A bridge may import any module the bundler can resolve; an unresolvable one is AVX_C17.
 * @property {string} COMPILER_BRIDGE_ISOLATED_IMPORT - AVX_C10: An isolated component imports a bridge.
 * @property {string} COMPILER_BRIDGE_CIRCULAR_IMPORT - AVX_C11: Bridge modules import each other in a cycle.
 * @property {string} COMPILER_BRIDGE_INVALID_MODULE - AVX_C12: A *.bridge.js file is not built on the bridge() factory.
 * @property {string} COMPILER_RUNTIME_MISSING - AVX_C13: Retired. There is no prebuilt runtime; a missing install surfaces as AVX_C17.
 * @property {string} COMPILER_HOOK_FAILED - AVX_C14: A configured build lifecycle hook exited non-zero.
 * @property {string} COMPILER_INVALID_OUTPUT - AVX_C15: The compiler produced JavaScript that does not parse.
 * @property {string} COMPILER_DUPLICATE_BUNDLE_BINDING - AVX_C16: Two modules publish the same bundle-scope name.
 * @property {string} COMPILER_UNRESOLVED_IMPORT - AVX_C17: An import names a module that cannot be found.
 * @property {string} COMPILER_MISSING_EXPORT - AVX_C18: An import names something a module does not export.
 * @property {string} COMPILER_MODULE_UNREADABLE - AVX_C19: A module's import or export declarations could not be read.
 * @property {string} COMPILER_BUNDLE_CYCLE - AVX_C20: A module cycle carries a binding that cannot cross it.
 * @property {string} COMPILER_MISSING_RUNTIME_CAPABILITY - AVX_C23: The build linked a runtime capability the emitted bundle does not carry.
 * @property {string} COMPONENT_RENDER_ABORTED - AVX_R33: A component failed to render and no handler claimed the error.
 * @property {string} RENDERER_UNAVAILABLE - AVX_R34: A component needs a rendering engine this bundle does not carry.
 * @property {string} SECURITY_BLOCKED_EVENT_ATTRIBUTE - AVX_R35: The runtime refused to set an inline event-handler attribute.
 * @property {string} COMPILER_BRIDGE_UNKNOWN_MEMBER - AVX_W37: A template reads a member that the bridge does not declare.
 * @property {string} COMPILER_BRIDGE_UNKNOWN_EVENT - AVX_W38: Code subscribes to an event the bridge never emits.
 * @property {string} ATLAS_UNREAD_STATE - AVX_W40: Declared state that nothing in the application reads.
 * @property {string} ATLAS_UNREACHABLE_ACTION - AVX_W41: An action no supported invocation surface can reach.
 * @property {string} RENDER_LIST_INVALID_SOURCE - AVX_W39: A list expression evaluates to a non-iterable value.
 * @property {string} COMPILER_TRANSACTION_UNBOUNDED - AVX_W42: An atomic action's write set could not be resolved completely.
 * @property {string} COMPILER_TRANSACTION_IRREVERSIBLE - AVX_W43: An atomic action performs an effect a rewind cannot undo.
 * @property {string} COMPILER_TRANSACTION_OVERLAP - AVX_W44: Two atomic actions write the same state.
 * @property {string} COMPILER_UNRESOLVED_COMPONENT_REFERENCE - AVX_W46: A PascalCase template tag resolves to no registered component, built-in, or known HTML/SVG element.
 * @property {string} COMPILER_RENDER_NOT_COMPILED - AVX_W47: A template could not be compiled to a render program and falls back to the string renderer.
 * @property {string} COMPILER_EXPRESSION_NOT_COMPILED - AVX_W48: A development build contains an expression the code generator could not compile.
 * @property {string} COMPILER_EXPRESSION_NOT_EXECUTABLE - AVX_C27: A production build contains an expression the code generator could not compile.
 * @property {string} COMPILER_BOUND_EVENT_ATTRIBUTE - AVX_C28: An interpolated on* handler would run a value as code; use @event.
 * @property {string} COMPILER_INTERPOLATED_DYNAMIC_ATTRIBUTE - AVX_C29: A dynamic attribute binding, :[name]="value", has {{ }} in one of its slots; both are expressions.
 * @property {string} COMPILER_UNHANDLED_AST_NODE - AVX_C30: A compiler pass reached a template AST node type it has no branch for.
 * @property {string} COMPILER_INLINE_EVENT_ATTRIBUTE - AVX_W52: A static inline on* handler bypasses the event system and a strict CSP.
 * @property {string} COMPILER_EXPRESSION_REFUSED - AVX_C21: An expression names something the sandbox forbids.
 * @property {string} COMPILER_COMPILED_ONLY_CONSTRUCT - AVX_C22: A template that cannot compile uses a construct only the compiled renderer implements.
 * @property {string} COMPILER_INVALID_STYLE_DIRECTIVE - AVX_C24: An `@css` attribute or `<@css />` tag does not name a style block.
 * @property {string} COMPILER_TEMPLATE_REWRITE_INCOMPLETE - AVX_C25: A directive the template front-end rewrites survived rewriting.
 * @property {string} COMPILER_MALFORMED_TEMPLATE - AVX_C26: A tag or comment in a template is never terminated.
 * @property {string} COMPILER_UNKNOWN_STYLE_BLOCK - AVX_W49: A template names a style block its stylesheet does not declare.
 * @property {string} COMPILER_STYLE_DIRECTIVE_NO_TARGET - AVX_W50: A `<@css />` tag has no element to style.
 * @property {string} COMPILER_STATE_NOT_LITERAL - AVX_W51: A bracketed `<state>` initialiser is not a constant literal and stays a string.
 * @property {string} ATLAS_NO_REACHABLE_PAGE - AVX_W53: The application compiles pages that no route names and no mountPage() call mounts.
 * @property {string} COMPILER_UNTERMINATED_INTERPOLATION - AVX_W54: An interpolation is opened in a template and never closed.
 * @property {string} COMPILER_UNUSED_STYLE_BLOCK - AVX_W55: A stylesheet declares a style block no template names, so it is not emitted.
 * @property {string} ATLAS_UNREGISTERED_COMPONENT - AVX_W56: A template renders a component the application never registers.
 * @property {string} COMPONENT_NESTING_LIMIT - AVX_R36: Child mounting stopped at the nesting limit, so deeper components were not mounted.
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
  COMPILER_BRIDGE_INVALID_MODULE: 'AVX_C12',
  COMPILER_RUNTIME_MISSING: 'AVX_C13',
  COMPILER_HOOK_FAILED: 'AVX_C14',
  COMPILER_INVALID_OUTPUT: 'AVX_C15',
  COMPILER_DUPLICATE_BUNDLE_BINDING: 'AVX_C16',
  COMPILER_UNRESOLVED_IMPORT: 'AVX_C17',
  COMPILER_MISSING_EXPORT: 'AVX_C18',
  COMPILER_MODULE_UNREADABLE: 'AVX_C19',
  COMPILER_BUNDLE_CYCLE: 'AVX_C20',
  COMPILER_MISSING_RUNTIME_CAPABILITY: 'AVX_C23',

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
  REACTIVE_DEADLOCK_DETECTED: 'AVX_R18',
  BRIDGE_INVALID_DEFINITION: 'AVX_R19',
  BRIDGE_RESERVED_KEY: 'AVX_R20',
  BRIDGE_INVALID_MEMBER: 'AVX_R21',
  BRIDGE_READONLY_STATE: 'AVX_R22',
  BRIDGE_INVALID_EVENT: 'AVX_R23',
  BRIDGE_SETUP_FAILED: 'AVX_R24',
  COMPONENT_RENDER_ABORTED: 'AVX_R33',
  RENDERER_UNAVAILABLE: 'AVX_R34',
  SECURITY_BLOCKED_EVENT_ATTRIBUTE: 'AVX_R35',
  TRACE_UNREADABLE: 'AVX_R25',
  TRACE_NOT_DETERMINISTIC: 'AVX_R26',
  TRACE_REPLAY_DIVERGED: 'AVX_R27',
  TRACE_REPLAY_FAILED: 'AVX_R28',
  TRANSACTION_REWIND_FAILED: 'AVX_R29',

  // Component Registration Errors
  COMPONENT_INVALID_NAME: 'AVX_R30',
  COMPONENT_INVALID_CLASS: 'AVX_R31',
  EXPRESSION_UNSUPPORTED: 'AVX_R32',

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
  ATLAS_UNREAD_STATE: 'AVX_W40',
  ATLAS_UNREACHABLE_ACTION: 'AVX_W41',
  COMPILER_TRANSACTION_UNBOUNDED: 'AVX_W42',
  COMPILER_TRANSACTION_IRREVERSIBLE: 'AVX_W43',
  COMPILER_TRANSACTION_OVERLAP: 'AVX_W44',
  COMPILER_UNRESOLVED_COMPONENT_REFERENCE: 'AVX_W46',
  COMPILER_RENDER_NOT_COMPILED: 'AVX_W47',
  COMPILER_EXPRESSION_NOT_COMPILED: 'AVX_W48',
  COMPILER_EXPRESSION_REFUSED: 'AVX_C21',
  COMPILER_COMPILED_ONLY_CONSTRUCT: 'AVX_C22',
  COMPILER_INVALID_STYLE_DIRECTIVE: 'AVX_C24',
  COMPILER_TEMPLATE_REWRITE_INCOMPLETE: 'AVX_C25',
  COMPILER_MALFORMED_TEMPLATE: 'AVX_C26',
  COMPILER_EXPRESSION_NOT_EXECUTABLE: 'AVX_C27',
  COMPILER_BOUND_EVENT_ATTRIBUTE: 'AVX_C28',
  COMPILER_INTERPOLATED_DYNAMIC_ATTRIBUTE: 'AVX_C29',
  COMPILER_UNHANDLED_AST_NODE: 'AVX_C30',
  COMPILER_INLINE_EVENT_ATTRIBUTE: 'AVX_W52',
  COMPILER_UNKNOWN_STYLE_BLOCK: 'AVX_W49',
  COMPILER_STYLE_DIRECTIVE_NO_TARGET: 'AVX_W50',
  COMPILER_STATE_NOT_LITERAL: 'AVX_W51',
  ATLAS_NO_REACHABLE_PAGE: 'AVX_W53',
  COMPILER_UNTERMINATED_INTERPOLATION: 'AVX_W54',
  COMPILER_UNUSED_STYLE_BLOCK: 'AVX_W55',
  ATLAS_UNREGISTERED_COMPONENT: 'AVX_W56',
  COMPONENT_NESTING_LIMIT: 'AVX_R36',

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
  SECURITY_BLOCKED_URL: 'AVX_W45',
  RENDER_LIST_EVALUATION_FAILED: 'AVX_W18',
  RENDER_KEY_EVALUATION_FAILED: 'AVX_W19',
  RENDER_LIST_DUPLICATE_KEY: 'AVX_W20',
  DIRECTIVE_HTML_EVALUATION_FAILED: 'AVX_W21',
  DIRECTIVE_SHOW_EVALUATION_FAILED: 'AVX_W22',
  DIRECTIVE_CLASS_EVALUATION_FAILED: 'AVX_W23',
  ROUTER_GUARD_UNDEFINED_RETURN: 'AVX_W27',
  COMPILER_MULTIPLE_STATE_TAGS: 'AVX_W28',
  BRIDGE_LISTENER_ERROR: 'AVX_W36',
  RENDER_LIST_INVALID_SOURCE: 'AVX_W39',
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
  [AvenxErrorCodes.ROUTER_GUARD_ERROR]:
    'Navigation guard threw an error during evaluation for route "{0}": {1}',
  [AvenxErrorCodes.TEMPLATE_RENDER_ERROR]:
    'Failed to render interpolation expression "{0}". Error: {1}',
  [AvenxErrorCodes.EVENT_HANDLER_ERROR]:
    'Event handler execution failed for statement "{0}". Error: {1}',

  [AvenxErrorCodes.BRIDGE_ALREADY_EXISTS]:
    'Bridge "{0}" is already registered. Available bridges: {1}. Suggestion: {2}',
  [AvenxErrorCodes.STATE_MUTATION_IN_UPDATE]:
    'State mutation detected during the update/render lifecycle. Avoid modifying component state inside templates, getters, computed property definitions, or lifecycle hooks like onUpdate.',
  [AvenxErrorCodes.LIFECYCLE_HOOK_ERROR]:
    'Error in component "{0}" during lifecycle hook "{1}": {2}',
  [AvenxErrorCodes.DOM_PARSING_FAILED]:
    'DOM parsing failed due to malformed HTML. Parser error: {0}. HTML context: "{1}"',
  [AvenxErrorCodes.ROUTER_GUARD_TIMEOUT]:
    'Navigation guard timed out after {0}ms for route "{1}".',
  [AvenxErrorCodes.SANDBOX_VIOLATION]:
    'Sandbox security violation: {0}',
  [AvenxErrorCodes.RENDERER_UNAVAILABLE]:
    '<{0}> needs {1}, and this bundle does not contain it.\n\nA template the compiler could not lower keeps the string renderer, and the build links that renderer when it reports AVX_W47. Reaching this means the two disagreed: either this component was compiled by a different build than the one that linked this bundle, or the renderer was linked and its registry was split by the same file being bundled twice. Rebuild from a clean dist/. If it persists, run "avenx build" and check that AVX_W47 is reported -- a build that reports it and still produces this is a compiler defect worth filing.',
  [AvenxErrorCodes.COMPONENT_RENDER_ABORTED]:
    '<{0}> failed to render and nothing handled the error, so it is showing nothing.\n  during: {1}\n  cause: {2}\n\nThe element is mounted and empty. Handle this where it belongs -- an onErrorCaptured hook on this component or an ancestor, an <@errorBoundary> around the part that can fail, or app.onError() for the whole application -- or fix the cause above. This message is what an unhandled render failure looks like; it is not raised again once something claims the error.',
  [AvenxErrorCodes.STATE_DIRECT_REASSIGNMENT]:
    'Cannot reassign component state directly (e.g. "this.state = {...}"). Reassigning the entire state object replaces the reactive Proxy and breaks change detection. Mutate individual properties instead, e.g. "this.state.propertyName = value" or "Object.assign(this.state, {...})".',
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
  [AvenxErrorCodes.BRIDGE_SETUP_FAILED]:
    'Bridge "{0}" failed during setup(): {1}',

  [AvenxErrorCodes.TRACE_UNREADABLE]:
    'This trace cannot be read: {0}',
  [AvenxErrorCodes.TRACE_NOT_DETERMINISTIC]:
    'Refusing to replay a best-effort trace as if it were reproducible: {0}\n\nPass { allowBestEffort: true } to replay it anyway. The result will report what diverged rather than claiming a pass.',
  [AvenxErrorCodes.TRACE_REPLAY_DIVERGED]: '{0}',
  [AvenxErrorCodes.TRACE_REPLAY_FAILED]:
    'Replay could not start: {0}',
  [AvenxErrorCodes.TRANSACTION_REWIND_FAILED]:
    'Rewind of the atomic action "{0}" left {1} path(s) unrestored:\n{2}\nThe "{3}" conflict policy refuses to overwrite a value the transaction did not write. Everything else it journaled was restored.',

  // Component registration errors
  [AvenxErrorCodes.COMPONENT_INVALID_NAME]:
    'Invalid component name "{0}". Component names must be non-empty strings.',

  [AvenxErrorCodes.COMPONENT_INVALID_CLASS]:
    'Invalid component class for "{0}". Expected a constructor extending AvenxComponent, received "{1}".',
  [AvenxErrorCodes.EXPRESSION_UNSUPPORTED]:
    'The expression "{0}" is outside the supported template expression language: {1}\n\nTemplate expressions, computed values and directive bindings are evaluated by Avenx rather than by the JavaScript engine. That is what lets them run under a Content-Security-Policy with no \'unsafe-eval\', and what lets every property access be checked. Statements, function declarations, await and destructuring are not expressions -- move that logic into an <action> and call it from the template.',

  // Compiler Warnings
  [AvenxErrorCodes.COMPILER_BUNDLE_SIZE_EXCEEDED]:
    'WARNING: {0} exceeds {1} KB ({2} KB)',
  [AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE]:
    'Component "{0}" has an empty template.',
  [AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE]:
    'Undeclared variable or method "{0}" referenced in template of {1}.',
  [AvenxErrorCodes.COMPILER_UNMATCHED_FOR_TAG]:
    'Unmatched <@for> tags in template.',
  [AvenxErrorCodes.COMPILER_TRANSITION_PARSE_FAILED]:
    'Failed to parse transition tags: {0}',
  [AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED]:
    'Failed to optimize static subtrees: {0}',
  [AvenxErrorCodes.COMPILER_PREPROCESSOR_MISSING]:
    'Preprocessor module "{0}" is not installed. Falling back to raw CSS.',
  [AvenxErrorCodes.COMPILER_INVALID_CONFIG]:
    'Failed to parse avenx.config.json at "{0}": {1}',
  [AvenxErrorCodes.COMPONENT_METHOD_RESERVED_KEY_COLLISION]:
    'Method name "{0}" in component "{1}" collides with a reserved instance method (mount, unmount, update, destroy or scheduleUpdate).\nThese are framework methods; an action or method of the same name would shadow one. Rename it. Lifecycle hooks (onMount, onUnmount, ...) are not reserved -- declaring one as an <action> is the supported way to define it.',
  [AvenxErrorCodes.COMPILER_PREPROCESSOR_FAILED]:
    'Error compiling {0}: {1}',
  [AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED]:
    'Failed to parse <@deadlock> tag in component "{0}": {1}',
  [AvenxErrorCodes.COMPILER_BRIDGE_NOT_FOUND]:
    'Bridge import "{0}" in {1} could not be resolved to a bridge module.\nExpected a file at "{2}". Bridges discovered in this project: {3}.',
  [AvenxErrorCodes.COMPILER_BRIDGE_DUPLICATE_NAME]:
    'Duplicate bridge name(s) detected. These files resolve to the same bridge name:\n{0}\nBridge names are derived from the file name, so rename one of the files (e.g. "auth.bridge.js" -> "admin-auth.bridge.js").',
  [AvenxErrorCodes.COMPILER_UNRESOLVED_IMPORT]:
    'Cannot resolve "{0}" imported by {1}.\n{2}\n\nThe build stops here rather than dropping the import: a bundle missing one of its modules starts and then fails at the moment the code runs.',
  [AvenxErrorCodes.COMPILER_MISSING_EXPORT]:
    '{0} {1}\n\nImported by {2}.',
  [AvenxErrorCodes.COMPILER_MODULE_UNREADABLE]:
    'Could not read the import and export declarations of {0}: {1}',
  [AvenxErrorCodes.COMPILER_BUNDLE_CYCLE]:
    '{0}\n\nIn {1}.',
  // Retired when the bundler replaced the concatenator. A bridge may now import
  // anything that resolves; the message is kept so `avenx explain AVX_C09`
  // still answers for anyone reading an older build log.
  [AvenxErrorCodes.COMPILER_BRIDGE_UNSUPPORTED_IMPORT]:
    'Bridge "{0}" imports "{1}", which the Avenx bundler could not inline. This no longer happens: a bridge may import any module the bundler can resolve, and an import that resolves to nothing is reported as AVX_C17 instead.',
  [AvenxErrorCodes.COMPILER_BRIDGE_ISOLATED_IMPORT]:
    'Component "{0}" declares the "isolated" contract but imports the bridge "{1}". An isolated component may not reach outside its own state. Remove the import or drop the isolated contract.',
  [AvenxErrorCodes.COMPILER_BRIDGE_CIRCULAR_IMPORT]:
    'Bridge import cycle: {0}.\nBridges are initialised in dependency order, so a cycle has no valid order and would fail at load time. Break the cycle by moving the shared state into a third bridge that both import, or by passing the value as an action argument instead of reaching across.',
  [AvenxErrorCodes.COMPILER_BRIDGE_INVALID_MODULE]:
    '"{0}" is not a bridge module. A bridge imports the bridge() factory from the Avenx runtime and exports the definition it returns:\n\n  import { bridge } from \'avenx-core/runtime\';\n\n  export default bridge({ state: { /* ... */ } });\n\nRename the file if it is not meant to be a bridge.',
  [AvenxErrorCodes.COMPILER_RUNTIME_MISSING]:
    'The Avenx runtime bundle "dist/{0}" is missing. Reinstall avenx-core, or run "npm run build" if you are working inside the framework repository.',
  [AvenxErrorCodes.COMPILER_HOOK_FAILED]:
    'The {0} hook failed: {1}\nCommand: {2}\nThe build is aborted because a lifecycle hook is part of it.',
  [AvenxErrorCodes.COMPILER_INVALID_OUTPUT]:
    'The compiler produced "{0}", and it is not valid JavaScript: {1}\n  line {2}: {3}\n\nThis is a compiler defect, not a mistake in your source. Nothing was written to the output directory, so the previous build is still in place. Please report it with the source that triggered it.',
  [AvenxErrorCodes.COMPILER_MISSING_RUNTIME_CAPABILITY]:
    'The build decided this application needs {0}, and the bundle it produced does not contain it.\n  reason: {1}\n  expected to find: {2}\n\nThis is a compiler defect, not a mistake in your source. Nothing was written to the output directory, so the previous build is still in place. The most likely cause is that the same runtime file was reached by two different paths and linked twice, which splits the registry the capability installs itself into; a symlinked avenx-core (npm link, a file: dependency, pnpm or a workspace) is how that usually happens. Please report it with the source that triggered it.',
  [AvenxErrorCodes.COMPILER_DUPLICATE_BUNDLE_BINDING]:
    'Two modules both compile to the bundle-scope name "{0}":\n  {1}\n  {2}\nA compiled application is one script, so each module may publish only one uniquely named binding. Rename the class or the file so the two no longer collide.',
  [AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_MEMBER]:
    'Bridge "{0}" has no member "{1}" (used in {2}).{3}\nDeclared members: {4}.',
  [AvenxErrorCodes.COMPILER_BRIDGE_UNKNOWN_EVENT]:
    'Bridge "{0}" never emits the event "{1}" (subscribed in {2}).{3}\nEmitted events: {4}.',
  [AvenxErrorCodes.ATLAS_UNREAD_STATE]:
    '{0} is {1} read nowhere in the application ({2}).\nAtlas found no template binding, computed, action, resource or guard that reads it. Delete it, or check whether the read it was meant to have is missing. Run "avenx impact {3}" to see the relationships Atlas did find.',
  [AvenxErrorCodes.ATLAS_UNREACHABLE_ACTION]:
    '{0} is never invoked from a template, action, computed, resource or guard ({1}).\nLifecycle actions the runtime calls by name are exempt. Delete it, or wire up the call site it is waiting for.',
  [AvenxErrorCodes.COMPONENT_NESTING_LIMIT]:
    'Child components are still being mounted after {0} passes, so mounting stopped and anything deeper is not on the page.\nEach pass mounts one more level of nesting, so this means the page nests components more than {0} deep, or a component renders itself. Anything below that depth is missing rather than wrong, which is why this says so instead of stopping quietly.',
  [AvenxErrorCodes.ATLAS_UNREGISTERED_COMPONENT]:
    '{0} render(s) <{1}>, but {2} never registers it, so nothing will be rendered there.\nPages under src/pages are registered by the compiler; components are not. Add the import and the registration to {3}:\n  import {7} from \'{4}\';\n  app.register(\'{5}\', {6});\nThe runtime reports this as AVX_W13 when the page is opened, and renders an empty element. Silence this class with "warnings": { "AVX_W56": "off" } in avenx.config.json.',
  [AvenxErrorCodes.ATLAS_NO_REACHABLE_PAGE]:
    'Nothing in this application can reach its {0} page(s): {1}.\nNo route table names them and no mountPage() call mounts one, so each is compiled into the bundle and never rendered. If they are the whole application, the container stays empty and neither the browser nor this build reports anything else. Call app.initRouter({ \'\': \'{2}\' }) in {3}, or app.mountPage(\'{4}\') to mount one directly. Silence this class with "warnings": { "AVX_W53": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_TRANSACTION_UNBOUNDED]:
    '{0} is atomic, but its write set could not be resolved completely ({1}):\n{2}\nThe journal still records every write it makes through Avenx state, so the rewind itself is unaffected. What is affected is this report: overlap analysis and the irreversible-effect list below it are incomplete for this action.',
  [AvenxErrorCodes.COMPILER_TRANSACTION_IRREVERSIBLE]:
    '{0} is atomic, but {1} effect(s) cannot be rewound:\n{2}\nEverything it writes through Avenx state will be restored; the effects above will not. Move them after the transaction, or accept that a rewind leaves them in place.',
  [AvenxErrorCodes.COMPILER_TRANSACTION_OVERLAP]:
    '{0} and {1} are both atomic and both write {2} ({3}).\nIf they can be in flight at the same time, a rewind may find a value it did not write. The "safe" conflict policy skips such a path and reports AVX_R29 rather than discarding the newer value.',
  [AvenxErrorCodes.COMPILER_EXPRESSION_NOT_COMPILED]:
    '{0} expression(s) could not be compiled:\n{1}\nThis development build still renders the rest of each component, but these expressions fail with AVX_R32 when they are evaluated, and a production build refuses them (AVX_C27). Rewrite them in the supported expression language, or move the logic into an <action>, whose body is ordinary JavaScript. Silence this class with "warnings": { "AVX_W48": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_EXPRESSION_REFUSED]:
    'The expression "{0}" cannot be compiled: {1}\n  in <{2}>\nTemplate expressions may not name restricted globals or touch __proto__, constructor or prototype. Move the logic into an <action> if it genuinely needs a browser API.',
  [AvenxErrorCodes.COMPILER_COMPILED_ONLY_CONSTRUCT]:
    '<{0}> uses <@{1}>, which only the compiled renderer implements, but this template cannot be compiled: {2}\n\nFalling back is safe for a construct both renderers implement. It is not safe here: the string renderer has no rewrite for that directive, so it would render the tag into the document as a literal element wrapping the branch it was meant to choose between.\n\nMove the construct that refused into a child component so this template compiles, or replace the conditional with data-ax-show.',
  [AvenxErrorCodes.COMPILER_INVALID_STYLE_DIRECTIVE]:
    'Invalid style directive in <{0}>: {1}\n  {2}\nWrite the attribute as "@css blockName" or the tag as "<@css blockName />", where blockName is a block declared inside <@css> in the component stylesheet.',
  [AvenxErrorCodes.COMPILER_TEMPLATE_REWRITE_INCOMPLETE]:
    'The template front-end left {1} in <{0}> after rewriting it:\n  {2}\nThis is a compiler defect rather than a mistake in your template. Nothing was written, so the previous build is intact; please report it with the template that triggered it.',
  [AvenxErrorCodes.COMPILER_MALFORMED_TEMPLATE]:
    'Malformed template in <{0}>: {1}\n  {2}\nClose the tag, attribute quote or comment. The build stops here because everything after an unterminated construct would otherwise be read as part of it.',
  [AvenxErrorCodes.COMPILER_UNKNOWN_STYLE_BLOCK]:
    'Style block "{1}" used in <{0}> is not declared in its stylesheet{2}.\nThe element renders without that class. Declare the block inside <@css> in the component stylesheet, or correct the name. Silence this class with "warnings": { "AVX_W49": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_STYLE_DIRECTIVE_NO_TARGET]:
    '<@css {1} /> in <{0}> has no element to style.\nPlace it as the first child of the element it styles, or immediately after that element. Silence this class with "warnings": { "AVX_W50": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_EXPRESSION_NOT_EXECUTABLE]:
    '{0} expression(s) cannot be compiled, and a production build has no interpreter to run them:\n{1}\nEach would throw AVX_R32 the first time it is evaluated, so nothing was written. Rewrite it in the supported expression language (see Template expressions), or move the logic into an <action>, whose body is ordinary JavaScript. "avenx build --dev" still builds, with AVX_W48, while you work on it.',
  [AvenxErrorCodes.COMPILER_STATE_NOT_LITERAL]:
    'State "{1}" in <{0}> (in template of {4}) looks like an object or array initialiser but contains {2}, so it stays the string {3}.\nState initialisers are evaluated at build time and may contain only constant values: strings, numbers, booleans, null, arrays and objects. Set a computed value in onMount, or declare a <computed>. Silence this class with "warnings": { "AVX_W51": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_BOUND_EVENT_ATTRIBUTE]:
    '<{0}> binds the inline event handler "{1}" to an interpolated value: {2}\nAn on* attribute runs its value as JavaScript, so this would execute {1} from application state -- and it does not run under a strict Content-Security-Policy. Use the event directive instead: @{3}="handler" (or @{3}="handler()" to call one). See Events.',
  [AvenxErrorCodes.COMPILER_INTERPOLATED_DYNAMIC_ATTRIBUTE]:
    '<{0}> writes a dynamic attribute binding whose {1} is an interpolation: {2}\nBoth slots of :[name]="value" are expressions, not interpolations, so the braces become part of the expression: it resolves to nothing and the attribute is silently never set, in development and in production alike. Drop the braces: :[{3}]="{4}". To interpolate into an attribute whose name is fixed, write an ordinary attribute instead. See Dynamic attributes.',
  [AvenxErrorCodes.COMPILER_UNHANDLED_AST_NODE]:
    'Unhandled template AST node type "{0}"{1} in {2}.\nEvery node the template parser produces must have an explicit branch in this pass. A node type reaching the fallback means a parser change added a node kind a pass was never taught to read, so the pass would otherwise mis-handle it and emit output that looks valid. Add a branch for "{0}" to {2}.',
  [AvenxErrorCodes.COMPILER_UNTERMINATED_INTERPOLATION]:
    'Unterminated interpolation in template of {0}: {1}\nThe "{{" opened here is never closed, so the text is emitted to the page exactly as written -- a visitor sees the braces and the expression source. Close it with "}}", or escape the braces if they are meant as literal text. Silence this class with "warnings": { "AVX_W54": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_UNUSED_STYLE_BLOCK]:
    'Style block(s) {1} in {2} are declared but no element in <{0}> names them, so none of their rules are emitted.\nAn Avenx style block is a named block, not a CSS selector: write `card { ... }` in the stylesheet and `<div @css card>` in the template. A block written as `.card { ... }` or `button { ... }` is a block whose name is ".card" or "button" -- it styles nothing until an element names it, and a name that is not a plain word can never be named at all. Silence this class with "warnings": { "AVX_W55": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_INLINE_EVENT_ATTRIBUTE]:
    '<{0}> uses the inline event handler "{1}" (in template of {3}).\nInline handlers bypass Avenx\'s event system and do not run under a strict Content-Security-Policy. Prefer @{2}="handler". Silence this class with "warnings": { "AVX_W52": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_RENDER_NOT_COMPILED]:
    '{0} template(s) could not be compiled to a render program and will render through the string renderer:\n{1}\nThose components re-render, reparse and diff their whole template on every update, instead of updating only the bindings whose dependencies changed. They render correctly; the cost is time proportional to the template rather than to the change. Silence this class with "warnings": { "AVX_W47": "off" } in avenx.config.json.',
  [AvenxErrorCodes.COMPILER_UNRESOLVED_COMPONENT_REFERENCE]:
    'Component "<{0}>" referenced in template of {1} does not resolve to a registered component, a built-in tag, or a known HTML/SVG element.{2}\nRegister the component (add a matching ".component.js" file), fix the spelling, or use a lowercase HTML element. A dash-containing custom element (e.g. "my-widget") is never flagged. Silence this class with "warnings": { "AVX_W46": "off" } in avenx.config.json.',

  // Runtime Warnings
  [AvenxErrorCodes.PAGE_ALREADY_REGISTERED]:
    'Page "{0}" is already registered and will be overwritten.',
  [AvenxErrorCodes.ROUTE_PATH_MISSING_LEADING_SLASH]:
    'Route path "{0}" lacks a leading slash. This may prevent hash paths from resolving properly.',
  [AvenxErrorCodes.ROUTE_PARAM_DECODE_FAILED]:
    'Failed to decode route parameter "{0}": {1}',
  [AvenxErrorCodes.ROUTE_NOT_FOUND]:
    'No route defined for hash: {0}',
  [AvenxErrorCodes.ROUTE_TITLE_EVALUATION_FAILED]:
    'title() threw an error: {0}',
  [AvenxErrorCodes.PAGE_PROP_EVALUATION_FAILED]:
    'Failed to evaluate prop expression: {0}. Error: {1}',
  [AvenxErrorCodes.PAGE_COMPONENT_NOT_REGISTERED]:
    "Component '{0}' not found in registry.",
  [AvenxErrorCodes.COMPONENT_RESTORE_SLOT_CONTENT_FAILED]:
    'Failed to restore default slot content. Error: {0}',
  [AvenxErrorCodes.COMPONENT_INJECT_KEY_NOT_FOUND]:
    'Injected key "{0}" not found in any ancestor component.',
  [AvenxErrorCodes.SECURITY_SANITIZED_TAG]:
    'Sanitized tag "<{0}>" when stripping content.',
  [AvenxErrorCodes.SECURITY_SANITIZED_ATTRIBUTE]:
    'Sanitized attribute "{0}" when stripping content.',
  [AvenxErrorCodes.SECURITY_BLOCKED_EVENT_ATTRIBUTE]:
    'Refused to set the inline event-handler attribute "{0}": its value would run as JavaScript.\nA bound on* handler is a build error (AVX_C28); reaching this means a dynamic attribute name resolved to one at run time. Use the event directive, @event="handler", instead.',
  [AvenxErrorCodes.SECURITY_BLOCKED_URL]:
    'Refused a "{0}" attribute whose URL uses a scheme that executes rather than locates: "{1}".\nThe attribute was set to about:blank. Interpolation escapes the value into the attribute safely, but escaping cannot make a javascript: URL safe -- only the scheme can. If the URL comes from user input, validate it where it enters the application.',
  [AvenxErrorCodes.RENDER_LIST_EVALUATION_FAILED]:
    'Failed to evaluate list expression: {0} in component <{2}>. Error: {1}',
  [AvenxErrorCodes.RENDER_KEY_EVALUATION_FAILED]:
    'Failed to evaluate key expression: {0}. Error: {1}',
  [AvenxErrorCodes.RENDER_LIST_DUPLICATE_KEY]:
    'Duplicate key "{0}" detected in list expression "{1}". Appending index suffix to prevent node reuse conflict.',
  [AvenxErrorCodes.RENDER_LIST_INVALID_SOURCE]:
    'Failed to render list in component <{0}>. Expression "{1}" evaluates to a non-iterable value.',
  [AvenxErrorCodes.DIRECTIVE_HTML_EVALUATION_FAILED]:
    'Failed to evaluate data-ax-html: {0}. Error: {1}',
  [AvenxErrorCodes.DIRECTIVE_SHOW_EVALUATION_FAILED]:
    'Failed to evaluate data-ax-show: {0}. Error: {1}',
  [AvenxErrorCodes.DIRECTIVE_CLASS_EVALUATION_FAILED]:
    'Failed to evaluate data-ax-class: {0}. Error: {1}',
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
 * Substitutes `{0}`, `{1}` ... placeholders in a message template.
 *
 * Every occurrence of a placeholder is replaced, in one pass.
 *
 * Substituting argument by argument with a string pattern replaced only the
 * first `{n}`, so a message that referred to the same argument twice printed
 * the placeholder to the user the second time: AVX_C28 told authors their
 * handler "would execute {1} from application state" and offered "@{3}=..." as
 * the fix.
 *
 * One pass rather than one per argument also means a substituted value that
 * happens to contain `{0}` -- a template snippet quoted back into the message,
 * say -- is not expanded again by a later argument.
 *
 * A placeholder with no corresponding argument is left as written, which is
 * what the argument-by-argument loop did too.
 * @param {string} message - The message template.
 * @param {any[]} args - The values to substitute, by position.
 * @returns {string} The filled message.
 */
function fillPlaceholders(message, args) {
  return message.replace(/\{(\d+)\}/g, (placeholder, index) => {
    const position = Number(index);
    return position < args.length ? String(args[position]) : placeholder;
  });
}

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
    const message = AvenxErrorMessages[code] || 'An unknown framework error occurred.';

    super(`[${code}] ${fillPlaceholders(message, args)}`);

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
  const message = AvenxErrorMessages[code] || 'An unknown framework error occurred.';
  return `[${code}] ${fillPlaceholders(message, args)}`;
}
