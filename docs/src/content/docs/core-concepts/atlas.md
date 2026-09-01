---
title: 'Avenx Atlas'
description: 'The compiler-generated semantic model of your application, and the impact and why queries built on it.'
---

Avenx Atlas is the compiler's map of your application's **data flow** — not its
module graph. It knows that `cart.items` is read by a getter in a bridge, that
the getter is rendered by two components, and that one of them sits behind a
guarded route.

```bash
npx avenx atlas             # what is in this application
npx avenx impact cart.items # what can be affected if this changes
npx avenx why cart.total    # where this value comes from
```

Atlas is **compile-time only**. It adds nothing to the runtime and nothing to
your bundle.

---

## 1. Why this exists

The riskiest routine change in a frontend application is touching shared state,
and it is the one with the least tooling. The usual answers are grep, or a
runtime profiler that can only tell you what already happened after you have
reproduced it.

Avenx can answer statically because its declarations are declarations. `<state>`
is a closed, enumerable set of keys. `<computed>` and `<action>` are named units
with source text the compiler keeps. A bridge is reached through an import, so
the compiler can see every consumer. Templates are ASTs with positions. Routes
and guards are declared.

The compiler already computed all of that on its way to emitting a bundle, and
then discarded it. Atlas is the retained form.

It pairs with [Avenx Trace](/core-concepts/trace/): **Atlas is what can happen,
Trace is what did happen.** They use the same vocabulary — reads, writes,
invokes, emits — and a test in this repository checks that every causal step in
a recorded trace corresponds to an edge Atlas predicted.

---

## 2. `avenx atlas`

```bash
npx avenx atlas
```

```text
🗺  Avenx Atlas
   43 nodes · 74 relationships · 0 unresolved

  Components   3
  Pages        2
  Bridges      1
  State keys   10
  Computed     1
  Getters      2
  Actions      7
  Resources    0
  Bindings     11
  Handlers     3
  Routes       3
  Guards       1

Bridges
  cart — 9 declarations  src/bridges/cart.bridge.js

Routes
  /            → Cart
  /cart        → Cart
  /checkout    → Checkout  guarded by AuthGuard

Every relationship in this project resolved.
```

`--json` prints the whole model.

---

## 3. `avenx impact`

The question this exists to answer: *what breaks if I change this?*

```bash
npx avenx impact cart.items
```

```text
What depends on: cart.items
   state  src/bridges/cart.bridge.js:5

├─ reads cart.total .reduce  src/bridges/cart.bridge.js:10
│  ├─ reads CartSummary {{ }} "cart.total"  src/components/cart-summary/cart-summary.component.js:14
│  └─ reads Checkout {{ }} "cart.total"  src/pages/checkout.page.js:7
│     └─ declares Checkout  src/pages/checkout.page.js
│        └─ routes-to /checkout  src/main.app.js:9
├─ reads cart.count .length  src/bridges/cart.bridge.js:14
│  └─ reads CartSummary {{ }} "cart.count"  src/components/cart-summary/cart-summary.component.js:15
├─ reads CartList <@for> "cart.items"  src/components/cart-list/cart-list.component.js:9
├─ reads CartList {{ }} "item.qty" .[].qty  src/components/cart-list/cart-list.component.js:10
├─ writes cart.addItem  src/bridges/cart.bridge.js:18
│  └─ invokes CartList.seed  src/components/cart-list/cart-list.component.js:3
│     └─ invokes CartList @click="seed()"  src/components/cart-list/cart-list.component.js:8
└─ writes cart.addQty .[].qty [possible]  src/bridges/cart.bridge.js:23
   └─ invokes CartItem.incQty  src/components/cart-item/cart-item.component.js:7
      └─ invokes CartItem @click="incQty()"  src/components/cart-item/cart-item.component.js:19

22 related nodes

0 unresolved relationships in this answer.
```

Read it as a chain: the loop variable `item` inside `<@for item in cart.items>`
resolves back to `cart.items`, so `{{ item.qty }}` is reported as a read of
`cart.items[].qty`. The route at the end is there because the page that renders
the binding is reachable from it.

The last line is part of the answer, not decoration. See
[section 5](#5-certain-possible-and-unresolved).

---

## 4. `avenx why`

The inverse question: *where does this value come from?*

```bash
npx avenx why cart.total
```

```text
What this depends on: cart.total
   getter  src/bridges/cart.bridge.js:10

└─ reads cart.items .reduce  src/bridges/cart.bridge.js:5

1 related node

0 unresolved relationships in this answer.
```

`impact` and `why` are the same traversal in opposite directions, sharing one
implementation, so the two answers cannot contradict each other.

### Naming a symbol

Both accept, in order of precision:

| You type | It means |
| :--- | :--- |
| `state:bridge:cart.items` | that exact node |
| `cart.items` | the member `items` of the owner `cart` |
| `CartItem` | the component itself |
| `qty` | a member named `qty`, if only one exists |
| `/checkout` | a route |

An ambiguous name lists its candidates rather than picking one.

### Options

| Option | Meaning |
| :--- | :--- |
| `--json`, `-j` | Machine-readable output. |
| `--depth=<n>` | How many hops to follow. Defaults to 12. |

---

## 5. `certain`, `possible` and `unresolved`

This is the part to read before trusting an answer.

**`certain`** — the relationship follows directly from a declaration. `{{ qty }}`
in a template where `<state qty="1" />` is declared. `cart.addQty(id, 1)` where
`addQty` is a declared bridge action. `items.push(x)`, which mutates its receiver.

**`possible`** — Atlas believes the relationship holds but cannot prove it. The
main source is a local bound from application state:

```js
const item = this.items.find((entry) => entry.id === id);
item.qty = item.qty + n;   // writes cart.items — but which element is unknown
```

Atlas records the write, marks it `possible`, and keeps the path (`[].qty`).

**`unresolved`** — analysis could not follow something, and says so rather than
producing silence. Each entry carries a reason, the expression, and a location:

| Reason | What it means |
| :--- | :--- |
| `dynamic-member` | A member reached through a computed key: `items[key]`. |
| `unknown-identifier` | A root identifier that matched no declaration in scope. |
| `unknown-bridge-member` | A bridge accessed through a member it does not declare. |
| `shadowed-identifier` | A local binding shadows a declaration of the same name, so that body was not followed. |
| `spread` | A spread whose contents cannot be enumerated. |
| `slot-scope` | A scoped-slot variable, whose value comes from whichever parent fills the slot. |
| `dynamic-component` | A template tag naming no known component. |
| `dynamic-route` | A route target that is not a literal page name. |

Every `impact` and `why` answer prints how many unresolved entries bear on it,
**including when the count is zero**. Zero is information; silence is not.

### The principle

> An uncertain answer is better than a confidently wrong one.

Atlas never manufactures certainty. If it cannot follow an expression, the gap
appears in `unresolved` — it is never quietly dropped, and never guessed at.

---

## 6. Diagnostics

Two warnings fall out of the model. Both are **absence** claims, and both refuse
to fire when the analysis behind them was incomplete.

### `AVX_W40` — unread state

```text
[AVX_W40] cart.discount is written by cart.applyCoupon but read nowhere in the
application (src/bridges/cart.bridge.js:7).
```

State that no template binding, computed, action, resource or guard reads.

### `AVX_W41` — unreachable action

```text
[AVX_W41] CartSummary.neverCalled is never invoked from a template, action,
computed, resource or guard (src/components/cart-summary/cart-summary.component.js:9).
```

Both run during `avenx build` and `avenx check`, appear in `avenx check --json`,
and honour the `warnings` setting like every other code:

```json
{ "warnings": { "AVX_W40": "off", "AVX_W41": "error" } }
```

Run `avenx explain AVX_W40` for causes and remedies.

### When they stay quiet

Deliberately, and this is the important half:

- **When anything unresolved could be hiding the relationship.** A
  `dynamic-member`, `shadowed-identifier`, `spread` or `unknown-identifier`
  anywhere the symbol could be reached from blocks the claim. The block is
  scoped: unresolved analysis in one component does not silence a clean claim in
  another.
- **Lifecycle actions.** `onMount`, `onUnmount`, `onBeforeUpdate` and the rest
  are invoked by the runtime by name, so they are reachable with no call site.
- **Members of a bridge nothing imports.** The bridge is already reported once
  as omitted from the bundle; warning about each of its members would pile noise
  on a fact already stated.

---

## 7. The generated artifact

`avenx build` writes `dist/<outputName>.atlas.json` beside the bundle, on the
same terms as `bundle.trace.json`: **it is never referenced by the bundle**. An
application that never runs a query downloads nothing extra, a deployment that
does not want the file simply does not upload it, and the runtime is byte-for-byte
unchanged.

```jsonc
{
  "atlasVersion": 1,
  "generatedAt": "2026-08-30T00:00:00.000Z",
  "srcDir": "src",
  "summary": { "nodes": 43, "edges": 74, "unresolved": 0, "counts": { } },
  "nodes": [
    {
      "id": "state:bridge:cart.items",
      "kind": "state",
      "name": "items",
      "owner": "bridge:cart",
      "loc": { "file": "src/bridges/cart.bridge.js", "line": 5 }
    }
  ],
  "edges": [
    {
      "from": "getter:bridge:cart.total",
      "to": "state:bridge:cart.items",
      "kind": "reads",
      "confidence": "certain",
      "loc": { "file": "src/bridges/cart.bridge.js", "line": 10 },
      "path": "reduce"
    }
  ],
  "unresolved": []
}
```

**Node kinds:** `component`, `page`, `bridge`, `state`, `computed`, `action`,
`resource`, `getter`, `event`, `binding`, `handler`, `route`, `guard`.

**Edge kinds:** `reads`, `writes`, `invokes`, `renders`, `imports`, `routes-to`,
`guarded-by`, `declares`, `emits`, `subscribes`.

The document is **versioned** and **sorted**: nodes, edges and unresolved entries
are ordered deterministically, so two builds of unchanged sources produce
identical bytes and the file diffs cleanly. Readers must tolerate unknown fields;
a bump of `atlasVersion` means something existing changed meaning.

An `errors` array appears only when a phase of the analysis failed. A reader that
finds it is holding a **partial** model, and an absence in it is not evidence of
an absence in the application.

---

## 8. Source locations

Every location Atlas reports is a line and column in the file you wrote.

That takes deliberate work. By the time the compiler validates a template it has
stripped imports and comments, deleted declaration blocks, applied style scoping
and expanded `data-ax-bind` — offsets into that string point at nothing you can
open. Atlas instead **masks** the original file: declaration regions and comments
are replaced character-for-character with spaces, newlines kept, so an offset into
the mask is an offset into the file. Tests read each reported line back out of the
source and assert it contains what Atlas said was there.

---

## 9. Performance

Atlas is built as a by-product of the parse the compiler already performs. On a
300-component project it adds roughly 30 ms to a 130 ms build.

Per-unit fragments are cached in memory, keyed by the file's content **plus a
digest of the bridge surfaces it resolves against** — so renaming a bridge getter
invalidates every consumer, even though none of their files changed. A warm
rebuild of that project takes about 107 ms against 199 ms cold.

The artifact is proportionate to the application: roughly 11 KB per component,
because every template binding is a node with its own location.

---

## 10. Limitations

Known and deliberate:

- **The analyser is not a JavaScript parser.** It is a string- and comment-aware
  scanner that understands member access, optional chaining, literal and computed
  members, calls, assignment, update operators, template literals and
  destructuring — the shapes Avenx components contain. Anything it cannot follow
  becomes an `unresolved` entry.
- **Scoping is flat.** A name bound anywhere in a body shadows an application
  declaration everywhere in it. This over-approximates shadowing, which loses an
  edge and reports it rather than inventing one.
- **Aliasing is followed one hop.** `const item = this.items.find(...)` is
  tracked; assigning that local to another local is not.
- **Imported helper modules are not analysed.** An action that calls a function
  from a plain `.js` module is followed as far as the call; what the helper does
  is outside the model.
- **Scoped-slot variables are out of model.** Their values come from whichever
  parent fills the slot, which is not a static relationship.
- **Element identity is not modelled.** `cart.items[2].qty` resolves to the state
  key `cart.items` with the path `[].qty`. Atlas models declared symbols, not
  individual elements.
- **Route guards are read from `initRouter`.** Guards attached at runtime through
  `router.beforeEach()` are not in the model.
- **The cache is in memory.** It lives for the life of the process; there is no
  on-disk cache, because the rest of the build is not incremental either.

---

## 11. Command reference

| Command | Description |
| :--- | :--- |
| `avenx atlas` | Print an overview of the application model. |
| `avenx atlas --json` | Print the whole model. |
| `avenx impact <symbol>` | What can be affected if this changes. |
| `avenx why <symbol>` | Where this value comes from. |

`impact` and `why` take `--json` and `--depth=<n>`.

`avenx inspect` and `avenx stats` read the same model, so the hierarchy they
print and the answers a query gives always agree.
