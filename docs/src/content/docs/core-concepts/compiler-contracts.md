---
title: 'Compiler Contracts'
description: 'Compiler Contracts (static, pure, deterministic, isolated, unconditional) and compile-time optimizations in Avenx-JS.'
---

Avenx-JS introduces **Compiler Contracts** (`static`, `pure`, `deterministic`, `isolated`, `unconditional`). Compiler contracts are explicit semantic guarantees provided by the developer to the Avenx compiler. The compiler leverages these guarantees for static analysis, validation, and optimizations.

---

## 1. Overview of Contracts

| Contract | Description | Enforced By Compiler | Primary Optimization |
| :--- | :--- | :--- | :--- |
| **`static`** | Component or template subtree output is completely immutable at runtime. | Disallows dynamic expressions `{{ }}`, event handlers `@event`, two-way bindings `data-ax-bind`, and slots. | Hoists AST and marks subtree with `data-ax-static="true"` to bypass DOM diffing entirely. |
| **`pure`** | Component or expression produces zero observable side effects. | Detects assignment operators, state mutations, and external global access (`window`, `localStorage`, `fetch`). | Safe code reordering and dead-code elimination. |
| **`deterministic`** | Identical inputs $\rightarrow$ identical semantic output. | Detects calls to non-deterministic functions (`Math.random()`, `Date.now()`, `performance.now()`, `crypto`). | Enables safe memoization and render caching. |
| **`isolated`** | Unit depends *only* on explicit props and local state. Disconnects from global bridges. | Disallows access to `$bridges`, `this.$bridges`, and `$parent`. | Eliminates unneeded reactive bridge subscriptions; updates only on prop/state changes. |
| **`unconditional`** | Bypasses template dependency filtering and re-renders on every mutation. | Opts out of render skipping for unobserved keys. | Escape hatch for manual debugging and unconditional re-rendering. |

---

## 2. Syntax

Contracts can be declared at the **component level**, on **DOM elements**, or using **block directives**.

### Component-Level Contracts
Declare contracts at the top of your `.component.js` file using `<contract />`:

```html
<contract isolated pure deterministic />

<state count="0" />
<computed name="double" value="this.state.count * 2" />

<template>
  <div class="card">
    <h2>{{ props.title }}</h2>
    <p>Value: {{ double }}</p>
  </div>
</template>
```

### Element Attribute Contracts
Tag specific elements or subtrees in templates:

```html
<template>
  <div class="user-profile">
    <!-- Static Header -->
    <header static class="profile-header">
      <h1>User Dashboard</h1>
      <p>Manage your account settings</p>
    </header>

    <!-- Pure and Deterministic calculation subtree -->
    <div pure deterministic class="stats-box">
      <span>{{ props.score * 10 }}%</span>
    </div>
  </div>
</template>
```

### Directive Block Tags
Wrap template sections with compiler directive block tags:

```html
<template>
  <div class="content">
    <@static>
      <nav class="sidebar">
        <a href="#overview">Overview</a>
        <a href="#settings">Settings</a>
      </nav>
    </@static>

    <@isolated>
      <div class="isolated-card">
        <span>{{ props.badge }}</span>
      </div>
    </@isolated>
  </div>
</template>
```

---

## 3. Contract Relationships & Memoization

1. **`static` $\implies$ `pure` $\land$ `deterministic`**:
   A static subtree never changes and is inherently free of runtime side-effects and non-determinism.
2. **`pure` $+$ `deterministic` $\implies$ `memoizable`**:
   When an element is tagged with both `pure` and `deterministic`, the compiler emits `data-ax-memo="true"`. During DOM reconciliation, `DomPatcher` skips diffing child nodes when the rendered output matches.
3. **`isolated` $\implies$ `fine-grained reactive boundary`**:
   Isolated components do not inject global bridges into their scope and will not trigger re-renders on ambient store updates.

---

## 4. Diagnostics & Error Codes

The compiler validates contracts during build time:

- **`AVX_C04` (`COMPILER_CONTRACT_STATIC_VIOLATION`)**: Thrown when a node marked `static` contains dynamic interpolations, events, or bindings.
- **`AVX_C05` (`COMPILER_CONTRACT_ISOLATED_VIOLATION`)**: Thrown when an `isolated` component accesses `$bridges` or `$parent`.
- **`AVX_C06` (`COMPILER_CONTRACT_INVALID`)**: Thrown when a `<contract />` declaration uses an unknown contract name or malformed syntax.
- **`AVX_W32` (`COMPILER_CONTRACT_PURE_VIOLATION`)**: Warning emitted when a `pure` contract encounters side-effecting operations.
- **`AVX_W33` (`COMPILER_CONTRACT_DETERMINISTIC_VIOLATION`)**: Warning emitted when a `deterministic` contract calls non-deterministic APIs.
- **`AVX_W34` (`COMPILER_CONTRACT_REDUNDANT`)**: Warning emitted when a child contract is redundant because its parent already enforces a stricter contract.
