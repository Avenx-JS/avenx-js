---
title: 'Computed Properties'
description: 'Learn how to declare computed properties and how Avenx-JS tracks, caches, and updates them.'
---

Computed properties are reactive, memoized derivations of component state and other reactive values. They are useful when a value can be calculated from existing data and should automatically update when its dependencies change.

Unlike ordinary methods, computed properties cache their result and only re-evaluate when a dependency that was used during the previous evaluation changes.

## Definition

Declare a computed property with the `<computed />` tag. Its `name` identifies the property, and its `value` contains the expression:

```html
<state price="100" tax="0.1" />
<computed name="taxAmount" value="price * tax" />
<computed name="totalPrice" value="price + taxAmount" />
```

Here, `taxAmount` derives a value from `price` and `tax`, while `totalPrice` can use another computed property.

## Dependency Tracking & Caching

A computed property's dependencies are collected from the values its expression reads during evaluation. Avenx caches the result while those dependencies stay unchanged, so later reads reuse the cached value.

When a dependency changes, the computed value is invalidated and reevaluated when it is next read. Other computed properties and views that depend on it can then update as well.

## Circular Dependency Protection

A computed property must not read itself, either directly or through a cycle of other computed properties. When evaluation re-enters a computed that is already being evaluated, Avenx logs warning `AVX_R04` and returns `undefined` for that recursive read. An expression that performs arithmetic with that value can therefore produce `NaN`. Break the cycle by deriving each computed value from state or from computed values that do not depend on it.

## Mental Model

A computed property should be treated as a **pure derivation**:

```text
Reactive State
     │
     ▼
Dependency Tracking
     │
     ▼
Computed Expression
     │
     ▼
Cached Result
     │
     └──── dependency changes ────► Re-evaluate
```
