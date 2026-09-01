---
title: 'Migrating from Vue to Avenx-JS'
description: 'Comprehensive guide for migrating Vue SFCs, Composition API, templates, directives, and Pinia stores to Avenx-JS.'
---

This guide details how to migrate applications built with **Vue 2 / Vue 3** to **Avenx-JS**.

---

## 1. Architectural Overview & Mental Model Shift

Vue single file components (`.vue`) encapsulate `<template>`, `<script>`, and `<style scoped>` in one file. Avenx-JS separates templates/logic into `.component.js` companion files and styling into `.component.css`, utilizing top-level compiler tags for state and computed properties.

| Concept | Vue | Avenx-JS |
| :--- | :--- | :--- |
| **Component Format** | Single File Component (`.vue`) | Companion files (`.component.js` + `.component.css`) |
| **Reactivity** | `ref()` / `reactive()` | Top-level `<state key="val" />` Proxy tag |
| **Computed Values** | `computed(() => fn)` | `<computed name="x" value="..." />` tag |
| **Loops & Directives** | `v-for`, `v-model`, `v-show`, `v-if` | `<@for>`, `data-ax-bind`, `data-ax-show`, ternary HTML |
| **Global Store** | Pinia (`defineStore`) / Vuex | **Bridges** (`bridge()` in `src/bridges/*.bridge.js`) |

---

## 2. Component Structure and Templates

A Vue SFC wraps three concerns in one file: `<template>` (markup), `<script setup>` (logic), and `<style scoped>` (styles). Avenx-JS splits those same three concerns into **companion files**: a `.component.js` file that holds the HTML template plus top-level compiler tags for state and computed properties, and a `.component.css` file holding scoped styles. The template engine is plain HTML with a few compiler tags — see [Templates](/core-concepts/templates) for the full language, and the [Migration Overview](/migration/overview) for where companion files sit in the paradigm map.

### SFC to Companion File Mapping

| Vue SFC (`.vue`) | Avenx-JS |
| :--- | :--- |
| `<template>` | `.component.js` — the template IS the file's HTML |
| `<script setup>` | `.component.js` — `data-props-*` attributes, `<state />`, `<computed />`, `<@for>`, actions |
| `<style scoped>` | `.component.css` — `<@css>` named blocks bound via the `@css` attribute |
| `defineProps([...])` | `data-props-*` attributes on the component tag in the parent; read via `this.props.*` |

#### Before — Vue Single File Component (`.vue`)

```html
<!-- ItemList.vue -->
<template>
  <div class="list-container">
    <header>
      <slot name="header">Default Header</slot>
    </header>
    <ul>
      <li v-for="(item, idx) in items" :key="item.id">
        <span>{{ idx + 1 }}. {{ item.name }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup>
defineProps(['items']);
</script>

<style scoped>
.list-container { padding: 1rem; }
</style>
```

#### After — Avenx.js Companion Files

```html
<!-- src/components/item-list/item-list.component.js -->
<div class="list-container" @css container>
  <header>
    <slot name="header">Default Header</slot>
  </header>
  <ul>
    <@for item in this.props.items key="item.id">
      <li>
        <span>{{ index + 1 }}. {{ item.name }}</span>
      </li>
    </@for>
  </ul>
</div>
```

```css
/* src/components/item-list/item-list.component.css */
<@css>
  container {
    padding: 1rem;
  }
</@css>
```

Note the three changes that matter:

1. **The template is the file.** There is no `<template>` wrapper — the component's root element is whatever the `.component.js` file returns.
2. **Styles are scoped by name.** `<@css>` blocks are extracted, hashed into unique class suffixes, and bound to elements with the `@css` attribute (see [Styling](/core-concepts/styling)).
3. **Props come through `this.props`.** The parent passes `items` with `data-props-items="..."`, and the child reads `this.props.items` — no `defineProps` declaration needed.

### Loops: `v-for` → `<@for>`

Vue's `v-for` is an element directive; Avenx's `<@for>` is a **compiler tag** that wraps the repeated block. Loop blocks are translated to `<template>` tags and managed by the `ListManager` for efficient DOM list updates. Avenx also supports Map, Set, and Object iteration via destructuring, and fallback blocks via `<@empty>` (which replaces Vue's `v-if="items.length"` empty-state pattern).

#### Before — Vue `v-for`

```html
<ul v-if="items.length">
  <li v-for="(item, idx) in items" :key="item.id">
    <span>{{ idx + 1 }}. {{ item.name }}</span>
  </li>
</ul>
<p v-else>No items found.</p>

<div v-for="(value, key) in myObject">
  {{ key }}: {{ value }}
</div>
```

#### After — Avenx `<@for>`

```html
<ul>
  <@for item in this.props.items key="item.id">
    <li>
      <span>{{ index + 1 }}. {{ item.name }}</span>
    </li>
    <@empty>
      <p>No items found.</p>
    </@empty>
  </@for>
</ul>

<@for [key, value] in state.myObject key="key">
  <div>{{ key }}: {{ value }}</div>
</@for>
```

### The Implicit `index` Variable

Every `<@for>` loop automatically injects a **zero-indexed `index` variable** into the loop template scope — `ListManager` adds it for you on each iteration. You never declare it:

```html
<@for item in this.props.items key="item.id">
  <span>{{ index + 1 }}. {{ item.name }}</span>
</@for>
```

:::caution
Do **not** write `(item, index) in list` inside `<@for>` like you would in Vue. `<@for>` takes exactly one item variable (or a `[key, value]` pair for objects/maps); the index is implicit and starts at `0`, so add `1` (as above) for a human-readable 1-based count.
:::

### Slots: Default and Named

Avenx supports both Vue-style **default** and **named** slots. The child component declares a `<slot>` element (with a fallback body); the parent supplies content with a `slot="name"` attribute. If the parent provides no content for a slot, the child's fallback content renders instead.

#### Before — Vue Named Slot

```html
<!-- Card.vue -->
<div class="card">
  <header>
    <slot name="header">Default Header</slot>
  </header>
  <main>
    <slot></slot>
  </main>
</div>
```

```html
<!-- Parent.vue -->
<Card>
  <h2 slot="header">Special Title</h2>
  <p>This content goes into the default slot!</p>
</Card>
```

#### After — Avenx Slots

```html
<!-- src/components/card/card.component.js -->
<div class="card" @css card>
  <header>
    <slot name="header">Default Header</slot>
  </header>
  <main>
    <slot></slot>
  </main>
</div>
```

```html
<!-- Parent template -->
<Card>
  <h2 slot="header">Special Title</h2>
  <p>This content goes into the default slot!</p>
</Card>
```

Named and default slot markup is identical between Vue and Avenx — only the file layout changes.

### Checking Slot Presence (`this.$slots.has()`)

A component can decide whether the parent actually supplied content for a slot using `this.$slots.has(slotName)` inside an action or logic block. This is the direct replacement for Vue's `this.$slots.header` checks:

```html
<!-- src/components/card/card.component.js -->
<div class="card">
  <h2 data-ax-show="this.$slots.has('header')">This card has a custom header</h2>
  <slot name="header">Default Header</slot>
</div>
```

`this.$slots.has()` returns `true` only when the parent passed matching content, letting you conditionally render fallback UI without emitting empty containers — pair it with `data-ax-show` (Avenx's conditional-visibility directive, the `v-if`/`v-show` replacement) as above. See [Slots and `$slots.has()`](/core-concepts/templates) in the Templates guide for the full details.

---

## 3. Directives and Event Handling

Vue templates heavily rely on built-in directives such as `v-model`, `v-show`, `v-if`, `:class`, `:style`, and `@event` handlers. Avenx-JS provides lightweight HTML5 `data-ax-*` data attributes for directives and `@event` syntax for event handling. See the [Directives](/core-concepts/directives) guide for full specifications and the [Migration Overview](/migration/overview) for paradigm comparisons.

### Directive Mapping Reference

| Vue Directive | Avenx-JS Equivalent | Behavior & Usage Notes |
| :--- | :--- | :--- |
| `v-model="text"` | `data-ax-bind="state.text"` | Two-way data binding for text inputs, textareas, and select elements. |
| `v-show="isVisible"` | `data-ax-show="state.isVisible"` | Toggles `display` property (`none` vs original) to show/hide DOM elements. |
| `v-if="condition"` | Inline Ternary `{{{ condition ? '...' : '' }}}` | Avenx has **no `v-if` directive**. Use raw ternary interpolation or `data-ax-show`. |
| `:class="{ active: isAct }"` | `data-ax-class="{ active: state.isAct }"` | Dynamically adds or removes CSS class names based on truthy expressions. |
| `:style="{ color: c }"` | `data-ax-style="{{ { color: state.c } }}"` | Dynamically applies inline CSS style properties. |
| `@click="logout"` | `@click="logout()"` | Binds DOM event listeners to `<action>` handlers (requires parentheses). |

---

### Code Migration Example

#### Before — Vue Directives Template (`.vue`)

```html
<template>
  <div>
    <input v-model="username" placeholder="Username" />
    <input type="checkbox" v-model="acceptedTerms" />

    <div v-show="isVisible" :class="{ active: isActive }" :style="{ color: textColor }">
      Visible Content
    </div>

    <p v-if="isLoggedIn">Welcome back!</p>
    <button @click="logout">Logout</button>
  </div>
</template>
```

#### After — Avenx.js Directives & Events (`.component.js`)

```html
<!-- src/components/user-form/user-form.component.js -->
<state username="" acceptedTerms="false" isVisible="true" isActive="true" textColor="blue" isLoggedIn="true" />

<action name="logout">
  state.isLoggedIn = false;
</action>

<div>
  <!-- Two-way binding for text inputs -->
  <input type="text" data-ax-bind="state.username" placeholder="Username" />

  <!-- Manual binding for checkboxes -->
  <input type="checkbox" checked="{{ state.acceptedTerms }}" @change="state.acceptedTerms = event.target.checked" />

  <!-- Visibility, class, and style directives -->
  <div data-ax-show="state.isVisible" data-ax-class="{ active: state.isActive }" data-ax-style="{{ { color: state.textColor } }}">
    Visible Content
  </div>

  <!-- Conditional rendering using inline ternary expression -->
  {{{ state.isLoggedIn ? '<p>Welcome back!</p>' : '' }}}

  <!-- Event listener call -->
  <button @click="logout()">Logout</button>
</div>
```

---

### Key Conceptual Differences & Migration Pitfalls

#### 1. No `v-if` Directive

Avenx-JS deliberately does **not** include a `v-if` or `<@if>` directive tag. Conditional markup is handled in one of two ways:

1. **Inline Ternary Expressions (`{{{ ... }}}`):** To dynamically insert or destroy DOM elements based on state, use raw HTML interpolation with a JS ternary condition:
   ```html
   {{{ state.isLoggedIn ? '<p>Welcome back!</p>' : '' }}}
   ```
2. **`data-ax-show` Directive:** If the DOM element should remain mounted in the DOM tree while toggling visibility, use `data-ax-show="state.isVisible"`.

#### 2. Checkbox & Radio Two-Way Binding

`data-ax-bind` maps onto `v-model` directly here. Like Vue, it detects the control and binds a checkbox or radio through `checked` rather than `value`:

```html
<!-- Vue -->
<input type="checkbox" v-model="acceptedTerms" />

<!-- Avenx-JS -->
<input type="checkbox" data-ax-bind="state.acceptedTerms" />
```

Checkbox groups backed by an array and radio groups sharing one value work the same way as in Vue:

```html
<input type="checkbox" value="apple" data-ax-bind="state.fruits" />
<input type="radio" name="color" value="red" data-ax-bind="state.selectedColor" />
```

The one difference worth knowing: a `checked` attribute written by hand on a bound input is dropped, because the binding owns that state. Set the initial value in `<state>` instead of on the element. See [Two-Way Bindings](/core-concepts/templates/#2-two-way-bindings-data-ax-bind) for the full reference.

#### 3. Event Handler Invocation Syntax (`@click="logout()"`)

In Vue templates, method references without parentheses (e.g. `@click="logout"`) are valid. In Avenx-JS, event attributes (`@click`, `@input`, `@change`, `@submit`) execute template expressions directly. Action handlers must include **explicit execution parentheses**:

```html
<!-- Vue (Method reference without parentheses) -->
<button @click="logout">Logout</button>

<!-- Avenx-JS (Explicit execution parentheses) -->
<button @click="logout()">Logout</button>
```

Event parameters can also be passed directly to action methods or inline expressions:
```html
<button @click="selectUser(item.id)">Select</button>
<input @input="state.searchQuery = event.target.value" />
```

---

## 4. Reactivity, Ref, and Computed

Vue 3 manages reactive state with Composition API primitives (`ref()`, `reactive()`, `computed()`) or the Options API (`data()`, `computed`). Avenx-JS unifies reactive state and derived values into **two top-level compiler tags**: one `<state />` tag holds every reactive property, and `<computed />` tags declare derived values. There are no `.value` wrappers and no setters — state is a reactive Proxy you mutate directly, and the template re-evaluates for you. See [Reactive State](/core-concepts/reactivity) for the full model and [Computed Properties](/core-concepts/computed) for derivations, plus the [Migration Overview](/migration/overview) for where this sits in the paradigm map.

### Replacing `ref()` and `reactive()` with One `<state />` Tag

Every Vue ref and reactive object collapses into **one** `<state />` tag at the top of the component — each attribute is one reactive property. The tag sits in the `.component.js` file, is parsed at compile time, and is stripped before the class is emitted.

#### Before — Vue 3 Composition API (`ref` / `reactive`)

```javascript
import { ref, reactive } from 'vue';

const count = ref(0);
const user = reactive({ name: 'Jane', role: 'admin' });

function increment() {
  count.value++;
}
```

#### After — One Avenx `<state />` Tag

```html
<!-- src/components/counter/counter.component.js -->
<state count="0" user='{"name": "Jane", "role": "admin"}' />

<action name="increment">
  state.count++;
</action>

<div>
  <p>Count: {{ state.count }}</p>
  <p>User: {{ state.user.name }} ({{ state.user.role }})</p>
  <button @click="increment()">Increment</button>
</div>
```

Attribute values are coerced to their JavaScript types — numbers, booleans, arrays, and objects all work. `@click="increment()"` calls the action defined by the `<action>` tag (see [Events](/core-concepts/events)).

### No `.value` Unwrapping

Vue's `ref()` returns a wrapper object, so script blocks read `count.value` and write `count.value = 1`. Avenx state properties are accessed **directly** — `state.count`, not `state.count.value` — because `state` is already the reactive Proxy. The same is true in expressions: `{{ state.count }}`, not `{{ state.count.value }}`.

:::caution
In Vue you can pass `ref` objects around and read `.value` wherever they land. In Avenx there is no wrapper to pass around: if you need a value outside the template, reference `state.<name>` in the action that consumes it.
:::

### JSON Attribute Rules for Objects and Arrays

`<state />` attributes are evaluated as JSON/JavaScript expressions. The one rule to remember: **object and array values must be valid JSON strings** — wrap them in single quotes and use double quotes inside:

```html
<state user='{"name": "Jane", "role": "admin"}' tags='["student", "verified"]' />
```

This is the one formatting difference Vue developers hit most: bare `{ name: "Jane" }` or single quotes inside the value are not valid JSON, and the attribute will not parse as you expect.

### Replacing `computed()` with `<computed />`

A Vue `computed(() => expr)` becomes a `<computed name="..." value="..." />` tag. The `value` attribute is a stringified JavaScript expression that can reference `state` properties and other computed names.

#### Before — Vue `computed()`

```javascript
import { ref, reactive, computed } from 'vue';

const count = ref(0);
const user = reactive({ name: 'Jane', role: 'admin' });

const doubleCount = computed(() => count.value * 2);
const greeting = computed(() => `Hello ${user.name}, count is ${count.value}`);
```

#### After — Avenx `<computed />` Tags

```html
<state count="0" user='{"name": "Jane", "role": "admin"}' />
<computed name="doubleCount" value="state.count * 2" />
<computed name="greeting" value="'Hello ' + state.user.name + ', count is ' + state.count" />

<div>
  <p>{{ greeting }} (Double: {{ doubleCount }})</p>
</div>
```

Template literals like Vue's `` `Hello ${user.name}` `` become string concatenation in the `value` expression (template literals inside an HTML attribute are awkward to escape); the computed tag accepts any stringified JS expression, so concatenation works cleanly.

### No Vue Watchers

Vue's `watch()`, `watchEffect()`, and the Options API `watch` option have **no direct counterpart** in Avenx. You do not subscribe to changes — every mutation of `state` re-renders the template automatically, and `<computed />` covers the "react to a state change with a derived value" case that `watch` is often used for.

```javascript
// Vue: imperative side effect on change
watch(count, (next) => console.log('count is', next));
```

```html
<!-- Avenx: derived value declared once; the template re-evaluates on state change -->
<computed name="countLog" value="'count is ' + state.count" />
```

If you genuinely need to run a side effect when a value changes, Avenx does offer `this.$watch(source, callback, options)` as an advanced, explicit tool — but it is an Avenx API, not Vue's `watch`, and most Vue `watch` usages (derived UI state, logging, syncing) are better expressed as `<computed />` or as work inside the action that mutates the state. See [Watchers](/core-concepts/reactivity#watchers--advanced-options-watch) in the Reactivity guide.

---

## 5. Global Stores & Pinia to Bridges

Vue applications typically rely on **Pinia** (`defineStore`) or Vuex to share reactive state and business logic across components. In Avenx-JS, shared global state is managed through **Bridges** — modules in `src/bridges/*.bridge.js` created with the `bridge()` factory.

A bridge is reached by importing it, much as a Pinia store is reached through `useAuthStore()`. There are no store providers and no root plugin to install: the import alone puts the bridge in the component's template scope. See the [Bridges](/core-concepts/bridges) guide for complete details and the [Migration Overview](/migration/overview) for paradigm comparisons.

---

### Generating Bridges via CLI

You can generate a new bridge using the Avenx CLI command:

```bash
npx avenx g bridge auth
```

This creates a new `src/global/auth.bridge.js` scaffold built on the `bridge()` factory.

---

### Code Migration Example

#### Before — Vue Pinia Store (`stores/auth.js` & `Component.vue`)

```javascript
// stores/auth.js
import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isLoggedIn: false,
    user: { name: 'Guest' }
  }),
  actions: {
    login(username) {
      this.isLoggedIn = true;
      this.user.name = username;
    },
    logout() {
      this.isLoggedIn = false;
      this.user.name = 'Guest';
    }
  }
});
```

```html
<!-- UserNav.vue -->
<script setup>
import { useAuthStore } from '@/stores/auth';
const auth = useAuthStore();
</script>

<template>
  <div>
    <p>Current User: {{ auth.user.name }}</p>
    <button @click="auth.logout()">Log Out</button>
  </div>
</template>
```

#### After — Avenx.js Bridge (`src/bridges/auth.bridge.js` & Component Template)

```javascript
// src/bridges/auth.bridge.js
import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: {
    isLoggedIn: false,
    user: { name: 'Guest' },
  },

  login(username) {
    this.isLoggedIn = true;
    this.user.name = username;
  },

  logout() {
    this.isLoggedIn = false;
    this.user.name = 'Guest';
  },
});
```

```html
<!-- src/components/user-nav/user-nav.component.js -->
import auth from '../../bridges/auth.bridge.js';

<div>
  <p>Current User: {{ auth.user.name }}</p>
  <button @click="auth.logout()">Log Out</button>
</div>
```

---

### Key Conceptual Differences & Migration Pitfalls

#### 1. No Store Providers, but Still an Import

In Vue, components import the store module and invoke a composition function (e.g. `const auth = useAuthStore()`). In Avenx-JS the import stays, and the call does not: importing the bridge is what binds it into the template scope.

There is no root plugin to install and no provider to wrap the app in. The import is also what the compiler reads — a bridge nothing imports is left out of the bundle, and a template member the bridge does not declare is reported at build time.

#### 2. State Is Read-Only Outside the Bridge

Pinia lets a component write `auth.isLoggedIn = true` directly. A bridge does not: assigning to state from outside throws `AVX_R22`. Every mutation goes through an action, which keeps one origin for each change.

```javascript
import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { items: [] },

  addItem(item) {
    this.items = [...this.items, item];
  },
});
```

#### 3. `export default` Compiler Requirement

The Avenx compiler reads the definition object passed to `bridge()` in the default export, so a `.bridge.js` file must export one:

```javascript
export default bridge({ /* ... */ });
```

Helper constants and functions declared above `export default` are preserved — the module body is emitted inside its own scope. A `.bridge.js` file that is not built on `bridge()` fails the build with `AVX_C12`.
