# Changelog

All notable changes to Avenx-JS are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Avenx is pre-1.0, so under SemVer a minor release may change public behaviour;
every such change is listed below with its migration.

(This paragraph used to point at `docs/production-readiness/release-readiness.md`
for the project's SemVer policy. That file was removed in 02bc44b along with the
rest of that directory, and nothing replaced it, so the reference was dead.)

## [Unreleased]

Production-readiness cycle. No public API was removed and no documented feature
was dropped. Behaviour changes are listed with their migration.

### Fixed — found by an adversarial pass over the release candidate

A second review followed the documentation literally, built a realistic
application, and compared development against production. It found defects the
first pass and the whole test suite had missed.

- **A component nested inside a component did not mount** when its host
  appeared during an update rather than at first render. The page's mount pass
  collects `[data-avenx-comp]` hosts before its children have rendered, so one
  pass reached one level; deeper levels arrived only when another pass happened
  to run. The common shape — fetch in `onMount`, render a list of components
  that contain components — silently lost all of its inner content, with a
  clean build, a passing `avenx check`, an empty console, and development and
  production agreeing with each other. No fixture in the suite nested a
  component inside a component, which is why 156 browser tests said nothing.
- **Every nested reactive object claimed its component's computed properties.**
  One proxy handler serves the root state and every object inside it, and the
  computed traps did not ask which object they were answering for. So
  `Object.keys(state.query)` listed computed names, `JSON.stringify(state.form)`
  serialised computed values into a request, and `state.query.total` returned
  the component's `total`. Templates never showed it, because they read
  computeds off the root where they belong.
- **`this.$router` did not exist.** The routing guide documents
  `navigate()`, `back()`, `forward()` and `go()` on it, and the routing
  tutorial uses it for programmatic navigation; every one of those examples
  threw. It is now implemented, and declared in the type surface.
- **Route parameters were reported as undeclared.** A page routed as
  `'/profile/:id'` receives `id` as state, but the template validator only read
  `<state>`, so `{{ id }}` raised `AVX_W03` and `avenx check` exited 1 — the
  documented feature failing the documented CI command on correct code.
- `AVX_W07` fired when a page was registered again with the *same* class, which
  overwrites nothing. The routing tutorial tells the reader to register pages by
  hand while the compiler already does, so following it logged one warning per
  page on every load.
- `avenx init my-app` discarded the name and scaffolded into the current
  directory, exiting 0 — the routing tutorial opened with exactly that command.
  It now refuses an argument it does not use and prints the recipe that works.
- `AVX_W24` now names both the configured CSS preprocessor and the npm package
  to install. A `style.preprocessor` value of `"scss"` points users at `sass`
  with an install command instead of telling them to install a nonexistent
  `scss` package.

### Added — found by the same pass

- `AVX_W56` reports a component a template renders that the application never
  registers. Pages are registered by the compiler and components are not, so a
  hand-written `main.app.js` silently loses them; the runtime renders an empty
  element and says nothing until the page is opened.

### Fixed — documentation that did not survive being followed

- The installation page required Node 18 in one paragraph and recommended v16
  two lines later, with v16 in its requirements table. The CLI exits 1 below 18.
- The routing tutorial's login step could never succeed: it branched on
  `username === 'admin'` with no input on the page.
- Its profile page copied a query parameter into state inside `onMount`, so the
  sub-nav links it tells the reader to add changed the URL and nothing else.

### Fixed — the scaffolded first run

The path a new user takes — `avenx init`, `avenx generate page`, `avenx build`,
open the page — produced a blank screen, a successful build and a silent
console. Four separate defects met there, each individually invisible.

- A route pattern was compiled exactly as written while the URL hash was
  normalised to `#/path`, so only a pattern spelled `#/…` could ever match.
  `''`, `'/'` and `'/about'` matched nothing, silently. The scaffolded routing
  template declared the root twice (`'': 'Home'` beside `'#/': 'Home'`), and
  every fixture copied the habit, which is why a green suite never noticed. All
  four spellings now resolve to the same route, as the compiler's own model
  already assumed.
- A bare `#`, which any `<a href="#">` leaves in the URL, matched no pattern and
  fell through to the wildcard. It now resolves to the root.
- `AVX_W53` reports an application whose pages no route names and no
  `mountPage()` call mounts. `avenx generate page` now prints the route line to
  add instead of saying the page "will be automatically registered and routed if
  you update src/main.app.js", which said both that nothing was required and
  that something was.
- The page scaffold shipped `.page-container { … }` with `class="page-container"`.
  An Avenx style block is a name attached with `@css`, not a CSS selector, so
  every generated page carried a stylesheet that emitted nothing. The component
  scaffold beside it had always been correct.

### Fixed — diagnostics that were wrong rather than missing

- `<@if>` and `<@elseif>` conditions were never walked, so a typo in a condition
  compiled clean (`AVX_W03` fires for an interpolation but did not for a
  condition), and state read only by a condition was reported by `AVX_W40` as
  "read nowhere in the application".
- Attributes were located with a regular expression that ends a tag at the first
  `>`. In `<div title="a > b" @click="go()">` the handler was invisible, so
  `AVX_W41` claimed the action it calls is never invoked. The shared template
  walk now reads the markup lexer, as the other front-end passes already did.
- `AVX_W51` and `AVX_W52` were reported in `avenx check --json` against a file
  called `config.js` — a path that exists in no project — because the recovery
  matched `config.js` inside the `avenx.config.json` named in their own remedy
  text. Both now name their template, and no diagnostic is attributed to a file
  the search invented.
- `AVX_W01` weighed source maps against the bundle budget, so every development
  build warned about `bundle.js.map` by default and a project escalating
  `AVX_W01` to `"error"` could not run one at all.

### Fixed — silent failures elsewhere

- A tag whose earlier attribute contains `>` no longer hides what follows it:
  `<slot :label="a > b ? x : y">` now reaches the slot, a scoped slot with such
  an attribute is still recognised as one, and `:[name]="val"` still resolves on
  `<div title="a > b" :[name]="val">`. The last was data-dependent — the `>`
  could come from any rendered value — so a template that worked in development
  broke on the first record containing a greater-than sign.
- `initRouter` replaced the router without destroying the old one, leaking a
  navigation listener per call and leaving every abandoned router handling hash
  changes into the same target.
- The working-tree guard read the process's directory rather than the project,
  leaked git's `fatal: not a git repository` to the terminal, and exited 0 when
  declined — so a declined `avenx build` reported success having built nothing.
- An unrecognised command printed the help text and exited 0, so `avenx buidl &&
  deploy` deployed.

### Added

- **CSP-strict builds** (`"csp": { "strict": true }`, or `avenx build
  --csp-strict`). A production build already needs no `script-src
  'unsafe-eval'`; a development build carries the expression interpreter, which
  is the framework's last `new Function`. The option declines it, so a project
  whose deployment forbids `'unsafe-eval'` — a browser extension, a hardened
  Electron renderer, a staging environment mirroring production headers — can
  develop under the same policy it ships under. It also parses the emitted
  bundle and refuses it if `eval`, the `Function` constructor or a `with`
  statement survived anywhere in the graph, including in a dependency.

  Off by default, and the default build path is byte-identical to before the
  option existed. A strict development bundle is about 80 KB smaller (18 KB
  gzipped) for an `avenx init` project, having linked one module fewer; a
  production bundle is unchanged. New diagnostics: `AVX_C31` (an expression that
  did not compile, which a strict build refuses in development too) and
  `AVX_C32` (the emitted bundle can still evaluate source). Both ship their
  message text in the runtime's error table, as every other compiler
  diagnostic does, which costs a production bundle about 1 KB raw and 370 bytes
  gzipped.
- Every build now prints the Content-Security-Policy its output can run under,
  including the `style-src 'unsafe-inline'` that runtime-mounted component
  stylesheets need and the `Avenx.styleMountManager.setCspNonce()` call that
  replaces it. The deployment guide has the per-mode table; it previously
  described `script-src` only.
- `AVX_W53` (no reachable page), `AVX_W54` (unterminated interpolation, which
  was rendered to the page as literal text), and `AVX_W55` (a style block no
  template names), each with a catalogue entry.
- `avenx check`'s exit codes are documented: it fails on a warning, which
  `avenx build` does not.
- The Quick Start tutorial's stylesheet used CSS selectors and class attributes
  throughout, which produces no styles at all. It is corrected, and the
  documentation's stylesheet samples were swept for the same mistake.

### Behaviour changes and migration

| Change | Migration |
|---|---|
| `avenx init <name>` exits 1 instead of ignoring the name | `mkdir <name> && cd <name> && npx avenx init` |
| `AVX_W56` may appear on an existing project | Register the component, or silence the code |
| `this.$router` now exists | None; it previously threw |
| `''`, `'/'` and `'/about'` route patterns now match | None. They previously matched nothing; a table declaring the root twice still works |
| An unrecognised command exits 1 | Fix the typo; the message names the closest command |
| Declining the working-tree prompt exits 1 | Pass `--force`, or commit first |
| `AVX_W53`/`AVX_W54`/`AVX_W55` may appear on an existing project | Each is a warning and silenceable with `"warnings": { "AVX_W55": "off" }` |
| `AVX_W01` no longer counts source maps | None, unless a build relied on failing there |
| `csp.strict` is validated as a boolean | None; the option is new and off by default. A non-boolean value is refused rather than read as truthy |

### Fixed — compiler correctness

- The template front-end no longer reads expression or attribute content as
  markup. `@css`, `data-ax-bind` and comment stripping were applied with regular
  expressions that ended a tag at the first `>`; a handler such as
  `@click="count > 3 ? a() : b()"` silently produced a component that rendered
  blank in production. All front-end passes now share one markup lexer.
- An unclosed `<action>` or `<resource>` reports `AVX_C26` with a location
  instead of crashing the build with a bare `TypeError`.
- `new Date(0)`, tagged templates, shorthand properties (`{ count }`) and
  destructuring assignment targets are rewritten correctly in action bodies;
  each was silently miscompiled.
- `<@for item="user" in="users">` and `<@loading>` inside `<@defer>` compile to
  render programs instead of falling back to the string renderer.

### Fixed — build reliability

- A production build now fails with `AVX_C27` when it contains an expression it
  cannot execute, instead of succeeding and throwing in the browser.
  Development still builds, reporting `AVX_W48`.
- `<state>` initialisers written as JavaScript object or array literals
  (`{ id: 1, name: 'Ada' }`) are evaluated at build time instead of silently
  becoming strings. A non-constant initialiser keeps its string value and
  reports `AVX_W51`.

### Fixed — restored functionality

- `<action>` and `<resource>` bodies can use browser APIs again (`fetch`,
  `window`, `setInterval`, `requestAnimationFrame`, …), as the documentation has
  always described. They had been refused at build time since 2026-09-10, which
  broke the README's own `<resource>` example.
- `AVX_W26` no longer warns when a documented lifecycle hook (`onMount`,
  `onUnmount`, …) is declared as an `<action>`, which is the supported way to
  define one. Genuine collisions with reserved instance methods still warn.

### Fixed — dev server

- `avenx serve` now answers on both loopback families. Binding the name
  `localhost` resolved to one family, so everything reaching for `127.0.0.1`
  (curl, proxies, containers, CI) was refused while the browser worked.
- The inspector at `/__avenx-inspect` receives data. Its enabling flag was
  injected after the application bundle, so it was always too late.

### Fixed — reactivity and scheduling

- A reactive cycle quarantines the looping job instead of clearing the queue.
  Previously every unrelated component's pending update in that tick was
  silently discarded.
- Dependency tracking is O(1) per read rather than a linear scan, and the
  causation path is built only when read: a watcher with 400 tracked reads
  re-evaluated 200 times went from 54.6 ms to 25.1 ms, and 100,000 untracked
  nested writes from 73.2 ms to 38.0 ms.

### Security

- A bound `srcdoc` is escaped as HTML rather than treated as a URL; markup with
  no scheme used to execute in a same-origin iframe. Trusted HTML is opted in
  with `html(...)`, as for `data-ax-html`.
- A bound inline event handler (`onclick="{{ x }}"`) is refused at build time
  (`AVX_C28`) with the `@click` rewrite; a static inline handler warns
  (`AVX_W52`); the runtime refuses any `on*` attribute reaching it (`AVX_R35`).
  `@event` bindings and `on*` props on components are unaffected.
- `avenx trace export` can no longer be made to emit executable code by a
  recorded value, and the dev server refuses cross-origin trace uploads.

### Added

- Diagnostics `AVX_C24`–`AVX_C28`, `AVX_W49`–`AVX_W52`, `AVX_R35`, each with a
  catalogue entry and an entry in the error reference.
- `test/system/packageIntegrity.test.js`, which asserts that the published
  tarball can actually run.

### Behaviour changes and migration

| Change | Migration |
|---|---|
| A bound `on*` attribute fails the build | Use `@click="handler"`; the message gives the rewrite |
| A plain string bound to `srcdoc` is escaped | Wrap trusted HTML in `html(...)` |
| A JavaScript literal in `<state>` becomes an object/array | To keep a string, quote it (`label="'{ draft }'"`) or set it in `onMount` |
| A production build fails on an expression it cannot execute | Rewrite it, or move the logic into an `<action>`; `--dev` still builds |
| Malformed templates now fail with `AVX_C24`/`AVX_C26` | The diagnostic names the file and line |
