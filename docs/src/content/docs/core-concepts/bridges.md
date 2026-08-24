---
title: 'Bridges'
description: 'Share reactive state and events across components with Avenx Bridges.'
---

A **Bridge** is a small module that holds state several components need, plus the actions that change it. You create one with `bridge()`, and you use it by importing it.

```javascript
// src/global/counter.bridge.js
import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { count: 0 },
  increment() {
    this.count++;
  },
});
```

```html
<!-- src/components/counter.component.js -->
import counter from '../global/counter.bridge.js';

<div>
  <p>Count: {{ counter.count }}</p>
  <button @click="counter.increment()">+1</button>
</div>
```

That is the whole idea. Every component that imports `counter` reads the same value, and every one of them re-renders when `count` changes.

## What problem do Bridges solve?

Two components that need the same data usually have no good way to share it. Passing props works when one is the other's parent, but a header and a checkout panel on opposite sides of the page have no common ancestor to route data through — so the state gets pushed up to a shared parent that has no use for it, and threaded back down through components that only pass it along.

A Bridge takes the state out of the tree. It lives in its own module, and any component that wants it says so with an import.

The import matters. Because a Bridge is reached through an import rather than a global name, the Avenx compiler can see exactly which components use which bridges. It uses that to leave unused bridges out of your bundle, and to catch mistakes — a mistyped property, a subscription to an event that is never emitted — while you are building rather than at runtime.

## When should you use one?

Reach for a Bridge when **state outlives or spans components**:

- session and the current user
- a shopping cart, or anything a header badge and a detail page both display
- theme, locale and other app-wide preferences
- a connection to something outside Avenx — a WebSocket, `localStorage`, a media query

Do **not** reach for a Bridge when:

- the state belongs to one component. Use `<state>`.
- a parent already owns the data and the child only displays it. Use props.
- only a subtree needs it and the shape is naturally hierarchical. Use [Provide & Inject](/core-concepts/provide-inject).
- the value is derived from other values in the same component. Use `<computed>`.

A Bridge is global by nature. Keeping something local is almost always the better default, so use a Bridge when sharing is the actual requirement, not just in case.

## Creating a Bridge

Generate one:

```bash
npx avenx g bridge auth
```

That writes `src/global/auth.bridge.js`. You can also create bridge files by hand, in either `src/bridges/` or `src/global/` — the compiler scans both. The bridge's name is its file name in camelCase, so `user-prefs.bridge.js` becomes the bridge `userPrefs`. Names must be unique across the project.

A definition has three kinds of member:

```javascript
// src/global/auth.bridge.js
import { bridge } from 'avenx-core/runtime';

export default bridge({
  // 1. state — the shared data
  state: {
    user: null,
    status: 'anonymous',
  },

  // 2. getters — values derived from state
  get isLoggedIn() {
    return this.status === 'authenticated';
  },

  get displayName() {
    return this.user ? this.user.name : 'Guest';
  },

  // 3. actions — the only place state changes
  login(user) {
    this.user = user;
    this.status = 'authenticated';
  },

  logout() {
    this.user = null;
    this.status = 'anonymous';
  },
});
```

Inside the bridge, `this` gives you everything: read state, write state, call other actions, read getters.

There is nothing else to configure. A bridge has no name argument, no options object and no registration step — the module *is* the bridge.

:::note
Data belongs in `state`. A top-level value that is not a function or a getter is refused at startup with a message telling you to move it into `state`. This keeps the distinction between data, derived values and behaviour visible at a glance.
:::

Everything is optional. A bridge that only holds data needs no actions; a bridge that only carries events needs no state:

```javascript
export default bridge({ state: { theme: 'light' } });
```

## Consuming a Bridge

Import it and use it. There is no hook, no `useBridge()`, no provider to wrap anything in:

```javascript
import auth from '../global/auth.bridge.js';

auth.displayName;              // read a derived value
auth.user;                     // read state
auth.login({ name: 'Ada' });   // call an action
```

Every importer gets the same instance. You can name the import whatever reads best in that file:

```javascript
import session from '../global/auth.bridge.js';

session.displayName;
```

### State is read-only outside the bridge

Assigning to bridge state from a component is refused:

```javascript
auth.user = { name: 'Ada' };   // ❌ AVX_R22
auth.login({ name: 'Ada' });   // ✅
```

This is deliberate. When every mutation goes through an action, "who changed this?" has exactly one answer, and you can find it by reading the bridge file. It also means the compiler can flag the mistake before you run the app.

## Using Bridges in templates

Import the bridge at the top of the component file and read it in the template. Avenx tracks which properties each component actually reads, so a change re-renders only the components that depend on it:

```html
<!-- src/components/navbar.component.js -->
import auth from '../global/auth.bridge.js';

<nav>
  <span>{{ auth.displayName }}</span>

  <div data-ax-show="auth.isLoggedIn">
    <button @click="auth.logout()">Log out</button>
  </div>
</nav>
```

Optional chaining works as you would expect:

```html
<p>{{ auth.user?.email }}</p>
```

You never subscribe or unsubscribe for this. Reading `auth.displayName` in a template is the subscription, and it ends when the component unmounts.

Two components communicate by importing the same bridge — neither needs to know the other exists:

```html
<!-- product-card.component.js -->
import cart from '../global/cart.bridge.js';

<button @click="cart.add(props.product)">Add to cart</button>
```

```html
<!-- cart-badge.component.js — anywhere in the tree -->
import cart from '../global/cart.bridge.js';

<span class="badge">{{ cart.count }}</span>
```

## Actions

Actions are the methods of your definition. Inside them, `this` can read and write state.

```javascript
export default bridge({
  state: { items: [] },

  get count() {
    return this.items.length;
  },

  add(product) {
    this.items = [...this.items, product];
  },

  remove(id) {
    this.items = this.items.filter((item) => item.id !== id);
  },
});
```

Actions can be `async`, and write access survives the `await`:

```javascript
export default bridge({
  state: { user: null, status: 'idle', error: null },

  async load(id) {
    this.status = 'loading';
    try {
      this.user = await fetch(`/api/users/${id}`).then((res) => res.json());
      this.status = 'ready';
    } catch (err) {
      this.error = err.message;
      this.status = 'error';
    }
  },
});
```

An action that returns a value returns it to the caller, and an action that throws throws to the caller — so a component can `await` a bridge action and handle failure where it happened:

```html
<action name="submit">
  try {
    await auth.login(state.form);
  } catch (err) {
    state.error = err.message;
  }
</action>
```

Two rules keep actions predictable: **only actions write state**, and **an action never re-renders anything directly** — it changes state, and Avenx works out what that affects.

## Events

State answers "what is true now". Events answer "something just happened" — a toast to show, an animation to run, a scroll position to reset. Emit them from an action with `this.emit()`:

```javascript
export default bridge({
  state: { items: [] },

  add(product) {
    this.items = [...this.items, product];
    this.emit('added', product);
  },

  clear() {
    this.items = [];
    this.emit('cleared');
  },
});
```

There is no list of events to declare. Avenx reads the `emit()` calls in your bridge and knows the event names from them.

Subscribe with `on()`, usually in `onMount`:

```html
<!-- toast.component.js -->
import cart from '../global/cart.bridge.js';

<state message="" />

<action name="onMount">
  cart.on('added', (product) => {
    state.message = `${product.name} added to cart`;
  });
</action>

<div class="toast" data-ax-show="message">{{ message }}</div>
```

The handler receives whatever the action passed to `emit()`. Listeners run in the order they subscribed, and one that throws is logged without stopping the others.

Only the bridge itself can emit. `cart.emit(...)` from a component does not exist — events come from the bridge that owns the state, so an event always means what the bridge says it means.

:::tip
Prefer state when a component only needs to *display* something, and an event when it needs to *do* something once. A badge showing `cart.count` needs no event; a toast that appears for two seconds does.
:::

## Lifecycle and cleanup

### Subscriptions clean themselves up

A subscription made while a component is running — in a lifecycle hook or an event handler — belongs to that component and is released when it unmounts. You do not write teardown code for it, and mounting the same component repeatedly does not stack up listeners.

`on()` also returns an unsubscribe function, for when you want to stop listening before unmount:

```javascript
const stop = cart.on('added', handleAdded);
stop();  // safe to call more than once
```

There is no `off()`. The returned function is the only handle you need.

### Connecting to something outside Avenx

A bridge that owns an external resource — a socket, a timer, a `window` listener — sets it up in `setup()` and returns a function that tears it down:

```javascript
// src/global/presence.bridge.js
import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { online: [], connected: false },

  setup() {
    const socket = new WebSocket('wss://example.com/presence');

    socket.onopen = () => { this.connected = true; };
    socket.onmessage = (event) => {
      this.online = JSON.parse(event.data);
      this.emit('changed', this.online);
    };

    return () => socket.close();
  },
});
```

`setup()` runs **once, on first use** — the first read, action call or subscription. A bridge nobody touches never runs its setup, so the cost of a bridge you are not using is zero. If `setup()` throws, the failure is reported against the bridge by name at the point of use rather than crashing the app at boot.

`$dispose()` runs the cleanup, drops every listener and restores the initial state. You rarely need it in application code; it exists for tests and for hot reloads, and the bridge is usable again afterwards:

```javascript
afterEach(() => {
  auth.$dispose();
});
```

### Bridges outlive components

A bridge is created when its module loads and lives for as long as the page does. Unmounting a component that used it does not reset it — that is the point. If a bridge holds data that should not survive a session, clear it explicitly:

```javascript
logout() {
  this.user = null;
  this.token = null;
}
```

## TypeScript

`bridge()` infers everything from your definition. No type parameters, no interfaces to keep in sync:

```typescript
import { bridge } from 'avenx-core/runtime';

interface User {
  name: string;
  role: 'member' | 'admin';
}

export default bridge({
  state: {
    user: null as User | null,
    status: 'anonymous' as 'anonymous' | 'authenticated',
  },

  get isLoggedIn(): boolean {
    return this.status === 'authenticated';   // `this` is typed
  },

  login(user: User) {
    this.user = user;                          // writable through `this`
    this.status = 'authenticated';
    this.emit('login', user);
  },
});
```

Consumers get the mirror image of the runtime rules:

```typescript
import auth from '../global/auth.bridge.js';

auth.user;                        // User | null
auth.isLoggedIn;                  // boolean
auth.login({ name: 'Ada', role: 'admin' });

auth.user = null;                 // ✗ read-only property
auth.isLoggedIn = true;           // ✗ read-only property
auth.emit('login', user);         // ✗ emit does not exist on a consumer
auth.login({ name: 'Ada' });      // ✗ missing 'role'
```

Annotate an event payload where you subscribe:

```typescript
auth.on<User>('login', (user) => {
  console.log(user.name);
});
```

Event *names* are checked by the compiler rather than by TypeScript: subscribing to an event your bridge never emits is a build warning that names the emitted events and suggests the closest match.

## What the compiler does with your bridges

You do not configure any of this — it follows from importing bridges instead of reaching for globals.

**Unused bridges are dropped.** A bridge that no component, page or other bridge imports is left out of the bundle entirely.

**Mistakes are caught at build time.** These used to be `undefined` at runtime:

```
AVX_W37  Bridge "auth" has no member "displaName". Did you mean "displayName"?
AVX_W38  Bridge "auth" never emits the event "logn". Did you mean "login"?
AVX_C07  Bridge import "../global/ghost.bridge.js" could not be resolved
AVX_C08  Two bridge files resolve to the same bridge name
AVX_C10  An isolated component may not import a bridge
```

**Only what you imported is in scope.** A component sees the bridges it imported, under the names it chose, and nothing else. A bridge can never silently shadow one of your own `<state>` keys or actions.

### A limit worth knowing

A bridge module may import the Avenx runtime and other `*.bridge.js` modules. Any other import fails the build with `AVX_C09` — Avenx compiles bridges into a single bundle without a general-purpose bundler, so it cannot inline arbitrary modules.

Everything else in the file is yours. Constants, helper functions and JSDoc above `export default` all work normally:

```javascript
import { bridge } from 'avenx-core/runtime';

const GUEST = { name: 'Guest', role: 'visitor' };

function normalize(raw) {
  return { ...GUEST, ...raw };
}

export default bridge({
  state: { user: GUEST },
  setUser(raw) {
    this.user = normalize(raw);
  },
});
```

To share logic between bridges, put it in a bridge and import that. Bridges initialise in dependency order, so the imports must form a chain rather than a loop: two bridges that import each other fail the build with `AVX_C11`. Move whatever they share into a third bridge that both import.

## Best practices

**Keep bridges small and about one thing.** `auth`, `cart` and `theme` beat one `store`. Small bridges mean fewer components re-render on any given change, and each file stays readable.

**Name the action after the intent.** `cart.add(product)` says more than `cart.setItems([...])`, and it puts the logic where every caller shares it.

**Keep hot paths out of bridges.** Pointer moves, scroll offsets and animation frames belong in component `<state>`. A bridge write may wake several components; a local write wakes one.

**Reassign arrays and objects rather than mutating in place.** `this.items = [...this.items, item]` is the reliable form, and it makes the change obvious to anyone reading the action.

**Keep getters cheap.** They re-run whenever a reader re-renders. If a derivation is expensive, compute it in an action and store the result in state.

**Do not put a component's private state in a bridge.** If only one component reads it, it is not shared state — even if a bridge would be convenient.

**Dispose between tests.** `bridge.$dispose()` in `afterEach` gives every test a clean slate.

## Migrating from class bridges

Bridges built on `AvenxBridge` still work, are still registered ambiently under their `PascalCase` name, and still need no changes to keep running. They are deprecated: they cannot be typed, cannot be tree-shaken, and give the compiler nothing to check, because a template referencing `AuthBridge` never says where it came from.

The conversion is mechanical:

```javascript
// Before
import { AvenxBridge } from 'avenx-core/runtime';

export default class AuthBridge extends AvenxBridge {
  constructor() {
    super();
    this.isLoggedIn = false;
    this.user = { name: 'Guest' };
  }

  logout() {
    this.isLoggedIn = false;
    this.user = { name: 'Guest' };
  }
}
```

```javascript
// After
import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: {
    isLoggedIn: false,
    user: { name: 'Guest' },
  },

  logout() {
    this.isLoggedIn = false;
    this.user = { name: 'Guest' };
  },
});
```

Then, in each component that used it, replace the ambient `AuthBridge` with an import:

```html
import auth from '../global/auth.bridge.js';

<p>{{ auth.user.name }}</p>
```

Two things change in behaviour. State becomes read-only outside the bridge, so any component that assigned to it directly needs an action instead. And the bridge is only in scope where it is imported, so a component that used it without saying so has to say so.

## API reference

| Member | Description |
| :--- | :--- |
| `bridge(definition)` | Creates a bridge. `definition` may contain `state`, `setup`, getters and actions. |
| `definition.state` | Plain object of initial shared state. Reactive; read-only for consumers. |
| `definition.setup()` | Runs once on first use. May return a cleanup function. |
| `this` (inside the bridge) | Reads and writes state, calls actions, reads getters, and exposes `emit`. |
| `this.emit(event, payload?)` | Broadcasts an event to subscribers. |
| `bridge.on(event, handler)` | Subscribes. Returns an unsubscribe function; auto-released with the component that subscribed. |
| `bridge.$dispose()` | Runs cleanup, drops listeners, restores initial state. The bridge stays usable. |
| `bridge.$name` | The bridge's name, used in diagnostics. |
