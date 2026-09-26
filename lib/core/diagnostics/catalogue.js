/**
 * Structured diagnostic catalogue mapping stable error and warning codes
 * to detailed descriptions, causes, remedies, and documentation links.
 */
export const DIAGNOSTIC_CATALOGUE = {
  // Compiler Diagnostics (AVX_C01 - AVX_C06)
  AVX_C01: {
    code: 'AVX_C01',
    name: 'CompilerDistCreationFailed',
    severity: 'error',
    category: 'compiler',
    summary: 'The compiler could not create the build output (dist) directory.',
    causes: [
      'The process lacks write permission for the configured dist path.',
      'A non-directory file already exists at the dist location.'
    ],
    remedies: [
      'Ensure the project directory is writable by the build process.',
      'Remove or rename any file blocking the dist path, then rebuild.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c01-compiler-dist-creation-failed'
  },
  AVX_C02: {
    code: 'AVX_C02',
    name: 'CompilerSrcDirMissing',
    severity: 'error',
    category: 'compiler',
    summary: 'The project source directory (src) does not exist.',
    causes: [
      'avenx build or avenx check was run outside a scaffolded project.',
      'srcDir in avenx.config.json points at a missing folder.'
    ],
    remedies: [
      'Run avenx init to create a project skeleton.',
      'Create the configured source directory or correct srcDir.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#src-directory-missing'
  },
  AVX_C03: {
    code: 'AVX_C03',
    name: 'CompilerDuplicateComponentName',
    severity: 'error',
    category: 'compiler',
    summary: 'Two or more component files compile to the same class name.',
    causes: [
      'Component class names are derived from file names, so identically named files collide when bundled.'
    ],
    remedies: [
      'Rename or move one of the conflicting files so each produces a distinct class name.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#component-name-conflict'
  },
  AVX_C04: {
    code: 'AVX_C04',
    name: 'CompilerContractStaticViolation',
    severity: 'error',
    category: 'compiler',
    summary: 'A node or component marked with the static contract contains dynamic content.',
    causes: [
      'Interpolations, bindings, or other dynamic expressions appear under a static contract.'
    ],
    remedies: [
      'Remove the dynamic expression, or drop the static contract from that subtree.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c04-static-contract-violation'
  },
  AVX_C05: {
    code: 'AVX_C05',
    name: 'CompilerContractIsolatedViolation',
    severity: 'error',
    category: 'compiler',
    summary: 'An isolated component reaches outside its isolation boundary.',
    causes: [
      'The template or script accesses $bridges, $parent, or other external scope while isolated.'
    ],
    remedies: [
      'Remove the external access, or stop declaring the isolated contract on that component.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c05-isolated-contract-violation'
  },
  AVX_C06: {
    code: 'AVX_C06',
    name: 'CompilerContractInvalidDeclaration',
    severity: 'error',
    category: 'compiler',
    summary: 'A <contract /> declaration is unknown or malformed.',
    causes: [
      'An unrecognized contract name or invalid contract attribute syntax was used.'
    ],
    remedies: [
      'Use a supported contract name and check the contract declaration syntax in the docs.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c06-invalid-contract-declaration'
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

  // Warning Diagnostics (AVX_W01 - AVX_W35)
  AVX_W01: {
    code: 'AVX_W01',
    name: 'CompilerBundleSizeExceeded',
    severity: 'warning',
    category: 'compiler',
    summary: 'A compiled JavaScript or CSS asset exceeded the configured bundle size budget.',
    causes: [
      'Large third-party dependencies are included in the application bundle.',
      'Unused code or assets are bundled unnecessarily.',
      'Bundle size limits are configured too aggressively for the project.'
    ],
    remedies: [
      'Review generated assets and split or remove large dependencies.',
      'Raise build.bundleBudget in avenx.config.json if the size is expected.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w01-compiler-bundle-size-exceeded'
  },
  AVX_W03: {
    code: 'AVX_W03',
    name: 'CompilerUndeclaredReference',
    severity: 'warning',
    category: 'compiler',
    summary: 'A template references a variable or method that is not declared on the component.',
    causes: [
      'A typo in a variable or method name.',
      'Referencing state, computed, actions, or bridges that were never declared.'
    ],
    remedies: [
      'Verify the identifier spelling against state, computed, actions, and bridges.',
      'Update the template after renaming a declaration.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w03-compiler-undeclared-reference'
  },
  AVX_W29: {
    code: 'AVX_W29',
    name: 'CompilerCircularDependency',
    severity: 'warning',
    category: 'compiler',
    summary: 'The compiler detected a circular dependency in the component import graph.',
    causes: [
      'Two components import each other directly.',
      'A longer import chain loops back to an earlier component.'
    ],
    remedies: [
      'Remove imports that close a cycle.',
      'Extract shared code into a module both sides can import without looping.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w29-compiler-circular-dependency'
  },
  AVX_W35: {
    code: 'AVX_W35',
    name: 'CompilerDeadlockParseFailed',
    severity: 'warning',
    category: 'compiler',
    summary: 'The compiler could not parse a <@deadlock> tag or its attributes.',
    causes: [
      'Malformed or unclosed <@deadlock> / <@fallback> tags.',
      'Invalid attribute values on a <@deadlock> boundary.'
    ],
    remedies: [
      'Fix tag nesting and quoted attributes on the <@deadlock> block.',
      'Confirm nested <@fallback as="..."> is closed with </@fallback>.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w35-compiler-deadlock-parse-failed'
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
    docsUrl: 'https://avenx-js.com/core-concepts/atlas#avx-w40-unread-state'
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
    docsUrl: 'https://avenx-js.com/core-concepts/atlas#avx-w41-unreachable-action'
  },

  // Rewind diagnostics (AVX_W42 - AVX_W44, AVX_R29)
  AVX_W42: {
    code: 'AVX_W42',
    name: 'TransactionUnbounded',
    severity: 'warning',
    category: 'compiler',
    summary: "An atomic action's write set could not be resolved completely.",
    causes: [
      'The action reaches state through a computed member, a spread, or an identifier Atlas could not resolve.',
      'The action writes state from inside a promise continuation, which runs outside the transaction and is therefore not journaled.',
      'The action calls into a module Atlas does not model, so what that call writes is unknown here.'
    ],
    remedies: [
      'The rewind itself is unaffected: the journal observes the reactive proxies, not this analysis. What is incomplete is the report.',
      'Move optimistic writes ahead of the promise the action returns, so they sit inside the transaction.',
      'Run `avenx why <owner>.<action>` to see which relationships Atlas did resolve.',
      'Silence it for one project with `"warnings": { "AVX_W42": "off" }` in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/core-concepts/rewind#avx-w42-the-write-set-is-incomplete'
  },
  AVX_W43: {
    code: 'AVX_W43',
    name: 'TransactionIrreversible',
    severity: 'warning',
    category: 'compiler',
    summary: 'An atomic action performs an effect that a rewind cannot undo.',
    causes: [
      'The action emits a bridge event, writes to localStorage or sessionStorage, touches the DOM directly, or starts a timer.',
      'The action performs a request whose result it neither returns nor stores, so the transaction cannot tie its outcome to the rewind.'
    ],
    remedies: [
      'Move the effect after the transaction, where it runs only once the writes have committed.',
      'Return the promise whose rejection should trigger the rewind, so it becomes the transaction outcome rather than a loose effect.',
      'Accept it: state is still restored, and the listed effects are what a rewind will leave behind.',
      'Silence it for one project with `"warnings": { "AVX_W43": "off" }` in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/core-concepts/rewind#avx-w43-an-effect-a-rewind-cannot-undo'
  },
  AVX_W44: {
    code: 'AVX_W44',
    name: 'TransactionOverlap',
    severity: 'warning',
    category: 'compiler',
    summary: 'Two atomic actions write the same state and may be in flight at the same time.',
    causes: [
      'Two optimistic updates target one value — the classic double-click on a counter or a like button.',
      'An action and its inverse both write the key they toggle.'
    ],
    remedies: [
      'Guard the second invocation while the first is in flight, e.g. with a busy flag the template disables the control on.',
      'Nothing may be wrong: the default "safe" conflict policy refuses to discard a newer value and reports AVX_R29 instead.',
      'Set onConflict="force" on the action when the transaction really is the authority on that value.',
      'Silence it for one project with `"warnings": { "AVX_W44": "off" }` in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/core-concepts/rewind#avx-w44-two-transactions-writing-the-same-state'
  },
  AVX_W46: {
    code: 'AVX_W46',
    name: 'UnresolvedComponentReference',
    severity: 'warning',
    category: 'compiler',
    summary: 'A PascalCase template tag resolves to no registered component, built-in tag, or known HTML/SVG element.',
    causes: [
      'The component name is misspelled — the single most common template mistake, e.g. <UserCrad /> for <UserCard />.',
      'The component file was never created, or was renamed and a call site was missed.',
      'The tag was meant to be a plain HTML element but was written in PascalCase.'
    ],
    remedies: [
      'Fix the spelling — the warning names the closest registered component when one is near enough.',
      'Create the component file (e.g. "UserCard.component.js") so the name resolves.',
      'Use a lowercase HTML element, or a dash-containing custom element (e.g. "my-widget") which is never flagged.',
      'If the component is registered at runtime via app.register(), silence the code with "warnings": { "AVX_W46": "off" } in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w46-unresolved-component-reference'
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

  // Trace diagnostics (AVX_R25 - AVX_R28)
  AVX_C23: {
    code: 'AVX_C23',
    name: 'CompilerMissingRuntimeCapability',
    severity: 'error',
    category: 'compiler',
    summary: 'The build linked a runtime capability and the bundle it produced does not contain it.',
    causes: [
      'The same runtime file was reached by two different paths and bundled twice, so the registry the capability installs itself into was split.',
      'avenx-core is reached through a symlink -- npm link, a file: dependency, a pnpm store or a workspace -- and resolution did not canonicalise it.',
      'A code generator emitted the module that installs the capability without the import that runs it.'
    ],
    remedies: [
      'Rebuild from a clean dist/ directory.',
      'Reinstall dependencies so avenx-core resolves to a single location.',
      'This is a compiler defect rather than a mistake in your source. Nothing was written, so the previous build is intact; please report it with the template that triggered it.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c23-compiler-missing-runtime-capability'
  },
  AVX_C24: {
    code: 'AVX_C24',
    name: 'CompilerInvalidStyleDirective',
    severity: 'error',
    category: 'compiler',
    summary: 'An @css attribute or <@css /> tag does not name a style block.',
    causes: [
      'The attribute was written "@css" with nothing after it, or with a value (@css="card").',
      'The name after @css is not a plain block name (letters, digits, "_" and "-").',
      'A <@css /> tag was written without a block name.'
    ],
    remedies: [
      'Write the attribute as "@css blockName" and the tag as "<@css blockName />".',
      'Declare the block inside <@css> in the component stylesheet.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c24-compiler-invalid-style-directive'
  },
  AVX_C25: {
    code: 'AVX_C25',
    name: 'CompilerTemplateRewriteIncomplete',
    severity: 'error',
    category: 'compiler',
    summary: 'A directive the template front-end rewrites was still present after rewriting.',
    causes: [
      'The front-end failed to apply @css, <@css /> or data-ax-bind to a tag it should have recognised. Emitting the template anyway would render a component that silently differs from its source.'
    ],
    remedies: [
      'This is a compiler defect rather than a mistake in your source. Nothing was written, so the previous build is intact; please report it with the template that triggered it.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c25-compiler-template-rewrite-incomplete'
  },
  AVX_C26: {
    code: 'AVX_C26',
    name: 'CompilerMalformedTemplate',
    severity: 'error',
    category: 'compiler',
    summary: 'A tag or comment in a template is never terminated.',
    causes: [
      'An opening tag has no closing ">", usually because an attribute quote is never closed.',
      'A "<!--" comment has no matching "-->".',
      'An <action> or <resource> declaration has no closing tag, so its JavaScript body would be read as markup.'
    ],
    remedies: [
      'Close the tag, the attribute quote or the comment at the location shown.',
      'Everything after an unterminated construct would be read as part of it, so the build stops rather than guessing.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c26-compiler-malformed-template'
  },
  AVX_C30: {
    code: 'AVX_C30',
    name: 'CompilerUnhandledAstNode',
    severity: 'error',
    category: 'compiler',
    summary: 'A compiler pass reached a template AST node type it has no branch for.',
    causes: [
      'A change to the template parser introduced a node type that an existing pass was never taught to read.',
      'A pass was handed a hand-built node whose "type" is not one the parser produces.'
    ],
    remedies: [
      'Add an explicit branch for the reported node type to the pass named in the message.',
      'This is an internal invariant, not a template mistake: a node type with no branch would otherwise be mis-handled silently and emit output that looks valid, so the build stops instead.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c30-compiler-unhandled-ast-node'
  },
  AVX_W49: {
    code: 'AVX_W49',
    name: 'CompilerUnknownStyleBlock',
    severity: 'warning',
    category: 'compiler',
    summary: 'A template names a style block its stylesheet does not declare.',
    causes: [
      'The block name after @css or <@css /> is misspelled.',
      'The component has no stylesheet, or the block lives in a different component\'s stylesheet.'
    ],
    remedies: [
      'Declare the block inside <@css> in the component stylesheet, or correct the name.',
      'The element still renders, without the scoped class.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w49-compiler-unknown-style-block'
  },
  AVX_W50: {
    code: 'AVX_W50',
    name: 'CompilerStyleDirectiveNoTarget',
    severity: 'warning',
    category: 'compiler',
    summary: 'A <@css /> tag has no element to style.',
    causes: [
      'The tag follows text, an interpolation or a directive rather than an element.',
      'The tag is the first thing in the template, so it has no host element.'
    ],
    remedies: [
      'Place <@css name /> as the first child of the element it styles, or immediately after that element.',
      'Use the attribute form, <div @css name>, on the element itself.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w50-compiler-style-directive-no-target'
  },
  AVX_C27: {
    code: 'AVX_C27',
    name: 'CompilerExpressionNotExecutable',
    severity: 'error',
    category: 'compiler',
    summary: 'A production build contains an expression the code generator could not compile.',
    causes: [
      'A template expression, computed value or directive uses syntax outside the expression language, such as a destructuring arrow parameter, a regular-expression literal or delete.',
      'An event handler or action body is not valid JavaScript.',
      'A <@defer when> value combines several triggers, which is not supported.'
    ],
    remedies: [
      'Rewrite the expression in the supported expression language; the message names the file, the line and the reason.',
      'Move the logic into an <action>, whose body is ordinary JavaScript, and call it from the template.',
      'Use "avenx build --dev" to keep building with AVX_W48 while you fix it. A production bundle has no interpreter, so the expression would throw AVX_R32 when evaluated.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c27-compiler-expression-not-executable'
  },
  AVX_W48: {
    code: 'AVX_W48',
    name: 'CompilerExpressionNotCompiled',
    severity: 'warning',
    category: 'compiler',
    summary: 'A development build contains an expression the code generator could not compile.',
    causes: [
      'The expression uses syntax outside the expression language, or a handler or action body is not valid JavaScript.'
    ],
    remedies: [
      'Rewrite it in the supported expression language, or move the logic into an <action>.',
      'The expression fails with AVX_R32 when evaluated in development too; a production build refuses it with AVX_C27.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w48-compiler-expression-not-compiled'
  },
  AVX_W51: {
    code: 'AVX_W51',
    name: 'CompilerStateNotLiteral',
    severity: 'warning',
    category: 'compiler',
    summary: 'A bracketed <state> initialiser is not a constant literal and stays a string.',
    causes: [
      'An object or array initialiser refers to a variable, calls a function, spreads another value, uses a computed key or a template literal with substitutions.',
      'An object initialiser defines __proto__, constructor or prototype.'
    ],
    remedies: [
      'Write the value with constants only: strings, numbers, booleans, null, arrays and objects.',
      'Set the value in onMount, or declare a <computed>.',
      'If the text is meant to be a string, quote it: title="\'{ literal }\'".'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w51-compiler-state-not-literal'
  },
  AVX_C28: {
    code: 'AVX_C28',
    name: 'CompilerBoundEventAttribute',
    severity: 'error',
    category: 'compiler',
    summary: 'An interpolated on* handler would run a value as code.',
    causes: [
      'An inline event-handler attribute such as onclick or onerror on an HTML element has an interpolated value, e.g. onclick="{{ handler }}". Its value is executed as JavaScript, so a state value becomes code, and it does not run under a strict CSP.'
    ],
    remedies: [
      'Use the event directive: @click="handler" or @click="handler()".',
      'on* on a child component (PascalCase tag) is a prop, not a handler, and is not affected.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c28-compiler-bound-event-attribute'
  },
  AVX_C29: {
    code: 'AVX_C29',
    name: 'CompilerInterpolatedDynamicAttribute',
    severity: 'error',
    category: 'compiler',
    summary: 'A dynamic attribute binding has {{ }} in a slot that is already an expression.',
    causes: [
      'A dynamic attribute binding was written as :[key]="{{ value }}" or :[{{ key }}]="value". Both slots of :[name]="value" are expressions, so the braces are part of the expression: it resolves to nothing and the attribute is never set, in development and in production alike.'
    ],
    remedies: [
      'Drop the braces: :[key]="value".',
      'To interpolate into an attribute whose name is fixed, write an ordinary attribute instead: data-tone="{{ value }}".'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c29-compiler-interpolated-dynamic-attribute'
  },
  AVX_W52: {
    code: 'AVX_W52',
    name: 'CompilerInlineEventAttribute',
    severity: 'warning',
    category: 'compiler',
    summary: 'A static inline on* handler bypasses the event system and a strict CSP.',
    causes: [
      'An HTML element has a literal inline handler such as onclick="doThing()".'
    ],
    remedies: [
      'Prefer the event directive: @click="doThing()".',
      'Kept as a capability; silence with "warnings": { "AVX_W52": "off" } if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w52-compiler-inline-event-attribute'
  },
  AVX_W53: {
    code: 'AVX_W53',
    name: 'AtlasNoReachablePage',
    severity: 'warning',
    category: 'compiler',
    summary: 'The application compiles pages that no route names and no mountPage() call mounts, so none of them can be rendered.',
    causes: [
      'main.app.js constructs an AvenxApp but never calls initRouter() or mountPage().',
      'Pages were added with "avenx generate page" without registering them in the route table.'
    ],
    remedies: [
      'Declare a route table: app.initRouter({ \'\': \'Home\' }).',
      'Or mount a page directly: app.mountPage(\'Home\').',
      'Silence with "warnings": { "AVX_W53": "off" } if the application mounts pages some other way.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w53-atlas-no-reachable-page'
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
  AVX_W56: {
    code: 'AVX_W56',
    name: 'AtlasUnregisteredComponent',
    severity: 'warning',
    category: 'compiler',
    summary: 'A template renders a component the application never registers.',
    causes: [
      'main.app.js does not call app.register() for the component.',
      'The registration was removed, or the file was rewritten by hand after "avenx generate component" added it.'
    ],
    remedies: [
      'Import the component in main.app.js and call app.register(\'Name\', Name).',
      'Remove the tag from the template if the component is no longer wanted.',
      'Silence with "warnings": { "AVX_W56": "off" } if the component is registered some other way.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w56-atlas-unregistered-component'
  },
  AVX_W54: {
    code: 'AVX_W54',
    name: 'CompilerUnterminatedInterpolation',
    severity: 'warning',
    category: 'compiler',
    summary: 'An interpolation is opened in a template and never closed.',
    causes: [
      'A "{{" was written without a matching "}}".',
      'Another "{{" appears before the closing "}}", so neither is terminated.'
    ],
    remedies: [
      'Close the interpolation with "}}".',
      'If the braces are meant as literal text, escape or restructure them.',
      'Silence with "warnings": { "AVX_W54": "off" } if a template legitimately contains literal "{{".'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w54-compiler-unterminated-interpolation'
  },
  AVX_W55: {
    code: 'AVX_W55',
    name: 'CompilerUnusedStyleBlock',
    severity: 'warning',
    category: 'compiler',
    summary: 'A stylesheet declares a style block no template names, so it is not emitted.',
    causes: [
      'The stylesheet was written with CSS selectors (".card { }") rather than Avenx block names ("card { }").',
      'The template styles its elements with class attributes instead of the @css directive.',
      'A block was renamed in one file but not the other.'
    ],
    remedies: [
      'Name the block on the element it styles: <div @css card>.',
      'Rename the block to a plain word, since @css only accepts [A-Za-z0-9_-].',
      'Delete the block if it is genuinely unused.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w55-compiler-unused-style-block'
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
