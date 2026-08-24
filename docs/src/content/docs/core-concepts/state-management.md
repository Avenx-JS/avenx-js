---
title: 'State Management'
description: 'Learn how to define, mutate, and manage reactive state in Avenx-JS components using <state> tags and StateFactory.'
---

State is the underlying data that drives your user interface. In Avenx-JS, state management is **reactive**: when you mutate a component's state, Avenx-JS automatically detects the change and patches only the affected DOM elements in real-time.

---

## 1. Declaring Component State (`<state>`)

In Single-File Components (`.component.js` or `.page.js`), component state is declared using the `<state>` tag at the top of the file:

```html
<!-- Single primitive properties -->
<state count="0" title="'My Counter App'" isLoading="false" />
```

### Supported Data Types

Attributes on the `<state>` tag are evaluated as JSON/JavaScript expressions:

```html
<state 
  count="0"
  userName="'Alice'"
  isActive="true"
  tags='["frontend", "web", "avenx"]'
  user='{ "id": 42, "name": "Alice", "role": "admin" }'
/>
```

- **Strings:** Wrap in outer single quotes or escaped double quotes (e.g. `title="'Hello'"`).
- **Numbers & Booleans:** Written directly as attribute values (`count="0"`, `isActive="true"`).
- **Objects & Arrays:** Formatted as valid JSON strings (`user='{ "id": 1 }'`).

---

## 2. Under the Hood: `StateFactory` & ES6 Proxies

During component compilation and mounting, Avenx-JS passes your initial state object to `StateFactory.create()`. 

```javascript
import { StateFactory } from 'avenx-core/runtime';

const factory = new StateFactory();
const reactiveState = factory.create({ count: 0, user: { name: 'Alice' } });
```

### How Reactivity Works for Beginners

1. **Proxy Wrappers:** `StateFactory` wraps your component's state in a JavaScript [`Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy).
2. **Getter Interception (Dependency Tracking):** When a component template or computed property reads a state value (e.g., `{{ count }}`), the Proxy getter records that the template depends on `count`.
3. **Setter Interception (Change Detection):** When an action modifies `state.count = 1`, the Proxy setter catches the mutation, notifies subscribers, and schedules a microtask to patch the DOM.

---

## 3. Mutating State & Automatic Batching

To update state, mutate properties on `this.state` inside component `<action>` methods or lifecycle hooks:

```html
<!-- src/components/Counter.component.js -->
<state count="0" />

<action name="increment">
  this.state.count++;
</action>

<action name="reset">
  this.state.count = 0;
</action>

<div class="counter">
  <p>Value: {{ count }}</p>
  <button @click="increment()">Add</button>
  <button @click="reset()">Reset</button>
</div>
```

### Automatic Update Batching

If an action performs multiple state mutations synchronously, Avenx-JS **batches** them into a single asynchronous microtask update cycle:

```javascript
<action name="updateUserProfile">
  // All 3 mutations are batched together
  this.state.name = 'Bob';
  this.state.age = 30;
  this.state.role = 'editor';
  // Result: The DOM is patched ONCE after the action completes
</action>
```

This automatic batching prevents unnecessary layout thrashing and ensures high UI rendering performance.

---

## 4. Choosing the Right State Pattern

Avenx-JS offers three tiers of state management depending on data scope:

| Pattern | Scope | Best For |
| :--- | :--- | :--- |
| **Local Component State (`<state>`)** | Single Component | Form inputs, modal visibility, UI toggles, local counters. |
| **Provide / Inject (`provide`/`inject`)** | Component Subtree | Theme preferences, active tab context, localized form groups. |
| **Bridges (`bridge()`)** | Application-wide | User authentication, shopping cart, global notification queues, connections to external systems. |

A Bridge is a module you import where you need it, so the compiler can see every consumer. See the [Bridges guide](/core-concepts/bridges/).

---

## 5. State Rules & Golden Guidelines

### ❌ Do Not Reassign `this.state` Directly

Assigning a new object directly to `this.state` replaces the reactive Proxy object and breaks change detection, triggering error `AVX_R16`:

```javascript
// ❌ WRONG: Reassigning this.state destroys reactivity (AVX_R16)
this.state = { count: 5 };

// ✅ CORRECT: Mutate individual properties
this.state.count = 5;

// ✅ CORRECT: Update multiple properties at once using Object.assign
Object.assign(this.state, { count: 5, title: 'Updated' });
```

---

### ❌ Do Not Mutate State Inside Computed Getters or Render Methods

Modifying reactive state inside a computed getter or template expression causes an infinite re-render loop, triggering error `AVX_R11`:

```javascript
// ❌ WRONG: Modifying state during computed calculation (AVX_R11)
<computed name="doubleCount" value="state.count++; return count * 2" />

// ✅ CORRECT: Pure computed getters without side effects
<computed name="doubleCount" value="count * 2" />
```
