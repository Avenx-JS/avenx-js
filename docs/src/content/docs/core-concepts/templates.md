---
title: 'Templates & Slots'
description: 'How slots, data-bindings, loops, and conditional templates work in Avenx-JS.'
---

---

Avenx-JS provides a clean HTML-based template engine that supports text interpolation, HTML transclusion, two-way bindings, and loops.

## 1. Interpolation & HTML Escaping

Avenx-JS template expressions provide two interpolation modes:

- **Escaped Text (`{{ expression }}`)**: Values are automatically passed through an HTML escaper (`HtmlEscaper`) to convert special characters (`<`, `>`, `&`, `"`, `'`) into entities, preventing Cross-Site Scripting (XSS).

```html
<p>Hello {{ state.username }}</p>
```

- **Unescaped Raw HTML (`{{{ expression }}}`)**: Allows inserting raw, unescaped HTML nodes directly into the DOM tree.

```html
<div>{{{ state.rawHtml }}}</div>
```

### Escaped (`{{ }}`) vs. Unescaped (`{{{ }}}`) Comparison

| Syntax | Output Handling | Example Input | Rendered DOM Output |
| :--- | :--- | :--- | :--- |
| `{{ expr }}` | Automatically HTML-escaped | `<script>alert(1)</script>` | `&lt;script&gt;alert(1)&lt;/script&gt;` |
| `{{{ expr }}}` | Raw HTML interpolation | `<strong>Bold Text</strong>` | `<strong>Bold Text</strong>` |

> [!CAUTION]
> **Cross-Site Scripting (XSS) Security Warning:** Rendering untrusted user input using `{{{ ... }}}` introduces severe Cross-Site Scripting (XSS) vulnerabilities. Never pass raw user inputs, URL parameters, or unvalidated form fields directly to triple-curly expressions.

### Safe Raw HTML Rendering with `Sanitizer`

Before rendering user-generated HTML content with `{{{ ... }}}`, use the built-in `Sanitizer` class from `avenx-core/runtime` to strip dangerous elements (like `<script>`, `<iframe>`, or inline `onerror` handlers):

```javascript
import { AvenxComponent, Sanitizer } from 'avenx-core/runtime';

export default class ForumPost extends AvenxComponent {
  onMount() {
    const sanitizer = new Sanitizer();
    
    // Sanitize untrusted post content before assigning to state
    const untrustedContent = this.props.rawPostContent;
    this.state.safeContent = sanitizer.sanitize(untrustedContent);
  }
}
```

```html
<!-- Renders clean, sanitized HTML safely -->
<article class="post-body">
  {{{ state.safeContent }}}
</article>
```

## Dynamic HTML Content (`data-ax-html`)

The `data-ax-html` directive binds HTML content directly to an element. Unlike standard text interpolation (`{{ ... }}`), it is designed for rendering HTML.

### Default Escaping

When a normal string is provided, HTML characters are automatically escaped to help prevent Cross-Site Scripting (XSS) attacks.

```html
<div data-ax-html="state.message"></div>
```

```js
state.message = '<strong>Hello World</strong>';
```

Output:

```html
&lt;strong&gt;Hello World&lt;/strong&gt;
```

### Rendering Trusted HTML

To render HTML without escaping, wrap the content with `SafeHtml` or generate it using the `html` tagged template helper.

```js
state.message = new SafeHtml('<strong>Hello World</strong>');
```

or

```js
state.message = html`<strong>Hello World</strong>`;
```

Output:

```html
<strong>Hello World</strong>
```

### Null and Undefined Values

If the bound value is `null` or `undefined`, an empty string is rendered.

### Security Advisory

Only use `SafeHtml` or the `html` helper with trusted content. Rendering untrusted user input without escaping may introduce Cross-Site Scripting (XSS) vulnerabilities.

## 2. Two-Way Bindings (`data-ax-bind`)

Form inputs (input, textarea, select) support two-way bindings via `data-ax-bind`. This is translated at compile-time to an attribute binding and an event listener:

```html
<input type="text" data-ax-bind="state.username" />
```

The compiler picks the DOM property from the control, so the same directive works across input types.

### Text inputs, textareas and selects

These bind through `value`. Text inputs and textareas listen for `input`; selects listen for `change`:

```html
<input type="text" data-ax-bind="state.username" />
<textarea data-ax-bind="state.bio"></textarea>
<select data-ax-bind="state.city"></select>
```

### Checkboxes

A checkbox binds through `checked`, not `value`.

Bound to a boolean, it mirrors that boolean and writes back `event.target.checked`:

```html
<input type="checkbox" data-ax-bind="state.acceptedTerms" />
```

Bound to an array, several checkboxes form a group. Each input's `value` is added to or removed from the array as it is checked, and `checked` follows membership:

```html
<input type="checkbox" value="apple" data-ax-bind="state.fruits" />
<input type="checkbox" value="banana" data-ax-bind="state.fruits" />
```

With `state.fruits` starting as `['apple']`, the first box renders checked; ticking the second gives `['apple', 'banana']`.

### Radio buttons

Radios in a group share one bound value. `checked` is the comparison between the model and the input's `value`, and selecting one stores that value:

```html
<input type="radio" name="color" value="red" data-ax-bind="state.selectedColor" />
<input type="radio" name="color" value="blue" data-ax-bind="state.selectedColor" />
```

Selecting the second input sets `state.selectedColor` to `'blue'`, which unchecks the first.

A `checked` attribute written by hand on a bound checkbox or radio is dropped: the binding owns that state. Set the initial value in `<state>` instead.

## 3. Boolean Attributes Coercion

The framework's template patcher (`lib/core/renderer/domPatch.js`) provides automatic handling for standard HTML boolean attributes when bound to expressions (e.g., `disabled="{{ state.isSubmitting }}"`).

When a boolean attribute's value is bound to an expression, Avenx-JS automatically toggles its presence on the element and sets the underlying DOM property to `true` or `false` based on the evaluated truthiness:

- **Truthy Evaluation**: If the bound expression evaluates to a truthy value, the attribute is added to the HTML element and the underlying DOM property is set to `true` (e.g., `element.disabled = true`).
- **Falsy Evaluation**: If the bound expression evaluates to a falsy value (`false`, `null`, `undefined`, or `"false"`), the attribute is automatically removed from the HTML element and the DOM property is set to `false` (e.g., `element.disabled = false`).

### Supported Boolean Attributes

Avenx-JS automatically coerces the following standard HTML boolean attributes:

- `disabled`
- `checked`
- `required`
- `readonly`
- `selected`
- `multiple`
- `autofocus`
- `novalidate`
- `formnovalidate`
- `hidden`
- `open`
- `reversed`
- `loop`
- `controls`
- `autoplay`
- `muted`
- `default`
- `ismap`
- `async`
- `defer`

### Examples

#### Button State

```html
<button disabled="{{ state.isSubmitting }}">Submit</button>
```

When `state.isSubmitting` is `true`, the `disabled` attribute is present on the `<button>` and `button.disabled = true`. When `state.isSubmitting` becomes `false`, the attribute is automatically removed and `button.disabled = false`.

#### Checkbox and Form Inputs

```html
<input type="checkbox" checked="{{ state.accepted }}" />
<input type="text" required="{{ state.requireName }}" readonly="{{ state.readOnly }}" />
```

#### Media Elements

```html
<video controls="{{ state.showControls }}" autoplay="{{ state.autoPlay }}" muted="{{ state.muted }}"></video>
```

#### Details Element

```html
<details open="{{ state.expanded }}">
  <summary>More Information</summary>
  <p>Content...</p>
</details>
```

When binding conditional flags to inputs or buttons, bind your expression directly to the boolean attribute. Avenx-JS automatically handles adding/removing the attribute and setting the DOM property based on evaluated truthiness.

## 4. Conditional Visibility (`data-ax-show`)

The `data-ax-show` directive reactively toggles the visibility of an element by modifying its inline CSS `display` property based on the evaluated expression.

### Basic Usage

```html
<div data-ax-show="state.isVisible">This content is conditionally visible.</div>
```

When `state.isVisible` evaluates to a truthy value, the element is visible. When it evaluates to a falsy value, the element is hidden using `display: none`.

### How It Works & State Conservation

Unlike simple directives that hardcode `display: block` or remove the element from the DOM entirely, `data-ax-show` carefully conserves your layout styling:

1. **Boolean Conversion**: The directive evaluates the expression and converts the result to a strict boolean (equivalent to `!!value`).
2. **Conserving Original Display**: On initialization, before any styles are modified, Avenx-JS saves the element's original CSS `display` property (such as `flex`, `grid`, `inline-block`, or default `""`) to an internal property (`__originalDisplay`) on the DOM element.
3. **Restoring Visibility**:
   - When switching to **true** (visible), the element's `style.display` is restored to its conserved `__originalDisplay` value.
   - When switching to **false** (hidden), `style.display` is set to `'none'`.

### Example with Flexbox and Grid Layouts

Because `__originalDisplay` is conserved, toggling visibility will never break custom layout containers:

```html
<!-- The inline 'display: flex' is saved to __originalDisplay on init -->
<div style="display: flex; gap: 10px;" data-ax-show="state.showToolbar">
  <button>Action 1</button>
  <button>Action 2</button>
</div>
```

When `state.showToolbar` becomes `true`, the element correctly reverts to `display: flex` instead of defaulting to `block`.

### Integration with Transitions

`data-ax-show` integrates seamlessly with Avenx-JS's animation lifecycle when combined with `<transition>` wrappers or `data-ax-transition` attributes:

- **Enter Transitions**: When switching from `false` to `true`, `display` is restored to `__originalDisplay` immediately, and the compiler triggers the `-enter`, `-enter-active`, and `-enter-to` CSS class sequence.
- **Leave Transitions**: When switching from `true` to `false`, the element is **not** hidden immediately. Instead, the `-leave`, `-leave-active`, and `-leave-to` CSS classes are applied. An exit callback waits for the CSS transition or animation to finish before finally setting `style.display = 'none'`.

For a complete guide and code examples on animating visibility toggles, see the [Transition Animations](./transitions.md#conditional-rendering-transitions) documentation.

:::tip
If evaluating a `data-ax-show` expression fails (for instance, when referencing an undefined property on `state`), Avenx-JS emits warning **AVX_W22** (`DIRECTIVE_SHOW_EVALUATION_FAILED`). Refer to the [Error Codes reference](/troubleshooting/errors#avx_w22--directive_show_evaluation_failed) for detailed troubleshooting steps.
:::


## 5. Reactive Style Bindings (`data-ax-style`)

Use the `data-ax-style` directive to dynamically apply inline CSS styles using a JavaScript object.

### Basic Usage

```html
<p data-ax-style="{{ { color: state.textColor } }}">Dynamic text color</p>
```

When `state.textColor` changes, the element's `color` style is updated automatically.

### Multiple Style Bindings

```html
<div
  data-ax-style="{{ {
    color: state.textColor,
    backgroundColor: state.backgroundColor,
    fontSize: state.fontSize + 'px'
  } }}"
>
  Styled content
</div>
```

### Conditional Styles

```html
<span
  data-ax-style="{{ {
    color: state.isError ? 'red' : 'green',
    fontWeight: state.isActive ? 'bold' : 'normal'
  } }}"
>
  Status
</span>
```

Using object syntax keeps templates more readable and maintainable than manually constructing inline style strings.

## 6. Dynamic Class Bindings (`data-ax-class`)

Use the `data-ax-class` directive to add or remove CSS classes reactively. Static `class="…"` attributes on the same element are preserved.

### String Format

When the expression evaluates to a string, its space-separated tokens are applied as class names:

```html
<div class="card" data-ax-class="state.themeClass">Themed card</div>
```

```js
// e.g. in <state />
themeClass = 'theme-dark highlight';
```

When `state.themeClass` changes, previously applied dynamic classes from this directive are replaced with the new set. The static `card` class remains.

### Object Format

Pass an object whose **truthy** keys become class names (quote keys that are not valid identifiers):

```html
<button class="btn" data-ax-class="{ active: state.isActive, 'text-large': state.isLarge, disabled: state.isDisabled }">
  Action
</button>
```

| Expression value                        | Result                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `{ active: true, 'text-large': false }` | adds `active`; removes `text-large` if it was previously set by this directive |
| `"theme-blue"`                          | applies `theme-blue`                                                           |
| `""` / falsy                            | clears dynamic classes from this directive                                     |

> **Note:** Object and string forms are evaluated as template expressions in the component scope (same rules as other `data-ax-*` bindings). Prefer object form for multiple independent toggles.

## 7. Loops (`<@for>`)

Render lists, objects, sets, maps, or numeric ranges using the custom `<@for>` loop tag. Loop blocks are translated to `<template>` tags and managed via the `ListManager` for efficient DOM updates:

```html
<@for item in state.todos key="item.id">
  <li>{{ item.title }}</li>
</@for>
```

### Supported Data Sources

The `<@for>` loop can iterate over various sources:

1. **Arrays**: Iterates over array elements.
2. **Objects**: Iterates over the object's enumerable properties (entries). Use destructuring syntax to get `[key, value]`:
   ```html
   <@for [key, value] in state.settings key="key">
     <li>{{ key }}: {{ value }}</li>
   </@for>
   ```
3. **Maps and Sets**: Iterates in insertion order. For maps, destructuring works just like objects: `[key, value]`.
4. **Numeric Ranges**: Iterates `N` times from `0` to `N-1`.
   ```html
   <!-- Renders 0, 1, 2, 3, 4 -->
   <@for n in 5 key="n">
     <li>Item #{{ n }}</li>
   </@for>
   ```

### The Implicit `index` Variable

In addition to your item variable, every `<@for>` loop automatically injects a zero-indexed `index` variable into the template scope. You don't need to declare it — `ListManager` adds it for you on each iteration:

```html
<@for item in state.todos key="item.id">
  <li class="{{ index % 2 === 0 ? 'even' : 'odd' }}">
    {{ index + 1 }}. {{ item.title }}
  </li>
</@for>
```

### Empty States (`<@empty>`)

When the iterable source is empty (e.g. `[]`, `{}`, or `0`), you can display a fallback block using the `<@empty>` tag inside the loop:

```html
<@for item in state.todos key="item.id">
  <li>{{ item.title }}</li>
  <@empty>
    <li class="empty-state">No todos left!</li>
  </@empty>
</@for>
```

### Keys (`key="..."`)

## 8. Slots & Transclusion

Components can receive child HTML blocks using `<slot>` elements. Both default and named slots are fully supported.

#### Component Definition (e.g. `Card`)

```html
<div class="card">
  <div class="card-header">
    <slot name="header">Default Header</slot>
  </div>
  <div class="card-body">
    <slot></slot>
    <!-- Default Slot -->
  </div>
</div>
```

#### Component Usage

```html
<Card>
  <h2 slot="header">Special Title</h2>
  <p>This content goes directly into the default slot!</p>
</Card>
```

#### Fallback (Default) Slot Content

If a component's caller does not provide content for a given slot, Avenx-JS automatically falls back to rendering the default content defined inside that `<slot>` element in the component's template. This applies to both named and default slots. For example, in the `Card` component above, if no `slot="header"` element is passed in, the header slot will render its fallback text, `Default Header`, instead of being left empty. This makes it easy to define sensible defaults for optional component content without requiring the caller to always supply every slot.

### Checking Slot Presence (`this.$slots.has()`)

Components can determine whether a slot was provided by the parent using
`this.$slots.has(slotName)`.

#### Default Slot

```javascript
if (this.$slots.has('default')) {
  console.log('Default slot provided');
}
```

#### Named Slot

```javascript
if (this.$slots.has('header')) {
  console.log('Header slot provided');
}
```

If the slot is not provided, `this.$slots.has()` returns `false`, allowing components to conditionally render fallback content.

## 9. Passing Props to Child Components (`data-props-*`)

Custom child components can receive props from a parent page or component using the `data-props-<propName>` attribute syntax. The parser evaluates the attribute's value as an expression in the parent's scope and passes the resulting value into the child component as a prop.

```html
<MyProfile data-props-user="state.currentUser" />
```

Here, `data-props-user` passes the value of `state.currentUser` from the parent scope into the `MyProfile` component as the `user` prop. Inside the child component, the prop is accessed via `this.props.user`:

```html
<!-- src/components/my-profile/my-profile.component.js -->
<div class="profile">
  <p>Welcome, {{ this.props.user.name }}</p>
</div>
```

> **Note:** The portion of the attribute name after `data-props-` becomes the prop name on the child (e.g. `data-props-user` → `props.user`). Multiple props can be passed by adding additional `data-props-*` attributes:

```html
<MyProfile data-props-user="state.currentUser" data-props-isAdmin="state.isAdmin" />
```

## 10. SVG Support

Avenx-JS natively supports rendering SVG elements inside templates. During template cloning and patching, the framework automatically preserves the correct SVG namespace (`http://www.w3.org/2000/svg`), ensuring that SVG graphics render correctly in the browser.
This includes nested SVG elements such as `<rect>`, `<circle>`, `<path>`, and other SVG-specific tags. Even when templates are parsed using `DOMParser`, Avenx-JS automatically transitions SVG elements into the correct namespace during patching and cloning, so no additional configuration or manual namespace handling is required.

#### Example

```html
<svg width="200" height="200" viewBox="0 0 200 200">
  <rect x="20" y="20" width="160" height="160" rx="12" fill="#4F46E5" />
  <circle cx="100" cy="100" r="50" fill="#22C55E" />
  <path d="M50 150 L100 50 L150 150 Z" fill="#FACC15" />
</svg>
```

---

## 11. Static Subtree Optimization & Reconciliation Markers (`data-ax-static`, `data-ax-skip`, `data-ax-key`)

To achieve maximum rendering performance and eliminate Virtual DOM overhead, the Avenx-JS compiler performs static template analysis during component compilation. It decorates template subtrees with internal reconciliation attributes that instruct `DomPatcher` and `ListManager` to bypass unnecessary DOM diffing.

### 1. Static Subtree Marker (`data-ax-static="true"`)

During component parsing (`ComponentParser.optimizeStaticSubtrees()`), Avenx-JS walks the HTML template tree and identifies subtrees that contain no dynamic interpolations (`{{ }}` or `{{{ }}}`), directives (`data-ax-*`), or nested components. The root node of each static subtree is automatically decorated with `data-ax-static="true"`.

During reactive state updates, when `DomPatcher` encounters an element with `data-ax-static="true"`, it immediately bypasses attribute patching and child node diffing for that entire subtree:

```javascript
// Inside DomPatcher.#patchNode
if (!isPatchRoot && oldNode.nodeType === Node.ELEMENT_NODE && oldNode.hasAttribute('data-ax-static')) {
  return; // Skip diffing for static subtree!
}
```

#### Compiled Output Example

**Source SFC Template:**

```html
<div class="user-card">
  <!-- Static Subtree: No interpolations or directives -->
  <header class="card-header">
    <h3>User Profile</h3>
    <p>Account Overview & Settings</p>
  </header>

  <!-- Dynamic Content -->
  <div class="card-body">
    <p>Welcome, {{ state.username }}</p>
  </div>
</div>
```

**Compiled Template Output:**

```html
<div class="user-card">
  <header class="card-header" data-ax-static="true">
    <h3>User Profile</h3>
    <p>Account Overview & Settings</p>
  </header>

  <div class="card-body">
    <p>Welcome, {{ state.username }}</p>
  </div>
</div>
```

Because `<header>` is tagged with `data-ax-static="true"`, any update to `state.username` re-diffs only `<div class="card-body">`, while `<header>` and its children are skipped entirely during DOM patching.

### 2. Directive Bypass Marker (`data-ax-skip="true"`)

Directives like `data-ax-html` or custom element directives can instruct `DomPatcher` to skip recursive child node diffing (`skipChildren = true`). This prevents `DomPatcher` from overwriting imperatively managed DOM structures or custom inner HTML trees.

### 3. Reconciliation Key Marker (`data-ax-key` / `key`)

During `<@for>` list rendering, `ListManager` assigns or reads `data-ax-key="value"` to track element identities across reactive updates:

- **Node Reuse & Reordering**: During list reconciliations, `DomPatcher` matches elements by `data-ax-key`. Reordered array items are moved in the DOM rather than unmounted and re-created.
- **Node Isolation**: Ensures component state and input focus inside list items are preserved cleanly during array mutations.
