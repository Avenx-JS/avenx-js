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

The `AVX_R11` (`STATE_MUTATION_IN_UPDATE`) error occurs when state is mutated synchronously while Avenx-JS is already processing an update.

This can happen when state is modified from code that runs as part of rendering, such as a computed property or template expression. Updating state during this phase can schedule another update before the current update has finished, potentially creating an infinite rendering loop.

For example, avoid mutating state while computing a value:

```javascript
get displayName() {
  state.name = state.name.trim(); // Avoid: mutates state during an update
  return state.name;
}
```

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
