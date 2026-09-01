---
title: 'State Persistence (@avenx/persistence)'
description: 'Make Avenx bridge state survive a page reload with the official persistence plugin.'
---

State in an Avenx application lives in memory, which means a reload throws it
away. A shopping cart, a chosen theme, a half-finished form: all gone.

`@avenx/persistence` is the official plugin that fixes that. It is an
extension of Avenx state rather than a second store — your data stays in the
[Bridge](/core-concepts/bridges) that already owns it, mutations still go
through that bridge's actions, and components still read it exactly as before.
The plugin only adds two movements around it:

- **state → storage**, whenever a persisted value changes
- **storage → state**, once, when the bridge first initializes

---

## Installation

```bash
npm install @avenx/persistence
```

## Persisting a bridge

A bridge already has a hook that runs once, the first time anything reads it:
`setup()`. Call `persist()` there and return its result.

```javascript
// src/global/cart.bridge.js
import { bridge } from 'avenx-core/runtime';
import { persist } from '@avenx/persistence';

export default bridge({
  state: { items: [], coupon: null },

  get total() {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  },

  add(item) {
    this.items.push(item);
  },

  setup() {
    return persist(this, { key: 'cart' });
  },
});
```

That is the whole integration. Nothing in any component changes:

```html
<!-- src/components/cart-badge.component.js -->
import cart from '../global/cart.bridge.js';

<span class="badge">{{ cart.items.length }}</span>
```

Reload the page and the cart is still there.

:::note
**Why `setup()`?** It is the one place in an Avenx application where restoring
is legitimate. Bridge state is [read-only outside the
bridge](/core-concepts/bridges) so that every mutation has a single traceable
origin — and inside `setup()`, `this` is the bridge's own write-capable facade,
so a restore is a write from inside the bridge like any other. Avenx also runs
`setup()` exactly once, lazily, untracked and detached from any component's
scope, and calls whatever it returns on `$dispose`, which is precisely the
lifetime persistence needs.
:::

## Installing the plugin

`persist()` works on its own defaults. Installing the plugin sets
application-wide defaults for every persisted bridge and adds
`app.$persistence`:

```javascript
// src/main.app.js
import { AvenxApp } from 'avenx-core/runtime';
import { avenxPersistence } from '@avenx/persistence';

const app = new AvenxApp({ target: '#app' });

app.use(avenxPersistence, { prefix: 'shop:', version: 2 });
```

Install it before any persisted bridge is read. A bridge hydrates on first use
and reads its configuration once at that moment; a plugin installed later warns
that it arrived too late rather than applying to only half the application.

:::caution
**Toolchain.** With a bundler (Vite via `@avenx/vite`, Rollup, webpack) the
imports above are all you need. The **Avenx CLI compiler** analyses
`*.bridge.js` statically, so a bridge module may only import the Avenx runtime
and other bridges — third-party runtime packages are reached through a global
instead. Load `dist/avenx-persistence.global.js` from `index.html` and call
`AvenxPersistence.persist(this, …)`. See the plugin README for both forms.
:::

## Choosing what is persisted

Every key declared in `state` is persisted by default. Getters never are: they
are derived, and recompute from the restored state on their own.

Use `exclude` for anything that should not outlive the page:

```javascript
setup() {
  return persist(this, { key: 'cart', exclude: ['isLoading', 'draftNote'] });
}
```

Two kinds of state belong there: transient UI flags, which would come back as a
stuck spinner, and anything you would rather not leave on the device at all.
`include` does the same job from the other direction.

## Where it is stored

The `storage` option takes any object with the three methods Web Storage
already defines — `getItem`, `setItem`, `removeItem` — so `window.localStorage`
qualifies as it stands, and so does a custom backend:

```javascript
import { browserSessionStorage } from '@avenx/persistence';

setup() {
  return persist(this, { key: 'wizard', storage: browserSessionStorage() });
}
```

| Adapter | Lifetime |
|---|---|
| `browserLocalStorage()` | Survives reloads and a closed browser. **The default.** |
| `browserSessionStorage()` | Survives reloads; ends with the tab. |
| `memoryStorage()` | Ends with the page. For tests and server-side rendering. |

If the browser has storage switched off or refuses a write — private browsing,
an exhausted quota — the two browser adapters warn once and fall back to
memory. The application keeps working; it just stops surviving reloads.

## Versions and stale state

Persisted data outlives the code that wrote it: a user who last visited three
releases ago still has that release's state on their device.

Each stored value records the `version` it was written for. When that does not
match what the application expects, the data is **discarded** and the bridge
starts from its declared defaults — an old shape never reaches code that no
longer understands it. Bump `version` whenever you change the shape of
persisted state, and add `migrate` when the old data is worth keeping:

```javascript
setup() {
  return persist(this, {
    key: 'cart',
    version: 2,
    // v1 stored `products`; v2 calls the same thing `items`.
    migrate: (state, fromVersion) =>
      fromVersion === 1 ? { items: state.products ?? [] } : null,
  });
}
```

Returning `null` discards the data. If `migrate` throws, the data is discarded
and the failure is reported — a broken migration costs a stored value, never
the application.

## When persistence fails

Persistence never throws into your application. A store that is blocked, full
or holding unreadable data leaves the bridge on its declared defaults, and the
failure is reported through the Avenx logger and to an `onError` callback:

```javascript
app.use(avenxPersistence, {
  onError: ({ key, phase, message }) => {
    reportToMonitoring(`persistence ${phase} failed for ${key}: ${message}`);
  },
});
```

`phase` is one of `read`, `write`, `quota`, `serialize`, `deserialize`,
`malformed`, `version` or `migrate`, so a full quota can be handled differently
from a corrupted value. Diagnostics name the key and the phase, never the
persisted value.

Configuration mistakes are the exception — a missing `key`, an `include` naming
a state key that does not exist — and those throw where they are written.

## Reaching persistence directly

```javascript
app.$persistence.flush();       // write pending changes now
app.$persistence.clear('cart'); // discard stored data; live state is untouched
app.$persistence.clear();       // discard everything this application persists
```

`flush()` belongs in a `pagehide` handler, because the queued write runs at the
end of the tick and a page that is going away may not get one:

```javascript
window.addEventListener('pagehide', () => app.$persistence.flush());
```

`clear()` belongs in sign-out. It decides what the next reload finds, not what
the application is showing — reset the state itself through the bridge's own
actions, as usual.

## Things to keep in mind

- **Browser storage is not secure storage.** It is readable by any script on
  your origin and by anyone with access to the device, and it is not encrypted.
  Keep credentials, tokens and personal data out of it; `exclude` is how.
- **Persisted state should be JSON-representable.** `Date`, `Map`, `Set` and
  class instances are not restored as themselves unless you supply your own
  `serialize`/`deserialize` pair.
- **Persist what a reload needs, not a cache.** Web Storage quotas are a few
  megabytes per origin.
- **Restoration happens once, at startup.** The plugin does not watch storage
  for changes made in other tabs.
