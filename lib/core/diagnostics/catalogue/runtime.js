/**
 * Runtime diagnostic catalogue entries.
 */
export default {
  AVX_R01: {
    code: 'AVX_R01',
    name: 'ComponentMountFailure',
    severity: 'error',
    category: 'runtime',
    summary: 'The target DOM element for component mounting was not found.',
    causes: [
      'The selector passed to app.mount() does not exist in the DOM when called.'
    ],
    remedies: [
      'Ensure the selector exists in index.html before mounting or call after DOMContentLoaded.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r01-mount-target-not-found'
  },
  AVX_R08: {
    code: 'AVX_R08',
    name: 'UncaughtRenderError',
    severity: 'error',
    category: 'runtime',
    summary: 'An unhandled exception occurred during component render cycle.',
    causes: [
      'Accessing properties of undefined/null during reactive re-rendering.'
    ],
    remedies: [
      'Use optional chaining or default values for nullable reactive properties.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#template-interpolation-failure'
  },
  AVX_R16: {
    code: 'AVX_R16',
    name: 'StateDirectReassignment',
    severity: 'error',
    category: 'runtime',
    summary: 'A component state object was reassigned instead of being mutated.',
    causes: [
      'Code assigned a new object directly to this.state, attempting to replace the reactive proxy.'
    ],
    remedies: [
      'Mutate individual properties on this.state or use Object.assign(this.state, values).'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors'
  },
  AVX_R17: {
    code: 'AVX_R17',
    name: 'PluginInstallFailed',
    severity: 'error',
    category: 'runtime',
    summary: 'A plugin failed while being installed into the application.',
    causes: ['The plugin installer threw or returned a rejected promise.'],
    remedies: [
      'Inspect the reported cause, then fix the plugin installer before mounting the application.',
      'Name object plugins with a `name` property so the diagnostic identifies them.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r17-plugin-install-failed'
  },
  AVX_R18: {
    code: 'AVX_R18',
    name: 'ReactivityLoopDetected',
    severity: 'error',
    category: 'runtime',
    summary: 'A circular reactive update loop exceeded the maximum update depth limit.',
    causes: [
      'An action or effect synchronously mutates state that triggers itself continuously.'
    ],
    remedies: [
      'Break recursive mutations or add termination conditions to reactive watchers.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r18-reactive-deadlock-detected'
  },
  AVX_R29: {
    code: 'AVX_R29',
    name: 'TransactionRewindFailed',
    severity: 'error',
    category: 'runtime',
    summary: 'A rewind could not restore every path the transaction journaled.',
    causes: [
      'Another transaction, or ordinary code, wrote the same path after this transaction did. The "safe" policy will not overwrite a value it did not write.',
      'A collection grew past `rewind.maxSnapshotItems`, so no savepoint was kept for it.',
      'A setter on the restored path threw while the value was being put back.'
    ],
    remedies: [
      'Read the report: it names each path, the value the transaction wrote, and the value found instead.',
      'Check the build output for AVX_W44 — an overlap between two atomic actions is the usual cause.',
      'Raise `rewind.maxSnapshotItems` in avenx.config.json if a large collection was the reason.',
      'Set onConflict="force" on the action if this transaction should win regardless.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r29-transaction-rewind-failed'
  },
  AVX_R36: {
    code: 'AVX_R36',
    name: 'ComponentNestingLimit',
    severity: 'error',
    category: 'runtime',
    summary: 'Child mounting stopped at the nesting limit, so deeper components were not mounted.',
    causes: [
      'The page nests child components more deeply than the mounting pass allows.',
      'A component renders itself, directly or through a cycle.'
    ],
    remedies: [
      'Flatten the component tree, or render the deeper levels from a page instead.',
      'Check for a component whose template renders its own tag.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r36-component-nesting-limit'
  },
  AVX_R38: {
    code: 'AVX_R38',
    name: 'PageMountPointOwnerUnmounted',
    severity: 'warning',
    category: 'runtime',
    summary: 'A nested component was skipped because the component it is written in is not mounted.',
    causes: [
      'The component whose template contains the nested component failed to register, resolve, or mount.',
      'A dynamic component expression for the owning component did not resolve to a registered component.'
    ],
    remedies: [
      'Check the warnings for the owning component, which is reported separately, and fix why it did not mount.',
      'Register the owning component with the application so it can be mounted.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r38-page-mount-point-owner-unmounted'
  },
  AVX_R39: {
    code: 'AVX_R39',
    name: 'RouterUnavailable',
    severity: 'error',
    category: 'runtime',
    summary: 'A router API was used without linking the router capability.',
    causes: [
      'The application imports the runtime directly through an external bundler.',
      'A dynamically selected routing API could not be detected during compilation.'
    ],
    remedies: [
      'Build with avenx build, which links routing when the application uses it.',
      'Explicitly import "avenx-core/runtime/router" before using router APIs.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r39-router-unavailable'
  },
  AVX_R35: {
    code: 'AVX_R35',
    name: 'SecurityBlockedEventAttribute',
    severity: 'error',
    category: 'runtime',
    summary: 'The runtime refused to set an inline event-handler attribute.',
    causes: [
      'A dynamic attribute name (:[expr]) resolved to an on* handler such as onclick, whose value would run as JavaScript.'
    ],
    remedies: [
      'Use the event directive @event="handler" rather than assembling an on* attribute name.',
      'A bound on* attribute written literally is refused earlier, at build time, with AVX_C28.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r35-security-blocked-event-attribute'
  },
  AVX_R33: {
    code: 'AVX_R33',
    name: 'ComponentRenderAborted',
    severity: 'error',
    category: 'runtime',
    summary: 'A component failed to render, nothing handled the error, and the component is showing nothing.',
    causes: [
      'An expression, computed value or lifecycle hook threw while the component was rendering.',
      'The component needs a rendering engine this bundle does not carry (see AVX_R34).',
      'The application registers no error handler, so there was nowhere else for the error to go.'
    ],
    remedies: [
      'Fix the cause printed under "cause:" -- it is the original error, with its stack.',
      'Handle it where it belongs: an onErrorCaptured hook on the component or an ancestor, an <@errorBoundary> around the part that can fail, or app.onError() for the whole application.',
      'This message is what an unhandled render failure looks like. It is not raised once something claims the error, so adding a handler silences it by design.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r33-component-render-aborted'
  },
  AVX_R34: {
    code: 'AVX_R34',
    name: 'RendererUnavailable',
    severity: 'error',
    category: 'runtime',
    summary: 'A component needs a rendering engine that is not present in this bundle.',
    causes: [
      'The component was compiled by a different build than the one that linked this bundle.',
      'The string renderer was linked but its registry was split by the same file being bundled twice.',
      'dist/ holds a mixture of artifacts from more than one build.'
    ],
    remedies: [
      'Delete dist/ and rebuild.',
      'Run "avenx build" and check that AVX_W47 is reported for the component named in the message -- that warning is what links the renderer.',
      'A build that reports AVX_W47 and still produces this is a compiler defect worth filing.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r34-renderer-unavailable'
  },
  AVX_R37: {
    code: 'AVX_R37',
    name: 'CompiledTemplateEnvironmentUnsupported',
    severity: 'error',
    category: 'runtime',
    summary: 'The environment has no usable DOM, so a compiled template\'s skeleton cannot be prepared and the component cannot render here.',
    causes: [
      'The code is running outside a browser with no DOM configured -- a test runner in its default \'node\' environment (Vitest\'s default) has no document.',
      'A minimal DOM mock provides a document whose parser reshapes the skeleton past the compiler\'s markers, so the parsed tree cannot be matched to the render program.'
    ],
    remedies: [
      'Run the component in a browser, or configure a DOM environment in the test runner: install happy-dom or jsdom and set \'test: { environment: "happy-dom" }\' in the Vitest config.',
      'Do not rebuild or file a compiler defect for this code -- the same bundle renders unchanged where a usable DOM exists.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r37-compiled-template-environment-unsupported'
  },
  AVX_R25: {
    code: 'AVX_R25',
    name: 'TraceUnreadable',
    severity: 'error',
    category: 'runtime',
    summary: 'A trace file could not be read by this version of Avenx.',
    causes: [
      'The trace was produced by a newer avenx-core than the one reading it.',
      'The file is not a trace, or was truncated while being written.'
    ],
    remedies: [
      'Upgrade avenx-core to a version that understands this trace format version.',
      'Re-record the session with `avenx serve --trace`.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r25-traceunreadable'
  },
  AVX_R26: {
    code: 'AVX_R26',
    name: 'TraceNotDeterministic',
    severity: 'error',
    category: 'runtime',
    summary: 'A best-effort trace was replayed without explicitly accepting that it may not reproduce.',
    causes: [
      'The recording detected something replay cannot reproduce: an unattributed state write, a polling resource, a value that could not be serialized, or a redacted input.',
      'The recording buffer filled up and dropped its oldest nodes.'
    ],
    remedies: [
      'Run `avenx trace view <id>` to see which reasons were recorded.',
      'Remove the source of non-determinism — move timer-driven state changes into an action, or drop pollInterval — and record again.',
      'Pass { allowBestEffort: true } to replay() to run it anyway; the result reports what diverged instead of claiming a pass.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r26-tracenotdeterministic'
  },
  AVX_R27: {
    code: 'AVX_R27',
    name: 'TraceReplayDiverged',
    severity: 'error',
    category: 'runtime',
    summary: 'Replaying a trace produced different state or DOM changes than the recording.',
    causes: [
      'Application code changed since the trace was recorded — which is exactly what a regression test is for.',
      'Something outside the sandbox boundary took part in the original run: a bridge reading Date.now(), a timer, or a request made outside a <resource>.',
      'The recorded event target could not be found in the replayed DOM.'
    ],
    remedies: [
      'Read the divergence report: it names the step and the first recorded and replayed operation that differ.',
      'If the change was intended, re-record the trace and re-export the test.',
      'If it was not, the divergence is the bug the trace was meant to catch.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r27-tracereplaydiverged'
  },
  AVX_R28: {
    code: 'AVX_R28',
    name: 'TraceReplayFailed',
    severity: 'error',
    category: 'runtime',
    summary: 'A replay could not be set up.',
    causes: [
      'replay() was called without a mount() option.'
    ],
    remedies: [
      'Pass a mount() function that constructs and mounts the application, and returns the context your assertions need.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r28-tracereplayfailed'
  },
  AVX_W57: {
    code: 'AVX_W57',
    name: 'NonReactivePropertyAssignment',
    severity: 'warning',
    category: 'runtime',
    summary: 'Directly assigning a property on a component instance that is not declared in <state> is non-reactive and will not trigger DOM updates.',
    causes: [
      'A component method or action assigns directly to "this.<property>" after initialization.',
      'A property was intended to be reactive but was omitted from the <state> declaration.',
      'Dynamic local state was attached to the component instance outside the constructor.'
    ],
    remedies: [
      'Declare the property in the component\'s <state> tag with an initial value.',
      'If the property is intended as static, non-reactive instance state, initialize it inside the constructor.',
      'Use this.state.<property> = value for reactive mutations rather than assigning to this directly.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w57-component-non-reactive-assignment'
  },
  AVX_R02: {
    code: 'AVX_R02',
    name: 'PageNotFound',
    severity: 'error',
    category: 'runtime',
    summary: 'The requested page is not registered.',
    causes: [
      'A route maps to a page that does not exist, was not compiled, or whose class is named incorrectly.'
    ],
    remedies: [
      'Check the page name spelling and verify the page file exists under src/pages and is registered.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r02-page-not-found'
  },
  AVX_R03: {
    code: 'AVX_R03',
    name: 'ComponentNotFound',
    severity: 'error',
    category: 'runtime',
    summary: 'A component tag names a component that is not registered.',
    causes: [
      'The tag is misspelled, or the component was never created, imported, or registered with the application.'
    ],
    remedies: [
      'Check the tag spelling against the component name, and register the component before rendering.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r03-component-not-found'
  },
  AVX_R04: {
    code: 'AVX_R04',
    name: 'ComputedCircularDependency',
    severity: 'error',
    category: 'runtime',
    summary: 'A computed property depends on itself, directly or indirectly.',
    causes: [
      'Computed getters reference their own key through a chain of other computed properties.'
    ],
    remedies: [
      'Refactor the computed expressions so none of them reference their own key, directly or through another computed.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r04-computed-circular-dependency'
  },
  AVX_R05: {
    code: 'AVX_R05',
    name: 'ComputedEvaluationFailed',
    severity: 'error',
    category: 'runtime',
    summary: 'Evaluating a computed property threw an error.',
    causes: [
      'The computed expression throws, for example by reading a property of undefined or calling something that is not a function.'
    ],
    remedies: [
      'Review the expression shown in the message and ensure every referenced state value is defined.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r05-computed-evaluation-failed'
  },
  AVX_R06: {
    code: 'AVX_R06',
    name: 'RouterGuardDenied',
    severity: 'error',
    category: 'runtime',
    summary: 'A navigation guard denied the transition to a route.',
    causes: [
      'A guard returned false for the target route. For access controls this is expected behaviour.'
    ],
    remedies: [
      'If the denial is unexpected, check the guard logic and the condition it tests for that route.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r06-router-guard-denied'
  },
  AVX_R07: {
    code: 'AVX_R07',
    name: 'RouterGuardError',
    severity: 'error',
    category: 'runtime',
    summary: 'A navigation guard threw an error during evaluation.',
    causes: [
      'Guard code threw, often inside an asynchronous fetch or a read of missing data.'
    ],
    remedies: [
      'Fix the error shown in the message, and wrap asynchronous guard work in try/catch where a failure should deny or redirect instead.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r07-router-guard-error'
  },
  AVX_R09: {
    code: 'AVX_R09',
    name: 'EventHandlerError',
    severity: 'error',
    category: 'runtime',
    summary: 'An event handler statement failed while executing.',
    causes: [
      'The handler action throws, or the statement names a method that does not match a declared action.'
    ],
    remedies: [
      'Verify the method declaration matches the event expression, and fix the error the handler reports.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r09-event-handler-error'
  },
  AVX_R10: {
    code: 'AVX_R10',
    name: 'BridgeAlreadyExists',
    severity: 'error',
    category: 'runtime',
    summary: 'A bridge with the same name is already registered.',
    causes: [
      'A bridge was registered twice under one name. Bridge names must be unique across the application.'
    ],
    remedies: [
      'Register each bridge once under a unique name, or reuse the bridge that is already registered.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r10-bridge-already-exists'
  },
  AVX_R11: {
    code: 'AVX_R11',
    name: 'StateMutationInUpdate',
    severity: 'error',
    category: 'runtime',
    summary: 'State was mutated during the update or render lifecycle.',
    causes: [
      'Code modifies reactive state inside a template, a getter, a computed definition, or a hook such as onUpdate, which re-triggers the same update cycle.'
    ],
    remedies: [
      'Move the mutation into an action or event handler, and keep templates, getters, and update hooks free of state writes.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r11-state-mutation-in-update'
  },
  AVX_R12: {
    code: 'AVX_R12',
    name: 'LifecycleHookError',
    severity: 'error',
    category: 'runtime',
    summary: 'A component lifecycle hook threw an error.',
    causes: [
      'An unhandled error was thrown inside onMount, onUpdate, onUnmount, or another lifecycle hook.'
    ],
    remedies: [
      'Inspect the hook named in the message and fix the underlying error, handling rejected promises from asynchronous hook work.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r12-lifecycle-hook-error'
  },
  AVX_R13: {
    code: 'AVX_R13',
    name: 'DomParsingFailed',
    severity: 'error',
    category: 'runtime',
    summary: 'DOM parsing failed because the HTML is malformed.',
    causes: [
      'A template or dynamically rendered content has unclosed tags, mismatched elements, or other malformed markup.'
    ],
    remedies: [
      'Verify the template HTML is well formed: every element properly nested and every tag closed.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r13-dom-parsing-failed'
  },
  AVX_R14: {
    code: 'AVX_R14',
    name: 'RouterGuardTimeout',
    severity: 'error',
    category: 'runtime',
    summary: 'A navigation guard timed out.',
    causes: [
      'One or more sequential guards returned promises that did not resolve within the configured timeout, so the transition stalled.'
    ],
    remedies: [
      'Inspect the guard for unresolved or hanging promises and shorten or cache its asynchronous work.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r14-router-guard-timeout'
  },
  AVX_R15: {
    code: 'AVX_R15',
    name: 'SandboxViolation',
    severity: 'error',
    category: 'runtime',
    summary: 'An expression attempted something the sandbox forbids.',
    causes: [
      'Template or runtime expressions accessed restricted properties such as __proto__, constructor, or prototype, or an unauthorised global. This prevents prototype pollution and template injection.'
    ],
    remedies: [
      'Remove the restricted access and pass the needed value into the component as state or a prop instead.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r15-sandbox-violation'
  },
  AVX_R19: {
    code: 'AVX_R19',
    name: 'BridgeInvalidDefinition',
    severity: 'error',
    category: 'runtime',
    summary: 'bridge() was called without a definition object.',
    causes: [
      'bridge() received no argument, or something that is not a plain object.'
    ],
    remedies: [
      'Pass a definition object, for example bridge({ state: { count: 0 } }).'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r19-bridge-invalid-definition'
  },
  AVX_R20: {
    code: 'AVX_R20',
    name: 'BridgeReservedKey',
    severity: 'error',
    category: 'runtime',
    summary: 'A bridge definition declares a member name reserved by the Bridge API.',
    causes: [
      'The definition declares on, emit, $dispose, or $name, or a getter or action collides with a state key.'
    ],
    remedies: [
      'Rename the member so it does not collide with a reserved name or a state key.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r20-bridge-reserved-key'
  },
  AVX_R21: {
    code: 'AVX_R21',
    name: 'BridgeInvalidMember',
    severity: 'error',
    category: 'runtime',
    summary: 'A bridge definition places a plain value at the top level.',
    causes: [
      'Data was placed at the top level of the definition instead of inside state. Only actions, getters, and the reserved keys state and setup may live at the top level.'
    ],
    remedies: [
      'Move the value into the state object: bridge({ state: { name: value } }).'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r21-bridge-invalid-member'
  },
  AVX_R22: {
    code: 'AVX_R22',
    name: 'BridgeReadonlyState',
    severity: 'error',
    category: 'runtime',
    summary: 'Code outside a bridge tried to assign to bridge state.',
    causes: [
      'Bridge state is read-only for consumers so every mutation has a single, traceable origin inside the bridge.'
    ],
    remedies: [
      'Add an action to the bridge that performs the change, and call that action instead of assigning.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r22-bridge-readonly-state'
  },
  AVX_R23: {
    code: 'AVX_R23',
    name: 'BridgeInvalidEvent',
    severity: 'error',
    category: 'runtime',
    summary: 'A bridge event call is invalid.',
    causes: [
      'on() or emit() was called with an empty or non-string event name, or on() was called without a listener function.'
    ],
    remedies: [
      'Pass a non-empty event name string and, for on(), a listener function.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r23-bridge-invalid-event'
  },
  AVX_R24: {
    code: 'AVX_R24',
    name: 'BridgeSetupFailed',
    severity: 'error',
    category: 'runtime',
    summary: 'A bridge failed during its setup() hook.',
    causes: [
      'setup() threw while initialising, for example because an external connection could not be opened.'
    ],
    remedies: [
      'Fix the underlying error shown in the message, or record the failure in state inside setup() instead of throwing.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r24-bridge-setup-failed'
  },
  AVX_R30: {
    code: 'AVX_R30',
    name: 'ComponentInvalidName',
    severity: 'error',
    category: 'runtime',
    summary: 'A component was registered with an invalid name.',
    causes: [
      'Registration received a missing, non-string, or empty component name. Component names must be non-empty strings.'
    ],
    remedies: [
      'Pass a non-empty string name when registering the component or page.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r30-component-invalid-name'
  },
  AVX_R31: {
    code: 'AVX_R31',
    name: 'ComponentInvalidClass',
    severity: 'error',
    category: 'runtime',
    summary: 'A component was registered with a class that does not extend AvenxComponent.',
    causes: [
      'Registration received a plain object, an unrelated class, or another value that is not an AvenxComponent constructor.'
    ],
    remedies: [
      'Register a class that extends AvenxComponent.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r31-component-invalid-class'
  },
  AVX_R32: {
    code: 'AVX_R32',
    name: 'ExpressionUnsupported',
    severity: 'error',
    category: 'runtime',
    summary: 'An expression is outside the supported template expression language.',
    causes: [
      'The expression uses statements, function declarations, await, destructuring, or another construct that is not an expression. Template expressions are evaluated by Avenx, not the JavaScript engine, which is what lets them run under a strict Content-Security-Policy.'
    ],
    remedies: [
      'Move that logic into an action and call the action from the template.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-r32-expression-unsupported'
  },
  AVX_W12: {
    code: 'AVX_W12',
    name: 'PagePropEvaluationFailed',
    severity: 'warning',
    category: 'runtime',
    summary: 'A page prop expression failed to evaluate.',
    causes: [
      'The prop expression throws, or a value it reads is not defined.'
    ],
    remedies: [
      'Check the prop expression named in the message and define or guard the values it reads.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w12-page-prop-evaluation-failed'
  },
  AVX_W13: {
    code: 'AVX_W13',
    name: 'PageComponentNotRegistered',
    severity: 'warning',
    category: 'runtime',
    summary: 'A page references a component that is not in the registry.',
    causes: [
      'The component was never registered with the application, or its name is misspelled in the page.'
    ],
    remedies: [
      'Register the component, or correct the component name in the page.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w13-page-component-not-registered'
  },
  AVX_W14: {
    code: 'AVX_W14',
    name: 'ComponentRestoreSlotContentFailed',
    severity: 'warning',
    category: 'runtime',
    summary: 'Default slot content could not be restored.',
    causes: [
      'Restoring the fallback slot content threw, for example because the DOM nodes it expects were removed.'
    ],
    remedies: [
      'Check the slot usage and the error reported, and keep the default content inside the component tags.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w14-component-restore-slot-content-failed'
  },
  AVX_W15: {
    code: 'AVX_W15',
    name: 'ComponentInjectKeyNotFound',
    severity: 'warning',
    category: 'runtime',
    summary: 'An injected key was not provided by any ancestor component.',
    causes: [
      'A component injects a key that no ancestor provides with provide().'
    ],
    remedies: [
      'Provide the key from an ancestor component, or give the injection a default value.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w15-component-inject-key-not-found'
  },
  AVX_W16: {
    code: 'AVX_W16',
    name: 'SecuritySanitizedTag',
    severity: 'warning',
    category: 'runtime',
    summary: 'The sanitizer stripped a tag from rendered content.',
    causes: [
      'HTML passed through the sanitizer contained a tag that is not allowed, such as a script or an embedded frame.'
    ],
    remedies: [
      'Remove the stripped tag from the content, or render trusted markup through the framework binding meant for it instead of raw HTML.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w16-security-sanitized-tag'
  },
  AVX_W17: {
    code: 'AVX_W17',
    name: 'SecuritySanitizedAttribute',
    severity: 'warning',
    category: 'runtime',
    summary: 'The sanitizer stripped an attribute from rendered content.',
    causes: [
      'HTML passed through the sanitizer contained an attribute that is not allowed, such as an inline event handler.'
    ],
    remedies: [
      'Remove the stripped attribute and use framework event bindings instead of inline handlers.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w17-security-sanitized-attribute'
  },
  AVX_W18: {
    code: 'AVX_W18',
    name: 'RenderListEvaluationFailed',
    severity: 'warning',
    category: 'runtime',
    summary: 'A list expression failed to evaluate.',
    causes: [
      'The expression behind a list directive throws, or a value it reads is not defined.'
    ],
    remedies: [
      'Check the list expression named in the message and define or guard the values it reads.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w18-render-list-evaluation-failed'
  },
  AVX_W19: {
    code: 'AVX_W19',
    name: 'RenderKeyEvaluationFailed',
    severity: 'warning',
    category: 'runtime',
    summary: 'A list key expression failed to evaluate.',
    causes: [
      'The key expression throws for at least one item in the list.'
    ],
    remedies: [
      'Make the key expression safe for every item, including items with missing fields.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w19-render-key-evaluation-failed'
  },
  AVX_W20: {
    code: 'AVX_W20',
    name: 'RenderListDuplicateKey',
    severity: 'warning',
    category: 'runtime',
    summary: 'A list produced a duplicate key.',
    causes: [
      'Two items in the list evaluate to the same key, so the renderer appends an index suffix to prevent a node reuse conflict.'
    ],
    remedies: [
      'Use a key that is unique per item, such as a stable id, instead of a field that can repeat.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w20-render-list-duplicate-key'
  },
  AVX_W21: {
    code: 'AVX_W21',
    name: 'DirectiveHtmlEvaluationFailed',
    severity: 'warning',
    category: 'runtime',
    summary: 'A data-ax-html expression failed to evaluate.',
    causes: [
      'The expression throws, for example by calling a method on undefined.'
    ],
    remedies: [
      'Guard nullable values in the expression, or compute the HTML in an action and bind the result.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w21-directive-html-evaluation-failed'
  },
  AVX_W22: {
    code: 'AVX_W22',
    name: 'DirectiveShowEvaluationFailed',
    severity: 'warning',
    category: 'runtime',
    summary: 'A data-ax-show expression failed to evaluate.',
    causes: [
      'The expression throws, for example by reading a property of undefined.'
    ],
    remedies: [
      'Guard nullable values in the expression so it always returns a boolean.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w22-directive-show-evaluation-failed'
  },
  AVX_W23: {
    code: 'AVX_W23',
    name: 'DirectiveClassEvaluationFailed',
    severity: 'warning',
    category: 'runtime',
    summary: 'A data-ax-class expression failed to evaluate.',
    causes: [
      'The expression throws, for example by reading a property of undefined.'
    ],
    remedies: [
      'Guard nullable values in the expression so it always returns the class value.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w23-directive-class-evaluation-failed'
  },
  AVX_W36: {
    code: 'AVX_W36',
    name: 'BridgeListenerError',
    severity: 'warning',
    category: 'runtime',
    summary: 'A bridge event listener threw while handling an event.',
    causes: [
      'A handler registered with on() throws when the bridge emits the event. Dispatch catches and reports the error instead of losing it.'
    ],
    remedies: [
      'Inspect the listener error reported in the message and fix the handler.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w36-bridge-listener-error'
  },
  AVX_W39: {
    code: 'AVX_W39',
    name: 'RenderListInvalidSource',
    severity: 'warning',
    category: 'runtime',
    summary: 'A list expression evaluates to a non-iterable value.',
    causes: [
      'The source of a list directive is a plain object, a number, or another value that cannot be iterated, instead of a collection.'
    ],
    remedies: [
      'Return an array or another iterable from the list expression.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w39-render-list-invalid-source'
  },
  AVX_W45: {
    code: 'AVX_W45',
    name: 'SecurityBlockedUrl',
    severity: 'warning',
    category: 'runtime',
    summary: 'A URL attribute was refused because its scheme executes rather than locates.',
    causes: [
      'A URL-valued attribute resolves to a scheme such as javascript:. Escaping cannot make such a URL safe, so the attribute is set to about:blank, or removed from markup sanitized for data-ax-html.'
    ],
    remedies: [
      'Validate URLs where they enter the application and only allow schemes such as https: or relative paths.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w45-security-blocked-url'
  }
};
