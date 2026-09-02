# Persistence example — a to-do list that survives a reload

A complete Avenx application, compiled with the Avenx CLI, showing every part
of `@avenx/persistence` working together:

- **[`src/global/todos.bridge.js`](src/global/todos.bridge.js)** — an ordinary
  bridge. The only thing persistence adds is the `setup()` hook at the bottom.
- **`items` and `filter` are persisted; `draft` is not.** What the user is
  part-way through typing would be a surprise a day later, not a convenience,
  so it is listed in `exclude`. The getters `visible` and `remaining` are never
  persisted either — they recompute from the restored items.
- **A migration.** The bridge declares `version: 2`. Version 1 of this app
  stored `{ todos: [{ label, complete }] }`, so `migrate` renames those fields
  on the way in rather than throwing the user's list away.
- **[`src/main.app.js`](src/main.app.js)** — installs the plugin with an
  application-wide key prefix and an `onError` callback, and flushes pending
  writes on `pagehide`.

## Running it

From this directory:

```bash
node ../../../bin/avenx.js build
```

Then serve the **plugin** directory (one level up), because `index.html` loads
the plugin bundle from `../dist/`:

```bash
python3 -m http.server 8000 --directory ..
```

and open <http://localhost:8000/example/>.

If `../dist/avenx-persistence.global.js` is missing, build it first:

```bash
npm run build --prefix ..
```

## Things to try

1. Add a couple of items, then reload. They are still there.
2. Type something into the input without adding it, then reload. The draft is
   gone — that key is excluded on purpose.
3. Switch the filter, then reload. The filter comes back too.
4. In the browser console, plant data from the previous release and reload:

   ```javascript
   localStorage.setItem(
     'avenx-todo:todos',
     JSON.stringify({
       avenx: 1,
       version: 1,
       state: { todos: [{ label: 'From v1', complete: false }] },
     }),
   );
   ```

   The list comes back migrated. Change anything afterwards and storage is
   rewritten at version 2.

5. Corrupt the stored value and reload:

   ```javascript
   localStorage.setItem('avenx-todo:todos', '{{{not json');
   ```

   The app starts on its defaults and keeps working. The console carries one
   warning from the Avenx logger and one from this app's own `onError`.

## Why the plugin is loaded from a `<script>` tag

The Avenx CLI compiles an application into one self-contained bundle and
analyses `*.bridge.js` statically, so a bridge module may only import the
Avenx runtime and other bridges. Third-party runtime packages are reached
through a global instead — which is what `index.html` sets up, and why the
bridge calls `AvenxPersistence.persist(this, ...)`.

With a bundler (Vite, Rollup, webpack) none of that applies: drop the script
tag and `import { persist } from '@avenx/persistence'` in both files.
