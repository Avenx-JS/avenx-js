---
title: 'Component Lifecycle Hooks'
description: 'Understand Avenx-JS component lifecycle hooks, execution sequence, async behavior, and practical use cases.'
---

Avenx-JS components go through a structured series of initialization, mounting, updating, and unmounting phases during their lifecycle. Lifecycle hooks allow you to execute custom logic at specific stages of a component's lifetime — such as fetching API data when a component mounts, adjusting DOM scroll positions after updates, capturing descendant errors, or cleaning up timers when unmounting.

---

## Lifecycle Overview & Execution Flow

```mermaid
graph TD
    A["Instantiation & State Setup"] --> B["onBeforeMount()"]
    B --> C["Initial DOM Template Compilation"]
    C --> D["onMount()"]
    D --> N{"onEnter() Defined?"}
    N -- "Yes" --> O["onEnter()"]
    N -- "No" --> M{"Active Page Route?"}
    O --> M
    M -- "Yes" --> K["onActivate(params)"]
    M -- "No" --> E{"State or Props Changed?"}
    K --> E
    E -- "Yes" --> F["onBeforeUpdate()"]
    F --> G["DOM Patch Session"]
    G --> H["onUpdate()"]
    H --> E
    E -- "Component Removed" --> I["onUnmount()"]
    E -- "KeepAlive Route Change" --> J["onDeactivate()"]
    J -- "Restored Route" --> K["onActivate(params)"]
    E -- "Descendant Threw Error" --> L["onErrorCaptured(err, inst, info)"]
```

### Lifecycle Hooks Summary Matrix

| Hook Name | Execution Phase | DOM Available? | Primary Purpose |
| --- | --- | --- | --- |
| `onBeforeMount()` | Pre-Mount | ❌ No | Initialize non-reactive variables, prepare state values. |
| `onMount()` | Mounting | ✅ Yes | Fetch initial API data, measure DOM dimensions, attach listeners, start timers. |
| `onEnter()` | Post-Mount Transition | ✅ Yes | Trigger entrance animations or log page view telemetry immediately after initial render. |
| `onBeforeUpdate()` | Pre-Patch | ✅ Yes | Read DOM scroll/cursor positions before patching updates. |
| `onUpdate()` | Post-Patch | ✅ Yes | Adjust DOM scroll, re-initialize third-party DOM widgets. |
| `onBeforeLeave()` | Pre-Unmount Transition | ✅ Yes | Postpone unmounting by returning a `Promise` (e.g. exit animations or confirm dialogs). |
| `onLeave()` | Unmount Transition | ✅ Yes | Execute final transition cleanup immediately before internal teardown begins. |
| `onUnmount()` | Teardown | ✅ Yes (pre-removal) | Clear timers (`clearInterval`), remove `window` listeners, close WebSockets. |
| `onActivate(params)` | Page Route Activation | ✅ Yes | Runs on every page-route activation: after `onMount()` and optional `onEnter()` on the first activation, and when returning to a cached `keepAlive` page, with the latest route parameters. |
| `onDeactivate()` | KeepAlive Inactive | ✅ Yes | Triggered when navigating away from a cached `keepAlive` page route. |
| `onErrorCaptured()` | Error Handling | ✅ Yes | Catches unhandled errors thrown by descendant components. |

---

## Detailed Lifecycle Hooks Reference

### 1. `onBeforeMount()`

- **Trigger:** Runs right after reactive state and methods are initialized, immediately before the component's HTML template is compiled and inserted into the DOM.
- **Use Cases:** Initializing non-reactive local variables, computing pre-render data, or setting up early event listeners.
- **DOM Availability:** The component's DOM element (`this.el`) is **not** yet attached to the document.

```javascript
onBeforeMount() {
  console.log('Component is about to mount. Reactive state is ready.');
  this._startTime = Date.now();
}
```

---

### 2. `onMount()`

- **Trigger:** Runs immediately after the component element is mounted to the document DOM.
- **Use Cases:** Fetching initial API data, querying DOM element dimensions, attaching global event listeners, or starting timers.
- **DOM Availability:** Fully mounted and accessible via `this.el`.

```html
<!-- src/components/user-profile.component.js -->
<state user="null" isLoading="true" errorMessage="" />

<action name="onMount">
  this.fetchUserData();
</action>

<action name="fetchUserData">
  try {
    const response = await fetch('/api/user');
    if (!response.ok) throw new Error('Failed to load user profile');
    this.state.user = await response.json();
  } catch (err) {
    this.state.errorMessage = err.message;
  } finally {
    this.state.isLoading = false;
  }
</action>

<div class="user-profile">
  <div data-ax-show="state.isLoading">Loading profile...</div>
  <div data-ax-show="state.errorMessage" class="error">{{ state.errorMessage }}</div>

  <div data-ax-show="state.user">
    <h2>{{ state.user?.name }}</h2>
    <p>Email: {{ state.user?.email }}</p>
  </div>
</div>
```

---

### 3. `onBeforeUpdate()`

- **Trigger:** Runs right before Avenx-JS patches the DOM following a reactive `state` or `props` change.
- **Use Cases:** Reading current DOM scroll positions, input cursor positions, or element dimensions before new state changes alter the DOM structure.

```javascript
onBeforeUpdate() {
  const container = this.el.querySelector('.chat-history');
  if (container) {
    this._wasScrolledToBottom = container.scrollHeight - container.scrollTop === container.clientHeight;
  }
}
```

---

### 4. `onUpdate()`

- **Trigger:** Runs immediately after DOM diffing and patching complete.
- **Use Cases:** Re-initializing third-party JavaScript libraries (e.g. chart widgets, tooltips), adjusting scroll positions, or performing post-patch DOM measurements.

```javascript
onUpdate() {
  if (this._wasScrolledToBottom) {
    const container = this.el.querySelector('.chat-history');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }
}
```

> [!CAUTION]
> **Preventing Infinite Loops (`AVX_R11`):** Do not mutate reactive state synchronously inside `onBeforeUpdate()` or `onUpdate()`. Mutating state inside these hooks triggers another update cycle, causing an infinite loop.

---

### 5. `onUnmount()`

- **Trigger:** Runs right before the component instance is unmounted and detached from the DOM.
- **Use Cases:** Cleaning up `setInterval`/`setTimeout` timers, removing global `window` event listeners, or unsubscribing from WebSocket channels.

```html
<state count="0" />

<action name="onMount">
  // Store timer handle and window event listener
  this._timerId = setInterval(() => {
    this.state.count++;
  }, 1000);

  this.handleResize = () => console.log('Window resized:', window.innerWidth);
  window.addEventListener('resize', this.handleResize);
</action>

<action name="onUnmount">
  // Clean up all resources to prevent memory leaks
  if (this._timerId) {
    clearInterval(this._timerId);
    this._timerId = null;
  }
  if (this.handleResize) {
    window.removeEventListener('resize', this.handleResize);
  }
</action>

<div>Timer Count: {{ count }}</div>
```

---

### 6. `onActivate(params)` & `onDeactivate()`

- `onDeactivate()`: Runs when navigating away from an active `keepAlive` page instead of `onUnmount()`. The page instance then remains in the LRU cache.
- `onActivate(params)`: Runs on the first page-route activation after `onMount()` and optional `onEnter()`, and whenever the user returns to a cached `keepAlive` page. It receives the latest route parameters.

For a page configured with `keepAlive: true` and no `onEnter()` hook, the measured cumulative hook sequence is:

```text
1. Initial load (no prior navigation): onBeforeMount -> onMount -> onActivate
2. Navigate away:                    onBeforeMount -> onMount -> onActivate -> onDeactivate
3. Navigate back:                    onBeforeMount -> onMount -> onActivate -> onDeactivate -> onActivate
```

```javascript
onMount() {
  this.setupFeedSubscriptions();
}

async onActivate(params) {
  console.log(`Activated page for user ID: ${params.id}`);
  await this.refreshUserFeed(params.id);
}

onDeactivate() {
  console.log('Page deactivated and saved to keepAlive cache.');
}
```

> [!IMPORTANT]
> Both `onMount()` and `onActivate(params)` run on the initial load. Putting the same fetch in both hooks fetches the data twice on a cold entry. Perform activation data fetching in `onActivate()` alone and reserve `onMount()` for one-time setup.
>
> The runtime passes only `params` to `onActivate(params)`; it does not provide a first-activation or cached-return flag. Hook arguments therefore cannot distinguish a cached return from every other later activation. If skipping the first activation is sufficient for the route flow, track activation on the component instance:
>
> ```javascript
> async onActivate(params) {
>   const isReturn = this._hasActivated === true;
>   this._hasActivated = true;
>
>   if (isReturn) {
>     await this.refreshUserFeed(params.id);
>   }
> }
> ```

---

### 7. `onErrorCaptured(error, instance, info)`

- **Trigger:** Called when an unhandled exception is caught from a descendant child component.
- **Return Value:** Return `false` to stop error propagation up the component tree and prevent application crashes.

```javascript
onErrorCaptured(error, instance, info) {
  console.error(`Captured error from ${instance.constructor.name} during ${info}:`, error);
  this.state.hasError = true;
  this.state.errorMessage = error.message;
  return false; // Suppress further error propagation up the tree
}
```

---

### 8. `onEnter()`

`onEnter`, `onBeforeLeave`, and `onLeave` work on both pages and components. In a single-file page or component, declare them with `<action name="onEnter">`, `<action name="onBeforeLeave">`, or `<action name="onLeave">`. Return the Promise from `onBeforeLeave` to keep the current content mounted until it resolves; returning nothing allows immediate teardown.

- **Trigger:** Runs immediately after the component instance completes its initial mount and first render update (`LifecycleManager.mount()`).
- **Use Cases:** Triggering entrance CSS transitions, Web Animations API sequences, tracking page view analytics/impressions, or setting initial focus.
- **DOM Availability:** Fully mounted and accessible via `this.el`.

```javascript
onEnter() {
  console.log('Page/Component entered the active viewport.');

  // Trigger entrance animation
  const container = this.el.querySelector('.page-container');
  if (container) {
    container.classList.add('animate-fade-in');
  }

  // Track page-view impression
  if (window.analytics) {
    window.analytics.track('PageView', { page: this.$pageName || this.constructor.name });
  }
}
```

---

### 9. `onBeforeLeave()`

- **Trigger:** Runs before component unmounting begins (`LifecycleManager.unmount()`).
- **Async Promise Return Mechanism:** If `onBeforeLeave()` returns a `Promise`, `LifecycleManager` **postpones unmounting and teardown** until the returned Promise resolves (`beforeLeaveResult.then(doTeardown)`).
- **Use Cases:**
  - Running asynchronous exit animations (e.g. fade-out, slide-up) so the component remains in the DOM until the animation completes.
  - Displaying custom unsaved changes confirmation dialogs before allowing the route transition and unmounting to proceed.
- **DOM Availability:** Fully mounted and accessible during execution.

```javascript
// Asynchronous exit transition example
onBeforeLeave() {
  return new Promise((resolve) => {
    const container = this.el.querySelector('.page-content');
    if (!container) {
      return resolve();
    }

    // Play CSS exit transition before teardown
    container.classList.add('page-exit-active');
    container.addEventListener('transitionend', () => resolve(), { once: true });

    // Fallback timer to prevent stalling if transitionend does not fire
    setTimeout(resolve, 350);
  });
}
```

#### Example: Unsaved Form Confirmation with `onBeforeLeave()`

```javascript
// src/pages/edit-profile.page.js
export default class EditProfilePage extends AvenxPage {
  onBeforeLeave() {
    if (this.state.isDirty) {
      return new Promise((resolve) => {
        const leave = window.confirm('You have unsaved changes. Are you sure you want to leave?');
        if (leave) {
          resolve(); // Allow unmount and route transition to proceed
        }
      });
    }
  }
}
```

---

### 10. `onLeave()`

- **Trigger:** Executed immediately before internal teardown (`component.__performTeardown()`) begins.
- **Use Cases:** Final transition cleanup, resetting global document styles, removing temporary transition CSS classes, or completing transition telemetry.
- **DOM Availability:** Last moment where DOM nodes and component context are still intact before destruction.

```javascript
onLeave() {
  console.log('Component is leaving. Executing final transition cleanup.');
  document.body.classList.remove('lock-scroll');
}
```

---

## Async Lifecycle Hooks & Microtask Scheduling

Avenx-JS supports `async` functions within lifecycle hooks. When an async lifecycle hook executes, state mutations made before an `await` statement trigger batched DOM updates via the microtask queue.

### Handling Async Data & Unmounted State

When making asynchronous requests in `onMount()`, the HTTP request may resolve after the user has navigated away and the component has unmounted. Updating state on an unmounted component can waste memory or lead to errors.

Use an `AbortController` to cancel pending requests on unmount:

```javascript
// src/components/async-widget.component.js
export default {
  actions: {
    async onMount() {
      this._abortController = new AbortController();
      try {
        const res = await fetch('/api/data', { signal: this._abortController.signal });
        this.state.data = await res.json();
      } catch (err) {
        if (err.name !== 'AbortError') {
          this.state.error = err.message;
        }
      }
    },

    onUnmount() {
      if (this._abortController) {
        this._abortController.abort();
      }
    },
  },
};
```

---

## Defining Lifecycle Hooks in Component Files

In Avenx Single-File Components (`.component.js`), lifecycle hooks are declared using `<action>` tags with matching hook names:

```html
<state count="0" />

<action name="onMount">
  console.log('Component mounted successfully!');
</action>

<action name="onUnmount">
  console.log('Component cleanup completed.');
</action>

<div class="counter">
  <p>Count: {{ count }}</p>
</div>
```
