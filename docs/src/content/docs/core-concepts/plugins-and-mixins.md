---
title: 'Plugins & Global Mixins'
description: 'Extend Avenx-JS applications using global plugins (app.use) and global mixins (app.mixin).'
---

Avenx-JS provides built-in extension mechanisms to enhance application capabilities, add third-party integrations, or share global behavior across all components.

---

## 1. Global Plugins (`app.use`)

Plugins are self-contained modules used to extend `AvenxApp` with global features — such as analytics tracking, internationalization (i18n), custom directive providers, or state management integrations.

Plugins are installed by calling `app.use(plugin, options)`. Avenx-JS supports two plugin formats: **Object Plugins** (with an `install` method) and **Functional Plugins**.

### Object Plugin Format

An Object plugin is a JavaScript object that exposes an `install(app, options)` method:

```javascript
// src/plugins/analytics.plugin.js
export const AnalyticsPlugin = {
  /**
   * Plugin installer function.
   * @param {import('avenx-core/runtime').AvenxApp} app
   * @param {object} [options]
   */
  install(app, options = {}) {
    const trackingId = options.trackingId || 'UA-000000-0';
    console.log(`[AnalyticsPlugin] Initialized with tracking ID: ${trackingId}`);

    // Register a global mixin or helper on app
    app.mixin({
      methods: {
        trackEvent(category, action, label = '') {
          console.log(`[Analytics] Tracked event: ${category} -> ${action} (${label})`);
        },
      },
    });
  },
};
```

### Functional Plugin Format

A Functional plugin is a function that receives the `app` instance and configuration `options` directly:

```javascript
// src/plugins/logger.plugin.js
export function LoggerPlugin(app, options = {}) {
  const prefix = options.prefix || '[App]';

  app.mixin({
    methods: {
      logInfo(message) {
        console.log(`${prefix} ${message}`);
      },
    },
  });
}
```

### Installing Plugins

Call `app.use()` in your application entry file (`src/main.app.js`):

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import { AnalyticsPlugin } from './plugins/analytics.plugin.js';
import { LoggerPlugin } from './plugins/logger.plugin.js';

const app = new AvenxApp({ target: '#app' });

// Install object plugin with options
app.use(AnalyticsPlugin, { trackingId: 'UA-123456-1' });

// Install functional plugin with options
app.use(LoggerPlugin, { prefix: '[MyStore]' });
```

:::note
**Duplicate Installation Prevention:** Calling `app.use()` multiple times with the same plugin instance is safely ignored. Avenx-JS tracks installed plugins internally so plugins are only executed once.
:::

---

## 2. Global Mixins (`app.mixin`)

Global mixins allow you to inject reusable options, state, methods, and lifecycle hooks into **every component** created within the application.

Register a global mixin by calling `app.mixin(mixinObject)`.

### Basic Usage

```javascript
app.mixin({
  state: {
    appName: 'My Avenx App',
  },
  methods: {
    formatCurrency(amount) {
      return `$${Number(amount).toFixed(2)}`;
    },
  },
});
```

All registered components automatically gain access to `this.state.appName` and `this.formatCurrency()` inside their templates, actions, or methods.

---

### Option Merging & Inheritance Rules

When a component is instantiated, global mixin options are merged into the component following specific precedence rules:

| Option | Merging Behavior | Precedence |
| :--- | :--- | :--- |
| `state` / `data` | Merged as a shallow key-value object. | Component state overrides mixin state keys. |
| `computed` | Merged into component computed property getters. | Component computed properties override mixin getters. |
| `methods` | Merged onto the component instance. | Component methods override mixin methods. |
| `props` | Default prop schemas are merged. | Component prop definitions override mixin defaults. |
| Custom Properties | Attached directly onto component instances. | Accessible inside templates via `{{ customProp }}`. |

#### Example: State & Method Overrides

```javascript
app.mixin({
  state: {
    theme: 'dark',
    userRole: 'guest',
  },
  methods: {
    getRole() {
      return this.state.userRole;
    },
  },
});
```

If a component defines its own `state: { theme: 'light' }`, the resulting component state will be `{ theme: 'light', userRole: 'guest' }`.

---

### Lifecycle Hook Chaining & Execution Order

Unlike state or methods (where component definitions override mixin options), **lifecycle hooks are not overridden**. Instead, mixin lifecycle hooks and component lifecycle hooks are chained together into an array and executed sequentially.

Mixin lifecycle hooks run in order of registration **before** the component's own lifecycle hooks:

1. `Mixin1.onBeforeMount()`
2. `Mixin2.onBeforeMount()`
3. `Component.onBeforeMount()`
4. `Mixin1.onMount()`
5. `Mixin2.onMount()`
6. `Component.onMount()`

```javascript
app.mixin({
  onMount() {
    console.log('Global mixin onMount: Tracking component mount');
  },
  onUnmount() {
    console.log('Global mixin onUnmount: Cleaning up component resources');
  },
});
```

:::tip
**Error Robustness:** If an exception occurs inside a mixin lifecycle hook, Avenx-JS logs the error and continues executing subsequent mixin and component hooks to prevent unhandled mixin failures from breaking component initialization.
:::

---

## 3. Best Practices: Plugins vs. Mixins vs. Bridges

| Pattern | Best For | Usage Guidelines |
| :--- | :--- | :--- |
| **Global Plugins (`app.use`)** | External libraries, third-party services, application setup packages. | Use plugins to encapsulate modular setup logic and pass options cleanly. |
| **Global Mixins (`app.mixin`)** | Utility functions, global formatting helpers, app-wide lifecycle tracking. | Use global mixins sparingly to avoid cluttering component namespaces with unused properties. |
| **State Bridges (`bridge()`)** | Shared reactive domain state (User Auth, Shopping Cart, Notifications). | Use a [Bridge](/core-concepts/bridges) instead of mixins when components need to share reactive state that changes over time. |
