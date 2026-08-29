/**
 * Structured diagnostic catalogue mapping stable error and warning codes
 * to detailed descriptions, causes, remedies, and documentation links.
 */
export const DIAGNOSTIC_CATALOGUE = {
  // Compiler Diagnostics (AVX_C01 - AVX_C06)
  AVX_C01: {
    code: 'AVX_C01',
    name: 'InvalidTemplateSyntax',
    severity: 'error',
    category: 'compiler',
    summary: 'The component template contains invalid syntax or unclosed tags.',
    causes: [
      'A tag was opened but not properly closed.',
      'Malformed directive attributes or expression syntax.'
    ],
    remedies: [
      'Check template markup for balanced tags.',
      'Ensure directives use valid syntax (e.g., <@for ...>).'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-c01'
  },
  AVX_C02: {
    code: 'AVX_C02',
    name: 'DuplicateActionDefinition',
    severity: 'error',
    category: 'compiler',
    summary: 'An action name was defined more than once within the same component.',
    causes: [
      'Two <action name="..."> blocks share the same name identifier.'
    ],
    remedies: [
      'Rename or merge duplicate action definitions.'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-c02'
  },
  AVX_C03: {
    code: 'AVX_C03',
    name: 'UndefinedStateReference',
    severity: 'error',
    category: 'compiler',
    summary: 'A state variable referenced in the template or action is not declared.',
    causes: [
      'Referencing a variable not defined in <state /> declarations.'
    ],
    remedies: [
      'Declare the missing state variable in <state varName="..." />.'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-c03'
  },
  AVX_C04: {
    code: 'AVX_C04',
    name: 'InvalidDirectiveUsage',
    severity: 'error',
    category: 'compiler',
    summary: 'A framework directive is used in an invalid context.',
    causes: [
      'Placing directives where they cannot be evaluated or nesting incompatible directives.'
    ],
    remedies: [
      'Check the directive reference documentation for allowable parent-child relationships.'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-c04'
  },
  AVX_C05: {
    code: 'AVX_C05',
    name: 'MissingRootElement',
    severity: 'error',
    category: 'compiler',
    summary: 'Component template markup lacks a valid root container element.',
    causes: [
      'Template root has multiple adjacent unparented nodes without a fragment wrapper.'
    ],
    remedies: [
      'Wrap root template content inside a single container element or fragment.'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-c05'
  },
  AVX_C06: {
    code: 'AVX_C06',
    name: 'MalformedExpression',
    severity: 'error',
    category: 'compiler',
    summary: 'An expression enclosed in {{ ... }} failed interpolation parsing.',
    causes: [
      'JavaScript syntax error inside template expression interpolation delimiters.'
    ],
    remedies: [
      'Ensure interpolation contains valid JavaScript expressions.'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-c06'
  },

  // Runtime Diagnostics (AVX_R01 - AVX_R18)
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
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-r01'
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
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-r08'
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
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-r18'
  },

  // Warning Diagnostics (AVX_W01 - AVX_W35)
  AVX_W01: {
    code: 'AVX_W01',
    name: 'UnusedStateVariable',
    severity: 'warning',
    category: 'compiler',
    summary: 'A state variable was declared but never referenced in template or actions.',
    causes: [
      '<state ... /> defines a variable that is dead code.'
    ],
    remedies: [
      'Remove unused state declarations to reduce memory footprint.'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-w01'
  },
  AVX_W29: {
    code: 'AVX_W29',
    name: 'MissingKeyInLoop',
    severity: 'warning',
    category: 'compiler',
    summary: 'A repeated list item in <@for> does not specify a unique @key attribute.',
    causes: [
      '<@for ...> rendering dynamic lists without unique tracking keys.'
    ],
    remedies: [
      'Add a unique @key attribute to the root repeated item (e.g., @key="item.id").'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-w29'
  },
  AVX_W35: {
    code: 'AVX_W35',
    name: 'DeprecatedLifecycleHook',
    severity: 'warning',
    category: 'runtime',
    summary: 'A deprecated lifecycle method was invoked on the component instance.',
    causes: [
      'Using legacy lifecycle methods slated for deprecation.'
    ],
    remedies: [
      'Migrate to updated lifecycle hooks as specified in the migration guide.'
    ],
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-w35'
  },

  // Atlas diagnostics (AVX_W40 - AVX_W41)
  AVX_W40: {
    code: 'AVX_W40',
    name: 'AtlasUnreadState',
    severity: 'warning',
    category: 'compiler',
    summary: 'A declared state key is not read anywhere Atlas can see.',
    causes: [
      'The state was written but the code meant to render or derive from it was never added.',
      'The last reader was deleted and the declaration outlived it.',
      'The state is superseded by a computed or a bridge getter that reads something else.'
    ],
    remedies: [
      'Run `avenx impact <owner>.<key>` to see every relationship Atlas did find before deleting anything.',
      'Delete the declaration and its writers if the value really is dead.',
      'Add the missing read if the warning has caught a half-finished change.',
      'Silence it for one project with `"warnings": { "AVX_W40": "off" }` in avenx.config.json.'
    ],
    docsUrl: 'https://avenx.dev/docs/core-concepts/atlas#unread-state'
  },
  AVX_W41: {
    code: 'AVX_W41',
    name: 'AtlasUnreachableAction',
    severity: 'warning',
    category: 'compiler',
    summary: 'An action has no call site on any invocation surface Atlas models.',
    causes: [
      'The template handler that called it was renamed or removed.',
      'The action is called from code Atlas does not model, such as a bridge setup() or an imported helper module.',
      'It is dead code left behind by a refactor.'
    ],
    remedies: [
      'Run `avenx why <owner>.<action>` to confirm nothing reaches it.',
      'Wire up the missing @event handler or caller.',
      'Delete the action if it really is unreachable.',
      'Lifecycle actions the runtime calls by name (onMount, onUnmount, and the rest) are already exempt; if yours is invoked another way, silence the code with `"warnings": { "AVX_W41": "off" }`.'
    ],
    docsUrl: 'https://avenx.dev/docs/core-concepts/atlas#unreachable-action'
  },

  // Trace diagnostics (AVX_R25 - AVX_R28)
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
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-r25'
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
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-r26'
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
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-r27'
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
    docsUrl: 'https://avenx.dev/docs/troubleshooting#avx-r28'
  },
};

/**
 * Normalizes input code string to standard format (e.g. 'c01', 'avx_c01' -> 'AVX_C01').
 * @param {string} code
 * @returns {string}
 */
export function normalizeCode(code = '') {
  const clean = code.trim().toUpperCase();
  if (clean.startsWith('AVX_')) return clean;
  if (clean.startsWith('AVX')) return `AVX_${clean.slice(3)}`;
  return `AVX_${clean}`;
}

/**
 * Looks up an entry from the catalogue.
 * @param {string} code
 * @returns {object|null}
 */
export function getDiagnostic(code) {
  const normalized = normalizeCode(code);
  return DIAGNOSTIC_CATALOGUE[normalized] || null;
}

/**
 * Suggests near matches for an unknown code.
 * @param {string} inputCode
 * @returns {string[]}
 */
export function suggestCodes(inputCode) {
  const normalized = normalizeCode(inputCode);
  return Object.keys(DIAGNOSTIC_CATALOGUE).filter((k) => {
    return (
      k.includes(normalized) ||
      k.replace('AVX_', '').includes(normalized.replace('AVX_', ''))
    );
  });
}
