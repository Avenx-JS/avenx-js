---

title: 'AvenxRouter & Guard API'
description: 'API documentation for routing hooks, guards, navigation, and page lifecycle management.'
------------------------------------------------------------------------------------------------------

Classes responsible for navigation controls and route access authorization.

## AvenxRouter

Created by calling `AvenxApp.initRouter()`.

### Methods

* `navigate(hash)`: Programs a transition to another hash path.

```javascript id="8axpof"
router.navigate('#/dashboard');
```

* `destroy()`: Removes routing event listeners from the window.

<hr />

## AvenxGuard

Route guards extend `AvenxGuard`. Override the following method to implement route access validation:

### `canActivate(to, from)`

Called before navigating to a route.

| Param  | Properties           | Description                                      |
| ------ | -------------------- | ------------------------------------------------ |
| `to`   | `hash, page, params` | Target route details.                            |
| `from` | `hash, page, params` | Current route details (or null if initial load). |

**Returns:** `boolean` (true to allow, false to deny) or `string` (a redirect hash like `'#/login'`).

## Compilation Lifecycle & Limits

The Avenx compiler processes `.guard.js` files before including them in the compiled application. During compilation, ES module imports declared in guard files are stripped from the generated output.

As a result, guard logic that depends directly on imported utilities or other imported declarations may cause runtime `ReferenceError` exceptions after compilation.

For example, avoid relying on ES module imports directly inside a guard file:

```javascript id="o83wbg"
import { isAuthenticated } from './auth-utils.js';

export default class AuthGuard extends AvenxGuard {
  canActivate(to, from) {
    return isAuthenticated();
  }
}
```

In this example, the `import` declaration may be removed during compilation, leaving `isAuthenticated` unavailable when the guard executes.

Instead, move reusable logic into external utility files and expose it through supported application patterns. Utilities that are intentionally available globally can be referenced through properties on the `window` object:

```javascript id="kiz3p7"
export default class AuthGuard extends AvenxGuard {
  canActivate(to, from) {
    return window.AppUtils.isAuthenticated();
  }
}
```

When writing `.guard.js` files:

* Do not rely on ES module imports being preserved in the compiled output.
* Move reusable helper logic into external utility files.
* Reference intentionally global utilities through properties on `window`.

Understanding these compilation limits helps prevent missing imports and runtime `ReferenceError` exceptions caused by declarations being removed from the compiled output.
