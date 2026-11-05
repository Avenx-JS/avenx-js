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
  AVX_C31: {
    code: 'AVX_C31',
    name: 'CompilerCspStrictExpression',
    severity: 'error',
    category: 'compiler',
    summary: 'A CSP-strict build contains an expression the code generator could not compile.',
    causes: [
      'csp.strict is on, and a template expression, computed value, directive, list key or handler uses syntax outside the expression language.',
      'csp.strict is on in a development build, where the same expression would otherwise be reported as AVX_W48 and interpreted at runtime.'
    ],
    remedies: [
      'Rewrite the expression in the supported expression language; the message names the component, the file, the line and the reason.',
      'Move the logic into an <action>, whose body is ordinary JavaScript, and call it from the template.',
      'Remove "csp": { "strict": true } from avenx.config.json to go back to AVX_W48 in development while you work on it.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c31-compiler-csp-strict-expression'
  },
  AVX_C32: {
    code: 'AVX_C32',
    name: 'CompilerCspStrictDynamicCode',
    severity: 'error',
    category: 'compiler',
    summary: 'A CSP-strict build emitted output that can still construct code from a string.',
    causes: [
      'A hand-written module in the project calls eval or the Function constructor, or uses a with-statement.',
      'A dependency the bundle links does one of those.',
      'A framework module that needs \'unsafe-eval\' was reachable from the entry graph, which is a bug in Avenx.'
    ],
    remedies: [
      'Rewrite the reported construct; the message names the artifact, the line and the source text.',
      'Keep the dependency out of the bundle, or replace it with one that does not evaluate source at run time.',
      'Report it if the construct is in framework code: a CSP-strict build is meant to be able to promise this.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c32-compiler-csp-strict-dynamic-code'
  },
  AVX_C33: {
    code: 'AVX_C33',
    name: 'CompilerImportMeta',
    severity: 'error',
    category: 'compiler',
    summary: 'A module in the bundle uses import.meta, which a classic script cannot contain.',
    causes: [
      'A project module reads import.meta.env, the spelling Vite uses for environment variables.',
      'A project module reads import.meta.url or another import.meta property.',
      'A dependency the bundle links uses import.meta; the message names the package.'
    ],
    remedies: [
      'Read environment variables as process.env.AVX_PUBLIC_* in the entry, components, pages, bridges or guards. The build inlines it there, but not in other imported modules.',
      'Use document.baseURI in place of import.meta.url for the page\'s own address.',
      'For a dependency, use a browser build of the package or a package that does not need import.meta.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c33-compiler-import-meta'
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
  AVX_W62: {
    code: 'AVX_W62',
    name: 'CompilerUndeclaredSlot',
    severity: 'warning',
    category: 'compiler',
    summary: 'A template addresses a slot the component does not declare.',
    causes: [
      'A typo in the slot name.',
      'The slot was renamed in the component but not updated in the caller.',
      'Unnamed content passed to a component with no default slot.'
    ],
    remedies: [
      'Fix the spelling — the warning names the closest declared slot when one is near enough.',
      'Update the caller template to match the component’s declared slots.',
      'If intentional, silence with `"warnings": { "AVX_W62": "off" }` in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w62-compiler-undeclared-slot'
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
  AVX_W58: {
    code: 'AVX_W58',
    name: 'UnresolvedDefReference',
    severity: 'warning',
    category: 'styling',
    summary: 'An @def variable reference in a stylesheet could not be resolved and was left as literal text in the emitted CSS.',
    causes: [
      'A typo occurred when referencing an @def variable name (e.g. "@brnad" instead of "@brand").',
      'The @def variable was not declared in the component stylesheet or global scope.',
      'A self-referential or circular @def declaration could not be resolved during compilation.'
    ],
    remedies: [
      'Check the spelling of the @def variable reference in the stylesheet.',
      'Ensure the corresponding @def variable is declared inside a <@global> or local stylesheet block.',
      'Fix any circular or self-referential @def variable declarations.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w58-compiler-unresolved-def-reference'
  },
  AVX_W59: {
    code: 'AVX_W59',
    name: 'DuplicateRoutePattern',
    severity: 'warning',
    category: 'routing',
    summary: 'A route pattern is declared multiple times in initRouter(). The last declaration shadows earlier ones.',
    causes: [
      'The same route pattern path (e.g. "/dup") was defined more than once in the router configuration object.',
      'A copy-paste error occurred when defining route paths.'
    ],
    remedies: [
      'Remove or rename the duplicate route pattern in app.initRouter().',
      'Ensure each route pattern points to a unique or intended target page class.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w59-compiler-duplicate-route-pattern'
  },
  AVX_W60: {
    code: 'AVX_W60',
    name: 'UndefinedPublicEnv',
    severity: 'warning',
    category: 'environment',
    summary: 'A process.env.AVX_PUBLIC_* reference has no value, so the build inlined undefined in its place.',
    causes: [
      'The variable name is misspelled (e.g. "AVX_PUBLIC_API_URLL" instead of "AVX_PUBLIC_API_URL").',
      'The variable is missing from .env, or from the CI environment the build ran in.'
    ],
    remedies: [
      'Run `avenx env` to list every AVX_PUBLIC_* value the build can see, and correct the reference.',
      'Add the variable to .env or to the build environment.',
      'Silence with "warnings": { "AVX_W60": "off" } if undefined is intended.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w60-compiler-undefined-public-env'
  },
  AVX_W61: {
    code: 'AVX_W61',
    name: 'UnknownEventModifier',
    severity: 'warning',
    category: 'compiler',
    summary: 'An event attribute contains an unknown modifier that has no effect.',
    causes: [
      'A modifier name is misspelled, such as .prevnt instead of .prevent.',
      'The event handler uses an unsupported modifier.'
    ],
    remedies: [
      'Correct the modifier using the suggested name, or remove it.',
      'Consult the event modifiers guide for supported names.',
      'Silence with "warnings": { "AVX_W61": "off" } if the name is intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w61-compiler-unknown-event-modifier'
  },
  AVX_W63: {
    code: 'AVX_W63',
    name: 'CompilerJsModuleAsTemplate',
    severity: 'warning',
    category: 'compiler',
    summary: 'A .component.js file contains a JavaScript module rather than a component template.',
    causes: [
      'An ordinary JavaScript module or helper was saved with a .component.js extension.',
      'A class-based component was placed in a .component.js file instead of using single-file component syntax.',
      'A component file contains export, import, class, or variable declarations at the top level instead of HTML markup.'
    ],
    remedies: [
      'Rename non-component JavaScript files to end with .js rather than .component.js.',
      'Convert class-based components to single-file component template syntax, or use .js for class components registered manually.',
      'Ensure the .component.js file begins with template markup or Avenx declaration tags (<state>, <computed>, <action>, etc.).'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w63-compiler-js-module-as-template'
  },
  AVX_W64: {
    code: 'AVX_W64',
    name: 'AtlasComputedCircularDependency',
    severity: 'warning',
    category: 'compiler',
    summary: 'A computed property reads itself directly or through a cycle of other computeds.',
    causes: [
      'A <computed> expression names its own declaration on the right-hand side.',
      'Two or more computeds form a mutual READS cycle (a reads b, b reads a).'
    ],
    remedies: [
      'Rewrite the expression so it does not reference its own key.',
      'Break mutual cycles by deriving one computed from state or from a non-circular computed.',
      'Run `avenx why <owner>.<computed>` to inspect the edges Atlas recorded.',
      'Silence it for one project with `"warnings": { "AVX_W64": "off" }` in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w64-atlas-computed-circular-dependency'
  },
  AVX_W65: {
    code: 'AVX_W65',
    name: 'CompilerA11yImageAlt',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An <img> element is missing an alt attribute.',
    causes: [
      'An <img> tag was written without an alt attribute.'
    ],
    remedies: [
      'Provide an alt attribute describing the image, or alt="" if the image is decorative.',
      'Silence with "warnings": { "AVX_W65": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w65-compiler-a11y-image-alt'
  },
  AVX_W66: {
    code: 'AVX_W66',
    name: 'CompilerA11yInteractiveRole',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An interactive event handler was placed on a non-interactive element without an accessible role or keyboard listener.',
    causes: [
      'A non-interactive element (such as <div> or <span>) defines @click but lacks an accessible role and keyboard access.'
    ],
    remedies: [
      'Use a native <button> element, or add role="button" and a keyboard event handler (@keydown).',
      'Silence with "warnings": { "AVX_W66": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w66-compiler-a11y-interactive-role'
  },
  AVX_W67: {
    code: 'AVX_W67',
    name: 'CompilerA11yAnchorHref',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An <a> element is missing an href attribute.',
    causes: [
      'An <a> tag is used without an href attribute (typically to trigger an action rather than navigate).'
    ],
    remedies: [
      'Provide a valid href attribute, or replace the anchor with a <button> element.',
      'Silence with "warnings": { "AVX_W67": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w67-compiler-a11y-anchor-href'
  },
  AVX_W68: {
    code: 'AVX_W68',
    name: 'CompilerA11yFormLabel',
    severity: 'warning',
    category: 'accessibility',
    summary: 'A form control element has no associated label or accessible name.',
    causes: [
      'An <input>, <select>, or <textarea> element lacks an associated <label>, aria-label, or aria-labelledby attribute.'
    ],
    remedies: [
      'Associate a <label for="..."> with the control, wrap it in a <label>, or provide an aria-label attribute.',
      'Silence with "warnings": { "AVX_W68": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w68-compiler-a11y-form-label'
  },
  AVX_W69: {
    code: 'AVX_W69',
    name: 'CompilerA11yButtonName',
    severity: 'warning',
    category: 'accessibility',
    summary: 'A <button> element has no accessible name.',
    causes: [
      'A <button> element contains no text content or descriptive child elements, and lacks an aria-label or aria-labelledby attribute.'
    ],
    remedies: [
      'Add visible text content inside the <button>, or provide an aria-label or aria-labelledby attribute.',
      'Silence with "warnings": { "AVX_W69": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w69-compiler-a11y-button-name'
  },
  AVX_W70: {
    code: 'AVX_W70',
    name: 'CompilerA11yPositiveTabindex',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An element specifies a positive tabindex value.',
    causes: [
      'An element has a tabindex greater than zero, which disrupts the natural keyboard tab navigation sequence.'
    ],
    remedies: [
      'Use tabindex="0" to place the element in natural tab order, or tabindex="-1" for programmatic focus.',
      'Silence with "warnings": { "AVX_W70": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w70-compiler-a11y-positive-tabindex'
  },
  // Remaining diagnostics (AVX_C07 - AVX_C22, AVX_R02 - AVX_R32, AVX_W02 - AVX_W47)
  AVX_C07: {
    code: 'AVX_C07',
    name: 'CompilerBridgeNotFound',
    severity: 'error',
    category: 'compiler',
    summary: 'A bridge import could not be resolved to a bridge module.',
    causes: [
      'A component, page or bridge imports a .bridge.js file that does not exist, usually after a typo or a move.'
    ],
    remedies: [
      'Correct the import path, or create the bridge file. The message lists every bridge the project did discover.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c07-compiler-bridge-not-found'
  },
  AVX_C08: {
    code: 'AVX_C08',
    name: 'CompilerBridgeDuplicateName',
    severity: 'error',
    category: 'compiler',
    summary: 'Two bridge files resolve to the same bridge name.',
    causes: [
      'Bridge names are derived from file names, so files with the same base name in different folders collide.'
    ],
    remedies: [
      'Rename one of the files so each bridge name is unique, for example auth.bridge.js to admin-auth.bridge.js.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c08-compiler-bridge-duplicate-name'
  },
  AVX_C09: {
    code: 'AVX_C09',
    name: 'CompilerBridgeUnsupportedImport',
    severity: 'error',
    category: 'compiler',
    summary: 'A bridge imports a module the Avenx bundler could not inline.',
    causes: [
      'The bridge imports something the bundler cannot resolve into the bridge bundle. An import that resolves to nothing is now reported as AVX_C17 instead.'
    ],
    remedies: [
      'Keep helpers inside the bridge file, or import only modules the bundler can resolve.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c09-compiler-bridge-unsupported-import'
  },
  AVX_C10: {
    code: 'AVX_C10',
    name: 'CompilerBridgeIsolatedImport',
    severity: 'error',
    category: 'compiler',
    summary: 'A component with the isolated contract imports a bridge.',
    causes: [
      'An isolated component may not reach outside its own state, and importing a bridge does exactly that.'
    ],
    remedies: [
      'Remove the bridge import and pass the value in as a prop, or drop the isolated contract.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c10-compiler-bridge-isolated-import'
  },
  AVX_C11: {
    code: 'AVX_C11',
    name: 'CompilerBridgeCircularImport',
    severity: 'error',
    category: 'compiler',
    summary: 'Bridge modules import each other in a cycle.',
    causes: [
      'Bridges are initialised in dependency order, so a cycle has no valid order and would fail at load time.'
    ],
    remedies: [
      'Move the shared state into a third bridge that both import, or pass the value as an action argument instead of reaching across.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c11-compiler-bridge-circular-import'
  },
  AVX_C12: {
    code: 'AVX_C12',
    name: 'CompilerBridgeInvalidModule',
    severity: 'error',
    category: 'compiler',
    summary: 'A .bridge.js file is not a bridge module.',
    causes: [
      'The file does not import the bridge() factory from the Avenx runtime and export the definition it returns.'
    ],
    remedies: [
      'Convert the module to export default bridge({ state: { } }), or rename the file if it is not meant to be a bridge.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c12-compiler-bridge-invalid-module'
  },
  AVX_C13: {
    code: 'AVX_C13',
    name: 'CompilerRuntimeMissing',
    severity: 'error',
    category: 'compiler',
    summary: 'The Avenx runtime bundle file is missing from the installed package.',
    causes: [
      'The avenx-core install is incomplete or damaged. This code is retired: the runtime is now source linked into the application graph, and a missing install surfaces as AVX_C17 instead.'
    ],
    remedies: [
      'Reinstall avenx-core, or run npm run build if you are working inside the framework repository.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c13-compiler-runtime-missing'
  },
  AVX_C14: {
    code: 'AVX_C14',
    name: 'CompilerHookFailed',
    severity: 'error',
    category: 'compiler',
    summary: 'A build lifecycle hook command failed.',
    causes: [
      'A prebuild or postbuild command configured under hooks in avenx.config.json exited non-zero. A hook is part of the build, so its failure aborts the build.'
    ],
    remedies: [
      'Run the hook command yourself to see its output and fix it, or remove it from hooks if it is not meant to gate the build.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c14-compiler-hook-failed'
  },
  AVX_C15: {
    code: 'AVX_C15',
    name: 'CompilerInvalidOutput',
    severity: 'error',
    category: 'compiler',
    summary: 'The compiler produced output that is not valid JavaScript.',
    causes: [
      'The final generated JavaScript fails the compiler parse check. This is a compiler defect, not a mistake in your source, and nothing was written to the output directory.'
    ],
    remedies: [
      'Report the defect with the source that triggered it. The previous build is still in place.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c15-compiler-invalid-output'
  },
  AVX_C16: {
    code: 'AVX_C16',
    name: 'CompilerDuplicateBundleBinding',
    severity: 'error',
    category: 'compiler',
    summary: 'Two modules compile to the same bundle-scope name.',
    causes: [
      'A compiled application is one script, so two modules publishing the same uniquely named binding collide in the bundle scope.'
    ],
    remedies: [
      'Rename the class, the exported binding, or the file so the two no longer collide.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c16-compiler-duplicate-bundle-binding'
  },
  AVX_C17: {
    code: 'AVX_C17',
    name: 'CompilerUnresolvedImport',
    severity: 'error',
    category: 'compiler',
    summary: 'An import could not be resolved to any module.',
    causes: [
      'The imported path does not match a file, package export, or alias the bundler can resolve.'
    ],
    remedies: [
      'Fix the import path or install the missing package. The build stops rather than dropping the import, because a bundle missing a module fails later at run time.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c17-compiler-unresolved-import'
  },
  AVX_C18: {
    code: 'AVX_C18',
    name: 'CompilerMissingExport',
    severity: 'error',
    category: 'compiler',
    summary: 'An import names something the target module does not export.',
    causes: [
      'The imported name is misspelled, was renamed, or was never exported by the target module.'
    ],
    remedies: [
      'Use one of the names the module does export. The message lists them and suggests the closest match.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c18-compiler-missing-export'
  },
  AVX_C19: {
    code: 'AVX_C19',
    name: 'CompilerModuleUnreadable',
    severity: 'error',
    category: 'compiler',
    summary: 'The import and export declarations of a module could not be read.',
    causes: [
      'The module contains import or export syntax the bundler module reader cannot describe.'
    ],
    remedies: [
      'Simplify the declaration. If the syntax is valid ES modules, report it: a gap in the reader is a bug.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c19-compiler-module-unreadable'
  },
  AVX_C20: {
    code: 'AVX_C20',
    name: 'CompilerBundleCycle',
    severity: 'error',
    category: 'compiler',
    summary: 'A module cycle carries a binding that cannot cross it.',
    causes: [
      'Two modules import each other and one imports a value rather than a function. Only function declarations are initialised before a module body runs, so reading anything else across a cycle hits the temporal dead zone.'
    ],
    remedies: [
      'Break the cycle, or move the shared value behind a function that is called after both modules load.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c20-compiler-bundle-cycle'
  },
  AVX_C21: {
    code: 'AVX_C21',
    name: 'CompilerExpressionRefused',
    severity: 'error',
    category: 'compiler',
    summary: 'A template expression cannot be compiled because it breaks the sandbox rules.',
    causes: [
      'The expression names a restricted global or touches __proto__, constructor, or prototype.'
    ],
    remedies: [
      'Keep the template to supported expressions, or move the logic into an action if it genuinely needs a browser API.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c21-compiler-expression-refused'
  },
  AVX_C22: {
    code: 'AVX_C22',
    name: 'CompilerCompiledOnlyConstruct',
    severity: 'error',
    category: 'compiler',
    summary: 'A template uses a directive only the compiled renderer implements, but the template itself cannot be compiled.',
    causes: [
      'Falling back to the string renderer is not safe here: it has no rewrite for that directive and would render the tag into the document as a literal element.'
    ],
    remedies: [
      'Move the construct that refused to compile into a child component so this template compiles, or replace the conditional with data-ax-show.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c22-compiler-compiled-only-construct'
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
  AVX_W02: {
    code: 'AVX_W02',
    name: 'CompilerEmptyTemplate',
    severity: 'warning',
    category: 'compiler',
    summary: 'A component has an empty template.',
    causes: [
      'The component file declares no template content, so the component renders nothing.'
    ],
    remedies: [
      'Add the template markup, or remove the component if it is no longer used.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w02-compiler-empty-template'
  },
  AVX_W04: {
    code: 'AVX_W04',
    name: 'CompilerUnmatchedForTag',
    severity: 'warning',
    category: 'compiler',
    summary: 'A template has unmatched <@for> tags.',
    causes: [
      'An <@for> block is opened without a matching close, or closed without an open.'
    ],
    remedies: [
      'Check the <@for> nesting in the template and close every opened block.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w04-compiler-unmatched-for-tag'
  },
  AVX_W05: {
    code: 'AVX_W05',
    name: 'CompilerTransitionParseFailed',
    severity: 'warning',
    category: 'compiler',
    summary: 'Transition tags in a template could not be parsed.',
    causes: [
      'A transition tag is malformed, unclosed, or carries an invalid attribute.'
    ],
    remedies: [
      'Fix the transition tag syntax in the template named in the message.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w05-compiler-transition-parse-failed'
  },
  AVX_W06: {
    code: 'AVX_W06',
    name: 'CompilerStaticSubtreeOptimizationFailed',
    severity: 'warning',
    category: 'compiler',
    summary: 'A static subtree could not be optimised.',
    causes: [
      'The optimiser failed on a subtree it expected to be static, so that part of the template is rendered without the optimisation.'
    ],
    remedies: [
      'Check the content named in the message for dynamic constructs inside a static subtree.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w06-compiler-static-subtree-optimization-failed'
  },
  AVX_W07: {
    code: 'AVX_W07',
    name: 'PageAlreadyRegistered',
    severity: 'warning',
    category: 'routing',
    summary: 'A page name was registered twice, and the second registration overwrites the first.',
    causes: [
      'Two pages are registered under the same name, usually after a copy or rename.'
    ],
    remedies: [
      'Give each page a unique name and remove the duplicate registration.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w07-page-already-registered'
  },
  AVX_W08: {
    code: 'AVX_W08',
    name: 'RoutePathMissingLeadingSlash',
    severity: 'warning',
    category: 'routing',
    summary: 'A route path lacks a leading slash.',
    causes: [
      'The route was defined as "products" instead of "/products", which can prevent hash paths from resolving properly.'
    ],
    remedies: [
      'Start every route path with a slash.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w08-route-path-missing-leading-slash'
  },
  AVX_W09: {
    code: 'AVX_W09',
    name: 'RouteParamDecodeFailed',
    severity: 'warning',
    category: 'routing',
    summary: 'A route parameter could not be URI-decoded.',
    causes: [
      'The hash contains a malformed percent sequence, so decoding throws and the router falls back to the raw parameter string.'
    ],
    remedies: [
      'Encode route parameters when building links, for example with encodeURIComponent.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w09-route-param-decode-failed'
  },
  AVX_W10: {
    code: 'AVX_W10',
    name: 'RouteNotFound',
    severity: 'warning',
    category: 'routing',
    summary: 'No route is defined for the current hash.',
    causes: [
      'Navigation targeted a path that no registered route matches.'
    ],
    remedies: [
      'Add a route for the path, fix the link that points to it, or add a fallback route.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w10-route-not-found'
  },
  AVX_W11: {
    code: 'AVX_W11',
    name: 'RouteTitleEvaluationFailed',
    severity: 'warning',
    category: 'routing',
    summary: 'Evaluating a route title threw an error.',
    causes: [
      'The title() function for the route threw while the router was applying it.'
    ],
    remedies: [
      'Fix the error inside title() and make sure every value it reads is defined.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w11-route-title-evaluation-failed'
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
  AVX_W24: {
    code: 'AVX_W24',
    name: 'CompilerPreprocessorMissing',
    severity: 'warning',
    category: 'compiler',
    summary: 'A configured CSS preprocessor package is not installed, so raw CSS is used instead.',
    causes: [
      'avenx.config.json configures a preprocessor whose package is missing from the project dependencies.'
    ],
    remedies: [
      'Install the package named in the message, for example npm install -D sass, or remove the preprocessor configuration.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w24-compiler-preprocessor-missing'
  },
  AVX_W25: {
    code: 'AVX_W25',
    name: 'CompilerInvalidConfig',
    severity: 'warning',
    category: 'compiler',
    summary: 'avenx.config.json could not be parsed.',
    causes: [
      'The configuration file contains invalid JSON or a syntax error.'
    ],
    remedies: [
      'Fix the parse error reported in the message, then rebuild.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w25-compiler-invalid-config'
  },
  AVX_W26: {
    code: 'AVX_W26',
    name: 'ComponentMethodReservedKeyCollision',
    severity: 'warning',
    category: 'compiler',
    summary: 'A component method name collides with a reserved instance method.',
    causes: [
      'An action or method is named mount, unmount, update, destroy, or scheduleUpdate, which would shadow a framework method. Lifecycle hooks such as onMount are not reserved.'
    ],
    remedies: [
      'Rename the method. Declare lifecycle behaviour as a hook such as onMount instead of an action with a reserved name.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w26-component-method-reserved-key-collision'
  },
  AVX_W27: {
    code: 'AVX_W27',
    name: 'RouterGuardUndefinedReturn',
    severity: 'warning',
    category: 'routing',
    summary: 'A navigation guard returned undefined, so the transition defaults to allow.',
    causes: [
      'The guard has a missing return statement or an unhandled branch, which usually indicates a logic bug.'
    ],
    remedies: [
      'Return true, false, a redirect string, or a control object explicitly from every guard branch.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w27-router-guard-undefined-return'
  },
  AVX_W28: {
    code: 'AVX_W28',
    name: 'CompilerMultipleStateTags',
    severity: 'warning',
    category: 'compiler',
    summary: 'A component source contains more than one <state> tag.',
    causes: [
      'Only the first <state> declaration is reactive; subsequent tags are ignored.'
    ],
    remedies: [
      'Merge every state field into a single <state> declaration.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w28-compiler-multiple-state-tags'
  },
  AVX_W30: {
    code: 'AVX_W30',
    name: 'CompilerDuplicateIdAttribute',
    severity: 'warning',
    category: 'compiler',
    summary: 'A template uses the same static id attribute more than once.',
    causes: [
      'A static id is repeated in one template, or used inside a loop where it renders once per item. Static ids must be unique.'
    ],
    remedies: [
      'Give each element a distinct id, or use a class or data attribute for repeated elements.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w30-compiler-duplicate-id-attribute'
  },
  AVX_W31: {
    code: 'AVX_W31',
    name: 'CompilerPreprocessorFailed',
    severity: 'warning',
    category: 'compiler',
    summary: 'Compiling a file with a preprocessor failed.',
    causes: [
      'The preprocessor threw on the file, for example because of a syntax error in the source it processes.'
    ],
    remedies: [
      'Fix the source error the preprocessor reports for the file named in the message.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w31-compiler-preprocessor-failed'
  },
  AVX_W32: {
    code: 'AVX_W32',
    name: 'CompilerContractPureViolation',
    severity: 'warning',
    category: 'compiler',
    summary: 'A component with the pure contract contains a potential side effect.',
    causes: [
      'An expression or action under the pure contract writes state, calls an impure function, or otherwise mutates the world.'
    ],
    remedies: [
      'Remove the side effect from the pure component, or drop the pure contract.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w32-compiler-contract-pure-violation'
  },
  AVX_W33: {
    code: 'AVX_W33',
    name: 'CompilerContractDeterministicViolation',
    severity: 'warning',
    category: 'compiler',
    summary: 'A component with the deterministic contract contains a non-deterministic expression or call.',
    causes: [
      'The component reads the clock, randomness, or another source that can differ between renders.'
    ],
    remedies: [
      'Pass the value in as a prop or state, or drop the deterministic contract.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w33-compiler-contract-deterministic-violation'
  },
  AVX_W34: {
    code: 'AVX_W34',
    name: 'CompilerContractRedundant',
    severity: 'warning',
    category: 'compiler',
    summary: 'A contract declaration repeats one its parent scope already enforces.',
    causes: [
      'The same contract is declared on a component and on an ancestor, so the inner declaration adds nothing.'
    ],
    remedies: [
      'Remove the redundant inner contract declaration.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w34-compiler-contract-redundant'
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
  AVX_W37: {
    code: 'AVX_W37',
    name: 'CompilerBridgeUnknownMember',
    severity: 'warning',
    category: 'compiler',
    summary: 'A template or action reads a member a bridge does not declare.',
    causes: [
      'The member name is usually a typo. At run time the read would silently return undefined.'
    ],
    remedies: [
      'Use one of the declared members listed in the message, or declare the member on the bridge.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w37-compiler-bridge-unknown-member'
  },
  AVX_W38: {
    code: 'AVX_W38',
    name: 'CompilerBridgeUnknownEvent',
    severity: 'warning',
    category: 'compiler',
    summary: 'Code subscribes to a bridge event the bridge never emits.',
    causes: [
      'The event name in on() matches no emit() call in the bridge, so the handler would never run.'
    ],
    remedies: [
      'Subscribe to one of the emitted events listed in the message, or emit the event you meant from the bridge.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w38-compiler-bridge-unknown-event'
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
      'A URL-valued attribute resolves to a scheme such as javascript:. Escaping cannot make such a URL safe, so the attribute is set to about:blank.'
    ],
    remedies: [
      'Validate URLs where they enter the application and only allow schemes such as https: or relative paths.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w45-security-blocked-url'
  },
  AVX_W47: {
    code: 'AVX_W47',
    name: 'CompilerRenderNotCompiled',
    severity: 'warning',
    category: 'compiler',
    summary: 'One or more templates could not be compiled to a render program and will render through the string renderer.',
    causes: [
      'The compiler could not lower the listed templates into a render program. They render correctly, but every update re-renders, reparses, and diffs the whole template instead of updating only changed bindings.'
    ],
    remedies: [
      'Simplify the constructs in the listed templates so they compile, or silence the class with "warnings": { "AVX_W47": "off" } in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w47-compiler-render-not-compiled'
  }
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
