---
title: "Plugin Authoring Guide"
description: "A comprehensive guide to authoring, packaging, and testing third-party plugins for Avenx-JS."
---

This guide covers building third-party plugins for Avenx-JS, from extension mechanisms and compiler contracts to packaging and distribution.

---

## 1. When to Write a Plugin

Before writing a plugin, determine whether a plugin is the right abstraction:

* **Global Mixin (`app.mixin`)**: Use when sharing component lifecycle hooks or lightweight methods across all components without needing global registration or external configuration.
* **Bridge (`AvenxBridge`)**: Use when managing shared, reactive domain state (e.g., authentication, shopping cart) across components.
* **Plugin (`app.use`)**: Use when packaging reusable functionality that configures an application, registers global components, injects template helpers, hooks into bridge lifecycles, or extends the compilation pipeline.

---

## 2. The Installer Contract

Avenx-JS plugins follow an installer contract. A plugin can be authored as an **Object** with an `install` method or as a **Function**.

### Object Plugin

```javascript
export const myPlugin = {
  install(app, options = {}) {
    // app provides access to:
    // app.component(name, definition)
    // app.mixin(mixinObject)
    // app.config
  }
};
```

### Functional Plugin

```javascript
export function myPlugin(app, options = {}) {
  // Same installer logic
}
```

### Installation Guarantees

* **Once-only installation (Idempotency)**: `app.use()` maintains an internal registry of installed plugins. Registering the same plugin multiple times is safely ignored.
* **Option forwarding**: The second argument passed to `app.use(plugin, options)` is forwarded directly to `install(app, options)`.
* **Async installation**: If your plugin performs asynchronous setup (e.g., loading remote config), return a Promise from `install(app, options)`. Consumers awaiting initialization can call `await app.use(...)`.

---

## 3. Registering Components from a Plugin

Plugins can register reusable components globally using `app.component(name, definition)`:

```javascript
import IconComponent from "./IconComponent.js";

export const IconPlugin = {
  install(app) {
    app.component("ax-icon", IconComponent);
  }
};
```

### Tag-Naming Rules
* Must contain at least one hyphen (`-`) conforming to custom element specifications (e.g., `ax-icon`, `ui-button`).
* **Prefixing**: Avoid standard HTML tags or internal framework prefixes (`avenx-`). Always namespace your tags with a distinct prefix to avoid collisions.

---

## 4. Template Globals Contract (`templateGlobals`)

When a plugin injects helper functions or variables into component templates (such as `$t`, `n`, `d`, or `$i18n` in `@avenx/i18n`), the Avenx compiler statically validates template identifiers via `ComponentParser.validateTemplate()`.

Because compilation occurs ahead of time, the compiler cannot detect runtime `app.use()` calls. Any template global not known to the compiler will trigger an undeclared reference warning or failure during `avenx check`.

### The Author's Contract
Always document the required globals in your plugin's README so consumers know which identifiers to register.

### The Consumer's Contract
Consumers must declare these names in their project's `avenx.config.json` under `templateGlobals`:

```json
{
  "templateGlobals": ["t", "thtml", "n", "d", "rel", "locale", "$i18n"]
}
```

Declaring them informs the compiler to treat those identifiers as valid globals across all component templates.

---

## 5. Extending Bridges via `setup()`

Stateful or persistence plugins (like `@avenx/persistence`) can integrate directly with bridge lifecycles via the bridge's `setup()` extension hook. This enables capturing snapshots, hydration, or synchronizing reactive state with browser storage or WebSockets:

```javascript
export const persistencePlugin = {
  install(app, options = {}) {
    const storageKey = options.key || "avenx_state";

    if (app.bridge && typeof app.bridge.setup === "function") {
      app.bridge.setup((bridgeInstance) => {
        // Hydrate from stored state
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          bridgeInstance.hydrate(JSON.parse(saved));
        }

        // Subscribe to subsequent state mutations
        bridgeInstance.subscribe((state) => {
          localStorage.setItem(storageKey, JSON.stringify(state));
        });
      });
    }
  }
};
```

---

## 6. Compiler Preprocessors

Plugins that transform component syntax or perform compile-time code generation (such as `@avenx/charts`) can export a compiler preprocessor entry point (e.g., `preprocessor.js`).

A preprocessor runs before component templates are parsed into AST nodes:

```javascript
// preprocessor.js
export function preprocess(source, context) {
  return source.replace(/<ax-chart\s+([^>]+)>/g, "<canvas data-ax-chart $1>");
}
```

Consumers wire preprocessors into their build pipeline via `avenx.config.json`:

```json
{
  "compiler": {
    "preprocessors": ["@avenx/charts/preprocessor"]
  }
}
```

---

## 7. Packaging & Distribution

Structure your plugin package so it can be consumed in both ESM and CommonJS environments, while providing TypeScript typings:

```
my-plugin/
├── src/
│   └── index.js
├── dist/
│   ├── index.cjs
│   ├── index.mjs
│   └── index.d.ts
├── scripts/
│   └── build.js
├── package.json
└── README.md
```

### `package.json` Configuration
Always declare `avenx-core` as a `peerDependency`:

```json
{
  "name": "avenx-toast",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "peerDependencies": {
    "avenx-core": "^1.0.0"
  }
}
```

---

## 8. Testing Plugins

Test your plugin against real compiled components and test harnesses using `mountTestComponent` from `avenx-core/testing` or `AvenxMock`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { AvenxApp } from "avenx-core";
import { mountTestComponent } from "avenx-core/testing";
import { toastPlugin } from "../src/index.js";

test("registers plugin and exposes global helper", () => {
  const app = new AvenxApp();
  app.use(toastPlugin, { duration: 2000 });

  assert.equal(typeof app.config.globalProperties.$notify, "function");
});
```

---

## 9. Minimal End-to-End Example

Here is a complete, minimal plugin providing a notification banner:

```javascript
// src/index.js
const ToastComponent = {
  template: `
    <div class="ax-toast-wrap" if="$notifys.length">
      <div class="ax-toast" each="item in $notifys">{{ item.text }}</div>
    </div>
  `,
  state() {
    return { $notifys: [] };
  }
};

export const toastPlugin = {
  install(app, options = {}) {
    const timeout = options.timeout || 3000;

    // 1. Register component
    app.component("ax-toast-container", ToastComponent);

    // 2. Attach global property
    app.config.globalProperties.$notify = (text) => {
      console.log(`[Toast ${timeout}ms]: ${text}`);
    };
  }
};

export default toastPlugin;
```

### Consuming the Plugin

```javascript
import { createApp } from "avenx-core";
import toastPlugin from "avenx-toast";
import App from "./App.ax";

const app = createApp(App);
app.use(toastPlugin, { timeout: 5000 });
app.mount("#app");
```
