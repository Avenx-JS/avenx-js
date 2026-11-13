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
### Keep-Alive Page Caching

Routes can enable page caching by setting the `keepAlive` option. Instead of destroying the page when navigating away, Avenx stores the page instance in an internal Least Recently Used (LRU) cache.

When the user returns to the same route, the cached page instance is restored instead of creating a new one. This preserves the page's DOM state, component state, and any user input that has not been cleared.

```javascript
app.initRouter({
  '/profile/:id': {
    page: 'Profile',
    keepAlive: true,
  },
});
```
When a cached page is restored, the `onActivate(params)` lifecycle hook is called with the latest route parameters. When navigating away from a cached page, `onDeactivate()` is called instead of `onUnmount()`.

This behavior is useful for pages that should preserve their state between navigations, such as dashboards, forms, or long lists.

### `keepAliveLimit`

The maximum number of inactive keep-alive page instances is controlled by the `keepAliveLimit` option passed to the `AvenxApp` constructor.

When navigating away from a page configured with `keepAlive: true`:

1. `onDeactivate()` runs and the page instance is moved into the internal LRU cache.
2. If caching another inactive page would exceed `keepAliveLimit`, the least recently used cached page is evicted.
3. The evicted page's `onUnmount()` lifecycle hook runs.

```javascript
const app = new AvenxApp({
  target: '#app',
  keepAliveLimit: 3,
});
```

With this configuration, navigating among four or more keep-alive pages retains only the three most recently used inactive page instances in memory. Older cached pages are automatically removed as needed.

### Programmatic Page Cache Invalidation

In addition to automatic LRU eviction via `keepAliveLimit`, developers can manually purge cached page instances from memory using `clearKeepAliveCache(pageName?: string)`.

This is useful when page instances hold stale data or user-specific state that must be cleared (e.g. after a user logs out or updates profile data).

Calling `this.clearKeepAliveCache('UserProfilePage')` (or `app.clearKeepAliveCache('UserProfilePage')`) evicts the specified cached page instance from memory and triggers its `onUnmount()` hook. Calling `this.clearKeepAliveCache()` without arguments purges all cached page instances.

```javascript
// Inside a Component Action (e.g. Logout / Refresh Button)
export default {
  actions: {
    handleLogout() {
      // Evict specific cached page instance
      this.clearKeepAliveCache('UserProfilePage');

      // Or purge all cached keep-alive pages
      this.clearKeepAliveCache();

      // Navigate to login
      this.$router.navigate('/login');
    }
  }
};
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
### Query Parameters

The portion of a route hash after `?` is automatically parsed into an object and made available as `state.query`. This works alongside dynamic parameters (`:id`) and can be read the same way,in templates or actions:

```html
<!-- src/pages/dashboard.page.js -->
<!-- #/dashboard?tab=analytics&user=123 ->state.query.tab==='analytics' -->
    <div class="dashboard">
      <h1>Current tab: {{ query.tab }}</h1>
    </div>

```

Query parameters are also available inside component actions using `this.state.query`:

```javascript
//src/pages/dashboard.page.js
onMount() {
  const tab = this.state.query.tab;
  this.loadTabData(tab);
}
```
#### Type Coercion
While dynamic route parameters are always strings, query parameter values on the other hand are coerced based on their content:

| Raw value | Parsed as |
| ---- | ---- |
| `"true"` | Boolean `true` |
|`"false"` | Boolean `false`|
| A numeric string(e.g. `"123"`) |  `Number` (e.g.`123`) |
| Anything else | `String` |

```javascript
//#/settings?darkMode=true&fontSize=16&theme=blue
state.query={
  darkMode : true, //boolean
  fontSize:16,     //number
  theme: 'blue'   //string
}
```
:::note
If the route hash has no `?` segment,`state.query` is undefined rather than an empty object. Hence, check for its existence before accessing nested properties.
:::

### Wildcard Path Matchers

A `*` inside a route pattern acts as a catch-all wildcard, matching any subpath at that position — including nested segments separated by `/`. This is distinct from a route whose _entire_ pattern is `*`, which is a router-wide fallback (see [Configuring the Router](#2-configuring-the-router)); a pattern like `/docs/*` still only matches paths that start with `/docs/`:

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
## Accessing Active Route Data

Components can access information about the currently active route using the reactive `$route` getter provided by `AvenxComponent`.

The `$route` object exposes the following properties:

| Property | Description |
| -------- | ----------- |
| `$route.params` | Contains the dynamic route parameters extracted from the current URL. |
| `$route.hash` | Returns the current route hash. |
| `$route.page` | Returns the active page associated with the current route. |

### Example

The following example shows how to access a route parameter inside a component:

```javascript
import { AvenxComponent } from "avenx-core/runtime";

export default class UserProfile extends AvenxComponent {
  onMount() {
    console.log(this.$route.params.id);
  }
}
```

If the current route is:

```text
#/profile/42
```

Then:

```javascript
this.$route.params.id; // "42"
```
## Programmatic History Navigation

In addition to `router.navigate(hash)`, `AvenxRouter` exposes methods for traversing the browser / session history stack programmatically: `back()`, `forward()`, and `go(delta)`. These are available on the router instance and, inside components, via `this.$router`.

| Method | Description | Equivalent to |
| ------ | ------------ | ------------- |
| `router.back()` | Navigates backward one step in the history stack. | `router.go(-1)` / `window.history.back()` |
| `router.forward()` | Navigates forward one step in the history stack. | `router.go(1)` / `window.history.forward()` |
| `router.go(delta)` | Moves to a relative history position given by the integer `delta` (negative to go back, positive to go forward). | `window.history.go(delta)` |

### Back Buttons

```html
<!-- src/components/nav-bar.component.js -->
<button @click="goBack">← Back</button>

<action name="goBack">
  this.$router.back();
</action>
```

### Multi-Step Wizards

`go(delta)` is useful for jumping more than one step at a time — for example, skipping back over several wizard steps that each pushed their own history entry:

```html
<!-- src/components/checkout-wizard.component.js -->
<button @click="backToPayment">← Back to Payment</button>

<action name="backToPayment">
  // From a step two screens ahead of Payment, jump back two steps at once
  this.$router.go(-2);
</action>
```

### Cancel Handlers

A "Cancel" action in a form or modal commonly needs to return the user to wherever they came from, without hard-coding the previous hash:

```html
<!-- src/pages/edit-profile.page.js -->
<button @click="cancelEdit">Cancel</button>

<action name="cancelEdit">
  this.$router.back();
</action>
```

:::note
`back()`, `forward()`, and `go(delta)` move the history cursor but that doesn't guarantee a route change — if there's nowhere to go, the call is a no-op. Route guards (`canActivate`) still run against the resulting route once the history position (and therefore the hash) actually changes.
:::

### Delegate Behavior & Testability

History traversal is delegated to whichever `NavigationDelegate` the router is configured with (see [Pluggable Navigation Delegates](/api-reference/router-guard/#pluggable-navigation-delegates-navigationdelegate) in the API reference):

- **`BrowserNavigationDelegate`** forwards `back()`, `forward()`, and `go(delta)` directly to `window.history`, so the browser's own back/forward buttons and programmatic calls behave identically.
- **`MemoryNavigationDelegate`** maintains its own in-memory history array and cursor index instead of relying on `window.history`. Calling `go(delta)` moves that cursor and re-emits the resulting hash to subscribers, which makes backward/forward transitions deterministic and easy to assert in unit and integration tests, without a DOM or `jsdom` history mock.

```javascript
import { MemoryNavigationDelegate } from 'avenx-core/runtime';

const delegate = new MemoryNavigationDelegate('#/step-1');
delegate.setHash('#/step-2');
delegate.setHash('#/step-3');

delegate.back();
delegate.getHash(); // '#/step-2'

delegate.go(-1);
delegate.getHash(); // '#/step-1'

delegate.forward();
delegate.getHash(); // '#/step-2'
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

## 6. Page Titles

When a route is resolved, the router can automatically update `document.title`. Add a `title` property to any route definition — either a static string or a dynamic function that receives the parsed route parameters:

```javascript
app.initRouter({
  '/':            { page: 'Home',    title: 'Home' },
  '/profile/:id': { page: 'Profile', title: (params) => `Profile ${params.id}` },
  '*':            { page: 'NotFound', title: 'Page Not Found' },
});
```

### Title Prefix & Suffix

To avoid repeating your app name in every route, pass `titlePrefix` or `titleSuffix` in the router options. They are prepended / appended to every resolved title automatically:

```javascript
app.initRouter(
  {
    '/':      { page: 'Home',    title: 'Home' },
    '/about': { page: 'About',  title: 'About Us' },
  },
  { titleSuffix: ' — MyApp' },
);
// Results in "Home — MyApp", "About Us — MyApp"
```

:::note
Routes that do not declare a `title` property leave `document.title` unchanged. This lets you opt individual routes out of automatic title management.
:::

### Accessibility on navigation

After a successful navigation, the router announces the current `document.title`
through a visually hidden, polite `role="status"` region. It clears the region
before each announcement so that navigating between routes with the same title
can announce it again. Give routes meaningful titles for useful announcements.

On later navigations, the router also moves focus to the new page's
`[data-ax-page-heading]` element. Mark the heading in each page component:

```html
<h1 data-ax-page-heading>Profile</h1>
```

If the page has no marked heading, the router focuses its page container. It
adds `tabindex="-1"` when the target has no `tabindex` and focuses it with
`preventScroll: true`. The initial page load does not move focus.

Use the router's `a11y` options to choose another target or disable either
behavior:

```javascript
app.initRouter(routes, {
  a11y: {
    focusTarget: '[data-main-heading]',
    focusOnNavigate: true,
    announceRouteChanges: true,
  },
});
```

If the custom selector finds nothing in the new page, the router still tries
`[data-ax-page-heading]` before falling back to the page container. See the
[router API reference](/api-reference/router-guard) for option defaults.

## 7. Route Guards

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

---

## 8. Nested Routes & Layout Components

`AvenxRouter` supports one level of nested routes with a persistent parent layout (`children: [...]`, `layout: Component`). Child views can share surrounding UI — such as navigation headers, sidebars, breadcrumbs, and footers — without re-rendering or unmounting the wrapper during sibling transitions. The layout can be a component class, as shown below, or the name of a registered page.

### Route Configuration Schema

To configure nested routes, define a parent route object containing a `layout` component reference and a `children` array of child route definitions:

```javascript
import AppLayout from './layouts/app-layout.component.js';

app.initRouter({
  '/': { page: 'Home', title: 'Home' },

  // Parent route with layout and nested children
  '/admin': {
    layout: AppLayout,
    children: [
      { path: '/dashboard', page: 'AdminDashboard', title: 'Admin Dashboard' },
      { path: '/users', page: 'AdminUsers', title: 'User Management' },
      { path: '/settings', page: 'AdminSettings', title: 'System Settings' },
    ],
  },

  '*': { page: 'NotFound', title: 'Page Not Found' },
});
```

### Layout Component Structure

A Layout component acts as a shell that wraps nested child page components. During child route navigation, the Layout component remains mounted, preserving its internal reactive state, animations, and DOM tree:

```html
<!-- src/layouts/app-layout.component.js; .component.js files compile anywhere under src/ -->
<state activeTab="'dashboard'" />

<action name="navigateTab">
  const [tabPath] = args;
  this.state.activeTab = tabPath;
</action>

<div class="admin-layout">
  <!-- Persistent Sidebar Navigation -->
  <aside class="sidebar">
    <nav>
      <a href="#/admin/dashboard" @click="navigateTab('dashboard')">Dashboard</a>
      <a href="#/admin/users" @click="navigateTab('users')">Users</a>
      <a href="#/admin/settings" @click="navigateTab('settings')">Settings</a>
    </nav>
  </aside>

  <!-- Child View Mount Target -->
  <main class="content-view">
    <slot></slot>
  </main>
</div>
```

---

### Key Behavior & Features

#### 1. Layout Persistence During Transitions

When navigating between child routes sharing the same parent `layout` (for example, moving from `#/admin/dashboard` to `#/admin/users`), `AvenxRouter` keeps the `AppLayout` instance intact. Only the child page component mounted inside the `<slot>` is swapped out. This eliminates layout flicker, preserves sidebar scroll positions, and prevents re-triggering API calls in `AppLayout.onMount()`.

#### 2. Parameter Inheritance

Child routes automatically inherit dynamic path parameters defined on parent route paths.

```javascript
app.initRouter({
  '/org/:orgId': {
    layout: OrgLayout,
    children: [
      { path: '/members/:memberId', page: 'MemberDetail' },
    ],
  },
});
```

When navigating to `#/org/acme-corp/members/42`:
- Parent parameter `:orgId` = `'acme-corp'`
- Child parameter `:memberId` = `'42'`
- Both parameters are merged and passed into `MemberDetail` page component props and `$route.params` (`{ orgId: 'acme-corp', memberId: '42' }`).

#### 3. One Parent Layout Per Route Branch

Use one parent route with child routes for a shared layout. For additional visual nesting, compose components inside that layout; nested layout wrappers are not currently supported.

