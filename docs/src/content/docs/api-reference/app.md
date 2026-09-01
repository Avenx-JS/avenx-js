---
title: 'AvenxApp API'
description: 'API reference of AvenxApp class, the entry point for registering and mounting applications.'
---

The core coordinator class for your application. It holds mappings of components, pages, active bridges, and handles mounting elements onto the DOM.

## Constructor

```javascript
const app = new AvenxApp({ target: '#app' });
```

| Param           | Type     | Description                                                                                                    |
| --------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `config.target` | `string` | A valid DOM selector (e.g., `'#app'`) pointing to the root element. Throws exception `[AVX_R01]` if not found. |
| `config.enableProfiling` | `boolean` | Enables browser Performance Timeline marks and measures for component lifecycle work. Default: `false`. |
| `config.keepAliveLimit` | `number` | Maximum number of inactive keep-alive page instances stored in the internal LRU cache. Default: `5`. |
| `config.logging` | `object` | Configuration applied to the shared runtime `logger` on startup. Accepts `level`, `silent`, `formatter`, `transports`, and `warnHandler`. |
| `config.errorHandler` | `function` | Global error handler callback: `(error: Error, instance: AvenxComponent, info: string) => void`. |
| `config.warnHandler` | `function` | Global warning handler callback: `(message: string, instance: AvenxComponent) => void`. |

### `errorHandler`

Pass a global `errorHandler` function in the `AvenxApp` configuration to capture uncaught runtime exceptions, lifecycle failures, and unhandled template errors across all components:

```javascript
const app = new AvenxApp({
  target: '#app',
  errorHandler(error, instance, info) {
    console.error(`[Global Error] in ${instance?.constructor?.name || 'App'} during ${info}:`, error);

    // Send telemetry to external monitoring services (e.g. Sentry, LogRocket, Datadog)
    if (window.Sentry) {
      Sentry.captureException(error, {
        extra: { component: instance?.constructor?.name, lifecyclePhase: info },
      });
    }
  },
});
```

- **Callback Signature**: `(error: Error, instance: AvenxComponent, info: string) => void`
- **`error`**: The thrown `Error` or `AvenxError` instance.
- **`instance`**: The component instance where the exception originated (or `null` if thrown at application root).
- **`info`**: A string describing the execution context (e.g. `'onMount'`, `'onUpdate'`, `'eventHandler'`, `'render'`).

### `warnHandler`

Pass a global `warnHandler` function in the `AvenxApp` configuration (or `logging.warnHandler`) to intercept framework warning codes (e.g. `AVX_W01` to `AVX_W32`):

```javascript
const app = new AvenxApp({
  target: '#app',
  warnHandler(message, instance) {
    console.warn(`[Avenx Warning] from ${instance?.constructor?.name || 'Core'}: ${message}`);
  },
});
```

- **Callback Signature**: `(message: string, instance: AvenxComponent) => void`
- **`message`**: The formatted warning message string containing the `[AVX_W*]` warning code.
- **`instance`**: The component instance associated with the warning.

### `enableProfiling`

Set `enableProfiling` to `true` in the `AvenxApp` constructor to record
`performance.mark`/`performance.measure` entries for component `mount`,
`patch`, `render`, and `onMount` work. The resulting measurements use the
`[Avenx] <Component> - <Phase>` name, so they can be inspected in the browser's
Performance panel.

```javascript
const app = new AvenxApp({
  target: '#app',
  enableProfiling: true,
});
```

When profiling is enabled on an app, Avenx also sets
`window.__avenx_enable_profiling = true`. You can set that global flag yourself
before component work begins to enable the same profiling fallback for
components that do not have an app-level profiling option. The flag is only
read in browser environments and has no effect when the Performance Timeline
methods are unavailable.

### `logging`

Pass a `logging` object to configure the shared `logger` instance that `AvenxApp`, components, and your own application code use. This is separate from the `logging` option in `avenx.config.json`, which only affects the CLI's build-time output — see [Logging Options](/getting-started/configuration/#logging-options).

```javascript
const app = new AvenxApp({
  target: '#app',
  logging: {
    level: 'debug',
    silent: false,
  },
});
```

If omitted, the shared logger keeps its default configuration (`level: 'info'`, `silent: false`).

### `keepAliveLimit`

The `keepAliveLimit` option controls the maximum number of inactive pages configured with `keepAlive: true` that can remain cached in memory.

AvenxApp maintains an internal Least Recently Used (LRU) cache for keep-alive page instances. When a user navigates away from a keep-alive page, its `onDeactivate()` lifecycle hook runs and the page instance is moved into the cache instead of being destroyed immediately.

If adding another inactive page would exceed `keepAliveLimit`, the least recently used cached page is evicted from memory and its `onUnmount()` lifecycle hook is called.

The default value is `5`.

```javascript
const app = new AvenxApp({
  target: '#app',
  keepAliveLimit: 3,
});
```

For example, if four routes are configured with `keepAlive: true` and `keepAliveLimit` is set to `3`, only three inactive page instances are retained in memory. When the fourth page is cached, the least recently used cached page is evicted and its `onUnmount()` hook executes.

Applications with limited memory budgets may prefer a smaller value, while applications that benefit from preserving more inactive pages can increase the limit.

## Public Properties
### `activePage`
Returns the currently active mounted page component instance.

**Returns**

`AvenxComponent | null`

Returns the currently active mounted page component instance, or `null` if no page is currently mounted. Note that when using keep-alive caching, the `activePage` property will return the cached page instance when it is activated.

This read-only property is useful for debugging, diagnostics, and telemetry.

**Example**

```javascript
const currentPage = app.activePage;

if (currentPage) {
  console.log('Current page:', currentPage);
}
```

```javascript
const currentPage = app.activePage;

analytics.track('page-state', {
  active: currentPage !== null,
});
```


## Public Methods

### `register(name, compClass)`

Registers a component class so it can be resolved by component tag names in templates.

```javascript
app.register('Navbar', NavbarComponent);
```

### `registerPage(name, pageClass)`

Registers a page view class for routing.

```javascript
app.registerPage('Dashboard', DashboardPage);
```

### `getRegisteredPages()`

Returns an array of string identifiers for all page components registered via `app.registerPage(name, pageClass)` from the internal `pages` Map.

**Returns**

`string[]`

Returns an array containing the names of all registered pages.

```javascript
const registeredPages = app.getRegisteredPages();
console.log('Registered pages:', registeredPages);
// Example output: ['Home', 'Dashboard', 'UserProfile']
```

### `initRouter(routes)`

Instantiates and starts the hash-based router. Accepts a route mapping configuration object.

```javascript
app.initRouter({
  '/': 'Home',
  '/profile/:id': { page: 'Profile', guards: [AuthGuard] },
});
```

### `directive(name, definition)`

Registers a custom directive with the application instance. Returns the `AvenxApp` instance for chaining.

```typescript
directive(name: string, definition: DirectiveDefinition | DirectiveFunction): AvenxApp
```

| Param | Type | Description |
| --- | --- | --- |
| `name` | `string` | The directive identifier name (e.g. `'focus'`). Applied in HTML templates as `data-ax-focus` (or with dot modifiers like `data-ax-focus.lazy`). |
| `definition` | `object \| function` | An object containing lifecycle hooks (`mounted`, `updated`, `unmounted`), or a shorthand function `(el, binding) => void` executed on both mount and update. |

#### Lifecycle Hooks Schema (`DirectiveDefinition`)

| Hook | Parameters | Description |
| --- | --- | --- |
| `mounted(el, binding)` | `(el: Element, binding: DirectiveBinding) => void` | Invoked when the bound element is inserted into the DOM. |
| `updated(el, binding)` | `(el: Element, binding: DirectiveBinding) => void` | Invoked when the directive expression value updates (`binding.value !== binding.oldValue`). |
| `unmounted(el, binding)` | `(el: Element, binding: DirectiveBinding) => void` | Invoked when the bound element is removed/unmounted from the DOM. |

#### Binding Object Schema (`DirectiveBinding`)

| Property | Type | Description |
| --- | --- | --- |
| `binding.value` | `any` | Evaluated result of the directive expression. |
| `binding.oldValue` | `any` | Previous evaluated result before the update. |
| `binding.expression` | `string` | Raw string expression passed in the template. |
| `binding.modifiers` | `object` | Key/value map of modifier flags (e.g. `data-ax-tooltip.top.lazy` -> `{ top: true, lazy: true }`). |

```javascript
// Object definition
app.directive('focus', {
  mounted(el) {
    el.focus();
  },
});

// Shorthand function definition (runs on mounted and updated)
app.directive('color', (el, binding) => {
  el.style.color = binding.value;
});
```

See [Custom Directives](/core-concepts/directives/) for complete guides, modifier handling, and real-world examples.

### `registerBridge(name, bridgeData)`


Indexes a bridge on the application under `name`, so devtools and `app.bridges` can enumerate it. `bridgeData` is either a [`bridge()`](/core-concepts/bridges) instance or a plain reactive object.

The compiler emits this call for every bridge an application imports, so a normal project never writes it by hand. Call it directly only to register a plain object as ad-hoc shared state:

```javascript
app.registerBridge('flags', { betaEnabled: false });
```

A `bridge()` instance is indexed exactly as it is — it is already reactive and already read-only for consumers, so it is never re-wrapped. Registering the same name twice throws `AVX_R10`.

### `onError(callback)`

Registers an application-wide error handler callback. Handlers are stored in an execution list—calling `onError` multiple times **adds** each callback to the pipeline (it does not replace previous ones). Returns the `AvenxApp` instance for chaining.

When an uncaught component lifecycle or event execution error bubbles past local `onErrorCaptured` hooks, `AvenxApp` dispatches it through internal `_handleError(error, component, origin)`, which safely invokes every registered callback inside an isolated `try/catch` block.

```typescript
onError(callback: (error: Error, component?: AvenxComponent, origin?: string) => void): AvenxApp
```

| Param | Type | Description |
| --- | --- | --- |
| `error` | `Error \| AvenxError` | The caught error instance (includes `code`, `details`, and `stack`). |
| `component` | `AvenxComponent \| null` | The component instance where the exception originated, or `null`. |
| `origin` | `string` | Execution phase context (e.g. `'onMount'`, `'onUpdate'`, `'eventHandler:submitForm'`, `'render'`). |

```javascript
app.onError((error, component, origin) => {
  console.error(`[Global App Error] ${origin}:`, error);

  // Send diagnostic telemetry to Datadog / Sentry / LogRocket
  if (window.Sentry) {
    Sentry.captureException(error, {
      extra: {
        componentName: component?.constructor?.name,
        origin,
        errorCode: error.code,
      },
    });
  }
});
```

---

### `onWarn(callback)`

Registers an application-wide warning handler callback for intercepting framework warning messages and codes (`AVX_W01` to `AVX_W32`). Handlers are additive and return the `AvenxApp` instance for chaining.

```typescript
onWarn(callback: (warningMessage: string, component?: AvenxComponent, code?: string) => void): AvenxApp
```

| Param | Type | Description |
| --- | --- | --- |
| `warningMessage` | `string` | The formatted warning string (e.g. `"[AVX_W15] Inject key \"theme\" was not found..."`). |
| `component` | `AvenxComponent \| null` | The originating component instance associated with the warning context. |
| `code` | `string \| undefined` | The parsed warning code identifier (e.g. `'AVX_W15'`). |

```javascript
app.onWarn((msg, component, code) => {
  // 1. In production, forward warnings to central observability service
  if (process.env.NODE_ENV === 'production') {
    analytics.track('Framework Warning', { message: msg, code, component: component?.constructor?.name });
  }

  // 2. In automated tests, assert that specific deprecation or mismatch warnings do not occur
  if (code === 'AVX_W26') {
    throw new Error(`Reserved method collision warning detected: ${msg}`);
  }
});
```

---

### `mount(name, targetSelector)`

Mounts a registered component onto the specified DOM element, triggering the component lifecycle and bootstrapping the template rendering. If `targetSelector` is omitted, it falls back to the `config.target` selector provided in the constructor.

| Param              | Type     | Default                                        | Description                                                                                                    |
| ------------------ | -------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `name`             | `string` | —                                              | Name of the registered component to mount. Throws `[AVX_R03]` if the component is not registered.              |
| `targetSelector`   | `string` | `null` (falls back to `config.target`)         | A valid DOM selector (e.g., `'#app'`) pointing to the mount container. Falls back to the constructor's `target` if not provided. Throws `[AVX_R01]` if not found. |

```javascript
app.mount('MyRootComponent', '#app');
```

### `clearKeepAliveCache(pageName)`

Programmatically clears cached KeepAlive component instances from memory. Unmounts evicted page instances and destroys their cached DOM trees.

| Param | Type | Description |
| --- | --- | --- |
| `pageName` | `string` (optional) | Name of the page component to evict from cache. If omitted, clears all cached page instances. |

**Returns**

`boolean`

Returns `true` if cache entries were evicted, `false` otherwise.

```javascript
// Evict a specific cached page instance
const evicted = app.clearKeepAliveCache('UserProfilePage');

// Purge all cached keep-alive pages
app.clearKeepAliveCache();
```
