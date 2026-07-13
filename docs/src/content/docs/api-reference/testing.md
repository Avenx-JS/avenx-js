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
  - `$calls` — array of `{ method, args }` for every method call made on the mock.
  - `$stateChanges` — array of `{ prop, value }` for every property set on the mock.
  - `$onStateChange(callback)` — subscribes to state changes; returns an unsubscribe function.
  - `$onCall(callback)` — subscribes to method calls; returns an unsubscribe function.
  - `$reset()` — clears the recorded `$calls` and `$stateChanges` history.
  - `$isMock` — always `true`, useful for identifying mocked instances.

**Example**

```javascript
import { AvenxMock } from 'avenx-core/runtime';
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
import { AvenxMock } from 'avenx-core/runtime';

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
import { AvenxMock } from 'avenx-core/runtime';

AvenxMock.trigger(buttonElement, 'click');
```

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

Mocks the current router state, useful for testing route-dependent components without a real router.

**Parameters**

- `route` (object): The route object to set as the current route.

**Returns**

- `AvenxSandbox`: The sandbox instance (chainable).

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
import { AvenxMock } from 'avenx-core/runtime';
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
import { AvenxMock } from 'avenx-core/runtime';
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
