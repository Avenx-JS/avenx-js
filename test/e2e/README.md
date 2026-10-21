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
    browser-apis/    browser API access
    fallback/        fallback renderer and boundary behaviour
    security/        dynamic attribute names and srcdoc handling
    counter/        state, computed values, actions, bound attributes
    rendering/      interpolation, escaping, data-ax-show, keyed lists
    components/     nesting, props from parent state, slot projection
    events/         @click and the modifier grammar
    styling/        scoped CSS, isolation, @def globals
    routing/        hash routes, params, query, wildcard, guards, a bridge
    forms/          data-ax-bind across input types, focus retention
    defer/          <@defer> and its triggers
    guard-gaps/     regression tests for previously fixed guard bugs
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

148 tests across 23 spec files. All tests are expected to pass; the six previously pinned failures have been fixed.

| Area | Tests | Covers |
| :--- | ---: | :--- |
| `actions/` | 6 | Browser APIs |
| `build/` | 4 | Production and development runtime parity |
| `components/` | 12 | Component composition |
| `events/` | 12 | Event bindings, modifiers and loop scope |
| `forms/` | 12 | Focus retention and two-way binding |
| `performance/` | 6 | `<@defer>` triggers |
| `reactivity/` | 19 | Compiled rendering, fine-grained updates and state-to-DOM |
| `rendering/` | 26 | Fallback renderer, lists, conditionals and state initialisers |
| `routing/` | 21 | Navigation, guards and guard regression tests |
| `security/` | 5 | Dynamic attribute names and `srcdoc` |
| `serve/` | 9 | Development server |
| `smoke/` | 4 | Application boot |
| `styling/` | 12 | Attribute content and scoped CSS |

`<@suspense>`, `<@errorBoundary>` and `<@deadlock>` are covered by
`rendering/fallback-renderer.spec.js`, against both the production and the
development bundle. They are covered for a specific reason: each keeps the
string renderer, and that path rendered nothing at all in a linked checkout
while every test in this suite stayed green. A component that renders nothing
raises no `pageerror`, so the only assertion that can see it is one that looks
for content.

Not yet covered, in rough priority order: resources, rewind rollback, virtual
list windowing, transitions, keep-alive, provide/inject, declarative form
validation, live reload, and trace capture under
`avenx serve --trace`.

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

Every test in this suite is expected to pass. One framework limitation is
recorded here rather than pinned, because pinning it would mean asserting
behaviour that is wrong:

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
