---

title: 'Templates & Slots'
description: 'How slots, data-bindings, loops, and conditional templates work in Avenx-JS.'
-------------------------------------------------------------------------------------------

Avenx-JS provides a clean HTML-based template engine that supports text interpolation, HTML transclusion, two-way bindings, and loops.

## 1. Interpolation & HTML Escaping

* **Escaped Text (`{{ expression }}`)**: Values are automatically passed through an HTML escaper to prevent Cross-Site Scripting (XSS).

```html
<p>Hello {{ state.username }}</p>
```

* **Raw HTML (`{{{ expression }}}`)**: Allows inserting unescaped HTML. Use this with caution.

```html
<div>{{{ state.rawHtml }}}</div>
```

## 2. Two-Way Bindings (`data-ax-bind`)

Form inputs (input, textarea, select) support two-way bindings via `data-ax-bind`. This is translated at compile-time to a value attribute and an event listener:

```html
<input type="text" data-ax-bind="state.username" />
```

> **Warning:** `data-ax-bind` does not currently handle the boolean `checked` state of checkbox and radio inputs. Since the directive binds to the input's `value` and listens for `input` events, using it with checkboxes or radio buttons will not correctly update their checked state.

For checkbox inputs, bind the `checked` attribute manually and listen for the `change` event:

```html
<input
  type="checkbox"
  checked="{{ state.checked }}"
  @change="state.checked = event.target.checked"
/>
```

This ensures that the checkbox's checked state is rendered from `state.checked` and that the state is updated whenever the checkbox changes.

## 3. Loops (`<@for>`)

Render arrays using the custom `<@for>` loop tag. Loop blocks are translated to `<template>` tags and managed via the `ListManager` for efficient DOM list updates:

```html
<@for item in state.todos key="item.id">
    <li class="todo-item">{{ item.text }}</li>
</@for>
```

## 4. Slots & Transclusion

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

## 5. SVG Support

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
