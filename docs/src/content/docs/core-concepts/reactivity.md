---
title: 'Reactive State'
description: 'Deep dive into the Proxy-based reactive state and transparent dependency tracking in Avenx-JS.'
---

---

Avenx-JS implements a **transparent reactivity system** powered by JavaScript ES6 `Proxy`. There are no state setter functions or hooks required to update the user interface.

## How It Works

When a component is instantiated, the framework wraps its initial state object in a reactive Proxy. When an action or callback modifies any field on `state`, the Proxy trap intercepts the change and queues a re-render job.

```javascript
// In an action:
state.counter++; // Automatically schedules a visual update!
```

## Batching Updates & Scheduler

To maximize browser performance, state updates are batched together. If you change multiple state properties sequentially, Avenx does not re-render the DOM for each modification. Instead, the framework queues a single microtask job to flush updates together in the next tick.

```javascript
<action name="updateUser">
  state.name = "John"; // Queued state.age = 30; // Queued (deduplicated) state.role = "admin"; // Queued (deduplicated)
  // The DOM will render only ONCE at the end of the microtask queue.
</action>
```

## Lifecycle & Rendering Flow

When reactive state changes, Avenx-JS processes the update through a scheduled rendering cycle. Updates are batched using the scheduler queue so that multiple state mutations can be processed efficiently within a single microtask.

The update lifecycle follows this sequence:

1. **State Mutation** - A value in the reactive `state` object is changed.
2. **Proxy Interception** - The reactive Proxy intercepts the mutation and requests an update.
3. **Scheduler Job Queue** - The component's update job is added to the scheduler queue. Multiple updates to the same component can be deduplicated and batched together.
4. **Microtask Flush** - The scheduler processes the queued update jobs during the next microtask.
5. **DOM Patch** - The component template is rendered and the DOM is patched with the updated values.
6. **Slot Re-fill** - Component slots are re-filled with their updated content.
7. **`onUpdate` Execution** - The component's `onUpdate` lifecycle callback runs after the update has completed.

In summary:

```text
State Mutation
    ↓
Proxy Interception
    ↓
Scheduler Job Queue
    ↓
Microtask Flush
    ↓
DOM Patch
    ↓
Slot Re-fill
    ↓
onUpdate Execution
```

Because updates are queued and processed asynchronously, multiple synchronous state mutations can be grouped into a single rendering cycle instead of causing repeated DOM updates.

### Troubleshooting `AVX_R11`

#### Troubleshooting `AVX_W09`

The `AVX_W09` (`ROUTE_PARAM_DECODE_FAILED`) warning occurs when Avenx-JS cannot decode a route parameter because it contains malformed percent-encoding.

This warning is typically raised during route changes when parameters are extracted from the URL and decoded using JavaScript's `decodeURIComponent()`. If decoding fails because the URI is malformed, Avenx-JS logs the warning instead of crashing the application.

For example, the following route parameter contains invalid percent-encoding:

```text
#/profile/John%2
```

The `%2` sequence is incomplete and cannot be decoded.

A correctly encoded route would be:

```text
#/profile/John%20Doe
```

where `%20` represents a space.

To prevent this warning:

- Always encode route parameters using `encodeURIComponent()` before constructing URLs.
- Ensure every `%` is followed by exactly two hexadecimal digits (`0-9`, `A-F`, or `a-f`).
- Avoid manually writing encoded URL values whenever possible.

Example:

```javascript
const userName = "John Doe";
const url = `/profile/${encodeURIComponent(userName)}`;
```

Common examples of percent encoding:

**Valid**

```text
%20
%2F
%3A
```

**Invalid**

```text
%
%2
%ZZ
```

#### Troubleshooting `AVX_W11`

The `AVX_W11` (`ROUTE_TITLE_EVALUATION_FAILED`) warning occurs when a dynamic route `title` function throws an error while evaluating the route parameters.

For example, this route can trigger the warning if `params.id` is accessed through code that throws an error:

````javascript
app.initRouter({
  '/profile/:id': {
    page: 'Profile',
    title: (params) => getProfileTitle(params.id),
  },
});
The `AVX_R11` (`STATE_MUTATION_IN_UPDATE`) error occurs when state is mutated synchronously while Avenx-JS is already processing an update.

This can happen when state is modified from code that runs as part of rendering, such as a computed property or template expression. Updating state during this phase can schedule another update before the current update has finished, potentially creating an infinite rendering loop.

For example, avoid mutating state while computing a value:

```javascript
get displayName() {
  state.name = state.name.trim(); // Avoid: mutates state during an update
  return state.name;
}
````

Instead, computed getters should derive and return values without modifying state:

```javascript
get displayName() {
  return state.name.trim();
}
```

If a state mutation must happen after the current update cycle has completed, defer it using `setTimeout`:

```javascript
setTimeout(() => {
  state.name = state.name.trim();
}, 0);
```

Deferring the mutation allows the current rendering cycle to finish before another state update is scheduled.

When troubleshooting `AVX_R11`, check for state mutations inside computed getters, template expressions, or other code that executes during rendering. Prefer deriving values without side effects, and defer necessary state changes until after the current update cycle.

## Nested Reactivity

Avenx-JS automatically intercepts nested object mutations. If a state property contains an array or object, mutations within that tree are tracked:

```javascript
state.todos.push({ text: 'Learn Avenx', done: false }); // Reactive!
state.user.profile.age = 35; // Reactive!
```

## Reactivity Injection (Provide / Inject)

For deeply nested component trees, passing data down through props at every level ("prop drilling") gets unwieldy. Avenx-JS offers a lighter-weight alternative to global `bridges` for this specific case: an ancestor component can `provide` values, and any descendant, no matter how deeply nested, can `inject` them directly — without the value passing through, or being known by, the components in between.

Unlike bridges, provide/inject is scoped to a single component subtree rather than the whole application, and it doesn't route through the global bridge/render system, avoiding that overhead for state that's only relevant to one part of the tree.

### Providing values

Declare a `provide` property (or static method) on the ancestor component. It can be:

- **An object**, mapping keys to values or methods
- **A function** (instance or static) returning either form above, evaluated once per instance
- **An array of keys**, exposing matching properties already present on the component's own `state`, `props`, methods, or bridges

```javascript
// src/pages/dashboard.page.js
<state theme="dark" />;

// Object form: explicit keys and values
provide = {
  theme: this.state.theme,
  setTheme: (value) => {
    this.state.theme = value;
  },
};
```

```javascript
// Array form: re-exposes existing state/props/methods by name
provide = ['theme', 'setTheme'];
```

### Injecting values

Descendant components declare `inject` the same way — object, function, or array of keys — and the resolved keys become directly accessible as properties on `this` (and inside template expressions):

```javascript
// src/components/theme-toggle/theme-toggle.component.js
inject = ['theme', 'setTheme'];

<button @click="setTheme(theme === 'dark' ? 'light' : 'dark')">
  Current theme: {{ theme }}
</button>
```

To expose a provided value under a different local name, use the object form of `inject`, mapping the local key to the key it was provided under:

```javascript
inject = {
  currentTheme: 'theme', // accessible as `this.currentTheme` / `{{ currentTheme }}`
};
```

### How resolution works

An injected key is resolved **lazily, on every access** — it is not copied or cached at mount time. When a descendant reads an injected property, Avenx walks up the DOM tree from the component's root element to find the nearest ancestor component whose `provide` declares that key, then reads the current value from it.

This has two practical implications:

- **Object-form `provide` is reactive.** The object passed to `provide` is wrapped in its own reactive proxy internally. Injecting descendants read through that proxy on every access, so they automatically see updates when the provider changes a provided value — no extra wiring required.
- **Array-form `provide` stays reactive too**, since it reads the provided key directly off the provider's live `state`/`props`/methods each time, rather than a snapshot.

:::note
Only the **nearest** ancestor providing a given key is used. If multiple ancestors in the chain provide the same key, closer ancestors take precedence.
:::

:::caution
If no ancestor in the tree provides an injected key, the property resolves to `undefined` and a warning is logged to the console — it does not throw. Double-check ancestor/descendant `provide`/`inject` key names match if an injected value is unexpectedly `undefined`.
:::
