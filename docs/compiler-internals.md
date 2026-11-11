# Compiler Internals (Parser → IR → Optimizer → Codegen)

This document details the internal architecture, pass order, invariants, and data structures of the Avenx template compilation pipeline (`lib/compiler/`). It is intended for contributors maintaining or adding features to the compiler.

---

## 1. High-Level Pipeline Architecture

The compiler translates author-written component source (`.component.js` / `.component.css`) into an optimized render program and closure evaluation tables.

```
Component Template Source
          │
          ▼
[ Stage 1: Template Parser (lib/compiler/parser/) ]
  ├── Lexing & Tag Boundaries (tokenizer.js)
  ├── HTML Tree Construction (htmlTree.js -> HTMLNode Tree)
  └── Template front-end, orchestrated by ComponentParser.js (see §2.1)
          │
          ▼
[ Stage 2: Template IR Construction (lib/compiler/ir/build.js) ]
  ├── Declaration extraction & scoped CSS attributes applied
  └── Semantic typed tree created (nodes.js -> Element, Component, Slot, If, For)
          │
          ▼
[ Stage 3: IR Lowering & Optimization (lib/compiler/ir/lower.js) ]
  ├── Static HTML skeleton extraction (serializeHTML)
  ├── Control flow blocks extraction (programBlocks)
  └── Interned expressions index table generation
          │
          ▼
[ Stage 4: Code Generation (lib/compiler/codegen/) ]
  ├── Expression & action scanning (collect.js)
  └── Positional compiled closure tables (table.js, expression.js, actions.js)
```

---

## 2. Pipeline Stages & Pass Order

| Stage | Module | Input | Output | Primary Responsibilities |
| :--- | :--- | :--- | :--- | :--- |
| **1. Parser** | `parser/htmlTree.js`, `parser/tokenizer.js` | Raw template string | `HTMLNode` tree | Tokenizes tags and constructs a lightweight DOM-like AST. Intentionally non-spec-compliant; guarantees `serializeHTML(parseHTML(x))` round-trips. |
| **2. IR Builder** | `ir/build.js`, `ir/nodes.js` | `HTMLNode` tree (post-scoping) | Typed Template IR (`IRKind`) | Converts semantic constructs (`<@for>`, `<@if>`, `<slot>`, `<@defer>`) into typed IR nodes *before* any runtime directive rewriting occurs. |
| **3. Lowering** | `ir/lower.js` | Typed Template IR | Render `Program` + Interned Expressions | Emits a static HTML skeleton, runtime operations (`ops`), and indexed sub-blocks. Interns dynamic expression strings into positional indices. |
| **4. Codegen** | `codegen/table.js`, `codegen/expression.js` | Interned expression strings | Module source tables (`__axExprs`) | Compiles expressions to an AST with the compiler's own parser (`parser/js/`), checks security invariants, and emits closure tables for runtime evaluation. |

### 2.1 The template front-end (`ComponentParser.js` and `parser/`)

`lib/compiler/ComponentParser.js` is the orchestrator for one component or page. It reads the source and its stylesheet, extracts the declarations, runs the template through validation and desugaring, drives the stages above, and emits the generated class. It also owns the incremental-cache contract (`unitCacheKey`, `captureUnit`, `canReplayUnit`, `replayUnit`). It does not implement the template passes itself. Those live in `lib/compiler/parser/`:

| Module | Responsibility |
| :--- | :--- |
| `parser/tokenizer.js`, `parser/htmlTree.js` | Markup lexing and the `HTMLNode` tree. |
| `parser/declarations.js` | Reading `<state>`, `<computed>`, `<action>`, `<resource>` and `<contract>` declarations. |
| `parser/validate.js` | Template validation and front-end diagnostics: well-formedness (`AVX_C26`), leftover rewrites (`AVX_C25`), bound inline handlers (`AVX_C28`), interpolated dynamic attributes (`AVX_C29`), undeclared references, unknown event modifiers, duplicate ids, unterminated interpolations, unresolved component tags and accessibility. |
| `parser/identifiers.js` | Root-identifier extraction for template expressions, shared by validation and template-dependency extraction. |
| `parser/directives/` | The desugaring passes, one module per directive. Each exports a pure function: template in, template out, plus diagnostics. |
| `parser/staticSubtrees.js` | Static-subtree marking (`data-ax-static`) and lowering of the `<@static>` / `<@isolated>` / `<@pure>` / `<@deterministic>` block contracts. This is an optimisation pass, not a directive. |
| `parser/projectConfig.js` | Resolving `avenx.config.json` and its `voidTags` for a file, with one cache shared by every pass. |

Every extracted function keeps the signature of the `ComponentParser` method it came from. Anything that function used to read from the parser instance (its explicit `config`, its `customVoidTags`, the project's component names and route parameters) is passed in a trailing `options` object. `ComponentParser` keeps each method as a thin delegate, so its public surface is unchanged.

#### Desugaring order

The desugaring passes are order-dependent. The order is stated once, in `parser/directives/index.js`, and pinned by `test/unit/directivePipeline.test.js`:

1. `bindDirectives`: before template validation, so the validator sees each `data-ax-bind` once, as written.
2. The semantic template is recorded here. The IR (stage 2) is built from this point, before any structural rewrite.
3. The structural passes, run together as `STRUCTURAL_DIRECTIVE_PASSES`: `forLoops` → `suspense` → `errorBoundary` → `deadlock` → `defer` → `transitions` → `eventDelegation`.
4. `componentTags`, run by `compileUnit` after the structural passes. On every level of its recursion it first runs `slotProps` and then `scopedSlots`, so a scoped slot's interpolations are escaped before the template is handed on.

Static-subtree marking then runs over the result, and separately over the semantic template before the IR is built.

---

## 3. Key Data Structures

### A. Parser Node (`HTMLNode`)
Produced by `parser/htmlTree.js`:
```javascript
class HTMLNode {
  type;          // "element" | "text" | "comment"
  tagName;       // e.g. "div", "slot", "@for"
  attrs;         // { [key: string]: string }
  isSelfClosing; // boolean
  children;      // HTMLNode[]
  content;       // string (for text/comment nodes)
}
```

### B. Typed Template IR Node (`IRKind`)
Defined in `ir/nodes.js`:
```javascript
// Node kinds: ELEMENT, COMPONENT, SLOT, IF, FOR, DEFER, INTERPOLATION, TEXT, COMMENT
const slotNode = {
  kind: "slot",
  name: "header",
  fallback: fragmentNode // or null
};
```

### C. Lowered Render Program
Produced by `ir/lower.js`:
```javascript
const program = {
  v: PROGRAM_VERSION,
  html: "<div>...</div>", // Static serialized skeleton
  ops: [],                // Runtime patch operations
  elements: 0,            // Marker count for bound elements
  texts: 0,               // Marker count for dynamic text nodes
  blocks: []              // Child blocks for loops and branches
};
```

---

## 4. Pipeline Invariants & Assumptions

To prevent regressions (such as pass-ordering bugs and unattributable runtime failures):

1. **Parser Round-Trip Invariant**:
   `serializeHTML(parseHTML(template))` must round-trip authored markup identically. Directives are not rewritten into temporary `<template>` tags during the parse phase.

2. **No Partial IR Invariant (`IRRefusal`)**:
   `buildTemplateIR` operates on an all-or-nothing basis. If an unmodeled directive or invalid construct is encountered, it throws an `IRRefusal(reason, detail)` rather than emitting an incomplete IR. The orchestrator cleanly falls back to the legacy rendering path.

3. **Index-Based Expression Invariant**:
   Ops inside a lowered program address expressions strictly by index (`x: 0`), never by raw string (`x: "user.name"`). The raw strings are interned during lowering and matched 1:1 with entries in the generated expression closure table.

4. **All-or-Nothing Codegen**:
   If any interned expression fails compilation or triggers a security refusal (e.g., accessing `__proto__` or `window`), the entire program is withdrawn, and warning `AVX_W47` is emitted.

---

## 5. End-to-End Trace: `<slot>` Tag Flow

Tracing how `<slot name="header">Fallback</slot>` passes through each phase:

### Step 1: Lexer & Parser (`htmlTree.js`)
The markup parser parses the element into an `HTMLNode`:
```javascript
{
  type: "element",
  tagName: "slot",
  attrs: { name: "header" },
  isSelfClosing: false,
  children: [
    { type: "text", content: "Fallback", children: [] }
  ]
}
```

### Step 2: IR Construction (`ir/build.js`)
`build.js` intercepts `tag === "slot"` before directive lowering:
```javascript
{
  kind: "slot",
  name: "header",
  fallback: {
    kind: "fragment",
    children: [
      { kind: "text", value: "Fallback" }
    ]
  }
}
```

### Step 3: Lowering (`ir/lower.js`)
`lowerSlot()` produces a clean DOM skeleton element for runtime projection:
```javascript
{
  type: "element",
  tagName: "slot",
  attrs: { name: "header" },
  isSelfClosing: false,
  children: [
    { type: "text", content: "Fallback", children: [] }
  ],
  content: ""
}
```
* The static HTML skeleton preserves `<slot name="header">Fallback</slot>`.
* If dynamic bindings exist inside the fallback fragment, corresponding runtime ops are recorded in `builder.ops`.

### Step 4: Codegen (`codegen/table.js`)
Expressions enclosed within slot fallback fragments are interned, checked for scope safety, and compiled into the component unit closure table (`__axExprs`).

---

## 6. Checklist for Modifying Compiler Passes

When introducing new template syntax or altering AST transformations:
- [ ] Add the node type to `lib/compiler/ir/nodes.js`.
- [ ] Add IR builder coverage in `lib/compiler/ir/build.js` before runtime rewriting.
- [ ] Add lowering logic to `lib/compiler/ir/lower.js` with appropriate runtime ops in `lib/compiler/render/program.js`.
- [ ] Ensure any newly introduced expressions are registered in `lib/compiler/codegen/collect.js`.
- [ ] If the construct also needs a markup rewrite for the string renderer, add it as a module under `lib/compiler/parser/directives/` exporting a pure function, then register it in `parser/directives/index.js` at the position its semantics require. Do not reorder existing passes in the same change.
- [ ] Put any new template diagnostic in `lib/compiler/parser/validate.js`, not in `ComponentParser.js`.
- [ ] Add unit tests in `test/compiler/` verifying round-tripping and error reporting.
