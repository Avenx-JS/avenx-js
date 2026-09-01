---
title: 'Testing API'
description: 'API documentation for AvenxMock and AvenxSandbox, the testing utilities for isolating and testing Avenx-JS components.'
---

Avenx-JS ships with built-in testing utilities for mounting and testing components and pages in isolation, without a full app instance.

## `AvenxMock`

A static utility class providing mocking helpers for bridges, sandboxes, and event triggering.

### `AvenxMock.createMockBridge(bridgeClassOrObject, initialData)`

Creates a deep proxy around a bridge class or object, tracking method calls and state changes.

**Parameters**

- `bridgeClassOrObject` (function | object): A bridge class (constructor) or an existing bridge instance to wrap.
- `initialData` (object, optional): Initial state to assign onto the mock instance.

**Returns**

- `object`: A proxied mock bridge with special introspection properties:
  - `$calls` (`MockBridgeCall[]`) — Array containing every intercepted method call as `{ method, args }`.
- `$stateChanges` (`MockBridgeStateChange[]`) — Array containing every intercepted property mutation as `{ prop, value }`.
- `$onStateChange(callback: (prop: string, value: any) => void): () => void` — Subscribes to state changes and returns an unsubscribe function.
- `$onCall(callback: (method: string, args: any[]) => void): () => void` — Subscribes to intercepted method calls and returns an unsubscribe function.
- `$reset(): void` — Clears the recorded `$calls` and `$stateChanges` history.
- `$isMock` (`true`) — Read-only flag indicating the object is a mock bridge.
**Example**

```javascript
import { AvenxMock } from 'avenx-core/testing';
import AuthBridge from '../src/global/auth.bridge.js';

const mockAuth = AvenxMock.createMockBridge(AuthBridge, { isLoggedIn: false });

mockAuth.login('user@example.com');

console.log(mockAuth.$calls);
// [{ method: 'login', args: ['user@example.com'] }]

mockAuth.isLoggedIn = true;
console.log(mockAuth.$stateChanges);
// [{ prop: 'isLoggedIn', value: true }]
```

### `AvenxMock.createSandbox()`

Creates and returns a new `AvenxSandbox` instance for mounting components in isolation.

**Returns**

- `AvenxSandbox`: A new sandbox instance.

```javascript
import { AvenxMock } from 'avenx-core/testing';

const sandbox = AvenxMock.createSandbox();
```

### `AvenxMock.trigger(element, eventName, eventData)`

Dispatches an event on a DOM element (or a mock element), for simulating user interaction in tests.

**Parameters**

- `element` (Element): The target element to dispatch the event on.
- `eventName` (string): The event type to trigger (e.g., `'click'`, `'input'`).
- `eventData` (object, optional): Additional properties merged onto the dispatched event.

**Behavior**

- If a real `Event`/`CustomEvent` and `dispatchEvent` are available, a standard `CustomEvent` is dispatched with `eventData` set as `detail`.
- If the element exposes a custom `trigger()` method, that is called instead.
- Otherwise, falls back to manually walking up `parentNode` and invoking matching `listeners[eventName]` handlers, respecting `stopPropagation()`.

```javascript
import { AvenxMock } from 'avenx-core/testing';

AvenxMock.trigger(buttonElement, 'click');
```

### `AvenxMock.triggerEvent(target, eventName, detailOrOptions)`

Dispatches native or synthetic DOM events with full support for input values and keyboard/mouse options.

```javascript
import { AvenxMock } from 'avenx-core/testing';

AvenxMock.triggerEvent(inputElement, 'input', { value: 'test@example.com' });
```

### `AvenxMock.createMockRouter(options)`

Creates and attaches an isolated in-memory router to `window.__avenx_routers` for testing components that access route parameters or perform navigation.

```javascript
import { AvenxMock } from 'avenx-core/testing';

const router = AvenxMock.createMockRouter({
  hash: '#/users/42?tab=settings',
  page: 'UserProfile',
  params: { id: '42' },
  queryParams: { tab: 'settings' }
});
```

---

## `AvenxSandbox`

A container for registering components and bridges, then mounting them in isolation for testing.

### `register(name, compClass)`

Registers a component class under a given name in the sandbox.

**Parameters**

- `name` (string): The name to register the component under.
- `compClass` (typeof AvenxComponent): The component class.

**Returns**

- `AvenxSandbox`: The sandbox instance (chainable).

### `registerBridge(name, bridgeInstance)`

Registers a bridge instance under a given name in the sandbox.

**Parameters**

- `name` (string): The name to register the bridge under.
- `bridgeInstance` (object): The bridge instance (often created via `AvenxMock.createMockBridge`).

**Returns**

- `AvenxSandbox`: The sandbox instance (chainable).

### `setRoute(route)`

Mocks the current active router state, allowing components and pages that depend on route parameters, query strings, or the active page path to be tested in isolation without instantiating a full `AvenxRouter`.

**Parameters**

- `route` (`object`): The mocked route object. Properties include:
  - `hash` (`string`, optional): The mocked URL route hash (e.g. `'#/users/42'`).
  - `page` (`string`, optional): The name of the active page component (e.g. `'UserProfile'`).
  - `params` (`object`, optional): Key/value map of dynamic path parameters (e.g. `{ id: '42' }`).
  - `params.query` (`object`, optional): Key/value map of parsed URL query parameters (e.g. `{ tab: 'settings', filter: 'active' }`).

**Returns**

- `AvenxSandbox`: The sandbox instance (chainable).

**Example: Testing a Route-Dependent Component**

```javascript
import { AvenxMock } from 'avenx-core/testing';
import UserProfilePage from '../src/pages/user-profile.page.js';

const sandbox = AvenxMock.createSandbox();

// Mock active route with path parameter 'id' and query parameter 'tab'
sandbox.setRoute({
  hash: '#/users/42?tab=settings',
  page: 'UserProfile',
  params: {
    id: '42',
    query: {
      tab: 'settings',
      filter: 'active',
    },
  },
});

const wrapper = sandbox.mount(UserProfilePage);

console.log(wrapper.html);
// Component accesses route params and renders using mocked id '42' and tab 'settings'
```

### `waitForUpdate()`


Waits for any pending scheduled component updates to flush, before making assertions.

**Returns**

- `Promise<void>`

```javascript
await sandbox.waitForUpdate();
```

### `mount(compClass, props, container)`

Mounts a component (or page) class in isolation using the sandbox's registered bridges and components.

**Parameters**

- `compClass` (typeof AvenxComponent): The component or page class to mount.
- `props` (object, optional): Props to pass into the component.
- `container` (Element, optional): A DOM element to mount into. If omitted, a `<div>` is created automatically (using `document.createElement` when available, or an internal mock element otherwise).

**Returns**

- `object`: A mount helper with:
  - `instance` — the mounted component instance.
  - `container` — the DOM element the component was mounted into.
  - `html` — getter returning the current serialized inner HTML.
  - `update()` — manually triggers `instance.update()`.
  - `trigger(selectorOrElement, eventName, eventData)` — finds an element by CSS selector (or accepts an element directly) within the container and calls `AvenxMock.trigger()` on it.

**Example**

```javascript
import { AvenxMock } from 'avenx-core/testing';
import Counter from '../src/components/counter/counter.component.js';

const sandbox = AvenxMock.createSandbox();

const wrapper = sandbox.mount(Counter, { initialCount: 5 });

console.log(wrapper.html);
// <div class="content">...</div>

wrapper.trigger('button', 'click');
await sandbox.waitForUpdate();

console.log(wrapper.html);
// Reflects updated state after the click
```

### Full Example: Testing a Component with a Mocked Bridge

```javascript
import { AvenxMock } from 'avenx-core/testing';
import ProfileCard from '../src/components/profile-card/profile-card.component.js';
import UserBridge from '../src/global/user.bridge.js';

const sandbox = AvenxMock.createSandbox();
const mockUserBridge = AvenxMock.createMockBridge(UserBridge, { name: 'Ada' });

sandbox.registerBridge('user', mockUserBridge);

const wrapper = sandbox.mount(ProfileCard);

console.log(wrapper.html);
// Renders using the mocked 'Ada' user state

mockUserBridge.name = 'Grace';
await sandbox.waitForUpdate();

console.log(wrapper.html);
// Re-renders reflecting the updated mock state
console.log(mockUserBridge.$stateChanges);
// [{ prop: 'name', value: 'Grace' }]
```

---

## Component Unit Testing Helpers

Avenx-JS exports its testing helpers (`AvenxMock`, `AvenxSandbox`, `mountTestComponent`, `fireEvent`, `flushPromises`) from `avenx-core/testing` to simplify isolated unit testing with test runners like Vitest, Jest, Node Test Runner, or Playwright.

These live behind their own entry point so they can never reach a production bundle. Importing them from `avenx-core/runtime` does not work — the runtime entry contains only what a browser needs at runtime.

### `mountTestComponent(ComponentClass, options)`

Instantiates and mounts an Avenx component or page into a test container, pre-configuring props, reactive state overrides, transcluded slots, and mock bridges.

```typescript
function mountTestComponent<C extends AvenxComponent>(
  ComponentClass: new (...args: any[]) => C,
  options?: MountTestComponentOptions
): Promise<MountTestComponentResult<C>>
```

#### Options (`MountTestComponentOptions`)

| Option | Type | Description |
| :--- | :--- | :--- |
| `props` | `object` | Initial property values passed to the component constructor. |
| `state` / `initialState` | `object` | Reactive state overrides assigned before mounting. |
| `slots` | `string \| object \| Element` | Slot transclusion content (HTML string or slot map e.g. `{ default: '<p>...</p>', header: '...' }`). |
| `container` / `target` | `Element` | Target DOM element to mount into. Defaults to an auto-created `<div>`. |
| `bridges` | `object` | Map of mock or real bridges injected into the component. |
| `components` | `object` | Map of child components registered with the instance. |
| `route` | `object` | Mock route configuration passed to `AvenxMock.createMockRouter()`. |

#### Return Value (`MountTestComponentResult`)

| Property / Method | Type | Description |
| :--- | :--- | :--- |
| `instance` / `component` | `AvenxComponent` | The mounted component instance. |
| `element` | `Element` | The root DOM element rendered by the component. |
| `container` | `Element` | The parent container hosting the mounted component. |
| `html` | `string` | Getter returning the current serialized inner HTML markup of the container. |
| `update()` | `() => void` | Manually triggers a synchronous component update cycle. |
| `unmount()` | `() => void` | Invokes component unmounting, cleanup watchers, and lifecycle hooks (`onBeforeUnmount`, `onUnmounted`). |

---

### `fireEvent(element, eventType, detail)`

Dispatches synthetic DOM events (e.g. `click`, `input`, `change`, `submit`, `keydown`) on rendered DOM elements, applies form control values, and automatically awaits microtask scheduler completion via `nextTick()`.

```typescript
function fireEvent(
  element: Element,
  eventType: string,
  detail?: { value?: any; checked?: boolean; [key: string]: any }
): Promise<void>
```

**Parameters:**
- `element` (`Element`): The target DOM node to receive the event.
- `eventType` (`string`): The event type name (e.g. `'click'`, `'input'`, `'submit'`).
- `detail` (`object`, optional): Payload or options. If `detail.value` is provided, `element.value` is updated before firing `'input'`/`'change'`. If `detail.checked` is provided, `element.checked` is set.

**Returns:** `Promise<void>` — Resolves after the event has dispatched and all queued microtask DOM updates have flushed.

---

### Complete Component Unit Test Example

```javascript
import { describe, it, expect } from 'vitest';
import { mountTestComponent, fireEvent } from 'avenx-core/testing';
import SearchBoxComponent from '../src/components/SearchBox.component.js';

describe('SearchBoxComponent Unit Test', () => {
  it('updates query and triggers search on submit', async () => {
    // 1. Mount component with props and initial state overrides
    const wrapper = await mountTestComponent(SearchBoxComponent, {
      props: { placeholderText: 'Search articles...' },
      state: { query: 'Initial query' }
    });

    // 2. Assert initial rendered DOM
    expect(wrapper.element.querySelector('input').value).toBe('Initial query');
    expect(wrapper.element.querySelector('input').placeholder).toBe('Search articles...');

    // 3. Simulate user typing into input field with fireEvent
    const input = wrapper.element.querySelector('input');
    await fireEvent(input, 'input', { value: 'Avenx Reactivity' });

    // 4. Assert reactive state updated
    expect(wrapper.instance.state.query).toBe('Avenx Reactivity');

    // 5. Simulate form submission
    const form = wrapper.element.querySelector('form');
    await fireEvent(form, 'submit');

    // 6. Assert rendered output via wrapper.html
    expect(wrapper.html).toContain('Results for: Avenx Reactivity');

    // 7. Clean up component instance
    wrapper.unmount();
  });
});
```

---

## Headless Router Testing & SSR (`MemoryNavigationDelegate`)

To test router transitions, guards, resolvers, and page title updates in Jest, Vitest, or Node.js without a browser DOM environment, use `MemoryNavigationDelegate` (`lib/core/runtime/navigation/MemoryNavigationDelegate.js`).

### Unit Testing Router Transitions and Guards

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import { MemoryNavigationDelegate } from 'avenx-core/runtime/navigation';
import AuthGuard from '../src/guards/auth.guard.js';

describe('Router Headless Tests', () => {
  let delegate;
  let router;

  beforeEach(() => {
    // 1. Create an in-memory navigation delegate starting at '#/'
    delegate = new MemoryNavigationDelegate('#/');

    // 2. Initialize router with memory delegate
    router = AvenxApp.initRouter(
      {
        '#/': { page: 'Home', title: 'Home Page' },
        '#/dashboard': { page: 'Dashboard', title: 'Dashboard', guards: [AuthGuard] },
        '#/login': { page: 'Login', title: 'Login Page' },
      },
      {
        navigationDelegate: delegate,
        titlePrefix: 'App | ',
      }
    );
  });

  afterEach(() => {
    // 3. Clean up router and delegate listeners
    if (router && typeof router.destroy === 'function') {
      router.destroy();
    }
    if (delegate) {
      delegate.destroy();
    }
  });

  test('navigates in memory and updates title', async () => {
    expect(delegate.getHash()).toBe('#/');
    expect(delegate.title).toBe('App | Home Page');

    // Programmatically navigate
    await router.navigate('#/dashboard');

    // Unauthenticated user redirected to #/login by AuthGuard
    expect(delegate.getHash()).toBe('#/login');
    expect(delegate.title).toBe('App | Login Page');
  });
});
```

---

## Advanced Component Testing Patterns

The recipes below build on `AvenxMock.createSandbox()` for common real-world scenarios: slots, `$emit`, async updates, and lifecycle ordering.

### Testing Slot Transclusion

Mount a host that projects markup into a child `<slot>`, then assert the projected content appears in the rendered HTML.

```javascript
import { AvenxComponent } from 'avenx-core/runtime';
import { AvenxMock } from 'avenx-core/testing';

class Card extends AvenxComponent {
  static template = `
    <div class="card">
      <header class="card-header"><slot name="header"></slot></header>
      <div class="card-body"><slot></slot></div>
    </div>
  `;
}

class CardHost extends AvenxComponent {
  static template = `
    <ax-card>
      <template name="header"><h2>Profile</h2></template>
      <p class="bio">Ada Lovelace</p>
    </ax-card>
  `;
}

const sandbox = AvenxMock.createSandbox();
sandbox.register('ax-card', Card);

const wrapper = sandbox.mount(CardHost);

expect(wrapper.html).toContain('Profile');
expect(wrapper.html).toContain('Ada Lovelace');
expect(wrapper.html).toContain('class="card-body"');
```

:::tip
If your component uses default slot fallback markup, mount it **without** projected children and assert that the fallback text is present in `wrapper.html`.
:::

### Asserting `$emit` Custom Events

`$emit(eventName, detail)` dispatches a `CustomEvent` on the component root. Listen on `wrapper.container` (or the instance root) before triggering the action that emits.

```javascript
import { AvenxComponent } from 'avenx-core/runtime';
import { AvenxMock } from 'avenx-core/testing';

class CounterButton extends AvenxComponent {
  constructor() {
    super();
    this.state = { count: 0 };
  }

  static template = `
    <button class="inc" @click="increment()">+</button>
  `;

  increment() {
    this.state.count += 1;
    this.$emit('change', { count: this.state.count });
  }
}

const sandbox = AvenxMock.createSandbox();
const wrapper = sandbox.mount(CounterButton);

const emissions = [];
wrapper.container.addEventListener('change', (event) => {
  emissions.push(event.detail);
});

wrapper.trigger('.inc', 'click');
await sandbox.waitForUpdate();

expect(emissions).toEqual([{ count: 1 }]);
expect(wrapper.instance.state.count).toBe(1);
```

### Asynchronous State Updates & Microtask Batching

Reactive mutations are scheduled asynchronously. Always `await sandbox.waitForUpdate()` (or chain mutations then wait once) before asserting DOM output so the microtask flush completes.

```javascript
import { AvenxComponent } from 'avenx-core/runtime';
import { AvenxMock } from 'avenx-core/testing';

class StatusBadge extends AvenxComponent {
  constructor() {
    super();
    this.state = { label: 'idle' };
  }

  static template = `<span class="badge">{{ state.label }}</span>`;
}

const sandbox = AvenxMock.createSandbox();
const wrapper = sandbox.mount(StatusBadge);

// Multiple mutations in the same turn batch into one render pass
wrapper.instance.state.label = 'loading';
wrapper.instance.state.label = 'ready';

await sandbox.waitForUpdate();

expect(wrapper.html).toContain('ready');
expect(wrapper.html).not.toContain('loading');
```

When driving updates from a mocked bridge, mutate the bridge then wait once:

```javascript
mockAuth.isLoggedIn = true;
mockAuth.user.name = 'Ada';
await sandbox.waitForUpdate();
```

### Lifecycle Hook Execution Order

Record hook invocations on the instance to verify mount → update → unmount ordering during a test.

```javascript
import { AvenxComponent } from 'avenx-core/runtime';
import { AvenxMock } from 'avenx-core/testing';

class LifecycleProbe extends AvenxComponent {
  constructor() {
    super();
    this.state = { ticks: 0 };
    this.hookLog = [];
  }

  onMount() {
    this.hookLog.push('onMount');
  }

  onBeforeUpdate() {
    this.hookLog.push('onBeforeUpdate');
  }

  onUpdate() {
    this.hookLog.push('onUpdate');
  }

  onUnmount() {
    this.hookLog.push('onUnmount');
  }

  static template = `<div>{{ state.ticks }}</div>`;
}

const sandbox = AvenxMock.createSandbox();
const wrapper = sandbox.mount(LifecycleProbe);

expect(wrapper.instance.hookLog).toEqual(['onMount']);

wrapper.instance.state.ticks = 1;
await sandbox.waitForUpdate();

expect(wrapper.instance.hookLog).toEqual(['onMount', 'onBeforeUpdate', 'onUpdate']);

wrapper.instance.unmount();
expect(wrapper.instance.hookLog).toEqual([
  'onMount',
  'onBeforeUpdate',
  'onUpdate',
  'onUnmount',
]);
```

:::note
Exact hook names follow the component lifecycle documented in the [AvenxComponent API reference](/api-reference/component/). Prefer asserting relative order (mount before update, update before unmount) rather than absolute call counts when other framework hooks also run.
:::


