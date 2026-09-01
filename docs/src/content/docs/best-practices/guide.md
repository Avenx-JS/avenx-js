---
title: 'Best Practices'
description: 'Best practices for maximizing performance, reliability, and security in Avenx-JS applications.'
---

Maximize performance, reliability, and security in your Avenx-JS applications by following these production-oriented guidelines.

> [!TIP]
> Prefer simple, predictable component designs. Keep state close to where it is used, clean up resources when components unmount, and use Avenx-JS features such as batching, deferred rendering, and virtualization where they provide a measurable benefit.

## Component Architecture and Design Patterns

### Keep Components Focused

Follow the Single Responsibility Principle when designing components. A component should have a clear purpose and avoid becoming responsible for unrelated UI, state, networking, and application-wide behavior.

Prefer smaller components with clear responsibilities over large components that contain unrelated logic.

### Use Companion Files

For components that contain substantial logic or styling, keep responsibilities separated using the conventional companion-file structure:

```text
user-profile.component.js
user-profile.component.css
```

The component file contains the component logic and template, while the companion CSS file contains scoped component styles.

### Follow a Consistent SFC Tag Order

When using multiple SFC sections, keep them in the canonical order:

```html
<state>
<computed>
<action>
<resource>
<template>
<style>
```

This makes components easier to read and keeps related concerns predictable.

### Choose the Appropriate State Scope

Use the narrowest state scope that satisfies the requirement:

- **Local component state** — use `<state>` for private state owned by a component.
- **Subtree state** — use `this.provide` and `static inject` when state or services are shared within a component branch.
- **Global state** — use a [Bridge](/core-concepts/bridges) when state must be shared across unrelated parts of the application.

> [!IMPORTANT]
> Avoid putting state in a global Bridge when only one component or subtree needs it. Keeping state local reduces coupling and makes components easier to reason about and test.

## Reactivity and State Integrity

### Do Not Reassign the State Object

Do not replace the component's reactive state object:

```javascript
// Don't
this.state = {
  count: 10
};
```

Instead, update the existing reactive object:

```javascript
// Do
this.state.count = 10;

// Or
Object.assign(this.state, {
  count: 10
});
```

Direct state-object reassignment can violate the component's reactivity contract.

> [!WARNING]
> Treat `this.state` as the reactive container owned by the component. Update its properties instead of replacing the object.

### Keep Computed Values Pure

Computed getters should derive values from state without modifying that state.

```javascript
// Don't
<computed>
  doubled() {
    this.state.count++;
    return this.state.count * 2;
  }
</computed>
```

A computed value should instead be deterministic:

```javascript
// Do
<computed>
  doubled() {
    return this.state.count * 2;
  }
</computed>
```

Avoid mutating state during rendering, updates, or other execution paths that are expected to be read-only.

### Take Advantage of Update Batching

Multiple state mutations made during the same execution cycle can be batched by the scheduler.

```javascript
this.state.firstName = 'Aditya';
this.state.lastName = 'Inamke';
this.state.ready = true;
```

Prefer grouping related state updates instead of forcing unnecessary intermediate DOM updates.

### Use `nextTick()` for Updated DOM

Reactive state changes may be applied asynchronously. When code needs to read DOM measurements or query elements after a state update, wait for the update cycle to complete.

```javascript
this.state.open = true;

await this.nextTick();

const panel = document.querySelector('.panel');
const height = panel.offsetHeight;
```

The standalone `nextTick()` API can also be used when an instance method is not required.

## Performance Optimization

### Use Stable Keys in `<@for>`

Always provide stable, unique keys when rendering collections.

```html
<@for item in state.items key="item.id">
  <p>{{ item.name }}</p>
</@for>
```

Stable keys allow `ListManager` to identify existing DOM nodes and reuse or move them instead of unnecessarily rebuilding them.

> [!WARNING]
> Avoid using an unstable value such as a random number as a key. A key should consistently identify the same logical item.

### Use Compiler Contracts

When an expression or function satisfies the relevant compiler contract, mark it appropriately as `pure`, `deterministic`, or `static`.

Compiler contracts can help Avenx-JS identify work that can safely be optimized at compile time, including AST hoisting and memoization.

> [!IMPORTANT]
> Only use a compiler contract when its assumptions are actually true. Incorrectly declaring code as pure, deterministic, or static can produce incorrect behavior.

### Defer Non-Critical Work

Use `<@defer>` for expensive or non-critical UI that does not need to be rendered immediately.

Choose a trigger appropriate to the user experience:

- `idle` — defer work until the browser is idle.
- `visible` — render when the content becomes visible.
- `interaction` — render after user interaction.
- `timer` — render after a specified delay.

This is especially useful for off-screen sections and expensive subtrees.

### Virtualize Long Lists

For large datasets, prefer the built-in `<VirtualList>` component rather than rendering every item into the DOM at once.

Virtualization reduces DOM size and helps prevent unnecessary layout and rendering work.

As a practical guideline, consider virtualization for lists containing more than 100 items, particularly when each item contains complex markup.

## Memory Management and Lifecycle Teardown

### Clean Up Timers

Timers created by a component should be cleared when the component is unmounted.

```javascript
onMount() {
  this.timer = setInterval(() => {
    this.state.tick++;
  }, 1000);
}

onUnmount() {
  clearInterval(this.timer);
}
```

Also clear any `setTimeout()` handles created by the component.

### Remove Global Event Listeners

Global listeners can keep component-related callbacks alive after a component has been removed.

```javascript
onMount() {
  this.handleResize = () => {
    // handle resize
  };

  window.addEventListener('resize', this.handleResize);
}

onUnmount() {
  window.removeEventListener('resize', this.handleResize);
}
```

Always remove listeners using the same function reference that was registered.

### Clean Up WebSocket and Subscription Resources

Long-lived subscriptions should be closed or unsubscribed during `onUnmount()`.

```javascript
onMount() {
  this.socket = new WebSocket(url);
}

onUnmount() {
  this.socket?.close();
}
```

The same principle applies to other manually created subscriptions or external resources.

### Tear Down Manual Watchers

If a watcher is created manually and exposes a teardown method, make sure it is cleaned up when the component is destroyed.

```javascript
onMount() {
  this.watcher = this.watch(
    () => this.state.value,
    (value) => {
      // react to changes
    }
  );
}

onUnmount() {
  this.watcher?.teardown();
}
```

Do not leave manually instantiated watchers running after their owning component has disappeared.

### Unregister Dynamic Router Hooks

Router hooks registered dynamically should also be removed when they are no longer needed.

This is particularly important for components or modules that register `beforeEach` or `afterEach` handlers dynamically.

### Tune Keep-Alive Caching

Keep-alive caching can improve navigation performance by preserving previously visited pages, but excessive caching increases memory usage.

Use `keepAliveLimit` in `AvenxApp` to balance navigation resumption speed with memory consumption.

> [!TIP]
> Cache only as many pages as provide a meaningful navigation benefit. Large caches are not automatically faster if they create unnecessary memory pressure.

## Security and Defensive Coding

### Use Escaped Interpolation by Default

Use double curly braces for normal text interpolation:

```html
<p>{{ state.message }}</p>
```

Double curly braces provide automatic HTML entity escaping and should be the default choice for user-controlled or untrusted text.

### Restrict Triple Curly Braces

Triple curly braces render raw HTML and should only be used when the content is known to be safe.

```html
<!-- Only for verified/sanitized HTML -->
<div>{{{ state.trustedHtml }}}</div>
```

For user-provided HTML, sanitize it before rendering.

```javascript
const safeHtml = Sanitizer.prototype.sanitize(userHtml);
```

Where appropriate, `Sanitizer.stripTags()` can be used when the desired behavior is to remove HTML tags entirely.

> [!WARNING]
> Never assume that content is safe merely because it comes from your own application. Treat external and user-controlled HTML as untrusted until it has been validated or sanitized.

### Respect the Template Security Sandbox

Avenx-JS templates have security restrictions designed to prevent unsafe access from template expressions.

Avoid placing browser ecosystem calls directly inside templates.

```html
<!-- Don't -->
<button @click="localStorage.clear()">Clear</button>
```

Move such behavior into component actions:

```javascript
<action>
  clearStorage() {
    localStorage.clear();
  }
</action>

<button @click="clearStorage()">Clear</button>
```

This keeps templates focused on presentation while allowing browser APIs to remain inside controlled component logic.

### Validate Dynamic URLs

Be careful when binding dynamic values to URL-bearing attributes such as `href` and `src`.

```html
<a href="{{ state.url }}">Open</a>
```

Validate that the resulting URL uses an expected protocol before displaying or navigating to it.

> [!WARNING]
> Never allow unvalidated user input to become a navigation URL. In particular, reject dangerous protocols such as `javascript:`.

## Error Handling and Resilience

### Isolate Volatile UI with Error Boundaries

Use `<@errorBoundary>` around component trees where an isolated rendering or component failure should not bring down unrelated parts of the application.

Provide an appropriate `<@fallback>` view so users receive a useful recovery experience.

```html
<@errorBoundary>
  <ExpensiveWidget />
  <@fallback>
    <p>Unable to load this section.</p>
  </@fallback>
</@errorBoundary>
```

### Handle Asynchronous Resources

Use `<resource>` for asynchronous data or resource loading and provide appropriate loading and error states.

When several asynchronous parts of a UI need coordinated handling, `<@suspense>` can help isolate the loading experience.

> [!TIP]
> Treat loading, success, and error states as part of the normal UI design rather than as exceptional cases.

### Use Global Error and Warning Hooks

Applications can use `AvenxApp.onError()` and `onWarn()` to integrate application-level error reporting and diagnostics.

Use these hooks to connect Avenx-JS errors and warnings with your application's logging or telemetry system.

## Do's and Don'ts

### Do

- Keep components focused on a clear responsibility.
- Keep state at the narrowest appropriate scope.
- Mutate properties of `this.state` instead of replacing the state object.
- Keep computed values pure and deterministic.
- Use stable keys in `<@for>` loops.
- Use `nextTick()` when DOM access depends on a completed reactive update.
- Defer non-critical UI with `<@defer>`.
- Virtualize large datasets with `<VirtualList>`.
- Clean up timers, listeners, watchers, subscriptions, and router hooks.
- Escape untrusted text with `{{ ... }}`.
- Sanitize HTML before using raw HTML interpolation.
- Isolate failures with error boundaries and fallback views.

### Don't

- Don't replace `this.state` with a new object.
- Don't mutate state from computed getters or rendering/update paths.
- Don't use random or unstable loop keys.
- Don't render thousands of complex DOM nodes when virtualization is appropriate.
- Don't leave global event listeners or timers running after unmount.
- Don't keep manually created watchers alive after their owner is destroyed.
- Don't render untrusted HTML using `{{{ ... }}}`.
- Don't put browser APIs directly into template expressions.
- Don't trust dynamic URLs without validating their protocols.
- Don't treat error and loading states as afterthoughts.

## Reference Guides

For deeper information, refer to the relevant Avenx-JS documentation:

- [Components](/core-concepts/components)
- [Templates](/core-concepts/templates)
- [Reactivity](/core-concepts/reactivity)
- [Lifecycle](/core-concepts/lifecycle-hooks)
- [Routing and Guards](/api-reference/router-guard)
- [Error Handling](/troubleshooting/errors)
- [Testing API](/api-reference/testing)

> [!IMPORTANT]
> Best practices should complement, not replace, the Avenx-JS API documentation. When behavior depends on a specific API or compiler contract, verify the current reference documentation before relying on it.
