---
title: 'Component Structure'
description: 'Understand how Avenx Single File Components are structured with template, script, and style tags.'
---

---

In Avenx-JS, a component is defined by two companion files in the same directory: `<name>.component.js` (logic and template) and `<name>.component.css` (styles).

## JavaScript File (`.component.js`)

The component file contains configuration tags at the top and the HTML template at the bottom. The configuration tags are parsed at compile-time and stripped out before outputting class declarations.

- `<state key="val" />` - Declares the component's reactive local properties. Attributes are coerced to their corresponding JS types (numbers, booleans, arrays, or objects).
- `<computed name="computedName" value="expression" />` - Defines computed getters. The value attribute accepts stringified JS expressions.
- `<action name="methodName"> ... </action>` - Defines actions (methods) that have access to the component's state, computed attributes, and bridges in their execution scope.

```html
<!-- src/components/greet/greet.component.js -->
<state username="Guest" isLoggedIn="false" />
<computed name="greeting" value="isLoggedIn ? 'Welcome back, ' + username : 'Hello, Guest!'" />
<action name="login"> state.username = "Jane Doe"; state.isLoggedIn = true; </action>
<div class="greet-box">
  <h3>{{ greeting }}</h3>
  <button @click="login()">Log In</button>
</div>
```

## Accessing the Root DOM Element (`this.$element` / `this.el`)

Inside component actions and methods, Avenx-JS provides the `this.$element` getter (also aliased as `this.el`) to access the component's root HTML DOM element directly.

### Lifecycle Availability & Guarantees

The `this.$element` getter returns `Element` when mounted and `null` when unattached:

- **Pre-mount (`onBeforeMount`)**: Returns `null` because the component's HTML template has not yet been compiled and inserted into the document.
- **Post-mount (`onMount`, `onUpdate`)**: Guaranteed to return the mounted `Element` instance in the document DOM.
- **Post-unmount (`onUnmount`)**: Returns the element during `onUnmount()` cleanup execution, and resets to `null` after unmounting completes.

```html
<!-- src/components/chart-card/chart-card.component.js -->
<action name="onMount">
  // Access root element safely inside onMount
  const rootNode = this.$element; // or this.el
  console.log('Component root tag:', rootNode.tagName);
  
  // Attach third-party library (e.g. Chart.js, Tippy.js, D3)
  this.chartInstance = new Chart(rootNode.querySelector('.canvas'), { ... });
</action>

<action name="onUnmount">
  if (this.chartInstance) {
    this.chartInstance.destroy();
  }
</action>

<div class="chart-card">
  <canvas class="canvas"></canvas>
</div>
```

## Single `<state />` Tag Per Component

> **Important:** Only the **first** `<state />` tag in a `.component.js` file is parsed. If a component contains more than one `<state />` tag, every tag after the first is silently ignored, and the properties declared in those extra tags will **not** become reactive.

It can be tempting to split state declarations into multiple `<state />` tags to keep them organized, for example by feature or by section:

```html
<!-- This will NOT work as expected -->
<state username="Guest" isLoggedIn="false" />
<state theme="light" notifications="true" />
```

In the example above, only `username` and `isLoggedIn` become reactive state. `theme` and `notifications` are dropped during compilation with no warning or error, which can cause confusing bugs where a property behaves as if it were never declared.

All reactive properties for a component must be combined into a **single, unified** `<state />` tag:

```html
<!-- Correct: all properties in one <state /> tag -->
<state username="Guest" isLoggedIn="false" theme="light" notifications="true" />
```

## Attribute Coercion & Types

Every attribute passed to `<state>` starts as a plain HTML attribute string. Before the value is assigned to reactive state, the component compiler's expression parser coerces it into the corresponding JavaScript type: strings, booleans, numbers, arrays, and objects are all resolved automatically.

- `username="Guest"` is resolved as a `string` → `"Guest"`
- `isLoggedIn="false"` is resolved as a `boolean` → `false`
- `count="42"` is resolved as a `number` → `42`
- `tags='["work", "urgent"]'` is resolved as an `array`, parsed as JSON → `["work", "urgent"]`
- `user='{"name": "John"}'` is resolved as an `object`, parsed as JSON → `{ name: "John" }`

Strings, booleans, and numbers are coerced automatically and require no special quoting. Arrays and objects can be written two ways:

- as **JSON**, with double-quoted keys and strings — wrap the attribute in single quotes so the double quotes can be used inside it;
- as a **JavaScript literal**, with unquoted keys and single-quoted strings.

```html
<state user='{"name": "John", "role": "admin"}' tags='["work", "urgent"]' />
<state user="{ name: 'John', role: 'admin' }" tags="['work', 'urgent']" />
```

Both lines declare the same state. A JavaScript literal is evaluated when the component is compiled, so it may contain only constant values: strings, numbers, booleans, `null`, arrays and objects. An initialiser that refers to something else — a variable, a function call, a spread — cannot be evaluated at build time:

```html
<state items="{ list: defaultItems }" />
```

That value stays the string `"{ list: defaultItems }"`, and the build reports `AVX_W51` with the reason and the line. Set such a value in `onMount`, or declare it as a `<computed>`.

A value that is neither JSON nor a literal is plain text: `title="Home"` is the string `"Home"`, and `label="[beta] feature"` is the string `"[beta] feature"`.

> Before 2026-09, a JavaScript literal such as `{name: 'John'}` fell back to a string silently. Components that relied on that string — reading it back as text — now receive an object instead. To keep a string, wrap the value in single quotes when it contains none of its own (`label="'{ draft }'"` is the string `{ draft }`), or set it in `onMount`.

## Nesting Components

A component may render another component. A component tag is resolved wherever
it appears -- in a page template, in a component template, or inside a `<@for>`
or `<@if>` within either -- and props flow down through every level.

```html
<!-- src/pages/dashboard.page.js -->
<div class="dashboard">
  <Navbar user="{{ currentUser }}" />
  <Stats period="{{ period }}" />
</div>
```

```html
<!-- src/components/stats/stats.component.js -->
<div class="stats">
  <!-- A component inside a component. -->
  <StatCard label="Open" value="{{ this.props.openCount }}" />
  <StatCard label="Done" value="{{ this.props.doneCount }}" />
</div>
```

```html
<!-- src/components/stat-card/stat-card.component.js -->
<div class="stat-card">
  <p>{{ this.props.label }}</p>
  <p>{{ this.props.value }}</p>
  <!-- And another level below that. -->
  <Badge text="{{ this.props.label }}" />
</div>
```

Every component in that chain mounts, and a change to the page's state reaches
`Badge` through each level in the same flush.

Registration is per application, not per parent. A component is registered once
in `src/main.app.js` -- which `avenx g component` does for you -- and is then
available to every template:

```javascript
app.register('StatCard', StatCard);
app.register('Badge', Badge);
```

### How deep it goes

Mounting a child renders its template, which can introduce mount points of its
own, so the page reconciles children in repeated passes until a pass mounts
nothing new. The depth is therefore not fixed by the mechanism, but it is
bounded: a tree nested more than 50 levels deep, or a component that renders
itself without a base case, stops at that bound and reports
[`AVX_R36`](/troubleshooting/errors#avx-r36-component-nesting-limit) rather
than looping. Reaching it almost always means a component is rendering itself.

### When to nest and when not to

Nesting being available does not make it the right choice everywhere. Passing a
value down through several levels that do nothing with it but pass it on is the
case a [Bridge](/core-concepts/bridges) or
[Provide & Inject](/core-concepts/provide-inject) exists for. Prefer props for
one or two levels, and a Bridge when the state genuinely spans the tree.

:::note
Before 2026-09, child mounting reached only one level below whatever was
already rendered, so a grandchild rendered or did not depending on when its
parent's list was populated -- a component whose data arrived in `onMount()`
appeared empty, with a clean build and a silent console. Earlier versions of
this page documented that limitation as a rule and recommended composing every
component as a sibling in a page. That is no longer necessary.
:::

## Dynamic Components

Use `<Component :is="{{ name }}" />` when one place in a template should render
different registered components as state changes. For a few fixed branches with
different surrounding markup, `<@if>` may be clearer.

This page starts with a profile card and swaps to a settings card when the user
selects Settings:

```html
<!-- src/pages/home.page.js -->
<state currentView="ProfileCard" />
<action name="showProfile"> state.currentView = 'ProfileCard'; </action>
<action name="showSettings"> state.currentView = 'SettingsCard'; </action>

<div>
  <button @click="showProfile()">Profile</button>
  <button @click="showSettings()">Settings</button>
  <Component :is="{{ currentView }}" />
</div>
```

The two component templates can be as small as:

```html
<!-- src/components/profile-card/profile-card.component.js -->
<section><h2>Profile</h2></section>

<!-- src/components/settings-card/settings-card.component.js -->
<section><h2>Settings</h2></section>
```

Register both names in `src/main.app.js` and route to the page:

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import ProfileCard from './components/profile-card/profile-card.component.js';
import SettingsCard from './components/settings-card/settings-card.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('ProfileCard', ProfileCard);
app.register('SettingsCard', SettingsCard);
app.initRouter({ '/': 'Home' });
```

The name in `currentView` must match a registered component. If it names one
that is not registered, the mount point stays empty and the browser reports
`AVX_W13`. Use the interpolation braces shown above: the bare spelling
`<Component :is="currentView" />` currently renders nothing (see
[#1490](https://github.com/Avenx-JS/avenx-js/issues/1490)).

For now, a template with a dynamic component also emits `AVX_W47` at build time
and uses the string renderer. It still updates, but reparses and diffs the
whole template on each update instead of updating only changed bindings.

## Slot Fallback Content

Avenx components support **fallback content** inside `<slot>` elements. Fallback content is rendered automatically whenever the parent component does not provide content for that slot.

This allows component authors to define sensible defaults while still allowing consumers to override them when needed.

### Basic Example

Child component:

```html
<div class="card">
  <slot>
    <p>No content provided.</p>
  </slot>
</div>
```

Parent without slot content:

```html
<Card />
```

Output:

```html
<div class="card">
  <p>No content provided.</p>
</div>
```

Since no slot content is passed from the parent, the fallback markup inside `<slot>` is rendered.

### Overriding the Fallback

When the parent provides slot content, the fallback is ignored.

Child component:

```html
<div class="card">
  <slot>
    <p>No content provided.</p>
  </slot>
</div>
```

Parent:

```html
<Card>
  <p>Welcome back!</p>
</Card>
```

Output:

```html
<div class="card">
  <p>Welcome back!</p>
</div>
```

The provided slot content replaces the fallback defined inside the child component.

### Multiple Slots

Each slot can define its own fallback content independently.

```html
<header>
  <slot name="title">
    <h2>Untitled</h2>
  </slot>
</header>

<main>
  <slot>
    <p>No content available.</p>
  </slot>
</main>
```

If the parent omits either slot, only that slot's fallback content is rendered.

:::tip
Fallback content should provide meaningful defaults so components remain usable even when slot content is omitted.
:::

---

## Scoped Slots & Passing Slot Props

While standard slots allow parent components to inject HTML markup into a child component, **Scoped Slots** allow child components to pass dynamic data back to the parent's slot template. This allows parent components to customize how child data is rendered while keeping data management inside the child component.

### 1. Child Component Syntax (`<slot :prop="value">`)

To expose data to the parent slot template, bind properties onto the `<slot>` tag using the `:` attribute prefix:

```html
<!-- src/components/ListContainer.component.js -->
<state currentItem="{ id: 1, name: 'Avenx Framework', category: 'Web' }" isVisible="true" />

<div class="list-container">
  <!-- Exposing child state onto the default slot -->
  <slot :item="state.currentItem" :visible="state.isVisible"></slot>
</div>
```

Child components can also expose data on **named scoped slots**:

```html
<header class="card-header">
  <slot name="header" :title="state.title" :badgeCount="state.badges.length"></slot>
</header>
```

---

### 2. Parent Component Syntax (`data-slot-props`)

Parent components receive the child's exposed data by wrapping the transcluded slot markup in a `<template>` tag with the `data-slot-props` attribute. The attribute value defines the local variable name used to access child data:

```html
<!-- src/pages/HomePage.page.js -->
<state selectedItem="null" />

<action name="handleItemSelect">
  const [item] = args;
  this.state.selectedItem = item;
</action>

<div class="home-page">
  <ListContainer>
    <template data-slot-props="slotProps">
      <div class="custom-item" data-ax-show="slotProps.visible">
        <h3>{{ slotProps.item.name }}</h3>
        <span class="badge">{{ slotProps.item.category }}</span>
        <button @click="handleItemSelect(slotProps.item)">Select</button>
      </div>
    </template>
  </ListContainer>
</div>
```

---

### 3. Named Scoped Slots

When using named slots together with scoped slot props, specify both the `name` attribute and `data-slot-props` on the `<template>` tag:

```html
<CardWidget>
  <!-- Consuming a named scoped slot -->
  <template name="header" data-slot-props="headerProps">
    <h2>{{ headerProps.title }}</h2>
    <span class="count-pill">{{ headerProps.badgeCount }} new</span>
  </template>

  <!-- Default slot content -->
  <template data-slot-props="bodyProps">
    <p>{{ bodyProps.content }}</p>
  </template>
</CardWidget>
```

---

### 4. Scope Availability & Directive Support

Inside a scoped slot template:
- Interpolations (`{{ slotProps.item.name }}`), directives (`data-ax-show="slotProps.visible"`), and action handlers (`@click="handleItemSelect(slotProps.item)"`) automatically evaluate against `slotProps`.
- Event action handlers inside scoped slots can pass `slotProps` properties directly to component methods.
- Updates to child state automatically re-evaluate expressions inside the parent's scoped slot template without unmounting the slot DOM nodes.


## Lifecycle Hooks

Avenx components support lifecycle hooks that allow you to run logic at different stages of a component's lifecycle.

Lifecycle hooks can be defined in two ways:

1. Through the `methods` object.
2. By defining lifecycle methods directly in a class that extends `AvenxComponent`.

### Defining Lifecycle Hooks with Methods Object

Lifecycle hooks can be provided through the component's methods configuration:

```javascript
methods: {
  onMount() {
    console.log('Component mounted');
  },

  onUpdate() {
    console.log('Component updated');
  },

  onUnmount() {
    console.log('Component unmounted');
  }
}
```
### Defining Lifecycle Hooks as Class Methods

When using class-based components, lifecycle hooks can be defined directly as methods on a subclass of `AvenxComponent`.

```javascript
class MyComponent extends AvenxComponent {
  onMount() {
    console.log('Component mounted');
  }

  onUpdate() {
    console.log('Component updated');
  }

  onUnmount() {
    console.log('Component unmounted');
  }
}
```

If a lifecycle hook is defined in both the `methods` object and the subclass, the `methods` object takes priority.

Available lifecycle hooks:

- `onBeforeMount()` — Runs right before initial component template rendering.
- `onMount()` — Runs when the component is mounted to the DOM.
- `onBeforeUpdate()` — Runs before DOM patching upon state changes.
- `onUpdate()` — Runs when the component updates and finishes DOM patching.
- `onUnmount()` — Runs when the component is removed from the DOM.
- `onActivate(params)` — Runs after `onMount()` and optional `onEnter()` on the first page-route activation, and whenever returning to a cached `keepAlive` page, receiving the latest route parameters.
- `onDeactivate()` — Runs when navigating away from an active `keepAlive` page.
- `onErrorCaptured(error, instance, info)` — Captures unhandled errors from descendant components.

---

## Centralized Error Boundaries (`onErrorCaptured`)

Avenx components can act as **Error Boundaries** by implementing the `onErrorCaptured` lifecycle hook. When an unhandled error occurs in a descendant component's lifecycle hook (such as `onMount`) or event action, the error bubbles up the parent component hierarchy until an `onErrorCaptured` handler intercepts it.

### Hook Signature & Parameters

```javascript
onErrorCaptured(error, instance, info)
```

- `error` (`Error`): The error instance caught from the descendant component.
- `instance` (`AvenxComponent`): The component instance where the error occurred.
- `info` (`string`): Description string of where the error originated (e.g., `'onMount'`, `'action click'`, `'template render'`).

### Stopping Error Propagation (`return false`)

By default, an error captured by `onErrorCaptured` continues bubbling up to ancestor components and eventually triggers the global application error handler (`app.config.errorHandler`).

To **stop error propagation** and prevent the application from crashing, return `false` explicitly from `onErrorCaptured`:

```javascript
onErrorCaptured(error, instance, info) {
  console.error(`Caught error from ${instance.constructor.name} during ${info}:`, error);
  this.state.hasError = true;
  this.state.errorMessage = error.message;
  return false; // Prevents error from bubbling further
}
```

---

### Building an Error Boundary Component

Error Boundaries are reusable container components that wrap dynamic UI sections (such as charts, external feeds, or user-generated widgets) to display fallback UI when something breaks inside them.

#### Single-File Component Example (`ErrorBoundary.component.js`)

```html
<state hasError="false" errorMessage="''" />

<action name="onErrorCaptured">
  const [error, instance, info] = args;
  console.error('ErrorBoundary captured exception:', error, info);
  
  // Set fallback UI state
  this.state.hasError = true;
  this.state.errorMessage = error.message || 'An unexpected error occurred';
  
  // Stop propagation to prevent full application crash
  return false;
</action>

<action name="resetError">
  this.state.hasError = false;
  this.state.errorMessage = '';
</action>

<div class="error-boundary-wrapper">
  <div data-ax-show="hasError" class="error-fallback-card">
    <h3>Something went wrong</h3>
    <p>{{ errorMessage }}</p>
    <button @click="resetError()">Try Again</button>
  </div>

  <div data-ax-show="!hasError">
    <slot></slot>
  </div>
</div>
```

#### Consuming the Error Boundary

Wrap unstable or third-party components inside the `<ErrorBoundary>` component:

```html
<!-- src/pages/dashboard.page.js -->
<div class="dashboard-page">
  <h2>Analytics Dashboard</h2>

  <ErrorBoundary>
    <UnstableChartWidget />
  </ErrorBoundary>
</div>
```

If `<UnstableChartWidget>` throws an exception during data fetching in `onMount()`, `<ErrorBoundary>` catches the exception, returns `false` to stop propagation, and renders the fallback card with a "Try Again" button without affecting the rest of the dashboard page.


## Compilation Lifecycle & Limits

The Avenx compiler processes `.component.js` files by scanning for supported configuration tags and template content. During compilation, only `<state>`, `<computed>`, `<action>`, and template content are preserved and transformed into the generated component output.

Standard JavaScript declarations written outside these supported tags, such as ES module imports, local variables, constants, and helper functions, are not preserved by the compiler. Code that depends on these declarations may therefore cause runtime `ReferenceError` exceptions after compilation.

For example, avoid declaring imports or helper functions directly in a component file:

```javascript
import { formatName } from './utils.js';
const defaultName = 'Guest';
function getDisplayName(name) {
  return formatName(name);
}
<state username="Guest" />
<action name="updateName">
  state.username = getDisplayName(defaultName);
</action>
```

In this example, the `import`, `defaultName`, and `getDisplayName` declarations are outside the supported component tags and may be removed during compilation.

Instead, keep component logic inside supported tags or move reusable utilities into external files that can be accessed through supported application patterns.

For utilities that are intentionally exposed globally, reference them through the `window` object:

```html
<action name="updateName"> state.username = window.AppUtils.formatName(state.username); </action>
```

When writing `.component.js` files:

- Keep reactive state declarations inside `<state>` tags.
- Keep computed values inside `<computed>` tags.
- Keep component methods and state mutations inside `<action>` tags.
- Move reusable helper logic into external utility files.
- Reference intentionally global utilities through properties on `window`.

Understanding these compilation limits helps prevent missing imports, undefined helpers, and runtime `ReferenceError` exceptions caused by code being removed from the compiled output.

## Slot Fallbacks

Slots can define fallback content that is rendered when a parent component does not provide any content for that slot.

This allows components to display sensible default content while still supporting customization through composition.

### Basic Syntax

Define fallback content by placing it between the opening and closing `<slot>` tags.

```html
<div class="card">
  <slot>
    No content provided.
  </slot>
</div>
```

If a parent component does not supply any child content, the text inside the `<slot>` element is rendered automatically.

### Parent Provides Content

Child component:

```html
<div class="card">
  <slot>
    No content provided.
  </slot>
</div>
```

Parent component:

```html
<Card>
  <p>Welcome to Avenx-JS!</p>
</Card>
```

Rendered output:

```html
<div class="card">
  <p>Welcome to Avenx-JS!</p>
</div>
```

The fallback content is ignored because the parent supplied slot content.

### Parent Does Not Provide Content

Child component:

```html
<div class="card">
  <slot>
    No content provided.
  </slot>
</div>
```

Parent component:

```html
<Card />
```

Rendered output:

```html
<div class="card">
  No content provided.
</div>
```

Since no slot content was passed from the parent, the fallback content is rendered instead.

---

## Multiple Slots with Fallbacks

Each `<slot>` element manages its own fallback content independently.

```html
<header>
  <slot>
    Default Header
  </slot>
</header>

<main>
  <slot>
    Default Body
  </slot>
</main>

<footer>
  <slot>
    Default Footer
  </slot>
</footer>
```

If content is not supplied for a particular slot, that slot renders its own fallback while other slots continue to render the content they receive.

---

## Best Practices

- Provide meaningful fallback content whenever a slot is optional.
- Use concise placeholders such as loading states, default messages, or instructional text.
- Keep fallback content relevant to the component's purpose.
- Avoid relying on fallback content for required information that should always be supplied by the parent component.

### Passing Arguments to Actions

Actions can be invoked with arguments directly from template event bindings.

```html
<button @click="greet(state.username, 'morning')">
  Greet
</button>
```

Arguments passed to an action are automatically exposed inside the action block through an implicit `args` array.

The values are available in the same order they are passed.

```html
<action name="greet">
  const username = args[0];
  const timeOfDay = args[1];

  console.log(`Good ${timeOfDay}, ${username}!`);
</action>
```

In this example:

- `args[0]` contains `state.username`
- `args[1]` contains `"morning"`

This makes it easy to pass dynamic values from the template without defining additional component state.

### Passing Multiple Values

Any number of arguments can be supplied.

```html
<button
  @click="updateUser(state.id, state.name, state.role)">
  Update User
</button>

<action name="updateUser">
  const id = args[0];
  const name = args[1];
  const role = args[2];

  console.log(id, name, role);
</action>
```

Arguments are always available through the `args` array in the order they were passed.

### Notes

- `args` is automatically available inside `<action>` blocks.
- Arguments are zero-indexed (`args[0]`, `args[1]`, `args[2]`, ...).
- If an argument is omitted when the action is called, its corresponding entry in `args` will be `undefined`.
