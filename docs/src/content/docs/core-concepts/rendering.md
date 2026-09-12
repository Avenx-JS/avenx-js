---
title: 'How Rendering Works'
description: 'The compiled render program: what the Avenx compiler emits, what the runtime executes, and why an update costs what it costs.'
---

Avenx compiles a component's template through a **typed intermediate
representation** into a **render program**: a static HTML skeleton, a list of
binding operations, and a list of blocks for control flow. The skeleton is
parsed once per component class. Each binding becomes its own reactive effect,
so a state change updates only the bindings that read it.

This page explains what changed, why, and what it means for code you write.

---

## The short version

Nothing in your components changes. `{{ }}`, `@click`, `data-ax-class`,
`<@for>`, `<@defer>`, props and slots all mean exactly what they meant before.
`<@if>` is new, and `data-ax-style` now applies.

What changed is what happens between a state write and the DOM:

```text
before:  state change → re-render the whole template to an HTML string
                      → DOMParser
                      → diff the new tree against the live DOM
                      → patch

now:     state change → the bindings that read it
                      → write to their nodes
```

The practical effect is that **the cost of an update is proportional to the
change rather than to the template**. Changing one value in a component with
1500 bindings costs roughly what it costs in a component with 10.

---

## The old model, and what was wrong with it

The compiler used to hand the runtime a template string with its
interpolations still in it:

```js
super({ count: 0 }, { doubled: 'count * 2' }, bridges,
      '<p>{{ count }}</p><p>{{ doubled }}</p>', ...);
```

Everything after that was the runtime's problem. On every update it
interpolated the whole template into HTML, handed that HTML to `DOMParser`, and
walked the resulting tree against the live DOM looking for differences.

That works, and it has three costs that grow with the size of the template
rather than the size of the change:

- **Every expression is re-evaluated.** A component with 400 bindings evaluates
  400 expressions to change one of them.
- **The whole template is serialised and reparsed.** Including the parts that
  can never change.
- **The whole tree is diffed.** Including the parts that were just proven
  identical.

Measured on a component whose only change is one text binding (happy-dom,
median of five samples):

| Bindings in the component | Before | After |
| ---: | ---: | ---: |
| 10 | 0.371 ms | 0.0153 ms |
| 100 | 1.970 ms | 0.0144 ms |
| 500 | 16.758 ms | 0.0190 ms |
| 1500 | 161.018 ms | 0.0503 ms |

The old column grows 435× across that range. The new one grows 3.3×.

Allocation moved by a similar margin. One live value changing in a component
with 800 static rows allocated **23.8 MB** per update, because the string and
the parsed tree were both rebuilt every time; it now allocates **13.4 KB**.

---

## The new model

### The pipeline

```text
.component.js
  → tokenizer + tree parser      where each tag begins and ends; what tree they form
  → template IR                  what each construct means
  → lowering                     skeleton, ops and blocks
  → expression codegen           one closure per expression, addressed by index
  → bundler
```

The IR is the layer that carries meaning. `<@for row in rows key="row.id">`
becomes a node with a list expression, a binding name, a key and a body
fragment. Nothing downstream has to re-read markup to find out what it was.

This matters because of what it replaced. The compiler used to record a
construct by rewriting it into *different markup* — `<@for>` became
`<template data-ax-for="rows" data-ax-as="row">` — and the runtime rediscovered
the meaning by reading those attributes back off the live DOM with
`querySelectorAll`. Every expensive consequence followed from that: a list could
not be compiled at all, because by the time the backend ran the list was an
anonymous element carrying strings.

### What the compiler emits

```js
{
  v: 2,
  html: '<p><!--axt:0--></p><ul><!--axt:1--></ul>',
  ops: [
    { k: 'text', t: 0, x: 0 },
    { k: 'for',  t: 1, x: 1, as: 'row', key: 2, b: 0 }
  ],
  elements: 0,
  texts: 2,
  blocks: [
    { html: '<li><!--axt:0--></li>', ops: [{ k: 'text', t: 0, x: 3 }], elements: 0, texts: 1 }
  ]
}
```

The **skeleton** (`html`) is the template with every dynamic part removed.
Interpolations become comment markers; bound attributes are dropped; control
flow becomes a single comment marker that the block renders at. It is valid
HTML with no expressions in it.

The **ops** say what to do and where. `{ k: 'text', t: 0, x: 0 }` reads
"evaluate expression 0, write it to text marker 0".

The **blocks** are the bodies control flow owns. A block has the same shape as
the root — skeleton, ops, marker counts — and is parsed once for the life of
the page and cloned per arm or per row.

### Bindings are addressed by index

An op carries `x: 0`, not `x: "cart.total"`. The sources are compiled to
closures and emitted as a positional array beside the program:

```js
Counter.__axProgramExprs = [
  ($s) => axGet($s, 'count'),
  ($s) => axRead(axGet($s, 'row'), 'label', false)
];
```

The previous format keyed the compiled table by the expression's own source
text, which meant every expression shipped twice — once as a key and once as
compiled code — and made the contract between compiler and runtime string
identity, which nothing could check. An index is checkable and smaller, and it
means a program is self-contained: the runtime never needs the template source
to work out what a binding meant.

One consequence is worth knowing: if any expression in a template fails to
compile, the **whole program is withdrawn** and the component keeps the string
renderer. An index names a closure and nothing else, so a missing entry would
be a binding the runtime could neither evaluate nor name.

The program travels in the constructor's existing options object, referenced
through a class static:

```js
class Counter extends AvenxComponent {
  constructor(bridges, props) {
    super({ count: 0 }, ..., { program: Counter.__axProgram });
  }
}
Counter.__axProgram = { v: 2, html: '...', ops: [...] };
Counter.__axProgramExprs = [ ($s) => axGet($s, 'count') ];
```

It is a static rather than an inline literal because the runtime caches one
parsed skeleton per program object. Written inline it would be a fresh object on
every `new`, and every instance would reparse the template.

### What the runtime does

**Once per component class.** The skeleton is parsed into a `<template>`
element — template parsing is fragment parsing, so content a document parser
would relocate (a bare `<td>`) survives. The markers are then found in the tree
the parser *actually built* and their positions recorded as index paths, after
which the markers are removed. A 2000-node template is parsed once for the life
of the page.

**Once per instance.** The prepared tree is cloned, and each binding target is
resolved by following its recorded path. Cloning is native; there is no
tokeniser, no attribute parsing and no error recovery.

**Once per binding.** Each op gets a reactive effect that evaluates its
expression and writes the result. Evaluating registers the dependencies, so a
write to `count` wakes the bindings that read `count` and nothing else.

**Per block, on demand.** A control-flow op owns a *range* of sibling nodes
anchored at its marker, and remembers exactly which nodes it inserted — clearing
by emptying the parent would take the siblings belonging to other bindings.

- `<@if>` renders the first arm whose test is truthy, and swaps only when the
  arm index changes. An unrelated update does not tear down live DOM, so focus,
  selection and scroll position survive.
- `<@for>` reconciles by key: rows are reused in place, moved as the new order
  is walked, and torn down when their key disappears.
- `<@defer>` arms its trigger once and renders its block when it fires.

An event op is attached once at mount rather than re-bound on every update,
because a compiled element is created once and never replaced.

### Why markers rather than paths

The compiler cannot number nodes by walking its own AST and assume the browser
will produce the same tree. HTML parsing inserts implied elements (`<tbody>`),
relocates misplaced content, and closes tags the author left open. A path
computed from the compiler's tree can address a different node than the one the
compiler meant.

So the compiler emits markers and the runtime resolves them against the real
tree. If any marker cannot be found, the template refuses to prepare and the
component falls back to the string renderer — slower, and correct.

---

## What still uses the string renderer

A program is emitted only when **every** construct in a template is one the
program runtime implements. A template containing anything else gets no program
at all, and renders exactly as it did before.

There is no partial mode. A template half rendered by a program and half by the
diff engine would have two owners for the same DOM subtree, and the first
disagreement between them would be unattributable.

Compiled today:

- text interpolation, `{{ }}` and `{{{ }}}`
- attribute bindings, whole-value and mixed with literals
- boolean attributes
- `data-ax-show`, `data-ax-class`, `data-ax-html`, `data-ax-style`
- event handlers and their modifiers
- `<@if>` / `<@elseif>` / `<@else>`
- `<@for>` / `<@empty>`, keyed and unkeyed
- `<@defer>` / `<@placeholder>`, every trigger
- `<slot>`, named and default, with fallback content
- static subtrees
- child component mount points and their props
- arbitrary nesting of all of the above

Falls back today:

| Construct | Why |
| --- | --- |
| `<@suspense>`, `<@errorBoundary>` | Each replaces a subtree in response to a thrown promise or a thrown error, which the block runtime has no equivalent for yet. |
| `<@deadlock>` | Same, plus boundary state the scheduler reaches into. |
| Transitions | Enter/leave hooks are driven by the patcher. |
| A dynamic component tag | Its class can change between renders, which means unmounting one instance and mounting another. |
| A dynamic attribute name (`:[expr]`) | There is no attribute for the program to address until the name is evaluated. |
| `data-ax-ref` | Refs are collected by scanning the subtree after a render, which a program does not do. |
| `data-ax-validate` | Declarative validation is driven by the same post-render scan. |
| An expression the code generator cannot compile | The program is withdrawn rather than shipped with a hole in its expression table. |

`avenx build` reports what did not compile, grouped by reason:

```text
[AVX_W47] 2 template(s) could not be compiled to a render program and will
render through the string renderer:
  a <@suspense> boundary: ProductList
  a template ref: SearchBox
```

Those components still work. They cost time proportional to their whole
template on every update, which is worth knowing about rather than absorbing.
Silence the class with `"warnings": { "AVX_W47": "off" }` in
`avenx.config.json`.

You can ask a mounted component directly:

```js
component.$compiled; // true when a render program is driving the DOM
```

---

## Events

Event handlers are ops now. `@click.prevent="save()"` becomes
`{ k: 'event', e: 0, n: 'click', m: ['prevent'], x: 0 }`, where `x` indexes the
compiled statement table, and the listener is attached once when the element is
created.

The handler source leaves the markup entirely. The string renderer needs it in
the document, because it re-reads `data-ax-event` off the DOM when an event
fires and re-binds every handler on every update; a compiled element is created
once and never replaced, so one `addEventListener` at mount is both correct and
the whole cost.

Modifiers are applied around the handler rather than inside it, so the compiled
statement stays exactly what you wrote.

One thing did change, and it matters for Content Security Policy. `EventExecutor`
used to compile every handler with `new Function` before passing it on, which
meant **no inline handler ever reached the AST expression evaluator**. Two
consequences:

- an application needed `'unsafe-eval'` as soon as it contained one `@click`,
  even though the [deployment guide](/guides/deployment) says an
  expression-only application does not;
- `getFallbackReport()`, the documented way to check, never saw those handlers
  and came back empty.

Handlers now go through the same path as any other statement body: parsed
first, and compiled with `new Function` only when the body is genuinely a
statement (`if`, `for`, `return`, a declaration). `@click="count++"` compiles
nothing.

The evaluator's guarantees therefore now hold for inline handlers too — most
visibly, a property access cannot reach `constructor` however the key is
spelled, including `x['const' + 'ructor']`, which the source-text sandbox it
replaced did not catch.

---

## Scheduling

Bindings do not write to the DOM synchronously inside an assignment. Each
binding's effect is lazy, and its callback queues a job, exactly as the
component's render watcher used to.

That is deliberate. A plain effect per binding would be simpler and would change
what `$nextTick` means: the DOM would already have been touched by the time it
resolved, and an action making three writes to one value would produce three DOM
writes. Batching is unchanged — writes still coalesce into one microtask flush.

Lifecycle is coalesced rather than re-derived. With per-binding effects there is
no single moment that is "the update", so `onUpdate`, the `avenx:update` event
and injected-child notification fire **once per flush**, not once per binding.

Two scheduler changes came with this:

- Queue membership moved from a linear scan to a `Set`. One job per component
  made the scan invisible; one job per binding made a 500-binding component do
  125,000 comparisons before running anything.
- The per-job cycle guard is keyed by the job function rather than by `job.id`.
  Every binding job in a component shares that component's id for flush
  ordering, so an id-keyed counter read ten unrelated bindings doing their one
  job each as one job looping ten times.

---

## What this means for code you write

**Nothing is required of you.** Templates, actions, bridges, props and slots are
unchanged, and both renderers produce the same DOM.

Three things are worth knowing:

**Node identity is preserved.** A compiled update writes to nodes rather than
replacing them, so a focused input keeps focus, an open `<details>` stays open,
a running CSS transition is not restarted, and a third-party widget mounted into
your markup is not torn out from under you. The string renderer preserved most
of this most of the time; the compiled path preserves it by construction.

**Hand-edited DOM survives inside a compiled component.** The old renderer
diffed a freshly parsed tree against the live one and removed attributes the new
tree did not have. A compiled component only ever writes to its own bindings.
This is a behaviour difference, and it is the one place a compiled component and
an uncompiled one genuinely differ.

**`AVX_W47` is a performance hint, not an error.** A component on the string
path is correct. If it is large and updates often, the reason it did not compile
is worth looking at.

---

## What it costs

**Only one renderer ships, when only one is needed.** The string renderer is
now linked into a bundle only if some component in that build fell back — the
compiler already knows, because it produced the AVX_W47 list. A build where
every template compiles does not reference the patcher, the list manager, the
defer manager or the template renderer, and the bundler drops all four.

Measured on a scaffolded hello-world, production build:

| | Raw | Gzipped |
| --- | ---: | ---: |
| Before the refactor | 366,780 | 82,654 |
| After | 320,431 | 72,636 |

That is 12.6% smaller raw and 12.1% smaller gzipped, while `<@if>`, compiled
lists, compiled slots and compiled `<@defer>` were added. A compiled component
also stops carrying its own template in production, which it never rendered
from.

`<VirtualList>` moved the same way: it used to be registered by `AvenxApp`'s
constructor, which put it and everything it drives into every bundle whether or
not the application wrote the tag.

Measured against the same keyed list on both paths
(`benches/list-rendering.bench.js`, happy-dom — read the ratios, not the
milliseconds):

| Scenario | 20 rows | 100 rows | 500 rows |
| --- | ---: | ---: | ---: |
| One row renamed | 8.0x | 8.5x | 6.0x |
| Last row moved first | 4.1x | 4.6x | 3.4x |
| One row appended | 8.6x | 9.1x | 6.3x |

The compiled column is faster at every size but does not stay flat as rows
grow, and the reason is worth stating plainly: `trigger()` propagates a write up
the parent chain, so writing `rows[0].label` also triggers `rows`, which wakes
the loop's own effect and re-runs the whole reconcile. Fixing that means
changing how propagation works in the reactive core.

`benches/render-paths.bench.js` produces the single-binding comparison.

---

## Where the code lives

| Module | Role |
| --- | --- |
| `lib/compiler/parser/tokenizer.js` | Where each tag begins and ends in the source. |
| `lib/compiler/parser/htmlTree.js` | What tree those tags describe. |
| `lib/compiler/ir/nodes.js` | The IR vocabulary, and the refusal reasons. |
| `lib/compiler/ir/build.js` | Template → IR, or a named refusal. |
| `lib/compiler/ir/lower.js` | IR → program: skeleton, ops, blocks, interned expressions. |
| `lib/compiler/render/program.js` | The program format and the op vocabulary. |
| `lib/compiler/codegen/table.js` | Expressions and statements → positional closure tables. |
| `lib/core/renderer/program/CompiledTemplate.js` | Parses a skeleton once, clones it per instance. |
| `lib/core/renderer/program/bindings.js` | What each leaf op does to the DOM. |
| `lib/core/renderer/program/blocks.js` | What each control-flow op does: `<@if>`, `<@for>`, `<slot>`, `<@defer>`. |
| `lib/core/renderer/program/TemplateInstance.js` | One mounted program or block, and its effects. |
| `lib/core/renderer/stringRenderer.js` | The seam that lets the string renderer leave a bundle. |
| `lib/core/renderer/domPatch.js` | The string renderer, still used for templates that do not compile. |

Benchmarks: `benches/render-scenarios.bench.js` is the regression matrix,
`benches/render-phases.bench.js` decomposes one update into its stages.

---

## Atlas, Trace and Rewind

All three are unaffected.

Atlas reads component **source**, not compiled output, so it sees the same
template it always did. Trace's substitution point is the expression evaluator,
which every binding still goes through — a compiled update produces the same
`write → woke → patched` chain, and the DOM steps in it are now more precise,
because a binding names exactly the node it wrote. Rewind journals reactive
writes and is entirely upstream of rendering.

The test that checks every causal step in a recorded trace corresponds to an
edge Atlas predicted passes unchanged.
