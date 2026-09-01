# @avenx/persistence

Official state persistence plugin for [Avenx.js](https://github.com/avenx-js/avenx-js).

`@avenx/persistence` lets Avenx application state survive a page reload — and, depending on the backend, a closed browser — without any component or bridge writing serialization code of its own.

It is an extension of Avenx state, not a second store. Your data stays in the bridge that already owns it, changes still go through that bridge's actions, and components still read it exactly as before. The plugin only adds two movements around it: **state → storage** on change, and **storage → state** once, at startup.

---

## Features

- **One line, no plumbing**: call `persist()` from a bridge's `setup()` hook and the bridge is persisted. Nothing else in the application changes.
- **Driven by Avenx reactivity**: changes are detected with the same `watchEffect` machinery a template uses. No polling, no manual subscriptions, no duplicated state.
- **Economical writes**: a burst of mutations in one tick becomes a single write, and a write that would reproduce what storage already holds is skipped.
- **No feedback loops by construction**: restoration completes before the change watcher exists, so restored values are never written straight back.
- **Pluggable storage**: the adapter interface is the one the platform already defines, so `localStorage`, `sessionStorage` and any custom backend are interchangeable.
- **Fails quietly, reports loudly**: a blocked, broken or full store never breaks the application, and every failure reaches the Avenx logger and an optional `onError` callback with a phase precise enough to act on.
- **Versioned**: persisted state carries the schema version it was written for, so data from an earlier release is discarded or migrated rather than silently restored into an application that no longer understands it.

---

## Installation & Setup

### 1. Install the package

```bash
npm install @avenx/persistence
```

### 2. Persist a bridge

A bridge already has a hook that runs once, the first time anything reads it:
`setup()`. Call `persist()` there and return its result.

```javascript
// src/global/cart.bridge.js
import { bridge } from 'avenx-core/runtime';
import { persist } from '@avenx/persistence';

export default bridge({
  state: { items: [], coupon: null, draft: '' },

  get total() {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  },

  add(item) {
    this.items.push(item);
    this.emit('added', item);
  },

  setup() {
    return persist(this, { key: 'cart', exclude: ['draft'] });
  },
});
```

That is the whole integration. Components import the bridge and read it as
usual — nothing about them changes:

```html
<!-- src/components/cart-summary/cart-summary.component.js -->
import cart from '../../global/cart.bridge.js';

<div>
  <p>{{ cart.items.length }} items — {{ cart.total }}</p>
  <button @click="cart.add({ price: 9 })">Add</button>
</div>
```

Reload the page and the cart is still there.

**Why `setup()` and not a wrapper around the definition?** Because it is the
one place in an Avenx application where restoring is legitimate. Bridge state
is read-only from the outside by design, so that every mutation has a single
traceable origin; inside `setup()`, `this` is the bridge's own write-capable
facade, so a restore is a write from inside the bridge like any other. Avenx
also runs `setup()` exactly once, lazily, untracked and detached from any
component's disposal scope, and calls whatever it returns on `$dispose` — the
exact lifetime persistence needs. And the bridge module stays a literal
`bridge({ ... })`, which is what the Avenx compiler reads to build the Atlas,
validate templates and tree-shake unused bridges.

### 3. Install the plugin (optional, recommended)

`persist()` works on its own defaults without the plugin. Installing it sets
application-wide defaults for every persisted bridge and provides
`app.$persistence`:

```javascript
// src/main.app.js
import { AvenxApp } from 'avenx-core/runtime';
import { avenxPersistence } from '@avenx/persistence';

const app = new AvenxApp({ target: '#app' });

app.use(avenxPersistence, {
  prefix: 'shop:',
  version: 3,
});
```

Install it **before** any persisted bridge is read. A bridge hydrates the first
time something touches it, and reads its configuration once at that moment; a
plugin installed later warns that it arrived too late rather than applying to
half the application.

### 4. Toolchain note

With a bundler — Vite (via `@avenx/vite`), Rollup, webpack — the imports above
are all you need.

The **Avenx CLI compiler** is different: it compiles an application into one
self-contained bundle and analyses `*.bridge.js` statically, so a bridge module
may only import the Avenx runtime and other bridges. Third-party runtime
packages are reached through a global instead. Load the standalone build in
`index.html`:

```html
<script src="node_modules/@avenx/persistence/dist/avenx-persistence.global.js"></script>
<script src="dist/bundle.js"></script>
```

and drop the imports:

```javascript
setup() {
  return AvenxPersistence.persist(this, { key: 'cart', exclude: ['draft'] });
}
```

```javascript
app.use(AvenxPersistence.avenxPersistence, { prefix: 'shop:' });
```

Load order does not matter: the standalone build resolves the runtime the first
time a bridge asks to be persisted, which is after the application bundle has
installed it. The [example application](./example) is built this way.

---

## Configuration

Both `persist()` and `app.use(avenxPersistence, …)` accept the same settings. Anything set on `persist()` wins for that bridge; anything set at install time is the default for every bridge; anything set in neither falls back to the built-in default.

| Option        | Type             | Default                 | Where            | Description                                                                                     |
| ------------- | ---------------- | ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `key`         | `string`         | —                       | `persist()` only | **Required.** Names this bridge's slot in storage. Must be unique in the application.           |
| `include`     | `string[]`       | all state keys          | `persist()` only | Persist only these state keys.                                                                  |
| `exclude`     | `string[]`       | —                       | `persist()` only | Persist every state key except these. Mutually exclusive with `include`.                        |
| `migrate`     | `Function`       | —                       | `persist()` only | Upgrades state written for an earlier `version`. See [Versioning](#versioning-and-stale-state). |
| `storage`     | `StorageAdapter` | `browserLocalStorage()` | both             | Where state is written. See [Storage adapters](#storage-adapters).                              |
| `prefix`      | `string`         | `'avenx:'`              | both             | Prepended to `key` to form the storage key.                                                     |
| `version`     | `number`         | `1`                     | both             | Schema version of the persisted state.                                                          |
| `restore`     | `boolean`        | `true`                  | both             | Set `false` to keep saving but never restore.                                                   |
| `serialize`   | `Function`       | `JSON.stringify`        | both             | Turns the envelope into a string.                                                               |
| `deserialize` | `Function`       | `JSON.parse`            | both             | Turns a stored string back into an envelope.                                                    |
| `onError`     | `Function`       | —                       | both             | Called on any persistence failure. See [Error behaviour](#error-behaviour).                     |

Every option is validated where it is written, so a typo is an error at startup rather than a value that quietly stops being persisted.

---

## Choosing what is persisted

By default every key declared in the bridge's `state` is persisted. Getters never are — they are derived, and recompute from the restored state on their own.

Use `include` to persist a subset, or `exclude` to keep something out:

```javascript
export default bridge({
  state: {
    items: [], // worth keeping
    draftNote: '', // worth keeping
    isLoading: false, // transient: it would be restored as a stuck spinner
  },
  setup() {
    return persist(this, { key: 'cart', exclude: ['isLoading'] });
  },
});
```

`exclude` is the right tool for two kinds of state: transient UI flags that would be meaningless after a reload, and anything you would rather not leave on the device at all (see [Security](#security-and-data-handling)).

Names in `include` and `exclude` must match declared state keys. A name that matches nothing is treated as a mistake — most often a rename applied in only one of the two places — and reported immediately.

---

## Storage adapters

A storage adapter is any object with the three methods Web Storage already defines:

```javascript
{
  getItem(key); // => string | null
  setItem(key, value); // value is always a string
  removeItem(key);
}
```

`window.localStorage` and `window.sessionStorage` therefore satisfy the interface as they stand. Three resolvers ship with the plugin:

```javascript
import { browserLocalStorage, browserSessionStorage, memoryStorage } from '@avenx/persistence';
```

| Adapter                   | Lifetime                                                       |
| ------------------------- | -------------------------------------------------------------- |
| `browserLocalStorage()`   | Survives reloads and a closed browser. **The default.**        |
| `browserSessionStorage()` | Survives reloads; ends with the tab.                           |
| `memoryStorage()`         | Ends with the page. Useful in tests and server-side rendering. |

Both browser resolvers probe the area with a test write. If it is missing, blocked, or refuses (private browsing, an exhausted quota), they warn once and return an in-memory adapter instead — the application keeps working, it just stops surviving reloads.

A custom backend only needs those three methods:

```javascript
const cookieStorage = {
  getItem: (key) => readCookie(key),
  setItem: (key, value) => writeCookie(key, value, { maxAge: 604800 }),
  removeItem: (key) => deleteCookie(key),
};

setup() {
  return persist(this, { key: 'prefs', storage: cookieStorage });
}
```

Adapters are synchronous, because saving has to be able to run in a `pagehide` handler. A backend that is asynchronous underneath — IndexedDB, a server — is written as an adapter that keeps a synchronous mirror and flushes in the background.

---

## Serialization

State is not stored bare. It is stored in an envelope:

```json
{ "avenx": 1, "version": 3, "state": { "items": [], "coupon": null } }
```

`avenx` identifies the envelope format, so a key holding something else — another library's data, a hand-edited value — is recognised as foreign instead of being restored as state. `version` is your application's schema version.

`serialize` receives that whole envelope and returns a string; `deserialize` receives the string and returns the envelope. Replace them to change the format:

```javascript
setup() {
  return persist(this, {
    key: 'cart',
    serialize: (envelope) => compress(JSON.stringify(envelope)),
    deserialize: (raw) => JSON.parse(decompress(raw)),
  });
}
```

The snapshot handed to `serialize` is a detached plain copy: no proxies, and mutating it cannot reach application state. Plain objects and arrays are deep-copied (cycles and shared references are preserved); anything else — `Date`, `Map`, class instances — is passed through by reference and is then only as persistable as your serializer makes it. With the default `JSON.stringify`, keep persisted state JSON-representable.

---

## Versioning and stale state

Persisted data outlives the code that wrote it. A user who last visited three releases ago still has that release's state on their device.

Every envelope records the `version` it was written for. When it does not match the version the application expects, the data is **discarded** and the bridge starts from its declared defaults. That is the safe default: an older shape never reaches code that no longer understands it.

Bump `version` whenever you change the shape of persisted state in a way older data would not satisfy.

Provide `migrate` when the old data is worth keeping:

```javascript
setup() {
  return persist(this, {
    key: 'cart',
    version: 2,
    // v1 stored `products`; v2 calls the same thing `items`.
    migrate: (state, fromVersion) => {
      if (fromVersion === 1) {
        return { items: state.products ?? [] };
      }
      return null; // anything older: discard it
    },
  });
}
```

`migrate` returns the upgraded state, or `null` to discard. If it throws, the data is discarded and the failure is reported — a broken migration costs the user their stored state, never the application.

Keys the bridge no longer declares are dropped during restoration whether or not a migration ran, so a removed field cannot come back as state nothing reads.

---

## `app.$persistence`

Installing the plugin adds a small handle to the application, for the two moments an application has to reach persistence directly:

```javascript
app.$persistence.keys(); // ['cart', 'prefs'] — every bridge that has initialized
app.$persistence.flush(); // write pending changes now, instead of at the end of the tick
app.$persistence.flush('cart'); // …or just one
app.$persistence.clear('cart'); // discard stored data; live state is untouched
app.$persistence.clear(); // discard everything this application persists
```

`flush()` is what you call when the page is about to go away:

```javascript
window.addEventListener('pagehide', () => app.$persistence.flush());
```

`clear()` is what you call on sign-out. It decides what the next reload finds; it does not change what the application is currently showing. Reset the state itself through the bridge's own actions, as usual.

A bridge registers itself the first time it is used, so all three see only the bridges the application has actually touched. A persisted bridge nothing has read yet has nothing stored to clear either, so the two line up — but it is why `keys()` can be shorter than the number of `persist()` calls in the source.

---

## Error behaviour

Persistence never throws into the application. Every failure is logged through the Avenx logger and passed to `onError` if one is configured:

```javascript
app.use(avenxPersistence, {
  onError: ({ key, phase, message, error }) => {
    reportToMonitoring(`persistence ${phase} failed for ${key}: ${message}`, error);
  },
});
```

| Phase         | What happened                                                                     | What the application sees                                                 |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `read`        | The store threw when read.                                                        | Declared defaults.                                                        |
| `write`       | The store rejected a write.                                                       | State is correct; this change was not stored. Retried on the next change. |
| `quota`       | The store is full.                                                                | As `write`. Reported separately so it can be handled separately.          |
| `serialize`   | `serialize` threw, or returned a non-string.                                      | State is correct; nothing was stored.                                     |
| `deserialize` | `deserialize` threw on stored data.                                               | Declared defaults.                                                        |
| `malformed`   | Stored data is not a valid envelope, or holds keys the bridge no longer declares. | Declared defaults, or the recognised keys only.                           |
| `version`     | Stored data was written for a different `version` and there is no `migrate`.      | Declared defaults.                                                        |
| `migrate`     | `migrate` threw or declined.                                                      | Declared defaults.                                                        |

Configuration mistakes are the exception: a missing `key`, an `include` naming an undeclared state key, a `storage` that is not an adapter. Those throw where they are written, because they are a developer's to fix and would otherwise become an absent value noticed weeks later.

Diagnostics name the key and the phase and **never** the persisted value.

---

## Security and data handling

Browser storage is not secure storage. It is readable by any script running on your origin and by anyone with access to the device, it is not encrypted, and it is not a place for credentials, tokens, personal data, or anything else you would not put in a log file.

Treat `persist()` as a decision about what leaves the application's memory and stays on the user's device. `exclude` is how you keep something out of it.

The plugin will not make that decision unsafe on your behalf: serialization is data-only, nothing is ever passed to `eval` or `new Function`, and no persisted value appears in a diagnostic message.

---

## Limitations

- **Bridges only.** Persistence attaches to shared application state, which in Avenx is a bridge. Component state is per-instance and deliberately not persisted; lift anything that should outlive a reload into a bridge.
- **JSON-representable state by default.** `Date`, `Map`, `Set` and class instances are not restored as themselves unless you provide a `serialize`/`deserialize` pair that handles them.
- **Synchronous adapters.** See [Storage adapters](#storage-adapters).
- **One key per bridge.** Two bridges may not share a key; they would overwrite each other on every save, so it is refused.
- **Restoration is startup-only.** State is read once when the bridge initializes. The plugin does not watch storage for changes made by other tabs.
- **State keys, not getters.** A bridge's getters are derived, so they are recomputed rather than stored. They are identified by writing each declared value back over itself — assigning to a getter is refused, assigning an unchanged value is a no-op — which happens once, before the change watcher exists.
- **Size.** Web Storage quotas are a few megabytes per origin. Persist what a reload needs, not a cache.

---

## Example application

A complete, runnable example lives in [`example/`](./example) — a to-do list whose items and filter survive a reload, whose draft input deliberately does not, and which migrates state written by an earlier version of itself. It is compiled with the Avenx CLI and verified in a browser; see its [README](./example/README.md) for how to run it and what to try.

---

## Building

The package is published as ES modules and needs no build step for bundler
toolchains. The standalone browser build — the one the Avenx CLI toolchain
loads from a `<script>` tag — is produced by:

```bash
npm run build --prefix plugins/avenx-persistence
```

It writes `dist/avenx-persistence.global.js` and `dist/avenx-persistence.global.min.js`,
which publish the package as the `AvenxPersistence` global and deliberately do
**not** bundle the Avenx runtime: a page must only ever have one.

---

## Testing

```bash
npm test --prefix plugins/avenx-persistence
```

The suite runs against the real runtime: bridges built with `bridge(persist(...))`, a component mounted on a real template that reads restored state, and `AvenxApp` for installation. `plugins/avenx-persistence/test/persistence.test.js` covers behaviour, `persistenceResilience.test.js` covers the failure paths.

---

## License

MIT © Avenx Team
