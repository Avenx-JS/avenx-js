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
    counter/        state, computed values, actions, bound attributes
    rendering/      interpolation, escaping, data-ax-show, keyed lists
    components/     nesting, props from parent state, slot projection
    events/         @click and the modifier grammar
    styling/        scoped CSS, isolation, @def globals
    routing/        hash routes, params, query, wildcard, guards, a bridge
    forms/          data-ax-bind across input types, focus retention
    defer/          <@defer> and its triggers
    guard-gaps/     pins two guard bugs; its bundle is expected not to parse
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
- Keep `<state>` on one line (see the known gaps below).

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

92 tests in 13 files. 85 assert behaviour that works; 7 are pinned failures
documenting framework bugs, described below.

| Area | Tests | Covers |
| :--- | ---: | :--- |
| `smoke/` | 11 | Compiled boot, first render, per-app boot check, server 404s |
| `reactivity/` | 7 | State to DOM, computed values, bound boolean attributes |
| `rendering/` | 9 | Keyed lists, node identity on reorder, empty branch, `data-ax-show`, escaping |
| `components/` | 9 | Nesting, props from state, reactive props, default and named slots |
| `events/` | 7 | Bindings, bubbling, `.prevent`, `.stop`, `.once`, `.self`, `.enter` |
| `styling/` | 6 | Scoped CSS via computed style, cross-component isolation, `@def` |
| `routing/` | 18 | Hash routes, params, query, wildcard, deep links, history, guards, bridges |
| `forms/` | 12 | `data-ax-bind` across every input type, focus, caret and selection retention |
| `performance/` | 6 | `<@defer>` with interaction, idle, timer and visible triggers |
| `build/` | 7 | Production and development runtime parity |

Not yet covered, in rough priority order: resources and suspense, error
boundaries, the deadlock boundary, rewind rollback, virtual list windowing,
transitions, keep-alive, provide/inject, declarative form validation, the dev
server and live reload, and trace capture under `avenx serve --trace`.

## Known gaps this suite documents

Seven tests are written as `test.fail()`. They **run**, they are **expected to
fail**, and Playwright reports the suite as green while they do. If one starts
passing, the run turns red and says so — which is the point: a fixed bug should
not leave a stale expectation behind.

None of these were reachable from a unit test. Each compiles correctly in
isolation; the damage only appears once the output reaches a browser.

| Gap | Effect |
| :--- | :--- |
| `<computed value="count * 2" />` | The bare-identifier form that `README.md` and the component docs both show renders its initial value and never recomputes. Only `state.count * 2` registers a dependency. |
| Multi-line `<state>` tag | `ComponentParser` strips it with `/<state.*? \/>/g`; `.` does not match newlines, so the tag leaks into the template and reactivity stops for the whole component. Values still parse and the first render still looks right. |
| Two guard modules | Each emits its own `const { AvenxGuard } = Avenx;` into one bundle scope, so the bundle fails to parse and the app never starts. **The build still reports success.** Any project with an auth guard and a role guard ships broken. |
| A guard reading a bridge | The relative import is stripped without the binding being rewired, so the router reports `AVX_R07`. There is no supported alternative: `AvenxGuard` takes no injection and the sandbox blocks `window` inside actions. |
| A component inside `<@defer>` | The trigger fires and the marker is inserted, but nothing mounts it. This is the headline use of the feature. |
| `<@defer>` in a stateful component | Any unrelated state change discards the deferred container, so the block can never load. This makes `<@defer>` unusable in most components. |
| `data-ax-style` | Documented public API that applies nothing at all — the `style` attribute stays null on first render, with both the bare and `state.`-prefixed expression. |

The fixtures work around each of these where they have to, and say so in a
comment at the point of the workaround.

## CI

`ci.yml` runs the suite on Chromium for every pull request. Chromium alone gates
a PR: a framework regression shows up there first, and a three-engine fan-out on
every push costs more than it returns for a pre-v1 project.

`e2e-nightly.yml` runs Chromium, Firefox and WebKit once a day, and can be
dispatched by hand. All three are green today.

Failures upload the Playwright HTML report as a build artifact.
