---
title: 'Avenx Trace'
description: 'Record a causal trace of a running Avenx application, read why something happened, and export the recording as a regression test.'
---

`avenx trace` records **why** your application did what it did, and turns that
recording into a test.

Reproduce a bug once in the browser. Avenx captures the whole causal chain —
the click, the action it ran, the bridge mutation, the state write, the
watchers that woke, the DOM nodes that changed. Then one command turns that
recording into an executable regression test.

```bash
npx avenx serve --trace     # reproduce the bug in the browser
npx avenx trace view latest # read why it happened
npx avenx trace export latest --out test/cart-qty.test.js
```

---

## 1. Why this exists

Every team pays the same tax on every bug report: reproducing it, then writing
a test so it stays fixed. The second half is the expensive one, and the
information needed to do it was all present the moment the bug happened.

Avenx can capture that information because of how it is built. Template
expressions, computed properties and action bodies stay **source text** right
through to evaluation, and every identifier they resolve passes through a
single sandbox. Every state write goes through one Proxy trap; every DOM change
goes through one patcher. So the framework can say *which expression read which
property, and which state change moved which DOM node* — and it can feed the
same inputs back in to reproduce the run.

A framework that compiles expressions into closures has thrown that away before
the code runs.

---

## 2. Recording

Recording is **off by default** and is a development feature. Turn it on with a
flag:

```bash
npx avenx serve --trace
```

The dev server injects a small recorder and mounts an endpoint that receives
traces. Without the flag, neither exists.

Reproduce the behaviour in the browser, then either navigate away — the trace
is sent automatically — or save it explicitly from the console:

```js
await avenxTrace.save();
```

`window.avenxTrace` also exposes `id`, `size`, `deterministic`, `snapshot()`
and `stop()`.

Traces land in `.avenx/traces/` as one JSON file each. Add that directory to
your `.gitignore` unless you mean to commit them.

---

## 3. Reading a trace

```bash
npx avenx trace list
```

```text
TRACE ID        AGE     EVENTS   COMPONENTS   STATUS
trace-4f2a      2m      14       3            deterministic
trace-a91c      8m      42       7            best-effort
```

```bash
npx avenx trace view trace-4f2a
```

```text
▸ click <button.qty-inc> CartItem
  └─ action CartItem.incQty()  src/components/cart-item/cart-item.component.js:3
     └─ bridge cart · addQty("a", 1)
        ├─ write cart.items.0.qty 2 → 3
        │  ├─ woke CartItem#render
        │  │  └─ patched <span.qty> text "2" → "3"
        │  └─ woke CartSummary#render
        │     ├─ getter cart.total 36 → 48
        │     └─ patched <strong.total> text "$36.00" → "$48.00"
        └─ emit cart:changed → 0 listeners

Determinism: deterministic — this trace can be exported as a regression test.
```

Reading order follows **causality, not time**. Every line sits under the thing
that caused it, so the answer to "why did this DOM node change" is always the
line above it.

A derived value — a `computed` or a bridge getter — appears only when its result
actually *changed*, because `cart.total 36 → 48` is a step in a causal chain
while `cart.total read` is not. A bridge getter has no cache of its own, so the
first read inside a recording establishes a baseline and is not reported; the
change after it is.

Source locations (`cart-item.component.js:3`) come from `dist/bundle.trace.json`,
a sidecar the compiler writes next to your bundle. It is never referenced by the
bundle, so an application that records no traces downloads nothing extra.
Build the project to get them.

Useful flags: `--json` for the raw trace, `--roots=N` to cap a long session.

---

## 4. Exporting a regression test

```bash
npx avenx trace export trace-4f2a --out test/cart-qty.test.js
```

This writes two files: the test, and the trace beside it, so a committed test
does not depend on `.avenx/traces/` surviving a `prune`.

```javascript
import assert from 'assert';
import { mountTestComponent, replay } from 'avenx-core/testing';
import { loadComponent } from 'avenx-core/tooling';
import cart from './../src/bridges/cart.bridge.js';
import trace from './cart-qty.trace.json' with { type: 'json' };

const CartItem = loadComponent(
  new URL('./../src/components/cart-item/cart-item.component.js', import.meta.url).pathname,
  { bridges: { cart } },
);

let app;

const result = await replay(trace, {
  async mount() {
    app = await mountTestComponent(CartItem, {});
    return app;
  },
  async at(step) {
    switch (step.index) {
      // Step 1: click on <button.qty-inc>
      case 0: {
        assert.strictEqual(app.find('span.qty').textContent.trim(), '2');
        break;
      }
      default:
        break;
    }
  },
});

assert.strictEqual(result.ok, true);
assert.strictEqual(result.verified, true);
app.unmount();
```

An Avenx component file is not a JavaScript module — it is template syntax that
only becomes a class after compilation — so a test cannot `import` one.
`loadComponent()` runs the same compiler the build uses on a single file, which
means the generated test exercises the code your application actually ships.

A component that imports a **bridge** compiles to a reference the bundle
supplies, so the test hands the real bridge instance in. `avenx trace export`
detects that and writes the import for you.

The generated assertions are a starting point. Keep the ones that describe the
bug and delete the rest — but note that `replay()` itself already compares
**every** recorded state and DOM change against the recording, and throws at the
first step that differs. The assertions are extra readability, not the test.

When the code regresses, you get the causal report, not a bare mismatch:

```text
Step 1 (click <button.qty-inc>) diverged at position 1:
  recorded: write count 0 -> 1
  replayed: write count 0 -> 2
```

---

## 5. Deterministic vs best-effort

A trace is one of two things, and Avenx will not pretend otherwise.

**Deterministic** — nothing was observed that replay cannot reproduce. The
trace can become a regression test you rely on.

**Best-effort** — something escaped the recording boundary. Replay may diverge,
so `replay()` **refuses to run it** unless you pass `allowBestEffort: true`, and
even then the result is never marked `verified`.

A recording is downgraded for any of:

| Reason | What it means |
| :--- | :--- |
| `unattributed-write` | State changed with no recorded input to explain it — a timer, an outside listener, or async code outside a `<resource>`. |
| `polling-resource` | A `<resource>` declares a `pollInterval`, so how many times it settled depends on wall-clock time. |
| `unserializable-value` | A recorded value could not be represented in JSON (a DOM node, a class instance, a cycle, `NaN`). |
| `redacted-input` | A redaction rule removed a value replay would have to feed back in. |
| `truncated` | The ring buffer filled and dropped its oldest nodes. |

### Determinism is verified, not claimed

The list above is what the *recorder* can detect, and it is not exhaustive.
Bridge modules are ordinary ES modules and are not sandboxed, so a `Date.now()`
inside a bridge action reaches the real clock and the recorder cannot see it.

So replay never trusts the recording. It runs the real framework and **compares
what it observes against what was recorded**, step by step. A trace that claims
to be deterministic and diverges fails loudly with `AVX_R27`. This is the only
claim in the system backed by evidence rather than assertion.

Template expressions and action bodies are a different story: they resolve
`Date` and `Math` through Avenx's sandbox, so those readings *are* recorded and
replayed exactly.

---

## 6. Privacy and redaction

**A trace records real application state, which means it records whatever your
users typed.** Treat one like a debug dump: do not attach it to a public issue
without reading it first.

Configure redaction in `avenx.config.json`:

```json
{
  "trace": {
    "redact": ["auth.token", "user.*", "*.password", "billing.**"],
    "maxNodes": 5000
  }
}
```

Patterns match the same dotted property paths the trace records:

- `auth.token` — that exact path, and anything nested beneath it
- `user.*` — any single segment under `user`
- `*.password` — `password` under any single segment
- `billing.**` — `billing` and everything below it, at any depth

Redaction is applied **at record time**. A matched value never enters the
buffer, so it cannot leak through an export path that forgot to strip it. The
path is still recorded, so the trace remains useful: you see that
`auth.token` changed, just not to what.

As a backstop, any string value a rule actually withheld is also removed from
anywhere else it appears in the trace when the trace is serialized — including
the verbatim source of an action that contains it as a literal, and the
arguments of a call recorded before the write that identified it as a secret.

A trace declares what it withheld, in `redactions`, so a reader knows it is
partial.

### What redaction does not cover

- **Values you did not name.** Redaction is a list of paths, not a classifier.
  Anything you have not listed is recorded in full.
- **Very short values.** Strings under six characters are not scrubbed from
  source text, because doing so would mangle unrelated code.
- **The shape of your data.** Keys, paths and structure are always recorded.

---

## 7. Contracts

If a component declares a [compiler contract](/core-concepts/compiler-contracts/),
a trace checks it against what the code actually did:

```text
Contract violations observed during this trace:
  ⚠ AVX_W33  CartItem.total is declared `deterministic` but read Date.now() during this trace
```

The compiler checks contracts by pattern-matching source text, which misses
anything reached indirectly — a computed calling a helper that calls
`Date.now()` looks pure to a regular expression. A trace records where every
non-deterministic global was read and where every write happened, so the check
becomes a walk up the causal chain. The diagnostic codes are the compiler's own,
so `avenx explain AVX_W33` still works.

`static` and `isolated` are structural claims the compiler decides completely
from source, so a trace adds nothing and does not re-check them.

---

## 8. Performance and overhead

Tracing is off by default and costs nothing when off. Each instrumented site is
a single boolean check; no object is allocated and no listener is registered.

When it is on, the cost depends entirely on what the application is doing.
Measured with `npm run bench` (`trace-overhead.bench.js`):

| Workload | Overhead |
| :--- | :--- |
| Real component interaction — clicks, re-renders, DOM patches | **within measurement noise** (±5%) |
| A synthetic tight loop of 100,000 state writes with no rendering | **roughly 2×** the cost of a write |

The second row is the honest worst case and the first is what you will actually
feel: in a real application, rendering and DOM work dominate, and the recorder's
share of that disappears into it. Tracing a loop that does nothing but write
state is where the instrumentation is the whole cost.

Memory is the stronger guarantee. The recorder is bounded by a ring buffer
(5000 nodes by default, `trace.maxNodes` to change it) that evicts the oldest in
blocks, and the annotation index is pruned with it, so a dev server left open
all day cannot grow without limit. Captured values are bounded in depth, breadth
and string length; collection mutations record an operation name and a resulting
size rather than cloning the collection, so tracing a growing list stays linear
rather than quadratic.

The recorder adds about **16 KB minified / 5.8 KB gzipped** to the runtime
(measured against a scaffolded project with `node scripts/size-check.js`). That
is the price of being able to record in a real browser next to a real bug, and
it is paid by every build whether or not tracing is ever switched on.

Replay, the causal viewer, test generation, the trace store and the component
loader are *not* in that number. They live behind `avenx-core/testing`,
`avenx-core/tooling` and the CLI, and a system test asserts against the built
bundle that none of them can reach it.

---

## 9. Programmatic API

For tests that record directly, without the dev server:

```javascript
import { startRecording, stopRecording, replay } from 'avenx-core/testing';

const recorder = startRecording({ redact: ['auth.token'] });
recorder.arm();          // startup is over; record interaction from here
// ... drive the app ...
const trace = stopRecording();

await replay(trace, { mount: () => mountTestComponent(MyComponent, {}) });
```

`replay(trace, options)`:

| Option | Meaning |
| :--- | :--- |
| `mount()` | **Required.** Sets up and mounts the app. Its return value is the context passed to `at`. |
| `at(step, context)` | Runs after each input, for your own assertions. |
| `root` | Where to resolve event targets. Defaults to the mounted subtree. |
| `router` | A router to drive recorded navigations through. |
| `allowBestEffort` | Accept a trace the recorder marked best-effort. |
| `strict` | Throw on divergence. Defaults to `true`. |

---

## 10. Limitations

Known and deliberate for v1:

- **The viewer is text.** A graphical inspector is future work; a causal trace
  is a tree of short lines, and a tree in a terminal is diffable, pasteable and
  greppable today.
- **Only `<resource>` network activity is recorded.** Avenx does not intercept
  `fetch` or `XMLHttpRequest` globally. A trace that silently swallowed every
  request would be recording work Avenx has no model of. Requests made outside a
  `<resource>` are not reproduced — and a trace that depends on them diverges
  visibly during replay rather than passing by accident.
- **A replayed resource does not re-track its handler's dependencies.** The
  recorded settlement stands in for the handler entirely, because the handler
  *is* the network call. Anything that depends on re-tracking shows up as a
  divergence.
- **Bridge and imported-module code is not sandboxed**, so non-deterministic
  globals read there are invisible to the recorder. Replay catches the
  consequence.
- **Event targets are matched by selector and index.** A recorded trace can stop
  replaying if you rename the class it was recorded against. Replay reports the
  selector it could not find rather than skipping the step.
- **One recording at a time.** The tracer is process-wide.

---

## 11. Diagnostics

| Code | Meaning |
| :--- | :--- |
| `AVX_R25` | The trace cannot be read by this build — usually a newer format version. |
| `AVX_R26` | A best-effort trace was replayed without `allowBestEffort`. |
| `AVX_R27` | Replay produced different state or DOM changes than the recording. |
| `AVX_R28` | A replay could not be set up (usually a missing `mount()`). |

Run `avenx explain AVX_R27` for causes and remedies.

---

## 12. Command reference

| Command | Description |
| :--- | :--- |
| `avenx serve --trace` | Serve with recording on. |
| `avenx trace list` | List recorded traces, newest first. |
| `avenx trace view <id\|latest>` | Print a trace as a causal tree. |
| `avenx trace export <id\|latest>` | Write a regression test for a trace. |
| `avenx trace prune` | Remove traces, keeping the 20 newest. |

`export` takes `--out <file>`, `--force` and `--dry-run`. `prune` takes
`--all`, `--keep=N`, a trace id, and `--dry-run`. `list` and `view` take
`--json`.
