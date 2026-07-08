---
title: 'Computed Properties'
description: 'Learn how to use computed properties with automatic caching and dependency updates in Avenx-JS.'
---

Computed properties allow you to define state derivations that are cached and automatically updated whenever their source dependencies change.

## Definition

Define a computed property using the `<computed />` tag. It accepts a name and an expression:

```html
<state price="100" tax="0.1" />
<computed name="taxAmount" value="price * tax" />
<computed name="totalPrice" value="price + taxAmount" />
```

## Dependency Tracking & Caching

The reactivity system automatically traces which properties are read during the evaluation of a computed getter. It builds a dependency graph dynamically.

- If the variables referenced (e.g. `price` or `tax`) do not change, accessing the computed property returns the cached value instantly without re-evaluation.

- When a dependency changes, the computed property is marked as dirty, triggering updates in any views or downstream computed properties depending on it.

## Circular Dependency Protection

If you accidentally introduce a recursive loop (e.g., computed property `a` depends on `b`, which depends on `a`), Avenx detects it immediately during evaluation, cancels the infinite loop, throws warning code `[AVX_R04]`, and returns `undefined` to keep the application stable.
