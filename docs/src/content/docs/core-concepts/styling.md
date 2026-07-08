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

<div @css="card">
    <!-- Component Content -->
</div>

## 2. Global CSS & Custom Variables (`<@global>`)

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
