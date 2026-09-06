---
title: 'TypeScript & JSDoc Support'
description: 'Configure IDE autocompletion, type-checking with jsconfig.json, and JSDoc annotations in Avenx-JS projects.'
---

Avenx-JS ships TypeScript declarations (`.d.ts`) for its runtime, so the files
in your project that **are** JavaScript get real editor support with no build
step. What you get differs by file type, and it is worth being precise about
which, because the difference is structural rather than a gap waiting to be
filled.

| File | Editor support |
| :--- | :--- |
| `main.app.js`, `*.bridge.js`, `*.guard.js` | Full. Type checking, completion, hover documentation and go-to-definition from `avenx-core`'s declarations. |
| `*.component.js`, `*.page.js` | Markup-level. Tag and attribute completion for Avenx's own declarations, hover documentation, folding and formatting. |

**Component and page files are not JavaScript.** A `.component.js` file is
markup with `<state>`, `<computed>` and `<action>` declarations in it, so the
JavaScript language service cannot check it — pointed at one, it reports an
error on nearly every line. `avenx init` therefore associates those files with
HTML mode and excludes them from `jsconfig.json`, and ships an
`avenx.html-data.json` that teaches HTML completion about Avenx's tags.

What checks the code *inside* them is the compiler, not the editor:

- `avenx check` validates every template binding against the component's
  declarations, and reports an undeclared reference with a file and a line.
- `avenx build` fails if a template expression, computed value or directive
  binding is outside the expression language Avenx evaluates — `AVX_R32`, with
  the expression, the reason and the position.

There is no Avenx language server today. Full in-editor diagnostics for the
expressions inside a component file would need one, and this page will say so
until there is.

---

## Configuring `.vscode/jsconfig.json`

`avenx init` writes this for you. It turns type checking **on** for the
JavaScript in your project, and excludes component and page files, which are
markup:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "node",
    "checkJs": true,
    "allowJs": true,
    "strict": false
  },
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

### Compiler Options Explained

| Option | Value | Description |
| --- | --- | --- |
| `checkJs` | `true` | Enables real-time type checking and error reporting for `.js` files directly in your IDE. |
| `allowJs` | `true` | Allows JavaScript files to be imported and type-checked alongside TypeScript declarations. |
| `moduleResolution` | `"node"` | Resolves imports from `avenx-core` and `node_modules` automatically. |
| `target` | `"ESNext"` | Supports modern ES syntax, top-level `async/await`, and private fields. |

---

## Type Annotations with JSDoc

Avenx-JS components and framework utilities integrate seamlessly with JSDoc annotations.

### 1. Single-File Components (`.component.js`)

In Avenx-JS single-file components, state properties, actions, and computed getters are declared using `<state>`, `<action>`, and `<computed>` tags. You can add JSDoc comments to type state properties and action parameters:

```html
<!-- src/components/user-card.component.js -->
<state
  /** @type {string} */
  name="Alice"
  /** @type {number} */
  age="28"
/>

<action name="incrementAge">
  /** Increment user age */
  this.state.age++;
</action>

<computed uppercaseName>
  return this.state.name.toUpperCase();
</computed>

<div>
  <h3>{{ uppercaseName }}</h3>
  <p>Age: {{ age }}</p>
  <button @click="incrementAge()">Birthday</button>
</div>
```

---

### 2. Route Guards (`AvenxGuard`)

Route guards extend `AvenxGuard` and implement `canActivate(to, from)`. JSDoc annotations type route parameter objects and return values:

```javascript
// src/guards/auth.guard.js
import { AvenxGuard } from 'avenx-core/runtime';

export default class AuthGuard extends AvenxGuard {
  /**
   * Determines whether the route transition can proceed.
   *
   * @param {Object} to - Target route object (contains hash, page, params)
   * @param {Object} from - Current route object (contains hash, page, params)
   * @returns {boolean | string | Promise<boolean | string>}
   */
  canActivate(to, from) {
    const token = localStorage.getItem('authToken');

    if (!token) {
      // Redirect unauthorized users to login page
      return '#/login';
    }

    return true;
  }
}
```

---

### 3. Bridges (`bridge()`)

Bridges hold shared reactive state and the actions that change it. `bridge()` infers the whole type from your definition — there is nothing to annotate twice:

```javascript
// src/bridges/theme.bridge.js
import { bridge } from 'avenx-core/runtime';

/**
 * @typedef {'light' | 'dark'} ThemeMode
 */

export default bridge({
  state: {
    /** @type {ThemeMode} */
    mode: 'dark',
  },

  get isDark() {
    return this.mode === 'dark';
  },

  /**
   * Updates the active UI theme mode.
   * @param {ThemeMode} newMode - The mode to switch to.
   */
  setMode(newMode) {
    this.mode = newMode;
  },
});
```

Inside the definition, `this` is typed with writable state plus `emit`. Consumers get the same members with state and getters marked `readonly`, so assigning to shared state is a compile error as well as a runtime one:

```typescript
import theme from '../bridges/theme.bridge.js';

theme.isDark;              // boolean
theme.setMode('light');    // ok
theme.mode = 'light';      // ✗ read-only property
```

See the [Bridges guide](/core-concepts/bridges/) for the full type story.

---

### 4. Custom Directives (`app.directive`)

Register custom directives on `AvenxApp` with typed lifecycle hooks (`mounted`, `updated`, `unmounted`):

```javascript
import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

app.directive('focus', {
  /**
   * @param {HTMLElement} el
   */
  mounted(el) {
    el.focus();
  },
});
```

---

### 5. Programmatic Component Classes (`AvenxComponent`)

For unit testing, custom wrappers, or programmatic rendering, component classes extend `AvenxComponent<S>`:

```javascript
import { AvenxComponent } from 'avenx-core/runtime';

/**
 * @typedef {Object} UserState
 * @property {string} name
 * @property {number} age
 */

export default class UserCard extends AvenxComponent {
  /**
   * @param {Object} bridges
   * @param {Object} props
   */
  constructor(bridges, props) {
    /** @type {UserState} */
    const initialState = { name: 'Alice', age: 28 };
    super(initialState, {}, bridges, '<div>{{ state.name }}</div>', {}, props);
  }
}
```

---

## IDE Integration Tips

- **Autocompletion for Framework APIs**: Importing classes from `avenx-core/runtime` provides full IntelliSense for methods like `this.$watch()`, `this.$emit()`, `mount()`, and `setProps()`.
- **Hover Documentation**: Hovering over core framework classes or methods displays parameter types, return values, and JSDoc documentation directly in your editor.
- **Strict Null Checks**: If you set `"strictNullChecks": true` in `jsconfig.json`, wrap potentially undefined reactive properties in optional chaining (e.g., `this.state.user?.name`).
