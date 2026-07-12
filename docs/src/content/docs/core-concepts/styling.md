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

| | Attribute syntax | Tag syntax |
|---|---|---|
| Form | `<div @css card>` | `<@css card />` |
| Placement | On the element itself | As a child or sibling of the element |
| Best for | Static, hand-written templates | Templates where the target element is generated or you don't want to touch its opening tag directly |

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

## 5. Scoping Limitations and Nesting Rules

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

The nested `h1` selector does not contain `&`, so the compiler prepends the generated scope class directly to the selector. Conceptually, the result is:

```css
.generated-hashh1 {
  color: red;
}
```

There is no space between the generated scope class and `h1`. As a result, this selector does not target an `h1` element that is a descendant of the scoped `card` block.

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

The `&` refers to the generated scoped selector. Conceptually, this compiles to:

```css
.generated-hash h1 {
  color: red;
}
```

The space creates a descendant selector, so the rule correctly targets `h1` elements inside the scoped block.

For example:

```html
<div @css card>
  <h1>Card title</h1>
</div>
```

> **Note:** When targeting child or descendant elements inside a scoped CSS block, always use `&` followed by the required selector.

### Parent Selectors and Pseudo-classes

The `&` character can also be used to reference the scoped parent selector when applying pseudo-classes or other selector modifiers.

For example:

```css
<@css>
    card {
        &:hover {
            border-color: #6366f1;
        }

        &:focus {
            outline: 2px solid #6366f1;
        }
    }
</@css>
```

Conceptually, these selectors compile to:

```css
.generated-hash:hover {
  border-color: #6366f1;
}

.generated-hash:focus {
  outline: 2px solid #6366f1;
}
```

Use `&:hover`, `&:focus`, and similar patterns when the selector should apply directly to the scoped parent element.

### Nesting At-rules

Nesting at-rules such as `@media` and `@container` are resolved while preserving the scoped selector rules inside them.

For example:

```css
<@css>
    card {
        @media (max-width: 768px) {
            & h1 {
                font-size: 1.5rem;
            }
        }
    }
</@css>
```

The descendant selector continues to require `&` because it targets an element inside the scoped block.

The same rule applies when using container queries:

```css
<@css>
    card {
        @container (min-width: 500px) {
            & .content {
                display: grid;
                grid-template-columns: 1fr 1fr;
            }
        }
    }
</@css>
```

In both cases, the at-rule is resolved while the nested selector remains scoped to the component.

When writing nested scoped styles, remember:

- Use `& h1`, `& .child`, or similar selectors to target descendants.
- Use `&:hover`, `&:focus`, and similar selectors to target states of the scoped parent.
- Continue using `&` for descendant selectors nested inside `@media` and `@container` rules.
- A nested selector without `&` is scoped by directly prepending the generated hash and does not create a descendant selector.
