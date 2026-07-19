---
title: 'AvenxRouter & Guard API'
description: 'API documentation for routing hooks, guards, navigation, and page lifecycle management.'
---

Classes responsible for navigation controls and route access authorization.

## AvenxRouter

Created by calling `AvenxApp.initRouter(routes, options)`.

### Configuration Options

The second argument to `initRouter` is an optional `options` object that controls router behavior:

| Option                 | Type     | Default     | Description                                                                                                                                                                                                       |
| ---------------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`               | `string` | `''`        | A base path prepended to every route hash. Useful when the app is served from a subdirectory (e.g. `'/app'` turns `#/dashboard` into `#/app/dashboard`).                                                          |
| `guardTimeout`         | `number` | `5000`      | Maximum time, in milliseconds, a guard's `canActivate` is allowed to take (including async/promise-based guards) before the navigation is considered stalled and `AVX_R14` (`ROUTER_GUARD_TIMEOUT`) is triggered. |
| `guardTimeoutRedirect` | `string` | `undefined` | A hash path to redirect to automatically if a guard times out, instead of leaving navigation stalled. If omitted, a timed-out guard simply denies the transition.                                                 |
| `transition`           | `string` | `'none'`    | Enables a named transition effect (e.g. `'fade'`, `'slide'`) applied to the page container when navigating between routes.                                                                                        |

```javascript
const router = AvenxApp.initRouter(routes, {
  prefix: '/app',
  guardTimeout: 8000,
  guardTimeoutRedirect: '#/login',
  transition: 'fade',
});
```

### Methods

- ### `Maps(hash)`
  Programs a programmatic navigation to the specified route hash. It updates the browser history and triggers the matching route lifecycle.

### `destroy()`

Tears down the active router instance. It cleans up all global event listeners (like `hashchange` or `popstate`), unmounts the active route component, and releases internal memory references to prevent leaks.

### `matches(hash)`

- **Arguments:** `hash: string`
- **Returns:** `boolean`
- Evaluates whether a given URL hash matches any registered route pattern in the router configuration. Returns `true` if a match is found, otherwise `false`.

---

## The `AvenxGuard` Class

The `AvenxGuard` class allows you to intercept navigation requests before a route is fully loaded. Custom route guards should extend this base class.

### `canActivate(to, from)`

This lifecycle method is executed prior to entering a route.

- **Parameters:**
  - `to`: The target route object being navigated to.
  - `from`: The current route object being navigated away from.
- **Return Values:** The method can return a `boolean`, a `string` (redirect path), or a `Promise` resolving to either:
  - `true`: Allows the navigation to proceed.
  - `false`: Cancels the navigation.
  - `string`: Redirects the user to the specified path/hash (e.g., `'#/login'`).

:::caution
Redirect paths returned from `canActivate` must start with `#`. `AvenxRouter.navigate` only applies the configured `prefix` and namespace settings to hash paths — a path without the `#` prefix bypasses this resolution and can break navigation in apps served with a custom `prefix`.
:::

:::note
When the matched route hash includes query parameters,both `to.params.query` and `from.params.query` contain the parsed query object- using the type coercion rules described in [Query Parameters](/core-concepts/routing/#query-parameters). This lets a guard make decisions based on query values, for example:
```javascript
  canActivate(to, from) {
    if (to.hash.startsWith('#/dashboard') && to.params.query?.tab === 'admin' && !window.isAdmin) {
      return '#/dashboard';
    }
    return true;
  }
```
:::

### Navigation Redirects

Return a hash path from `canActivate` to redirect instead of activating the requested route. For example, an authentication guard can wait for the session check to resolve and send unauthenticated users to the login route:

```javascript
import { AvenxGuard } from 'avenx';

export class AuthGuard extends AvenxGuard {
  async canActivate(to, from) {
    const isAuthenticated = await checkUserSession();

    if (!isAuthenticated) {
      return '#/login';
    }

    return true;
  }
}
```

The router waits for a promise returned by `canActivate` to resolve before acting on its value. When the resolved value is a string, the router stops the current guard chain and starts a new navigation to that hash. The destination route is then matched normally and its own guards are resolved before the page is mounted. Avoid redirecting to a route protected by the same guard unless that route can pass the guard, or the redirects will repeat.

:::warning
Redirect paths must start with a `#` prefix to ensure router prefix and namespace settings are respected.
:::
