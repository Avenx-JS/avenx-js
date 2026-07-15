---
title: 'Actions & Event Handling'
description: 'Learn about actions, event handling, event delegation, and custom events in Avenx-JS.'
---

Avenx-JS simplifies capturing DOM events by letting you attach action handlers directly within elements using an `@` prefix.

## Binding Events

To bind an event listener, prefix the event name with `@` followed by the expression to execute:

```html
<button @click="increment()">Increment</button> <input @input="state.inputValue = event.target.value" />
```

:::note
**Context Availability:** Inside event expressions, you have access to the component's `state`, `computed` values, `methods`, registered `bridges`, and the native DOM `event` object.
:::

## Event Modifiers

Event bindings support dot-suffixed **modifiers** that adjust how the underlying DOM event is handled before your expression runs. Modifiers are appended directly to the event name, e.g. `@submit.prevent="save"` or `@keydown.enter="submit"`.
| Modifier | Applies to | Behavior |
|---|---|---|
| `.prevent` | Any event | Calls `event.preventDefault()` before invoking the handler. |
| `.stop` | Any event | Calls `event.stopPropagation()` before invoking the handler. |
| `.once` | Any event | Automatically removes the listener after it fires a single time. |
| `.enter` | Keyboard events | Only invokes the handler if the event's key is `Enter`. |
| `.escape` | Keyboard events | Only invokes the handler if the event's key is `Escape`. |
`.prevent` and `.stop` wrap the handler with the corresponding DOM method call:

```html
<form @submit.prevent="save()">
  <button type="submit">Save</button>
</form>
<div @click.stop="toggleMenu()">
  <!-- Click here won't bubble up to parent listeners -->
</div>
```

`.once` detaches the listener after the first invocation, useful for one-time actions like dismissing a banner:

```html
<button @click.once="dismissBanner()">Got it</button>
```

`.enter` and `.escape` act as key filters on keyboard events, so the handler only runs when the matching key is pressed:

```html
<input @keydown.enter="submit()" placeholder="Press Enter to submit" />
<input @keydown.escape="clearInput()" placeholder="Press Escape to clear" />
```

:::note
**Combining modifiers:** Modifiers can be chained together, for example `@keydown.enter.prevent="submit()"` filters for the Enter key and prevents the default action (such as form submission) in a single binding.
:::

## Event Delegation

Avenx does not attach event listeners to every single DOM node. Instead, the runtime's `EventBinder` uses **event delegation**. It listens for events at the component's root element and determines the correct target on invocation, saving browser memory and keeping dynamic list updates fast.

## Custom Component Events

Components can communicate with their parent containers by dispatching custom events. Avenx provides a built-in helper method, `$emit(eventName, detail)`, on the base `AvenxComponent` class to clean up component interactions.

### Emitting Events

To emit an event from a child component, call `$emit` inside actions or component methods. The second parameter is an optional payload (`detail`) passed to the parent handler:

```html
<!-- src/components/child/child.component.js -->
<state count="0" />
<action name="increment">
  state.count++;
  $emit('change', { count: state.count });
</action>

<button @click="increment()">Click me</button>
```

### Listening to Custom Events

Parent components can bind listeners to these custom events using the standard `@eventName="handler"` syntax on the child component tag. You can access the event payload via `event.detail`:

```html
<!-- src/pages/home/home.page.js -->
<state currentCount="0" />
<action name="handleChildChange">
  state.currentCount = event.detail.count;
</action>

<div class="home-page">
  <p>Child count is: {{ currentCount }}</p>
  <Child @change="handleChildChange()" />
</div>
```
