---
title: 'Custom Directives'
description: 'Learn how to extend HTML elements with custom reactive behaviors and low-level DOM manipulations using Avenx-JS Custom Directives.'
---

Avenx-JS provides built-in directives like `data-ax-show`, `data-ax-class`, `data-ax-html`, [`data-ax-validate`](/core-concepts/form-validation), and [`data-ax-ref`](#built-in-element-reference-directive-data-ax-ref). In addition to these built-in directives, Avenx-JS allows you to register **Custom Directives** to perform direct, low-level DOM manipulations when reactive data changes.

> [!TIP]
> For declarative form validation using `data-ax-validate` and the `this.state.$validation` reactive schema, see the [Form Validation & $validation](/core-concepts/form-validation) guide.

---

## Built-in Element Reference Directive (`data-ax-ref`)

While Avenx-JS encourages data-driven declarative UI development, certain tasks require direct access to underlying HTML DOM elements (e.g. focusing input fields, invoking HTML5 Canvas 2D API methods, or measuring element dimensions).

The `data-ax-ref="refName"` directive assigns a named reference to a DOM element within the component template, making it accessible on the component instance via `this.$refs.refName`.

```html
<input data-ax-ref="searchInput" type="text" placeholder="Search..." />
```

### Accessing `$refs` in Component Actions & Lifecycle Hooks

After the component mounts (`onMount`), references are accessible on `this.$refs`:

#### 1. Form Input Auto-Focus Example

```javascript
// src/components/search-bar.component.js
export default {
  actions: {
    onMount() {
      // Focus the input element on mount
      if (this.$refs.searchInput) {
        this.$refs.searchInput.focus();
      }
    },
    clearSearch() {
      this.state.query = '';
      this.$refs.searchInput?.focus();
    },
  },

  template: `
    <div class="search-bar">
      <input
        data-ax-ref="searchInput"
        data-ax-bind="query"
        type="text"
        placeholder="Type to search..."
      />
      <button @click="clearSearch">Clear</button>
    </div>
  `,
};
```

#### 2. HTML5 Canvas Context Example

```javascript
// src/components/chart.component.js
export default {
  actions: {
    onMount() {
      const canvas = this.$refs.chartCanvas;
      if (canvas && canvas.getContext) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#4f46e5';
        ctx.fillRect(10, 10, 150, 100);
      }
    },
  },

  template: `
    <div class="chart-container">
      <canvas data-ax-ref="chartCanvas" width="300" height="150"></canvas>
    </div>
  `,
};
```

> [!IMPORTANT]
> - **Component Boundary Scoping:** References are strictly scoped to the declaring component. Elements with `data-ax-ref` inside nested child component boundaries are ignored by parent `$refs`.
> - **Availability:** `$refs` entries are populated after DOM attachment during `onMount`. They return `undefined` before DOM mounting (`onBeforeMount`).


---

## What is a Custom Directive?

A custom directive is a reusable object containing lifecycle hooks that are executed as HTML elements are mounted, updated, or removed from the DOM. Directives allow you to perform direct, low-level DOM manipulations and encapsulate reactive UI behaviors without duplicating imperative code across components.

Directives are applied to HTML elements in component templates using the `data-ax-${directiveName}` attribute (e.g., `data-ax-focus`, `data-ax-tooltip`).

---

## Registering Custom Directives

Custom directives can be registered globally on your application instance using `app.directive(name, definition)`:

```typescript
app.directive(name: string, definition: DirectiveDefinition | DirectiveFunction): AvenxApp
```

```javascript
import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

// 1. Register with lifecycle hooks object
app.directive('focus', {
  mounted(el) {
    if (typeof el.focus === 'function') {
      el.focus();
    }
  },
});

// 2. Register with shorthand function (executes for both mounted and updated)
app.directive('color', (el, binding) => {
  el.style.color = binding.value;
});
```

You can then use the custom directive in any component template:

```html
<input data-ax-focus type="text" placeholder="Auto-focused input..." />
<p data-ax-color="state.themeColor">Dynamic theme text</p>
```

---

## Lifecycle Hooks & The `binding` Object

A custom directive definition provides three primary lifecycle hooks (both standard names and alias names are supported):

| Hook | Alias | Parameters | When Invoked |
| --- | --- | --- | --- |
| `mounted` | `bind` | `(el: Element, binding: DirectiveBinding)` | Called when the bound element is inserted into the DOM. Ideal for initial setup and attaching listeners. |
| `updated` | `update` | `(el: Element, binding: DirectiveBinding)` | Called after the containing component updates and the bound expression value changes (`binding.value !== binding.oldValue`). |
| `unmounted` | `unbind` | `(el: Element, binding: DirectiveBinding)` | Called when the bound element is removed from the DOM. Essential for cleanup and teardown. |

### The `binding` Object

The `binding` parameter provides metadata and values associated with the directive expression:

| Property | Type | Description |
| --- | --- | --- |
| `value` | `any` | The current evaluated result of the directive expression. |
| `oldValue` | `any` | The previous evaluated value before the update (available in `updated` / `update` and `unmounted` / `unbind`). |
| `expression` | `string` | The raw string expression assigned to the directive attribute in the template. |
| `modifiers` | `object` | An object containing boolean flags for dot-notation modifiers (e.g. `data-ax-tooltip.top.lazy` -> `{ top: true, lazy: true }`). |

---

## Practical Examples

### 1. Auto-Focus Directive (`data-ax-focus`)

Automatically sets focus on an input element when it is mounted into the DOM:

```javascript
app.directive('focus', {
  mounted(el) {
    if (typeof el.focus === 'function') {
      el.focus();
    }
  },
});
```

Usage in template:

```html
<input data-ax-focus type="text" placeholder="Search..." />
```

---

### 2. Click-Outside Directive (`data-ax-click-outside`)

Detects clicks outside of the target element and executes a callback function (ideal for closing dropdown menus, popovers, or modal dialogs):

```javascript
app.directive('click-outside', {
  mounted(el, binding) {
    // Define event handler and store reference on element
    el.__clickOutsideHandler__ = (event) => {
      if (!(el === event.target || el.contains(event.target))) {
        if (typeof binding.value === 'function') {
          binding.value(event);
        }
      }
    };

    // Attach global click listener
    document.addEventListener('click', el.__clickOutsideHandler__);
  },
  unmounted(el) {
    // Remove global listener on unmount to prevent memory leaks
    if (el.__clickOutsideHandler__) {
      document.removeEventListener('click', el.__clickOutsideHandler__);
      delete el.__clickOutsideHandler__;
    }
  },
});
```

Usage in template:

```html
<!-- Triggers state.closeDropdown() when clicking outside the menu container -->
<div class="dropdown-menu" data-ax-click-outside="state.closeDropdown">
  <ul>
    <li>Option 1</li>
    <li>Option 2</li>
  </ul>
</div>
```

---

### 3. Dynamic Tooltip Directive (`data-ax-tooltip`)

Creates a custom floating tooltip element that follows user hover actions and updates dynamically when state changes:

```javascript
app.directive('tooltip', {
  mounted(el, binding) {
    // Create floating tooltip DOM node
    const tooltipNode = document.createElement('div');
    tooltipNode.className = 'avenx-tooltip';
    tooltipNode.textContent = binding.value || '';
    tooltipNode.style.cssText = 'position: absolute; display: none; background: #333; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; z-index: 9999; pointer-events: none;';
    document.body.appendChild(tooltipNode);

    const show = (e) => {
      tooltipNode.style.display = 'block';
      tooltipNode.style.left = `${e.pageX + 10}px`;
      tooltipNode.style.top = `${e.pageY + 10}px`;
    };

    const hide = () => {
      tooltipNode.style.display = 'none';
    };

    el.addEventListener('mouseenter', show);
    el.addEventListener('mousemove', show);
    el.addEventListener('mouseleave', hide);

    // Save handles for update and teardown
    el.__tooltipState__ = { tooltipNode, show, hide };
  },

  updated(el, binding) {
    if (binding.value !== binding.oldValue && el.__tooltipState__) {
      el.__tooltipState__.tooltipNode.textContent = binding.value || '';
    }
  },

  unmounted(el) {
    if (el.__tooltipState__) {
      const { tooltipNode, show, hide } = el.__tooltipState__;
      el.removeEventListener('mouseenter', show);
      el.removeEventListener('mousemove', show);
      el.removeEventListener('mouseleave', hide);

      if (tooltipNode && tooltipNode.parentNode) {
        tooltipNode.parentNode.removeChild(tooltipNode);
      }
      delete el.__tooltipState__;
    }
  },
});
```

Usage in template:

```html
<button data-ax-tooltip="state.tooltipMessage">
  Hover for Info
</button>
```

---

## Best Practices & Performance Guidelines

1. **Strict Resource Cleanup in `unmounted` / `unbind`**: Always remove event listeners (`document.removeEventListener`), clear timers (`clearInterval`), and disconnect observers (`ResizeObserver.disconnect()`) to prevent memory leaks in single-page applications.
2. **Avoid Unnecessary DOM Reflows in `updated` / `update`**: Always check `if (binding.value !== binding.oldValue)` before mutating DOM styles or attributes to avoid triggering redundant layout calculations.
3. **Encapsulate Private Handlers on Elements**: Store event handler functions and DOM node references directly on private properties of `el` (e.g. `el.__myDirectiveHandler__`) so they can be retrieved in `updated` and `unmounted` without relying on module-level variables.
4. **Use Dot-Notation Modifiers for Options**: Leverage `binding.modifiers` (e.g. `data-ax-directive.once.prevent`) to allow template authors to toggle directive behavior cleanly.

---


## Resource cleanup in the `unmounted` hook

When a bound element leaves the DOM (component unmount, `v-if`/conditional
removal, or route change), Avenx calls `unmounted(el, binding)`. Use it to
tear down anything the directive attached that would otherwise leak:

| Cleanup | Typical pattern |
|---------|-----------------|
| Global listeners | `window` / `document` handlers added in `mounted` |
| Timers | `clearTimeout` / `clearInterval` / cancel `requestAnimationFrame` |
| Element-owned state | `delete el.__myDirectiveState` (or similar) |
| Observers | `ResizeObserver` / `IntersectionObserver` / `MutationObserver` `.disconnect()` |

Store handles on the element in `mounted` so `unmounted` can find them without
module-level globals.

### Example: scroll position tracker

```javascript
app.directive('scroll-track', {
  mounted(el, binding) {
    const onScroll = () => {
      if (typeof binding.value === 'function') {
        binding.value({ x: window.scrollX, y: window.scrollY });
      }
    };
    el.__scrollTrackHandler__ = onScroll;
    el.__scrollTrackRaf__ = 0;
    window.addEventListener('scroll', onScroll, { passive: true });
  },
  unmounted(el) {
    if (el.__scrollTrackHandler__) {
      window.removeEventListener('scroll', el.__scrollTrackHandler__);
      delete el.__scrollTrackHandler__;
    }
    if (el.__scrollTrackRaf__) {
      cancelAnimationFrame(el.__scrollTrackRaf__);
      delete el.__scrollTrackRaf__;
    }
  },
});
```

The built-in click-outside example above follows the same pattern: attach in
`mounted`, remove and `delete` the property in `unmounted`.

## Compiler Validation

During compilation, the Avenx-JS compiler validates expressions inside custom directives. If a directive attribute references an undeclared variable or state property, the compiler emits a diagnostic warning (`AVX_W11` / `COMPILER_UNDECLARED_VARIABLE`), helping catch typos before runtime.

---

## Directive Evaluation Lifecycle & Security

### Evaluation flow

1. **Compile time** — The compiler discovers built-in and custom `data-ax-*` attributes and binds them to expression strings or handlers.
2. **Mount** — On first mount, directive expressions are evaluated against the component instance (`this` / `state` / injected values) and applied to the live DOM node.
3. **Update** — When reactive state used by a directive changes, Avenx re-evaluates that directive during the component patch cycle. Directives that do not depend on dirty state are skipped.
4. **Unmount** — Custom directive `unmounted` hooks (when provided) run so listeners and DOM side effects can be cleaned up.

### HTML sanitization (`data-ax-html`)

Binding untrusted HTML with `data-ax-html` is dangerous. Avenx sanitizes injected markup and emits security warnings when risky content is stripped or blocked:

| Warning | Meaning |
| :--- | :--- |
| `AVX_W16` | A disallowed / sanitized tag was removed from HTML content |
| `AVX_W17` | Related sanitizer warning for unsafe markup patterns |
| `AVX_W21` | Additional HTML security warning during sanitize |

Prefer text interpolation or structured child components over raw HTML. If you must use `data-ax-html`, only pass trusted, server-sanitized content.

See [Error Reference](/troubleshooting/errors) for full warning text and examples.

