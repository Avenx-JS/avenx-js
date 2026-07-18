---
title: 'AvenxComponent API'
description: 'Full API reference for AvenxComponent properties, methods, and lifecycle hooks.'
---

The base class from which all standard UI components inherit. It manages reactivity, templates, lifecycle methods, and slot rendering.

## Properties

- `this.state` (Proxy): The reactive state instance for local properties. Changing state triggers updates automatically.
- `this.props` (Proxy): The reactive attributes passed by parent tags. Modifications from parents trigger updates.

## Lifecycle Hooks

Implement these functions in your component logic to execute code at specific points in the component's lifespan:

Lifecycle hooks can also be defined as class methods when creating a component by extending `AvenxComponent`.

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

When lifecycle hooks are provided through both the constructor `methods` object and class methods, the constructor `methods` object takes priority.


| Method Name        | Description                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `onMount()`        | Called immediately after the component's element is attached to the DOM. Place your initial data fetches here. |
| `onBeforeUpdate()` | Called before the component's DOM is patched during reactive state updates. Use this to read the current DOM state (e.g. scroll positions). |
| `onUpdate()`       | Called after the component has updated and patched the DOM tree. Use this for DOM measurements.                |
| `onUnmount()`      | Called before the component is detached and cleaned up. Ideal for removing timers and global listeners.        |

## DOM Events

In addition to the lifecycle hooks above, which you implement _inside_ your component class, `AvenxComponent` also dispatches native DOM [`CustomEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent)s directly on the component's root element at the same points in its lifecycle. This makes it possible to hook into a component's lifecycle from _outside_ the component — for example, when integrating a third-party library, or when a parent script doesn't have direct access to the component instance.

| Event Name      | Dispatched                                                        |
| --------------- | ----------------------------------------------------------------- |
| `avenx:mount`   | After the component has mounted and `onMount()` has run.          |
| `avenx:update`  | After the component has updated and `onUpdate()` has run.         |
| `avenx:unmount` | Before the component is detached, just before `onUnmount()` runs. |

Because these are standard DOM events, you can attach listeners to them the same way you would any other native event, using `addEventListener`:

```javascript
const btn = new ButtonComponent();
btn.mount('#button-container');

// Listen for updates from outside the component
btn.el.addEventListener('avenx:update', () => {
  console.log('ButtonComponent updated — re-initializing third-party widget');
  someThirdPartyLibrary.refresh(btn.el);
});

btn.el.addEventListener('avenx:unmount', () => {
  console.log('ButtonComponent is about to unmount — cleaning up widget');
  someThirdPartyLibrary.destroy(btn.el);
});
```

This pattern is especially useful for integrating libraries that need to re-initialize themselves whenever the DOM changes (e.g. tooltip libraries, chart libraries, or jQuery plugins) without needing to modify the component's own source code.

## Core Methods

### `mount(target)`

Mounts the component to the target DOM element or selector.

```javascript
const btn = new ButtonComponent();
btn.mount('#button-container');
```

### `setProps(newProps)`

Updates the component's reactive `props` to match `newProps`. New or changed properties are applied, and properties omitted from `newProps` are removed. These reactive changes trigger the update scheduler, which queues a DOM patch with the component's updated props.

| Param      | Type     | Description                         |
| ---------- | -------- | ----------------------------------- |
| `newProps` | `object` | The complete set of props to apply. |

```javascript
const btn = new ButtonComponent();
btn.mount('#button-container');

btn.setProps({
  label: 'Saving...',
  disabled: true,
});
```

### `unmount()`

Cleans up event listeners and empties the mounted container.

### `update()`

Forces a DOM patch and re-evaluates slots. Typically called automatically by the scheduler.
