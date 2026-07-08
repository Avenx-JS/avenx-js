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

## Event Delegation

Avenx does not attach event listeners to every single DOM node. Instead, the runtime's `EventBinder` uses **event delegation**. It listens for events at the component's root element and determines the correct target on invocation, saving browser memory and keeping dynamic list updates fast.

## Custom Component Events

Components can communicate with their parent containers by dispatching native or custom events. The container can capture them using standard listeners or lifecycle bindings.
