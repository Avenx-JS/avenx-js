---
title: 'Pages & Routing'
description: 'Set up client-side routing, nested pages, dynamic parameters, and guards.'
---

Avenx-JS features a built-in router designed for single-page applications. It handles hash-based navigation (e.g. `#/dashboard`), dynamic parameters, and guards.

## 1. Page Components (`.page.js`)

Pages are top-level components located inside `src/pages/`. They extend `AvenxPage` instead of `AvenxComponent`, enabling them to host child components dynamically.

## 2. Configuring the Router

Define routes in your `src/main.app.js` file by mapping path patterns to page names:

```javascript
import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
// Registering Pages (Normally automatically registered by compiler)
app.registerPage('Home', Home);
app.registerPage('Profile', Profile);
// Initialize router
app.initRouter({
  '/': 'Home',
  '/profile/:id': 'Profile',
  '*': 'Home', // Fallback route
});
```

## 3. Dynamic Route Parameters

Route segments starting with `:` are dynamic variables. The values parsed from the URL are automatically added to the Page component's `state` object and can be read inside templates or actions:

```html
<!-- src/pages/profile.page.js -->
<!-- state.id will contain the value from /profile/:id -->
<div class="profile">
  <h1>Viewing Profile ID: {{ id }}</h1>
</div>
```
### Wildcard Path Matchers
A `*` inside a route pattern acts as a catch-all wildcard, matching any subpath at that position — including nested segments separated by `/`. This is distinct from a route whose *entire* pattern is `*`, which is a router-wide fallback (see [Configuring the Router](#2-configuring-the-router)); a pattern like `/docs/*` still only matches paths that start with `/docs/`:
```javascript
app.initRouter({
  '/docs/*': 'Docs',
});
```
The matched subpath is exposed as `state.wildcard`, just like a `:param` value:
```html
<!-- src/pages/docs.page.js -->
<!-- /docs/intro                -> state.wildcard === 'intro' -->
<!-- /docs/concepts/reactivity  -> state.wildcard === 'concepts/reactivity' -->
<div class="docs">
  <h1>Viewing: {{ wildcard }}</h1>
</div>
```

## 4. In-Place Parameter Updates

:::caution
When navigating between routes that resolve to the **same page component class** (for example, from `#/profile/1` to `#/profile/2`), Avenx does **not** unmount and remount the page. It updates the route parameters and state on the existing page instance in place instead. This means `onMount()` and `onUnmount()` do **not** re-run during this kind of navigation — only `onUpdate()` fires.
:::
If a page relies solely on `onMount()` to fetch data based on a route parameter, that data becomes stale after navigating to a matching route with a different parameter, since `onMount()` only runs once, when the page is first mounted.
To react correctly to parameter changes, compare the incoming value against the previously seen value inside `onUpdate()`, and only re-fetch when it has actually changed:

```javascript
// src/pages/profile.page.js
onMount() {
  this._lastId = this.state.id;
  this.fetchProfile(this.state.id);
}
onUpdate() {
  if (this.state.id !== this._lastId) {
    this._lastId = this.state.id;
    this.fetchProfile(this.state.id);
  }
}
```

:::note
Guard the comparison against the previous value. `onUpdate()` runs after **every** page update, not just parameter changes, so without the check you would re-fetch on every unrelated state change too.
:::
See [Page Reuse During Navigation](/api-reference/page/#page-reuse-during-navigation) in the `AvenxPage` API reference for more detail on when a page instance is reused versus recreated.

## 5. Multi-Router Setup & Namespaces

Avenx-JS supports running **multiple independent `AvenxRouter` instances at the same time** on the same page — for example, a host application and one or more embedded micro-frontends, each with their own routes, pages, and navigation lifecycle.

### Isolating routers with `prefix`

Each router created via `app.initRouter(routes, options)` can be given a `prefix` in its options. A router only ever handles hashes that start with its own prefix — any hash that doesn't match is ignored completely by that router, including its wildcard route.
Route patterns are written **relative to the prefix**, not including it:

```javascript
// Host app — no prefix, owns the root of the hash space
const hostApp = new AvenxApp({ target: '#app' });
hostApp.registerPage('Home', Home);
hostApp.initRouter({
  '/': 'Home',
  '*': 'Home',
});
// Embedded widget — everything under #/widget/... belongs to this router
const widgetApp = new AvenxApp({ target: '#widget' });
widgetApp.registerPage('WidgetHome', WidgetHome);
widgetApp.initRouter(
  {
    '/home': 'WidgetHome', // matches #/widget/home
    '*': 'WidgetHome',
  },
  { prefix: '/widget' },
);
```

Navigating with `router.navigate(hash)` on a prefixed router automatically prepends its `prefix`, so calling `navigate('#/home')` on `widgetApp`'s router produces `#/widget/home`.

### Coordinating wildcard fallbacks with `window.__avenx_routers`

Every `AvenxRouter` registers itself in a global `window.__avenx_routers` set when it's created, and removes itself when `destroy()` is called. Routers use this registry to avoid stepping on each other's wildcard (`*`) fallback routes.
When a router can't match the current hash against any of its own named routes, it does **not** immediately fall back to its `*` route. Instead, it first checks every _other_ router registered in `window.__avenx_routers` to see whether one of them owns that hash (respecting each router's own `prefix`). Only if **no other router claims the hash** does the local wildcard fire.
This means, in the example above, if `hostApp`'s router doesn't have a matching route for `#/widget/home`, it won't incorrectly trigger its own `*` fallback — it detects that `widgetApp`'s router owns that hash and steps aside.
:::note
Only named routes count when checking whether another router "owns" a hash — wildcard routes are never considered a match by other routers, so two routers with `*` fallbacks never block each other.
:::
:::caution
Because routers coordinate through a shared global registry, always call `router.destroy()` when tearing down a router instance (for example, when unmounting a micro-frontend). A router left in `window.__avenx_routers` after it's no longer in use keeps its `hashchange` listener attached and continues to be consulted by other routers' fallback checks.
:::

## 6. Route Guards

## 5. Route Guards

Guards decide whether a transition to a page is allowed. Create a guard using the CLI:

```bash
npx avenx g guard auth
```

Implement the `canActivate(to, from)` method. Return a boolean, a redirect string, or a Promise:

```javascript
// src/guards/auth.guard.js
import { AvenxGuard } from 'avenx-core/runtime';
export default class AuthGuard extends AvenxGuard {
  canActivate(to, from) {
    // Return true to allow, false to block, or hash path to redirect
    if (to.hash === '#/dashboard' && !window.isLoggedIn) {
      return '#/login';
    }
    return true;
  }
}
```

:::caution
Redirect paths returned from `canActivate` must start with `#`. `AvenxRouter.navigate` only applies the configured `prefix` and namespace settings to hash paths — a path without the `#` prefix bypasses this resolution and can break navigation in apps served with a custom `prefix`.
:::warning
Redirect paths must start with a `#` prefix to ensure router prefix and namespace settings are respected.
:::
Map guards to routes in your application router initialization:

```javascript
app.initRouter({
  '/': 'Home',
  '/dashboard': { page: 'Dashboard', guards: [AuthGuard] },
});
```
