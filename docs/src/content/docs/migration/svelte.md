---
title: 'Migrating from Svelte to Avenx-JS'
description: 'Comprehensive guide for migrating Svelte components, reactivity ($: declarations), stores, event directives, and bindings to Avenx-JS.'
---

This guide details how to migrate applications built with **Svelte 3 / Svelte 4 / Svelte 5 (Runes)** to **Avenx-JS**.

---

## 1. Architectural Overview & Mental Model Shift

Both Svelte and Avenx-JS favor compiler-assisted reactivity over heavy virtual DOM reconciliation. However, their component paradigms differ in structure and state management:

- **Svelte**: Combines `<script>`, HTML markup, and `<style>` in a single `.svelte` file, using compile-time variable assignments (`let count = 0`) and dollar syntax (`$: doubled = count * 2`).
- **Avenx-JS**: Separates logic/templates and styling into **companion files** (`.component.js` and `.component.css`). State and computed derivations are declared explicitly using top-level `<state />` and `<computed />` compiler tags backed by fine-grained JavaScript `Proxy` reactivity and batched microtask updates.

| Concept | Svelte | Avenx-JS |
| :--- | :--- | :--- |
| **Component Format** | Single File Component (`.svelte`) | Companion files (`.component.js` + `.component.css`) |
| **Reactivity** | `let count = 0` / `$state(0)` | Top-level `<state count="0" />` Proxy tag |
| **Derived Values** | `$: doubled = count * 2` / `$derived()` | `<computed name="doubled" value="state.count * 2" />` |
| **Methods / Actions** | JavaScript functions in `<script>` | `<action name="increment">this.state.count++</action>` |
| **Two-Way Binding** | `bind:value={text}` | `data-ax-bind="state.text"` |
| **Loops** | `{#each items as item (item.id)}` | `<@for item in state.items key="item.id">` |
| **Conditional Flow** | `{#if condition} ... {:else} ... {/if}` | `data-ax-show="state.condition"` / inline ternaries |
| **Event Handling** | `on:click={handleClick}` | `@click="handleClick()"` (parentheses mandatory) |
| **Event Modifiers** | `on:submit\|preventDefault` | `@submit.prevent="save()"` |
| **Component Props** | `export let name = 'default'` / `$props()` | Top-level `<props name="default" />` / `this.props` |
| **Slots** | `<slot />` / `<slot name="header" />` | `<slot />` / `<slot name="header" />` |
| **Global State** | Writable/Readable Stores (`writable()`, `$store`) | **Bridges** (`bridge()` in `src/bridges/*.bridge.js`) |

---

## 2. Component Structure: `.svelte` → Companion Files

In Svelte, a component houses markup, script, and style in one file. Avenx-JS uses companion files:
- **`src/components/<name>/<name>.component.js`**: Holds the template markup and top-level compiler tags (`<state>`, `<props>`, `<computed>`, `<action>`, `<resource>`).
- **`src/components/<name>/<name>.component.css`**: Holds scoped styles using `<@css>` blocks.

### Side-by-Side Comparison

#### Before — Svelte Component (`Counter.svelte`)

```html
<!-- Counter.svelte -->
<script>
  export let initialCount = 0;

  let count = initialCount;
  $: doubled = count * 2;

  function increment() {
    count += 1;
  }
</script>

<div class="counter-card">
  <h2>Count: {count}</h2>
  <p>Doubled: {doubled}</p>
  <button on:click={increment}>Increment</button>
</div>

<style>
  .counter-card {
    padding: 1.5rem;
    border-radius: 8px;
    background: #f8fafc;
  }
</style>
```

#### After — Avenx-JS Companion Files

```html
<!-- src/components/counter/counter.component.js -->
<props initialCount="0" />
<state count="0" />
<computed name="doubled" value="state.count * 2" />

<action name="increment">
  this.state.count += 1;
</action>

<div class="counter-card" @css card>
  <h2>Count: {{ count }}</h2>
  <p>Doubled: {{ doubled }}</p>
  <button @click="increment()">Increment</button>
</div>
```

```css
/* src/components/counter/counter.component.css */
<@css>
  card {
    padding: 1.5rem;
    border-radius: 8px;
    background: #f8fafc;
  }
</@css>
```

---

## 3. Reactivity & State Management

### Declaring Reactive State

In Svelte, local state is defined with `let` or `$state()`. In Avenx-JS, state is declared via the top-level `<state />` tag:

```html
<!-- Svelte -->
<script>
  let username = 'Alice';
  let score = 100;
  let tags = ['dev', 'frontend'];
</script>

<!-- Avenx-JS -->
<state
  username="Alice"
  score="100"
  tags='["dev", "frontend"]'
/>
```

> [!NOTE]
> Primitive attributes (`score="100"`) are automatically coerced to numbers, booleans, or strings. Arrays and objects must be valid JSON strings enclosed in single quotes (`tags='["dev", "frontend"]'`).

### Reactive Declarations: `$:` vs `<computed />`

Svelte uses labeled statements (`$:`) for reactive computations. Avenx-JS uses `<computed />` compiler tags:

```html
<!-- Svelte -->
<script>
  let firstName = 'Ada';
  let lastName = 'Lovelace';
  $: fullName = `${firstName} ${lastName}`;
</script>

<!-- Avenx-JS -->
<state firstName="Ada" lastName="Lovelace" />
<computed name="fullName" value="`${state.firstName} ${state.lastName}`" />
```

---

## 4. Template Directives & Control Flow

### List Rendering: `{#each}` → `<@for>`

Svelte uses block-level `{#each}` tags and supports `{:else}` for empty lists. Avenx-JS uses `<@for>` with an implicit `index` variable, and `<@empty>` for empty states. Avenx also supports direct iteration over Maps, Sets, Objects (via `[key, value]` destructuring), and numeric ranges:

```html
<!-- Svelte -->
<ul>
  {#each items as item, i (item.id)}
    <li>{i + 1}. {item.name}</li>
  {:else}
    <li>No items found.</li>
  {/each}
</ul>

<!-- Avenx-JS -->
<ul>
  <@for item in state.items key="item.id">
    <li>{{ index + 1 }}. {{ item.name }}</li>
    <@empty>
      <li>No items found.</li>
    </@empty>
  </@for>
</ul>
```

### Conditional Rendering: `{#if}` → `data-ax-show` & Ternaries

For toggling element visibility, use `data-ax-show`:

```html
<!-- Svelte -->
{#if isVisible}
  <div class="banner">Welcome back!</div>
{/if}

<!-- Avenx-JS -->
<div class="banner" data-ax-show="state.isVisible">
  Welcome back!
</div>
```

For structural conditional rendering in markup, use inline template interpolations:

```html
<!-- Svelte -->
{#if isLoggedIn}
  <span>User Dashboard</span>
{:else}
  <span>Please Log In</span>
{/if}

<!-- Avenx-JS -->
<span>{{ state.isLoggedIn ? 'User Dashboard' : 'Please Log In' }}</span>
```

### Two-Way Data Binding: `bind:value` → `data-ax-bind`

Svelte uses `bind:value` or `bind:checked`. Avenx-JS uses `data-ax-bind`:

```html
<!-- Svelte -->
<input bind:value={searchTerm} placeholder="Search..." />
<input type="checkbox" bind:checked={agreed} />

<!-- Avenx-JS -->
<input data-ax-bind="state.searchTerm" placeholder="Search..." />
<input type="checkbox" data-ax-bind="state.agreed" />
```

---

## 5. Event Handling & Modifiers

### Event Syntax: `on:click` → `@click`

Svelte binds events using `on:event={handler}`. Avenx-JS uses `@event="handler()"` with **mandatory parentheses**:

```html
<!-- Svelte -->
<button on:click={submitForm}>Submit</button>

<!-- Avenx-JS -->
<button @click="submitForm()">Submit</button>
```

### Event Modifiers

Svelte uses pipe syntax (`|preventDefault`, `|stopPropagation`, `|once`). Avenx-JS uses dot-notation modifiers (`.prevent`, `.stop`, `.self`, `.once`):

| Svelte Event Modifier | Avenx-JS Modifier | Example |
| :--- | :--- | :--- |
| `on:submit\|preventDefault` | `@submit.prevent` | `<form @submit.prevent="save()">` |
| `on:click\|stopPropagation` | `@click.stop` | `<button @click.stop="toggle()">` |
| `on:click\|once` | `@click.once` | `<button @click.once="claim()">` |
| `on:click\|self` | `@click.self` | `<div class="modal" @click.self="close()">` |
| `on:keydown` (manual key filter) | `@keydown.enter` | `<input @keydown.enter="search()">` |

---

## 6. Component Communication: Props, Custom Events & Slots

### Props: `export let` → `<props />`

In Svelte, props are declared via `export let propName = defaultValue`. In Avenx-JS, props are declared with `<props />` and accessed via `this.props`:

```html
<!-- Svelte: UserBadge.svelte -->
<script>
  export let username = 'Guest';
  export let role = 'user';
</script>
<span class="badge">{username} ({role})</span>

<!-- Avenx-JS: user-badge.component.js -->
<props username="Guest" role="user" />

<span class="badge">{{ this.props.username }} ({{ this.props.role }})</span>
```

### Custom Events: `createEventDispatcher` → `this.$emit`

In Svelte, custom events are dispatched using `createEventDispatcher()`. In Avenx-JS, call `this.$emit(eventName, detail)`:

```javascript
// Svelte
import { createEventDispatcher } from 'svelte';
const dispatch = createEventDispatcher();

function notify() {
  dispatch('select', { id: 42 });
}

// Avenx-JS
<action name="notify">
  this.$emit('select', { id: 42 });
</action>
```

Listening in parent component:

```html
<!-- Svelte -->
<UserBadge on:select={handleSelect} />

<!-- Avenx-JS -->
<UserBadge @select="handleSelect(event.detail)" />
```

### Slots

Both frameworks use the `<slot>` element:

```html
<!-- Svelte & Avenx-JS: Default & Named Slots -->
<div class="card">
  <header>
    <slot name="header">Default Title</slot>
  </header>
  <main>
    <slot />
  </main>
</div>
```

---

## 7. Global State: Svelte Stores → Avenx Bridges

In Svelte, shared reactive state is managed using `writable()` / `readable()` stores and the `$store` auto-subscription syntax.

In Avenx-JS, shared global state is encapsulated in **Bridges** (`src/bridges/*.bridge.js`), created with the `bridge()` factory:

#### Before — Svelte Store (`authStore.js`)

```javascript
// authStore.js
import { writable } from 'svelte/store';

function createAuthStore() {
  const { subscribe, set, update } = writable({ user: null, token: null });

  return {
    subscribe,
    login: (user, token) => set({ user, token }),
    logout: () => set({ user: null, token: null }),
  };
}

export const auth = createAuthStore();
```

```html
<!-- Consuming Svelte Component -->
<script>
  import { auth } from './authStore.js';
</script>

{#if $auth.user}
  <p>Welcome, {$auth.user.name}!</p>
  <button on:click={auth.logout}>Log out</button>
{/if}
```

#### After — Avenx-JS Bridge (`auth.bridge.js`)

```javascript
// src/bridges/auth.bridge.js
import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: {
    user: null,
    token: null,
  },

  login(user, token) {
    this.user = user;
    this.token = token;
  },

  logout() {
    this.user = null;
    this.token = null;
  },
});
```

```html
<!-- Consuming Avenx-JS Component -->
import auth from '../bridges/auth.bridge.js';

<div class="auth-box">
  <p data-ax-show="auth.user">Welcome, {{ auth.user.name }}!</p>
  <button data-ax-show="auth.user" @click="auth.logout()">Log out</button>
</div>
```

> [!TIP]
> The import is the subscription. Like Svelte's `$store`, reading a bridge member in a template tracks it — but because the import names the dependency, the compiler drops bridges nothing imports and catches a mistyped member before you run the app.

---

## 8. Lifecycle Hooks Mapping

| Svelte Lifecycle | Avenx-JS Lifecycle | Description |
| :--- | :--- | :--- |
| `onMount(() => { ... })` | `onMount()` | Component is mounted and attached to the DOM. |
| `beforeUpdate(() => { ... })` | `onBeforeUpdate()` | State changed, prior to DOM patch cycle. |
| `afterUpdate(() => { ... })` | `onUpdate()` | DOM patch cycle has completed. |
| `onDestroy(() => { ... })` | `onUnmount()` | Component is destroyed/unmounted from DOM. |
| `tick()` | `await nextTick()` | Resolves when pending reactive microtasks flush. |

---

## 9. Migration Checklist

When converting a Svelte component to Avenx-JS:

1. [ ] Separate `.svelte` file into `.component.js` and `.component.css` companion files.
2. [ ] Convert `let` variables to `<state />` tags.
3. [ ] Convert `$: derived` declarations to `<computed />` tags.
4. [ ] Replace `{#each}` with `<@for item in state.items key="item.id">`.
5. [ ] Replace `bind:value` with `data-ax-bind="state.field"`.
6. [ ] Replace `on:click={fn}` with `@click="fn()"` (ensure parentheses are present).
7. [ ] Replace `on:event|modifier` with `@event.modifier`.
8. [ ] Replace `writable()` stores with `bridge()` modules in `src/bridges/`, and import them where they are used.
9. [ ] Move scoped CSS styles into `<@css>` blocks in the companion `.component.css`.
