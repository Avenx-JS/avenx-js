# End-to-end tests

These tests compile real Avenx applications with the real CLI and drive the
compiled output in a real browser.

```text
src/*.component.js, *.page.js, *.bridge.js, *.guard.js
        |
        |  bin/avenx.js build      (test/e2e/support/build-apps.js)
        v
dist/bundle.js + dist/bundle.css
        |
        |  static server           (test/e2e/support/server.js)
        v
Chromium
        |
        |  Playwright
        v
observable application behaviour
```

## The rule

**If a test can pass without the Avenx compiler and runtime executing, it is not
an E2E test.** It belongs in `test/unit` or `test/integration`.

This is not a style preference. The suite that preceded this one hand-wrote its
fixtures in plain DOM code — a `createCard()` factory in place of components, an
`addEventListener` plus a manual `preventDefault()` labelled in the fixture as
"event modifier .prevent simulation", a "v-model emulation" that mirrored inputs
by hand. Nine of its twenty-three tests passed, and all nine would still have
passed with `dist/runtime.js` deleted.

Fixture applications exist to make that failure mode structurally impossible.
Every app is a real project; `index.html` ships an empty `<div id="app">`, so
anything a test can see was put there by the framework.

## Layout

```text
test/e2e/
  apps/           real Avenx projects, one per feature cluster
    async/          declarative async data (<resource>, <@suspense>, <@errorBoundary>)
    browser-apis/    browser API access
    fallback/        fallback renderer and boundary behaviour
    security/        dynamic attribute names and srcdoc handling
    counter/        state, computed values, actions, bound attributes
    rendering/      interpolation, escaping, data-ax-show, keyed lists
    components/     nesting, props from parent state, slot projection
    composition/    provide/inject descendants and keep-alive routes
    events/         @click and the modifier grammar
    rewind/         atomic rollback, shared bridges, collections and concurrent writes
    styling/        scoped CSS, isolation, @def globals
    routing/        hash routes, params, query, wildcard, guards, a bridge
    forms/          data-ax-bind across input types, focus retention
    defer/          <@defer> and its triggers
    virtual-list/   VirtualList windowing over large datasets
    code-splitting/  lazy page chunks under codeSplitting, with template expressions
    guard-gaps/     regression tests for previously fixed guard bugs
    parity/         every documented template construct, built in both modes
  specs/          tests, grouped by the behaviour they describe
    smoke/ reactivity/ rendering/ components/ events/
    styling/ routing/ forms/ performance/ build/
  support/
    apps.js         the app registry and URL helpers
    build-apps.js   Playwright global setup: compiles every app
    server.js       static file server, real 404s
    fixtures.js     the shared `test` object
```

An app may back several specs. Keep each one small enough that a failure points
at one area of the framework.

## Running the suite

```bash
npm run test:e2e
```

The global setup rebuilds the runtime bundles and compiles every fixture app
before the first test runs, so there is no separate build step. A compiler
failure aborts the run with the compiler's own diagnostics attached.

Useful variations:

```bash
npx playwright test rendering
```

```bash
npx playwright test --ui
```

```bash
E2E_ALL_BROWSERS=1 npx playwright test --project=webkit
```

## Writing a test

Import the shared `test` object rather than Playwright's:

```js
import { test, expect } from '../../support/fixtures.js';

test('increments the rendered count', async ({ page, app }) => {
  await app.open('counter');
  await page.getByTestId('increment').click();
  await expect(page.getByTestId('count')).toHaveText('1');
});
```

It adds two things.

**`runtimeIssues`** is automatic. Any `pageerror` or `console.error` the page
produced fails the test, with the message as the failure. A test that means to
provoke one says so:

```js
runtimeIssues.allow(/Failed to load resource.*404/);
```

This is the harness's most valuable part. In the old suite a fixture threw
`reactive is not a function` on its first line and the result was eight
five-second locator timeouts, none of which named the cause.

**`app.open(name, { hash, entry })`** navigates to a fixture app and then checks
that the runtime published itself. A bundle that fails to parse leaves a blank
page and no `pageerror`, so without that check every later assertion times out on
a missing element for no visible reason.

### Conventions

- Name a test after observable behaviour — *"preserves the caret position when
  unrelated state changes"*, not *"calls DomPatcher.update()"*.
- Put `data-testid` in the fixture template and select on it, or use role- and
  text-based locators. **Never select on an emitted CSS class**: those are
  content hashes (`.avenx-27dcd258`) that change whenever the rule's text does.
- Assert styling through `getComputedStyle`, not class names — the effect, not
  the naming scheme.
- Use web-first assertions. No `waitForTimeout`. Prefer `expect(page).toHaveURL()`
  over reading `page.url()` once: the router settles the hash a beat after it
  swaps the page, and that race is a real source of flake.

## What is tested here, and what is not

| In a browser | In unit / integration |
| :--- | :--- |
| Compiled output actually executing | Parser and codegen string output |
| Real History API, hash changes, deep links | `RouteMatcher` pattern matching |
| IntersectionObserver, requestIdleCallback | `DeferManager` trigger selection |
| Focus, caret and selection across patches | Diff algorithm and LCS reorder |
| CSS cascade, specificity, style isolation | `StyleProcessor` emitted text |
| Real event dispatch, bubbling, capture | Modifier parsing |
| Minified bundle behaviour | Bundle size and forbidden markers |
| Multi-component reactive fan-out | Proxy and scheduler semantics |

The 154 unit and 21 integration tests cover the pieces thoroughly. E2E should not
duplicate them; it covers the one thing they cannot, which is the assembled
product running in a browser.

## Current coverage

Every test is expected to pass except the five pinned gaps listed under "Known gaps" below, which are expected to fail.

| Area | Tests | Covers |
| :--- | ---: | :--- |
| `actions/` | 6 | Browser APIs |
| `async/` | 7 | Declarative async data (<resource>, <@suspense>, <@errorBoundary>, recovery, sequencing, mutation, polling and abort on unmount) |
| `build/` | 51 | Production and development parity: the counter app, and every documented template construct (see "Construct parity" below); code-split page chunks |
| `components/` | 12 | Component composition |
| `composition/` | 5 | Reactive provide/inject, live DOM retention, uncached reset and lifecycle order |
| `events/` | 12 | Event bindings, modifiers and loop scope |
| `forms/` | 20 | Focus retention and two-way binding |
| `performance/` | 6 | `<@defer>` triggers |
| `reactivity/` | 19 | Compiled rendering, fine-grained updates and state-to-DOM |
| `rendering/` | 35 | Fallback renderer, lists, conditionals and state initialisers |
| `rewind/` | 6 | Synchronous and asynchronous rollback, shared bridge observers, nested and collection writes, key restoration, safe conflicts and commits |
| `routing/` | 22 | Navigation, guards and guard regression tests |
| `security/` | 15 | Dynamic attribute names and `srcdoc` |
| `serve/` | 17 | Development server |
| `trace/` | 4 | Browser click causation, export/replay and deliberate divergence, bridge redaction, the ingest size limit, and the no-trace boundary |
| `smoke/` | 22 | Application boot |
| `styling/` | 12 | Attribute content and scoped CSS |
| `transitions/` | 4 | List-row enter and leave classes, rapid toggling |
| `virtual-list/` | 1 | Fixed-height VirtualList windowing and scroll boundaries |

`<@suspense>`, `<@errorBoundary>` and `<@deadlock>` are covered by
`rendering/fallback-renderer.spec.js`, against both the production and the
development bundle. They are covered for a specific reason: each keeps the
string renderer, and that path rendered nothing at all in a linked checkout
while every test in this suite stayed green. A component that renders nothing
raises no `pageerror`, so the only assertion that can see it is one that looks
for content.

The trace specs reuse the real dev-server fixture with `--trace`. They click a
compiled component in the browser, save through `avenxTrace.save()`, read the
server's stored recording and run the unmodified CLI-exported test under the
documented Happy DOM setup. Changing the action then makes that exported test
fail with its diverging state. A separate browser interaction checks configured
bridge redaction; HTTP cases check the 32 MiB limit and the absence of a writable
endpoint without the flag. Each scratch project, trace and package link is
removed after its server exits.

### Official plugin CLI builds

`test/system/officialPluginCli.test.js` builds an isolated project for each
official plugin through `bin/avenx.js build`, using the documented package
imports. It executes the emitted bundles in fresh Happy DOM windows and checks:

- i18n translations, number formatting and reactive locale changes;
- a persisted bridge's rendered value, storage write and hydration on a fresh mount;
- chart SVG geometry and updates from a compiled page;
- equivalent initial rendering and updates from full CLI and Vite builds of the
  same source, with `@avenx/vite` loaded through a Vite configuration.

The runtime-plugin cases also require their implementation to appear in the
bundle. The Vite case checks the compiled render program in Vite's output;
the Vite plugin itself runs at build time. Package import or export resolution
failures therefore fail the build before rendering is checked.

Run this coverage with `node test/run-tests.js officialPluginCli.test.js`,
`npm run test:system` or `npm test`. It runs on the pull-request system-test path.
These are system tests with a DOM implementation, not browser E2E tests: they do
not check chart layout, browser storage policies or browser-specific rendering.
The CLI assertions run on every supported Node version. Full Vite parity runs
on Node 20.19+ or 22.12+ (and newer major versions), as required by the plugin's
Vite 7/8 peer dependency; the Node 18 job explicitly reports that case as skipped.

The Rewind specs hold actual browser requests until their optimistic DOM
assertions complete, then let the fixture server respond. No timer determines
whether the test observes the optimistic state. Synchronous throws restore
before the browser can paint; that case checks the reported error and restored
DOM, while asynchronous rejection cases check both visible states.

## Construct parity: the shipped arrangement

The unit and integration tiers run every test with the expression interpreter
and the string renderer installed (see `test/run-tests.js`). That is what a
development build does and what no production bundle does, so a defect that
exists only in a production bundle cannot be seen there. This is the tier
where the shipped arrangement is exercised.

The `parity` fixture uses every template construct the documentation lists,
taken from the "What's in the box" tables in the top-level `README.md` and the
sections of `docs/src/content/docs/core-concepts/templates.md`. The global
setup builds it with `avenx build` and `avenx build --dev`, and
`specs/build/construct-parity.spec.js` drives each construct through the same
steps on both bundles. Each construct sits in its own `data-construct` section
and gets one test, which checks three things:

1. **Content.** Particular text, attributes and styles, on both bundles. If
   the only check were that the two bundles agree, two bundles that both
   rendered nothing would pass.
2. **Parity.** The section is serialised (markup, live form state, computed
   `display` and `color`), and the production snapshot must equal the
   development one. There is no allowlist, so any divergence fails.
3. **Nothing went unreported.** The fixture must build with no `AVX_W48`,
   and the global setup stops the run if it does not. So the development
   bundle's interpreter should never run. It records what it is handed
   (`Avenx.interpretedSources()`), and the spec requires that list to be
   empty. An entry there is an expression the build neither compiled nor
   reported. It renders under `--dev` and throws `AVX_R32` in production.

The third check found two such expressions on its first run, both silent in
production. `<Component :is="{{ name }}">` left its mount point empty, and
`<transition name="fade">` produced `'fade'-enter-active` (quotes included),
so no stylesheet matched. Both were missing from the compiler's expression
collector; `test/unit/expressionCollectorCoverage.test.js` pins the fix.

| Construct group | Page | Constructs |
| :--- | :--- | :--- |
| Construct group | Page | Engine | Constructs |
| :--- | :--- | :--- | :--- |
| Text and attributes | `#/` | compiled | interpolation, raw interpolation, boolean attribute coercion, `data-ax-show`, `-class` (string and object), `-style`, `-html` (sanitised), SVG |
| Control flow | `#/control` | compiled | `<@if>` / `<@elseif>` / `<@else>`; keyed `<@for>` over an array, object, `Map`, `Set` and numeric range, each with `<@empty>` |
| Forms | `#/forms` | compiled | `data-ax-bind` on text, textarea, number, range, date, select, multiple select, boolean checkbox, checkbox group and radio |
| Components | `#/components` | compiled | static nesting to a grandchild, props, default / named / fallback slots, the `<template slot>` wrapper |
| Async | `#/async` | both | `<@defer>` on `idle`, `timer(ms)`, `interaction`, an expression and `visible`; `<resource>`, `<@suspense>`, `<@deadlock>` (in `<AsyncPanel>`); `<@errorBoundary>` (in `<ErrorPanel>`) |
| Motion | `#/motion` | string | `<transition>` on a keyed list row, `<VirtualList>` |
| Routing | `#/shell/outlet` | string | a layout's router view (`data-ax-router-view`) |
| String renderer | `#/string-path` | string | dynamic attribute names, `data-ax-ref`, `data-ax-validate`, scoped slots, `<Component :is>`, and the string renderer's pinned gaps |

Each construct is placed on a page that compiles to a render program wherever
it can be. The constructs the IR refuses (`AVX_W47`) are grouped on pages that
render through the string renderer. So each engine is compared across both
build modes, and a compiled construct is not silently moved to the string path
by an unrelated neighbour. Adding a construct takes a `data-construct` section
in the fixture and an entry in the spec's `CONSTRUCTS`. A coverage test fails
if the two lists disagree.

Writing the fixture against the documentation turned up a few places where
the documentation and the framework disagree. They hold identically in both
builds, so none of them is a parity defect. Each is either pinned under "Known
gaps" below or worked around and noted in the fixture:

- A caught `<@errorBoundary>` replaces the whole component's template, its
  siblings included, not only the boundary's own subtree. `<ErrorPanel>`
  therefore holds nothing else.
- In a template, a `<resource>` name resolves to its value. Its status is
  `$resources.<name>.status`; the `<name>.status` spelling in `resources.md`
  renders nothing.

Deliberately left out, and why:

- **Typed inputs other than `date`** (`email`, `time`, `color`, ...). They
  share the `value`/`input` channel and write the string, as `date` does, so
  they would exercise no other code path.
- **The `click` / `hover` aliases and combined `<@defer>` triggers**
  (`visible; interaction`). They reach the same trigger implementations as
  `interaction` and `visible`, which are covered.
- **A tripped `<@deadlock>`.** Tripping a boundary needs a runaway reactive
  cycle, which logs `AVX_R18` and depends on scheduler timing, so the two
  bundles cannot be snapshotted at the same point. The healthy boundary is
  covered here, and the trip is covered by the unit tier.
- **Event modifiers, watchers, lifecycle hooks, scoped CSS, bridges and the
  router's guards and params.** These are behaviours rather than template
  constructs; their fixtures (`events/`, `styling/`, `routing/`, ...) run
  them against the production bundle.
- **`data-ax-static`, `data-ax-skip` and `data-ax-key`.** Templates are not
  meant to write these internal markers; the compiler adds them.

## The failure mode that has no symptom

Most framework bugs announce themselves: a thrown error, a wrong value, a
locator that times out. One does not. A component that mounts and renders
nothing produces a valid page with a valid empty element, no `pageerror` and no
console output, and every guard in this harness reports it as healthy.

That is how the fallback rendering path came to render nothing in a linked
checkout without a single test noticing. `runtimeIssues` cannot see it, because
there is no issue to see.

The only defence is to assert on content. A spec that opens an app and checks
it for errors has checked nothing; a spec that asserts particular text is
present has. `fallback-renderer.spec.js` ends with the general form of that
assertion -- no `[data-avenx-comp]` element may be empty -- and new specs
covering a rendering path should carry something equivalent.

## Known gaps this suite documents

Five gaps are pinned under `test.fail()`, all in
`build/construct-parity.spec.js`. All five fail identically in both builds,
and all but the last work on a compiled page:

| Pinned gap | Construct |
| :--- | :--- |
| `data-ax-style` applies nothing in a template that falls back to the string renderer. It is a render-program op the string renderer does not implement, so the attribute is interpolated to `"[object Object]"` | `style-on-string-path` |
| A bound `<textarea>` renders empty on the string path: its initial value is written as a `value` attribute, which a textarea ignores | `textarea-on-string-path` |
| The `<template slot="...">` wrapper is unwrapped only on the compiled path. On the string path the `<template>` itself is projected, so its content stays inert and invisible | `template-slot-on-string-path` |
| Updating the value of a dynamic attribute name (`:[name]="value"`) removes the attribute instead of setting the new value | `dynamic-attribute-update` |
| `<transition>` around a `data-ax-show` element applies no transition classes; the element appears and disappears immediately. `templates.md` and `transitions.md` both document the pairing, and `specs/transitions/` drives only list rows | `transition-on-show` |

One framework limitation is recorded here rather than pinned, because pinning
it would mean asserting behaviour that is wrong:

**A component does not mount its own child components.** Only `AvenxPage` walks
`[data-avenx-comp]` and instantiates what it finds. A component nesting
`<Child />` therefore emits the mount point and leaves it empty, silently, on
both rendering engines -- a fully compiled parent with a fully compiled child
behaves exactly like a fallback parent with a fallback child.

Every fixture app here roots its tree in a page, which is why no spec sees it.
That is also the supported arrangement today, so the fixtures are not wrong --
but the README documents PascalCase nesting without mentioning the page
requirement, and a developer following it gets an empty element and no
diagnostic. It is out of scope for the fallback-renderer work and wants its
own change.

The suite previously carried six `test.fail()` tests -- expected failures kept
under test so a broken piece of public API could not quietly go uncovered. All
six have since been fixed, four of them by the rendering-core refactor:

| Former gap | How it was closed |
| :--- | :--- |
| `<computed value="count * 2" />` never recomputed | Scope resolution made lazy and layered |
| Two guard modules broke the bundle | Guard emission no longer repeats the destructuring |
| A guard reading a bridge | Guard imports are resolved rather than stripped |
| A component inside `<@defer>` never mounted | `<@defer>` is a compiled block, and a mounted block is announced to the child-component pass |
| `<@defer>` in a stateful component | A block is owned by its binding rather than by a diff, so an unrelated update cannot discard it |
| `data-ax-style` applied nothing | Implemented as a render-program op |

When the next gap appears, add it back the same way: a `test.fail()` test and a
row here. A pinned gap turns the run red the moment it starts passing, which is
how all six of these were noticed.

## CI

`ci.yml` runs the suite on Chromium for every pull request. Chromium alone gates
a PR: a framework regression shows up there first, and a three-engine fan-out on
every push costs more than it returns for a pre-v1 project.

`e2e-nightly.yml` runs Chromium, Firefox and WebKit once a day, and can be
dispatched by hand. All three are green today.

Failures upload the Playwright HTML report as a build artifact.
