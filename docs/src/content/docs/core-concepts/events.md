---
title: 'Actions & Event Handling'
description: 'Learn about actions, event handling, event delegation, and custom events in Avenx-JS.'
---

Avenx-JS simplifies capturing DOM events by letting you attach action handlers directly within elements using an `@` prefix.

## Binding Events

To bind an event listener, prefix the event name with `@` followed by the expression to execute:

```html
<button @click="increment()">Increment</button>
<input @input="state.inputValue = event.target.value" />
```

:::note
**Context Availability:** Inside event expressions, you have access to the component's `state`, computed values, component `methods`, registered `bridges`, the native DOM `event` object, and scoped slot properties (when available).

Event handlers can also pass the `event` object to methods (for example, `@click="selectItem(item.id, event)"`). Compiled action handlers additionally expose an implicit `args` array containing the arguments supplied when the handler is invoked.
:::

## Implicit Event Handler Scope

Event handlers execute inside the component's runtime scope, so several values are automatically available without needing to import or declare them.

### Using the DOM Event

The native DOM `event` object is always available inside inline event handlers.

```html
<button @click="event.preventDefault()">
  Prevent Default
</button>

<input
  @input="state.username = event.target.value"
  placeholder="Enter your username"
/>
```

### Passing Event to Methods

The `event` object can be passed directly to component methods together with your own arguments.

```html
<button @click="selectItem(item.id, event)">
  Select Item
</button>
```

### Action Arguments

Compiled action handlers expose an implicit `args` array containing the arguments supplied when the handler is invoked. This allows reusable actions to receive values passed from event bindings.

## Event Modifiers

Event bindings support dot-suffixed **modifiers** that adjust how the underlying DOM event is handled before your expression runs. Modifiers are appended directly to the event name, e.g. `@submit.prevent="save"` or `@keydown.enter="submit"`.
| Modifier | Applies to | Behavior |
|---|---|---|
| `.prevent` | Any event | Calls `event.preventDefault()` before invoking the handler. Ignored when combined with `.passive` (browsers disallow `preventDefault` on passive listeners). |
| `.stop` | Any event | Calls `event.stopPropagation()` before invoking the handler. |
| `.self` | Any event | Only triggers the handler if `event.target === event.currentTarget` (i.e. click originates directly on the bound element itself, not on nested children). |
| `.once` | Any event | Automatically removes or deactivates the listener after it fires a single time. |
| `.passive` | Any event | Registers the listener with `{ passive: true }`, improving scroll/touch performance. |
| `.capture` | Any event | Registers the listener with `{ capture: true }` so it runs in the capture phase. |
| `.ctrl` | Mouse & Keyboard events | Only invokes handler if the `Control` key (`event.ctrlKey`) is held down. |
| `.alt` | Mouse & Keyboard events | Only invokes handler if the `Alt` / `Option` key (`event.altKey`) is held down. |
| `.shift` | Mouse & Keyboard events | Only invokes handler if the `Shift` key (`event.shiftKey`) is held down. |
| `.meta` | Mouse & Keyboard events | Only invokes handler if the `Meta` / `Command ⌘` / `Windows` key (`event.metaKey`) is held down. |
| `.cmd` | Mouse & Keyboard events | Alias for `.meta`. Only invokes handler if `event.metaKey` is `true`. |
| `.enter` | Keyboard events | Only invokes the handler if the pressed key is `Enter`. |
| `.esc` / `.escape` | Keyboard events | Only invokes the handler if the pressed key is `Escape` (`.esc` is an alias for `.escape`). |
| `.space` | Keyboard events | Only invokes the handler if the pressed key is Space (`' '`). |
| `.tab` | Keyboard events | Only invokes the handler if the pressed key is `Tab`. |
| `.delete` | Keyboard events | Only invokes the handler if the pressed key is `Delete`. |

### DOM Modifiers (`.prevent`, `.stop`, `.self`, `.once`, `.passive`, `.capture`)

`.prevent` and `.stop` wrap the handler with the corresponding DOM method call:

```html
<!-- Form submission without page reload -->
<form @submit.prevent="save()">
  <button type="submit">Save</button>
</form>

<!-- Stop event bubbling up to parent containers -->
<div @click.stop="toggleMenu()">
  <!-- Click here will not bubble up to parent listeners -->
</div>
```

`.self` ensures the handler only fires if the event target is the element itself, not a child element. Ideal for modal backdrop dismissals:

```html
<!-- Modal backdrop click dismissal: clicking .modal-dialog will NOT close the modal -->
<div class="modal-backdrop" @click.self="closeModal()">
  <div class="modal-dialog">
    <h2>Modal Header</h2>
    <p>Interacting with modal content does not trigger closeModal().</p>
    <button @click="confirmAction()">Confirm</button>
  </div>
</div>
```

`.once` executes the handler at most once:

```html
<button @click.once="claimReward()">Claim Reward (Single Click Only)</button>
```

`.passive` and `.capture` map to native `addEventListener` options:

```html
<div @scroll.passive="onScroll()">Scroll container</div>
<div @click.capture="onClickCapture()">Capture-phase click</div>
<div @touchstart.passive.capture="onTouch()">Passive capture touch</div>
```

### System Key Modifiers (`.ctrl`, `.alt`, `.shift`, `.meta`, `.cmd`)

System key modifiers filter mouse and keyboard event execution based on whether modifier keys are currently pressed:

```html
<!-- Trigger openInNewTab only when Control or Command + Click occurs -->
<a href="#/details" @click.ctrl="openInNewTab(event)" @click.cmd="openInNewTab(event)">
  View Details
</a>

<!-- Trigger submitForm on Command + Enter (macOS) or Ctrl + Enter -->
<textarea @keydown.cmd.enter="submitForm()" @keydown.ctrl.enter="submitForm()"></textarea>

<!-- Multi-system key combination: Shift + Alt + Click -->
<div @click.shift.alt="inspectElement()">Inspect Element</div>
```

:::tip
**Cross-Platform Command Key:** `.cmd` is a built-in alias for `.meta`. Use `.cmd` for clean macOS Command key syntax (e.g. `@keydown.cmd.enter`).
:::

### Key Filters (`.enter`, `.esc`, `.space`, `.tab`, `.delete`)

Key modifiers act as key filters on keyboard events, so the handler only runs when the matching key is pressed:

```html
<!-- Search input triggered on Enter key -->
<input @keyup.enter="performSearch()" placeholder="Search items and press Enter..." />
<input @keydown.esc="clearInput()" placeholder="Press Esc to clear" />
<input @keydown.space="togglePlay()" placeholder="Press Space to toggle" />
<input @keydown.tab.prevent="focusNext()" placeholder="Press Tab to navigate" />
<button @keydown.delete="removeItem()">Delete Item</button>
```

:::note
**Combining modifiers:** Modifiers can be chained together. For example, `@submit.prevent.stop="save()"` prevents standard form submission and stops bubbling, while `@keydown.cmd.enter.prevent="submit()"` verifies the Command key and Enter key are pressed and calls `event.preventDefault()` before executing `submit()`.
:::

## Scoped Slot Event Handling

Event handlers inside transcluded slot content automatically have access to scoped slot properties exposed through the `data-slot-props` attribute. This allows event handlers to work directly with slot data without requiring additional wiring.

```html
<ListContainer>
  <template data-slot-props="slotProps">
    <button @click="handleItemClick(slotProps.item)">
      Click Me
    </button>
  </template>
</ListContainer>
```

In this example, `slotProps.item` is available directly inside the event handler because the runtime resolves the scoped slot context before executing the handler.

## Event Delegation

Avenx does not attach event listeners to every single DOM node. Instead, the runtime's `EventBinder` uses **event delegation**. It listens for events at the component's root element and determines the correct target on invocation, saving browser memory and keeping dynamic list updates fast.

When rendering into a `DocumentFragment`, Avenx falls back to direct event binding because event delegation is not available in that context.

### Modifier Execution Order

When multiple modifiers are chained together, they execute in the following order:

1. `.self` (filters out events originating from child elements)
2. `.once` (checks and sets execution flags)
3. System key modifiers (`.ctrl`, `.alt`, `.shift`, `.meta`, `.cmd`)
4. Key modifiers (`.enter`, `.esc`, `.escape`, `.space`, `.tab`, `.delete`)
5. `.prevent` (`event.preventDefault()`)
6. `.stop` (`event.stopPropagation()`)
7. Execute the event handler

For example:

```html
<input @keydown.enter.prevent="submit()" />
```

The runtime first verifies the key modifier, then applies `.prevent`, and finally executes the event handler.

## Custom Component Events

Components can communicate with their parent containers by dispatching custom events. Avenx provides two event emission methods on the base `AvenxComponent` class:

- **`this.$emit(eventName, detail)`**: Built-in helper method for standard child-to-parent event emission (defaults `composed: true`).
- **`this.emit(eventName, detail, options)`**: Flexible event emission method allowing component authors to supply native [`CustomEventInit`](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/CustomEvent) options (e.g. `{ bubbles: false, cancelable: true, composed: false }`) to fine-tune event propagation.

### Emitting Events (`$emit`)

To emit a standard custom event from a child component, call `$emit` inside actions or component methods. The second parameter is an optional payload (`detail`) passed to the parent handler:

```html
<!-- src/components/child/child.component.js -->
<state count="0" />

<action name="increment">
  this.state.count++;
  this.$emit('change', { count: this.state.count });
</action>

<button @click="increment()">Click me</button>
```

### Fine-Tuning Event Propagation (`this.emit`)

When you need granular control over event behavior—such as stopping an event from bubbling up the DOM or creating non-cancelable events—use `this.emit(eventName, detail, options)` instead.

#### Options Parameter Schema (`options`)

| Option | Type | `this.emit()` Default | `this.$emit()` Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `bubbles` | `boolean` | `true` | `true` | Controls whether the event bubbles up through parent DOM elements. |
| `cancelable` | `boolean` | `true` | `true` | Controls whether listeners can cancel the event via `event.preventDefault()`. |
| `composed` | `boolean` | `false` | `true` | Controls whether the event propagates across Shadow DOM boundaries into the parent DOM. |

#### Code Examples: Non-Bubbling or Non-Cancelable Custom Events

```javascript
// 1. Emit a non-bubbling event (prevents parent containers from catching it unless bound directly)
this.emit('tab-selected', { tabId: 'dashboard' }, { bubbles: false });

// 2. Emit a non-cancelable event (event.preventDefault() is ignored)
this.emit('system-alert', { code: 'AVX_01' }, { cancelable: false });

// 3. Emit a non-bubbling, non-cancelable, non-composed internal event
this.emit('internal-scroll', { scrollTop: 250 }, {
  bubbles: false,
  cancelable: false,
  composed: false
});
```

### Listening to Custom Events (`@eventName`)

Parent components can bind listeners to these custom events using standard `@eventName="handler()"` syntax on the child component tag. Access the event payload via `event.detail`:

```html
<!-- src/pages/home/home.page.js -->
<state currentCount="0" />

<action name="handleChildChange">
  this.state.currentCount = event.detail.count;
</action>

<div class="home-page">
  <p>Child count is: {{ currentCount }}</p>
  <ChildComponent @change="handleChildChange()" />
</div>
```

---

## Global Event Bus & Cross-Component Communication

When two components do not share a direct parent-child relationship (for example, a global header component and a deeply nested shopping cart widget), passing props or bubbling events up through multiple levels becomes unwieldy.

Avenx-JS supports two primary patterns for cross-component communication across unrelated components:

:::tip
For most cross-component communication, reach for a [Bridge](/core-concepts/bridges/) rather than a hand-written bus. A bridge already carries both shared state and events, releases subscriptions when the subscribing component unmounts, and lets the compiler check event names. The hand-rolled bus below remains valid if you want full control over the mechanism.
:::

### 1. Global Event Bus Utility

You can create a standalone Event Bus module that implements `on`, `off`, and `emit` methods to publish and subscribe to application-wide events:

```javascript
// src/services/event-bus.js
class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribe to a global event.
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  /**
   * Unsubscribe from a global event.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /**
   * Emit a global event with a payload.
   * @param {string} event
   * @param {any} [data]
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        callback(data);
      }
    }
  }
}

export const eventBus = new EventBus();
```

#### Emitter Component (`ProductCard.component.js`)

```html
<state productId="42" />

<action name="addToCart">
  // Emit event to global event bus
  eventBus.emit('cart:add', { id: this.state.productId, quantity: 1 });
</action>

<button @click="addToCart()">Add to Cart</button>
```

#### Listener Component (`CartHeader.component.js`)

```javascript
import { AvenxComponent } from 'avenx-core/runtime';
import { eventBus } from '../services/event-bus.js';

export default class CartHeader extends AvenxComponent {
  constructor(bridges, props) {
    super({ cartCount: 0 }, {}, bridges, '<div>Cart ({{ state.cartCount }})</div>', {}, props);
    this.handleCartAdd = this.handleCartAdd.bind(this);
  }

  onMount() {
    // Subscribe to global event
    eventBus.on('cart:add', this.handleCartAdd);
  }

  onUnmount() {
    // Clean up listener to prevent memory leaks
    eventBus.off('cart:add', this.handleCartAdd);
  }

  handleCartAdd(payload) {
    this.state.cartCount += payload.quantity;
  }
}
```

---

### 2. Global State Bridge Pattern (`AvenxBridge`)

For state-driven cross-component communication, extending `AvenxBridge` is the recommended Avenx-JS architectural approach. Instead of managing manual event listeners, a global bridge holds shared reactive state that updates consuming components automatically:

```javascript
// src/bridges/cart.bridge.js
import { AvenxBridge } from 'avenx-core/runtime';

export default class CartBridge extends AvenxBridge {
  constructor() {
    super();
    this.items = [];
    this.count = 0;
  }

  addItem(product) {
    this.items.push(product);
    this.count = this.items.length;
  }
}
```

Components consume the bridge via `this.bridges.cart` and automatically receive reactive updates whenever `addItem()` is called from anywhere in the application.

