---
title: 'Scoped & Global CSS'
description: 'Master scoped styling and global styles inside Avenx-JS components.'
---

Styling is defined in the companion `.component.css` stylesheet. At compile-time, the Avenx compiler scopes component styles to keep them from bleeding into other views.

## 1. Scoped CSS Blocks (`<@css>`)

CSS rules defined inside `<@css>` use named blocks without dot prefixes. The compiler extracts this CSS, hashes the block names into unique class suffixes, and binds them to the component's HTML tags via the `@css` attribute.

```css
<@css>
    card {
        padding: 1.5rem;
        border: 1px solid #eee;

        /* Pseudo-selectors must be nested inside the named block */
        &:hover {
            border-color: #6366f1;
        }
    }
</@css>
```

```html
<div @css card>
  <!-- Component Content -->
</div>
```

## 2. Tag-based Scoped CSS (`<@css />`)

Besides the attribute syntax shown above, the compiler also recognizes a self-closing **tag** form of `@css` inside HTML templates: `<@css blockName />`. It applies the same generated scoped class as the attribute syntax, but where the class ends up depends on where you place the tag.

### Scoping the host tag

When `<@css blockName />` appears as the first thing inside an element, the scoped class is merged onto that host element:

```html
<div>
  <@css card />
  <h1>Card title</h1>
</div>
```

This is equivalent to writing:

```html
<div @css card>
  <h1>Card title</h1>
</div>
```

### Scoping the preceding sibling

When `<@css blockName />` appears immediately **after** an element (as its next sibling), the scoped class is applied to that preceding element instead:

```html
<div>Card content</div>
<@css card />
```

This is equivalent to writing:

```html
<div @css card>Card content</div>
```

### Attribute vs. tag syntax

|           | Attribute syntax               | Tag syntax                                                                                          |
| --------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Form      | `<div @css card>`              | `<@css card />`                                                                                     |
| Placement | On the element itself          | As a child or sibling of the element                                                                |
| Best for  | Static, hand-written templates | Templates where the target element is generated or you don't want to touch its opening tag directly |

Both forms produce the same scoped class and can be used interchangeably; choose whichever fits your template's structure better.

## 3. Scoping Limitations and Nesting Rules

Nested selectors are scoped by prefixing the generated component class. Selectors that do not use the `&` nesting reference are scoped directly and are **not** interpreted as descendant selectors.

For example, the following does **not** target `h1` elements inside the component:

```css
<@css>
    card {
        h1 {
            color: red;
        }
    }
</@css>
```

To target descendant elements, use the `&` nesting reference:

```css
<@css>
    card {
        & h1 {
            color: red;
        }
    }
</@css>
```

### Parent Selectors

Use `&` to reference the current selector when applying pseudo-classes or combining selectors.

```css
<@css>
    button {
        &:hover {
            background-color: #6366f1;
        }
    }
</@css>
```

### Nested At-Rules

The `&` nesting reference behaves the same way inside nested at-rules such as `@media`, `@supports`, and `@container`.

```css
<@css>
    card {
        @media (max-width: 768px) {
            & h1 {
                font-size: 1rem;
            }
        }
    }
</@css>
```

## 4b. Deep Scoped Selectors (`:deep()` & `::v-deep`)

Scoped CSS keeps rules inside the component. Use **deep selectors** when a parent stylesheet must style child-component DOM or slotted content across that boundary—without switching the whole block to `<@global>`.

`StyleProcessor` strips `:deep(...)` / `::v-deep(...)` (and bare `:deep` / `::v-deep`) at compile time, then applies the component scope hash only to the outer part of the selector. Descendants inside the deep wrapper stay unscoped.

### Supported syntax

| Form | Example | Idea |
| :--- | :--- | :--- |
| Parenthesized modern | `.card :deep(.badge)` | Prefer this form |
| Parenthesized Vue-style | `.card ::v-deep(.badge)` | Same behavior |
| Combinator form | `.card :deep .badge` | Space/`>`/`+`/`~` after `:deep` |

Conceptually:

```css
/* Source (scoped component) */
.card :deep(.badge) {
  color: #6366f1;
}
```

compiles like:

```css
.card[data-ax-scope-a1b2c3] .badge {
  color: #6366f1;
}
```

instead of attaching the scope attribute to `.badge` itself.

### Example

```css
<@css>
    card {
        padding: 1rem;

        & :deep(.child-title) {
            font-weight: 600;
        }
    }
</@css>
```

Use deep selectors sparingly: they intentionally pierce encapsulation. Prefer props, slots, or CSS variables when a child can own its own styles.

## 4c. Inline Component CSS (`static styles`)

Besides companion `.component.css` / `<@css>` blocks, a component **class** may declare a static `styles` string. At runtime, `StyleMountManager` injects that CSS into a shared `<style data-avenx-style="...">` element in `document.head` (one element per component class, reference-counted across instances).

```javascript
import { AvenxComponent } from 'avenx-core/runtime';

export class Badge extends AvenxComponent {
  static styles = `
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: #eef2ff;
      color: #3730a3;
    }
  `;
}
```

Notes:

- `styles` must be a non-empty **string** on the constructor (`componentClass.styles`). Empty or non-string values are ignored.
- Mount increments a ref-count; unmount decrements and removes the `<style>` node when no instances remain.
- Prefer `<@css>` / scoped stylesheets for compile-time scoping hashes; use `static styles` for simple runtime-injected class CSS shared by all instances of that class.

## 4. Global CSS & Custom Variables (`<@global>`)

Declare global styles or design token variables using the `<@global>` block. Use the `@def` directive to define custom color codes or measurements. The compiler replaces these variables statically at build time.

```css
<@global>
    @def primary-color #6366f1;
    @def font-sans 'Inter', sans-serif;

    body {
        margin: 0;
        font-family: @font-sans;
    }
</@global>

<@css>
    btn {
        background-color: @primary-color;
        color: white;
    }
</@css>
```

## 5. Native CSS Custom Properties (Variables) Scoping

In addition to `@def` static macros, Avenx-JS also scopes **native CSS custom properties** (the standard `--variable-name: value;` / `var(--variable-name)` syntax) that are declared inside a `<@css>` block.

When the compiler processes a `<@css>` block, `StyleProcessor` rewrites both the declaration and every `var()` usage of a custom property so that it is unique to that component instance:

```css
<@css>
    card {
        --color-primary: #6366f1;

        background-color: var(--color-primary);

        & .title {
            color: var(--color-primary);
        }
    }
</@css>
```

Conceptually, this compiles to something like:

```css
.avenx-a1b2c3d4 {
  --ax-a1b2c3d4-color-primary: #6366f1;
  background-color: var(--ax-a1b2c3d4-color-primary);
}

.avenx-a1b2c3d4 .title {
  color: var(--ax-a1b2c3d4-color-primary);
}
```

The `--ax-<hashId>-` prefix is derived from the same per-component hash used to scope class selectors, so a custom property named `--color-primary` in one component never collides with a `--color-primary` declared in another component's `<@css>` block, even though both are written identically in source.

### Scoped vs. Global Variables

This automatic renaming only applies to custom properties declared **inside** a `<@css>` block. It does **not** apply to variables declared in `<@global>` or on `:root`, which are compiled as-is and remain globally accessible:

```css
<@global>
    :root {
        --brand-color: #6366f1;
    }
</@global>

<@css>
    card {
        /* Reads the global variable, unaffected by scoping */
        border-color: var(--brand-color);

        /* Declared and scoped locally to this component */
        --card-padding: 1.5rem;
        padding: var(--card-padding);
    }
</@css>
```

| | Declared in `<@global>` / `:root` | Declared inside `<@css>` |
| --- | --- | --- |
| Renamed at compile time | No | Yes, to `--ax-<hashId>-<name>` |
| Visible outside the component | Yes | No â€” effectively private to that component |
| Typical use | Design tokens / theme variables shared across the app | Component-local values, including ones derived from props or state |

### Native Variables vs. `@def` Macros

It's worth distinguishing the two variable systems available inside `<@css>` and `<@global>` blocks:

- **`@def` macros** (e.g. `@def primary-color #6366f1;`, referenced as `@primary-color`) are resolved by simple text substitution at compile time. The `@primary-color` reference is replaced with its literal value before the CSS is emitted, so it produces no runtime CSS variable at all.
- **Native custom properties** (e.g. `--color-primary: #6366f1;`, referenced as `var(--color-primary)`) remain real CSS custom properties in the compiled output. They are only renamed to avoid cross-component collisions â€” they still behave like normal CSS variables at runtime, including being overridable via inline styles or JavaScript.

Use `@def` macros for static design tokens that never need to change at runtime, and native custom properties when you need actual runtime-computed or overridable CSS variables scoped to a component.

## 6. Scoping Limitations and Nesting Rules

The `StyleProcessor` scopes selectors declared inside `<@css>` blocks by prepending the generated component hash to nested selectors that do not contain the nesting reference character `&`.

Because of this scoping behavior, descendant selectors must use `&` explicitly. Writing a nested selector without `&` does not produce a descendant selector.

### Nested Selectors Without `&`

Consider the following scoped style:

```css
<@css>
    card {
        h1 {
            color: red;
        }
    }
</@css>
```

The nested `h1` selector does not contain `&`, so the compiler prepends the generated scope class directly to the selector (`.avenx-hashh1`). There is no space between the generated scope class and `h1`. As a result, this selector does not target an `h1` element that is a descendant of the scoped `card` block.

### Descendant Selectors With `&`

To target an element inside the scoped block, use the `&` nesting reference character:

```css
<@css>
    card {
        & h1 {
            color: red;
        }
    }
</@css>
```

The `&` refers to the generated scoped selector (`.avenx-hash`). Conceptually, this compiles to `.avenx-hash h1`, creating a descendant selector that correctly targets `h1` elements inside the scoped block.

```html
<div @css card>
  <h1>Card title</h1>
</div>
```

---

## 6. Deep Selectors & Target Patterns for Child Components / Slots

By default, scoped component styles only apply to elements defined directly within that component's template. When you need a parent component's styles to affect elements inside a child component, transcluded slot content, or third-party DOM elements, use deep selector patterns with the `&` nesting character.


### 1. Targeting Transcluded Slot Content

Elements passed into a child component via slots are rendered inside the child, but can be styled from the parent component using `&` descendant selectors:

```html
<!-- ParentComponent.component.js -->
<@css>
    modal-wrapper {
        & .slot-header {
            font-size: 1.25rem;
            font-weight: bold;
            color: #1e293b;
        }

        & p {
            line-height: 1.6;
        }
    }
</@css>

<div @css modal-wrapper>
  <CardDialog>
    <template data-slot-props="slotProps">
      <h2 class="slot-header">Modal Title</h2>
      <p>Transcluded slot body content styled by parent modal wrapper.</p>
    </template>
  </CardDialog>
</div>
```

### 2. Targeting Child Component Elements (Deep Styling)

To target elements inside a child component's DOM tree from a parent component's `<@css>` block, use `&` followed by the child's class or element selector:

```css
<@css>
    parent-container {
        /* Styles the child component's root or child nodes */
        & .child-badge {
            background-color: #e0e7ff;
            color: #3730a3;
            border-radius: 9999px;
            padding: 0.25rem 0.75rem;
        }

        /* Targets third-party or child SVG icons */
        & svg {
            width: 1.25rem;
            height: 1.25rem;
            fill: currentColor;
        }
    }
</@css>
```

### 3. Combining Scoped CSS with Global Tokens

For complete design control, combine component-scoped styles with global design tokens declared inside `<@global>`:

```css
<@global>
    @def primary-color #6366f1;
    @def radius-md 8px;
</@global>

<@css>
    badge-card {
        border-radius: @radius-md;
        border: 1px solid #cbd5e1;

        & .badge-title {
            color: @primary-color;
        }

        &:hover {
            border-color: @primary-color;
        }
    }
</@css>
```


## 7. CSS Preprocessors (Sass, SCSS, PostCSS, Less)

Avenx-JS provides built-in integration support for modern CSS preprocessors, including Sass (`.sass`), SCSS (`.scss`), Less (`.less`), and PostCSS. You can write nested preprocessor rules, custom mixins, and variables directly inside your `.component.css` or Single-File Component style blocks.

### 1. Configuration in `avenx.config.json`

To enable CSS preprocessing, set the `style.preprocessor` option in your project's `avenx.config.json`:

```json
{
  "style": {
    "preprocessor": "scss"
  }
}
```

Supported preprocessor values:

| Option | Preprocessor Engine | Supported Syntax |
| --- | --- | --- |
| `"scss"` | Dart Sass (`sass`) | Standard SCSS syntax with brackets and semicolons |
| `"sass"` | Dart Sass (`sass`) | Indented Sass syntax |
| `"less"` | Less (`less`) | Less syntax |
| `"postcss"` | PostCSS (`postcss`) | PostCSS plugins and syntax transformations |

### 2. Installing Peer Dependencies

Avenx-JS does not bundle heavy preprocessor engines by default. To use a preprocessor, install the matching package as a development dependency in your project:

#### Sass / SCSS

```bash
npm install -D sass
```

#### Less

```bash
npm install -D less
```

#### PostCSS

```bash
npm install -D postcss
```

### 3. Preprocessor Pipeline & Scoping Interaction

Preprocessing happens at build time inside the `StyleProcessor` compiler module prior to Avenx-JS scope hashing:

1. **Extraction**: `StyleProcessor` extracts global stylesheets (`<@global>`) and component-scoped blocks (`<@css>`).
2. **Preprocessing**: The raw stylesheet code is passed to the configured preprocessor engine (e.g. `sass.compileString()`). Preprocessor variables (`$primary-color`), `@mixin` directives, `@include` statements, and parent selector references (`&`) are evaluated and compiled into standard CSS.
3. **Scope Hashing**: `StyleProcessor` parses the preprocessed CSS output, generates unique component class scope hashes (e.g. `.avenx-a1b2c3d4`), and scopes native custom properties and `@def` tokens.

### 4. SCSS Example inside Component Styles

```scss
<@global>
    $brand-primary: #6366f1;

    @mixin card-shadow {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
</@global>

<@css>
    card {
        padding: 1.5rem;
        background: #ffffff;
        @include card-shadow;

        & .card-title {
            color: $brand-primary;
            font-size: 1.25rem;
        }

        &:hover {
            border-color: darken($brand-primary, 10%);
        }
    }
</@css>
```

### 5. Graceful Fallback & Warning Codes

Avenx-JS is designed to fail gracefully if preprocessor tools are misconfigured or missing:

- **Missing Peer Package (`AVX_W24`)**: If `style.preprocessor` is set to `"scss"` but the `sass` npm package is not installed in `node_modules`, Avenx-JS logs warning **`AVX_W24` (`COMPILER_PREPROCESSOR_MISSING`)** and falls back to processing the raw stylesheet as vanilla CSS without crashing the build.
- **Preprocessor Compilation Error (`AVX_W31`)**: If SCSS/Less compilation fails due to a syntax error or missing mixin, Avenx-JS catches the exception, logs warning **`AVX_W31` (`COMPILER_PREPROCESSOR_FAILED`)** with the error details, and uses raw CSS as fallback.

> [!TIP]
> If your project uses vanilla CSS, omit the `style.preprocessor` field or set it explicitly to `"none"` to prevent preprocessor checks.

---

## 8. Debugging Scoped CSS with Source Maps

When component styles are compiled, Avenx-JS transforms named block selectors (`<@css> card </@css>`) into scoped CSS classes (e.g. `.avenx-a1b2c3d4`) and bundles them into the final CSS output.

To trace compiled CSS rules in browser developer tools directly back to your original `.component.css` or Single File Component source lines:

1. Enable source maps in your project's `avenx.config.json`:
   ```json
   {
     "style": {
       "sourceMap": true
     }
   }
   ```
2. When inspecting elements in Chrome DevTools, Firefox Developer Tools, or Safari Web Inspector, CSS declarations point directly to the exact file and line number of the source `.component.css` file (e.g. `user-card.component.css:14`) rather than line numbers in `bundle.css`.
3. In development mode or when `"sourceMap": "inline"` / `"inlineSourceMap": true` is set, source maps are embedded directly as base64 comments (`/*# sourceMappingURL=data:application/json... */`). In production builds (`avenx build`), separate external map files (e.g. `bundle.css.map`) are generated alongside `bundle.css`.

## 8. Advanced Scoping Notes

### `<@global>` escape hatch

Rules inside `<@global>` are **not** rewritten with the component scope hash. They apply application-wide (design tokens, resets, utility classes). Prefer keeping component-private rules in `<@css>` so they do not leak.

### Reactive inline styles (`data-ax-style`)

For per-instance dynamic CSS values, use the [`data-ax-style`](/core-concepts/templates#5-reactive-style-bindings-data-ax-style) template directive with a JavaScript object. Prefer scoped classes for static layout; use `data-ax-style` for values that change with reactive state (colors, transforms, dimensions).

### Preprocessor troubleshooting

| Warning | Identifier | When it appears | What to do |
| :--- | :--- | :--- | :--- |
| `AVX_W24` | `COMPILER_PREPROCESSOR_MISSING` | Configured preprocessor package is not installed | Install the package (e.g. `sass`) or remove the `style.preprocessor` setting |
| `AVX_W31` | `COMPILER_PREPROCESSOR_FAILED` | Preprocessor throws (syntax error, bad hook return) | Fix the stylesheet/source; compiler falls back to raw CSS |

Full details: [Compiler Warnings](/troubleshooting/errors#avx_w24--compiler_preprocessor_missing).

---

## 9. StyleMountManager & Dynamic Runtime Style Lifecycle

In addition to static compile-time stylesheet bundling, Avenx-JS provides dynamic runtime CSS injection through the `StyleMountManager` module (`lib/core/runtime/StyleMountManager.js`), exported via `avenx-core/runtime`.

`StyleMountManager` ensures that when components declare runtime styles (such as `static styles = '...'` on class components or dynamically generated CSS), exactly **one** `<style>` element per component class exists in `document.head`, and that styles are automatically cleaned up when all instances of that component unmount.

---

### Reference Counting Architecture

`StyleMountManager` uses reference counting to manage the lifecycle of injected stylesheets:

```text
Component A (Instance 1) mounts   ──► refCount = 1  ──► Append <style data-avenx-style="avenx-style-ComponentA">
Component A (Instance 2) mounts   ──► refCount = 2  ──► Increment refCount (no duplicate DOM node)
Component A (Instance 1) unmounts ──► refCount = 1  ──► Decrement refCount (style remains active)
Component A (Instance 2) unmounts ──► refCount = 0  ──► Remove <style data-avenx-style="avenx-style-ComponentA">
```

#### Lifecycle Steps

1. **Mount & Deduplication (`mount`)**:
   - Reads `componentClass.styles`.
   - Generates a unique style identifier attribute (e.g. `data-avenx-style="avenx-style-UserProfile"`).
   - Checks if a matching `<style>` node already exists in `document.head` (e.g., from SSR hydration or pre-rendered markup). If found, it adopts the element and sets `refCount = 1`.
   - If already registered in memory, increments `refCount++` without creating a duplicate DOM node.
   - If not present, creates and appends `<style data-avenx-style="...">` to `document.head`.

2. **Unmount & Cleanup (`unmount`)**:
   - Decrements `refCount--` for that component class.
   - Verifies whether any active component instances remain in the DOM tree.
   - When `refCount <= 0` (and no active instances remain), removes the `<style>` tag from `document.head` and purges the entry from the internal registry.

---

### API Method Reference

Import the singleton instance or class:

```javascript
import { styleMountManager, StyleMountManager } from 'avenx-core/runtime';
```

| Method | Parameters | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `mount(componentClass)` | `componentClass: Function` | `void` | Mounts runtime styles defined on `componentClass.styles` into `document.head` and increments the reference count. |
| `unmount(componentClass)` | `componentClass: Function` | `void` | Decrements the reference count for `componentClass` and removes the `<style>` element if no active instances remain. |
| `getRefCount(componentClass)` | `componentClass: Function` | `number` | Returns the current active instance reference count for the specified component class (or `0` if unmounted). |

---

### Programmatic Usage Examples

#### 1. Defining Runtime Component Styles (`static styles`)

```javascript
import { AvenxComponent } from 'avenx-core/runtime';

export class StatusPill extends AvenxComponent {
  // Runtime injected CSS
  static styles = `
    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .status-pill.success {
      background-color: #dcfce7;
      color: #15803d;
    }
  `;
}
```

When `<status-pill>` mounts, `StyleMountManager` automatically injects:

```html
<style data-avenx-style="avenx-style-StatusPill">
  .status-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .status-pill.success {
    background-color: #dcfce7;
    color: #15803d;
  }
</style>
```

#### 2. Inspecting Reference Counts in Unit Tests

```javascript
import { styleMountManager } from 'avenx-core/runtime';
import { StatusPill } from './StatusPill.component.js';

describe('StatusPill Style Lifecycle', () => {
  it('increments and decrements style refCount on mount/unmount', () => {
    expect(styleMountManager.getRefCount(StatusPill)).toBe(0);

    const instance1 = new StatusPill();
    styleMountManager.mount(StatusPill);
    expect(styleMountManager.getRefCount(StatusPill)).toBe(1);

    const instance2 = new StatusPill();
    styleMountManager.mount(StatusPill);
    expect(styleMountManager.getRefCount(StatusPill)).toBe(2);

    styleMountManager.unmount(StatusPill);
    expect(styleMountManager.getRefCount(StatusPill)).toBe(1);

    styleMountManager.unmount(StatusPill);
    expect(styleMountManager.getRefCount(StatusPill)).toBe(0);
    expect(document.head.querySelector('[data-avenx-style="avenx-style-StatusPill"]')).toBeNull();
  });
});
```

#### 3. Custom Dynamic Theme Plugins

```javascript
import { styleMountManager } from 'avenx-core/runtime';

export function registerDynamicPluginTheme(pluginName, cssString) {
  class PluginComponentPlaceholder {
    static styles = cssString;
  }
  Object.defineProperty(PluginComponentPlaceholder, 'name', { value: pluginName });

  styleMountManager.mount(PluginComponentPlaceholder);

  return () => {
    styleMountManager.unmount(PluginComponentPlaceholder);
  };
}
```

