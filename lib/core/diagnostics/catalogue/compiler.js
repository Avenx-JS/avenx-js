/**
 * Compiler diagnostic catalogue entries.
 */
export default {
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
  AVX_C34: {
    code: 'AVX_C34',
    name: 'CompilerInvalidDeferTriggers',
    severity: 'error',
    category: 'compiler',
    summary: 'A defer trigger list contains a reactive expression, empty entry or repeated subscription.',
    causes: [
      'A semicolon-separated trigger list mixes a reactive condition with subscriptions.',
      'The same trigger is repeated, including equivalent timer(n) and n ms spellings.'
    ],
    remedies: [
      'Combine only idle, visible, hover, click, interaction and literal millisecond timers.',
      'Keep a reactive condition as the only trigger, and remove duplicate or empty list entries.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-c34-invalid-defer-triggers'
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
  AVX_W71: {
    code: 'AVX_W71',
    name: 'CompilerBareDollarMember',
    severity: 'warning',
    category: 'compiler',
    summary: 'A bare identifier starting with $ was used that is not an injected helper.',
    causes: [
      'Accessing a component instance member (such as $destroy, $isMounted, or $inspect) without "this.".',
      'A typo in an injected $ helper name (such as $ref instead of $refs).'
    ],
    remedies: [
      'Access component instance members via "this.<member>" (e.g. "this.$destroy()").',
      'Verify the spelling of injected helpers ($route, $router, $emit, $watch, $watchEffect, $nextTick, $refs, $element, $slots, $app).'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w71-compiler-bare-dollar-member'
  },
  AVX_W78: {
    code: 'AVX_W78', name: 'AtlasNoEntryPoint', severity: 'warning', category: 'compiler',
    summary: 'The application entry file contains no mount or router startup.',
    causes: ['The only mount call was removed or commented out after registering components.'],
    remedies: ['Call app.mount(), app.mountPage() or app.initRouter().',
      'For an intentionally unmounted library bundle, set warnings.AVX_W78 to "off".'],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w78-atlas-no-entry-point'
  },
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
  AVX_W77: {
    code: 'AVX_W77',
    name: 'CompilerReconciliationMarker',
    severity: 'warning',
    category: 'compiler',
    summary: 'Authored markup uses a compiler-owned reconciliation attribute.',
    causes: ['A template explicitly sets data-ax-static, data-ax-key, or data-ax-skip.'],
    remedies: [
      'Remove static and skip markers; the compiler and renderer manage these optimizations.',
      'Use the key expression on <@for> for list identity.',
      'Silence intentional usage with "warnings": { "AVX_W77": "off" } in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w77-compiler-reconciliation-marker'
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
  },
  AVX_W79: {
    code: 'AVX_W79',
    name: 'CompilerUnknownDeferTrigger',
    severity: 'warning',
    category: 'compiler',
    summary: 'A <@defer> block uses an unrecognised when trigger.',
    causes: [
      'The when attribute on <@defer> is neither a known trigger keyword (idle, visible, hover, click, interaction, timer(ms), <n>ms) nor a valid declared expression.'
    ],
    remedies: [
      'Use one of idle, visible, hover, click, interaction, timer(ms), <n>ms, or a valid expression referencing declared state/computed/methods.',
      'Silence intentional forward-compatible triggers with "warnings": { "AVX_W79": "off" } in avenx.config.json.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w79-compiler-unknown-defer-trigger'
  }
};
