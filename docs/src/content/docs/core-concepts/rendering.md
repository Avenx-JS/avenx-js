---
title: 'How Rendering Works'
description: 'The compiled render program: what the Avenx compiler emits, what the runtime executes, and why an update costs what it costs.'
---

Avenx compiles a component's template into a **render program**: a static HTML
skeleton plus a list of binding operations. The skeleton is parsed once per
component class. Each binding becomes its own reactive effect, so a state change
updates only the bindings that read it.

This page explains what changed, why, and what it means for code you write.

---

## The short version

Nothing in your components changes. `{{ }}`, `@click`, `data-ax-class`,
`<@for>`, props and slots all mean exactly what they meant before.

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

### What the compiler emits

At the end of the component pipeline — after every directive has been rewritten
and static subtrees marked — the compiler compiles the template into a program:

```js
{
  v: 1,
  html: '<p><!--axt:0--></p><p data-axb="0"><!--axt:1--></p>',
  ops: [
    { k: 'text', t: 0, x: 'count' },
    { k: 'attr', e: 0, a: 'title', x: 'doubled' },
    { k: 'text', t: 1, x: 'doubled' }
  ],
  elements: 1,
  texts: 2
}
```

The **skeleton** (`html`) is the template with every dynamic part removed.
Interpolations become comment markers; bound attributes are dropped. It is
valid HTML with no expressions in it.

The **ops** say what to do and where. `{ k: 'text', t: 0, x: 'count' }` reads
"evaluate `count`, write it to text marker 0".

The program travels in the constructor's existing options object, referenced
through a class static:

```js
class Counter extends AvenxComponent {
  constructor(bridges, props) {
    super({ count: 0 }, ..., { program: Counter.__axProgram });
  }
}
Counter.__axProgram = { v: 1, html: '...', ops: [...] };
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
- `data-ax-show`, `data-ax-class`, `data-ax-html`
- event handlers (see below)
- static subtrees
- child component mount points and their props

Falls back today:

| Construct | Why |
| --- | --- |
| `<@for>` | Keyed list reconciliation lives in `ListManager`, which the program does not drive. |
| `<slot>` | Slot filling moves nodes between trees at runtime. |
| `<@suspense>`, `<@errorBoundary>`, `<@deadlock>`, `<@defer>` | Each replaces a subtree with a fallback; the program has no equivalent. |
| Transitions | Enter/leave hooks are driven by the patcher. |
| A dynamic component tag | Its class can change between renders, which means unmounting one instance and mounting another. |
| A dynamic attribute name (`:[expr]`) | There is no attribute for the program to address until the name is evaluated. |
| `data-ax-ref`, `data-ax-validate`, `data-ax-style` | Not yet implemented on the program path. |

`avenx build` reports what did not compile, grouped by reason:

```text
[AVX_W47] 2 template(s) could not be compiled to a render program and will
render through the string renderer:
  a <@for> block: ProductList
  a <slot>: StatCard
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

Event handlers produce no ops. Avenx delegates events from the component root
and reads `data-ax-event` off the DOM when one fires, so the attribute survives
into the skeleton and there is nothing for a per-binding effect to do.

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

## Where the code lives

| Module | Role |
| --- | --- |
| `lib/compiler/render/program.js` | The program format and the op vocabulary. |
| `lib/compiler/render/compileTemplate.js` | Template → program, or a reason it refused. |
| `lib/compiler/parser/htmlTree.js` | The tree parser both halves of the compiler share. |
| `lib/core/renderer/program/CompiledTemplate.js` | Parses a skeleton once, clones it per instance. |
| `lib/core/renderer/program/bindings.js` | What each op does to the DOM. |
| `lib/core/renderer/program/TemplateInstance.js` | One mounted program and its effects. |
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
