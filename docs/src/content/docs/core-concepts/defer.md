---
title: Deferred Loading (<@defer>)
description: Declarative deferred loading of components and DOM subtrees until a defined trigger fires.
---

The `<@defer>` compiler tag enables **declarative deferred loading** of components and DOM subtrees in Avenx.js. Content is not rendered immediately; instead, it is loaded only when the configured trigger is fired.

This can help reduce the initial rendering and JavaScript workload by processing non-critical content only when needed.

---

## Basic Syntax

To defer a section of your template, simply wrap it with the `<@defer>` tag:

```html
<@defer>
  <HeavyChart data="{{ state.chartData }}" />
</@defer>
```

When no `when` attribute is specified, `<@defer>` defaults to the `idle` trigger. It uses `requestIdleCallback` when available in the browser, falling back to a short timer otherwise.

---

## Trigger Modes (`when="..."`)

The `when` attribute defines when the deferred content should be loaded:

| Trigger              | Syntax                              | Description                                                                                 |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **`idle`** (Default) | `<@defer when="idle">`              | Loads content during browser idle time.                                                     |
| **`visible`**        | `<@defer when="visible">`           | Loads content as soon as the defer container becomes visible in the viewport.               |
| **`hover`**          | `<@defer when="hover">`             | Loads content when the pointer enters (`mouseenter`) the placeholder.                       |
| **`click`**          | `<@defer when="click">`             | Loads content when the placeholder is clicked.                                              |
| **`interaction`**    | `<@defer when="interaction">`       | Loads content on either `hover` (`mouseenter`) or `click` interaction with the placeholder. |
| **`timer(ms)`**      | `<@defer when="timer(1000)">`       | Loads content after the specified delay in milliseconds.                                    |
| **`<n>ms`**          | `<@defer when="1000ms">`            | Shorthand for `timer(n)`; loads content after the specified delay in milliseconds.          |
| **Expression**       | `<@defer when="state.showDetails">` | Evaluates the specified expression and loads content when the result is truthy.             |

> **Unrecognised triggers:** For forward compatibility, an unrecognised `when` value that is neither a known trigger nor a valid expression falls back to `idle` at runtime. The compiler raises warning `AVX_W79` at build time so typos (such as `when="visble"`) are caught early.

---

### `idle`

The `idle` trigger loads deferred content as soon as the browser has idle time available.

```html
<@defer when="idle">
  <HeavyChart />
</@defer>
```

Avenx.js uses `requestIdleCallback` when this browser API is available, falling back to a short timer otherwise.

### `visible`

The `visible` trigger loads content as soon as the defer container becomes visible in the viewport.

```html
<@defer when="visible">
  <HeavyChart />
</@defer>
```

Avenx.js uses an `IntersectionObserver` for this. Once the container becomes visible, the observer is disconnected and the deferred content is loaded.

### `interaction`

The `interaction` trigger loads content as soon as the user interacts with the defer container.

Currently, both `click` and `mouseenter` trigger loading of the content. The trigger values `click` and `hover` are also supported as interaction triggers.

```html
<@defer when="click">
  <HeavyChart />
</@defer>

<@defer when="hover">
  <HeavyChart />
</@defer>
```

### `timer`

The `timer` trigger loads deferred content after the specified delay in milliseconds elapses.

```html
<@defer when="timer(2000)">
  <BannerAd />
</@defer>
```

In this example, the content is loaded after 2000 milliseconds (2 seconds). Avenx.js also supports time values in the `1000ms` format.

### Expression

An expression can be used as a trigger in the `when="<expression>"` form to load deferred content based on the current state.

```html
<@defer when="state.isReady">
  <HeavyComponent />
</@defer>
```

The expression is evaluated when the defer container is processed. If the result is truthy, the deferred content is loaded. If the container is processed again later, the expression is re-evaluated.

## Placeholders & Loading States (`<@placeholder>` & `<@loading>`)

Optional sub-tags can be used within `<@defer>`.

### `<@placeholder>`

`<@placeholder>` defines the content displayed while waiting for the configured trigger.

```html
<@defer when="visible">
  <@placeholder>
    <div class="skeleton-loader">
      The chart will load when it becomes visible...
    </div>
  </@placeholder>

  <HeavyChart data="{{ state.chartData }}" />
</@defer>
```

### `<@loading>`

On the compiled rendering path, `<@loading>` is an alternative spelling of `<@placeholder>`. Its content is displayed while waiting for the trigger and replaced by the deferred content when the trigger fires.

```html
<@defer when="visible">
  <@loading>
    <div class="spinner">Loading profile...</div>
  </@loading>

  <UserProfileDetails user="{{ state.user }}" />
</@defer>
```

These branches describe the waiting state before the trigger, not a separate asynchronous loading phase after it. Use one branch per `<@defer>` block. If both `<@placeholder>` and `<@loading>` are provided, `<@placeholder>` takes precedence on the compiled rendering path.

> **String-renderer fallback:** `<@placeholder>` is displayed while waiting for the trigger. The fallback string renderer recognizes `<@loading>` and parses it into a separate template, but `DeferManager` does not display it while waiting. Use `<@placeholder>` if your template may use the string-renderer fallback.

---

## Multiple Triggers

Separate subscription triggers with semicolons. The block reveals on the first
trigger to fire and immediately cancels every remaining subscription. This
works on both the compiled and string rendering paths:

```html
<@defer when="visible; interaction">
  <HeavyComponent />
</@defer>
```

Combine `idle`, `visible`, `hover`, `click`, `interaction`, `timer(n)` and
`n ms`, with non-negative integer millisecond delays. For example,
`when="visible; interaction; timer(4000)"` reveals on visibility, interaction,
or after four seconds, whichever happens first.

A reactive condition such as `when="rows.length"` remains a single-trigger
form. Mixing it into a list, leaving an empty entry, or repeating a trigger is
a compile-time `AVX_C34` error. Names are case-insensitive, and `timer(100)` and
`100 ms` count as the same trigger. Existing single-trigger expressions and
duration spellings continue to work.

## Cleanup and Lifecycle

Avenx.js registers corresponding cleanup functions for active triggers.

Depending on the trigger used, these include:

- Removing event listeners for `click` and `mouseenter`.
- Canceling timers with `clearTimeout()`.
- Canceling idle callbacks with `cancelIdleCallback()`, when available.
- Disconnecting `IntersectionObserver` instances with `disconnect()`.

When any trigger fires, every subscription for that block is released. Unmounting
before a trigger fires also releases them all; callbacks already queued by the
host cannot render into a disposed block.

> [!NOTE]
> Unmounting a component releases its pending `<@defer>` triggers on both rendering paths: compiled blocks dispose their trigger subscriptions, and the string-renderer fallback calls `DeferManager.destroy()`. Observers, timers, idle callbacks and listeners are cancelled, and a trigger that has not fired never renders into the detached component.

---

## How it works

Processing of `<@defer>` takes place in two primary steps:

1. **Compilation step:** The compiler recognizes `<@defer>` and lowers it into a **render program** (or converts it into a special defer container when falling back to the **string renderer** via `ComponentParser`). Depending on the content used, templates for `<@placeholder>`, `<@loading>`, and the deferred content itself can be stored within it.

2. **Runtime step:** Compiled templates use `DeferBinding`; the string-renderer fallback uses `DeferManager` to process defer containers. Both set up the configured trigger using `requestIdleCallback`, `IntersectionObserver`, event listeners, or `setTimeout`, depending on the trigger.

Once the trigger fires, the active rendering path renders the deferred content and removes previously rendered placeholder content.
