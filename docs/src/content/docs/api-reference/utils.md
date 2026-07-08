---
title: 'Utility Functions'
description: 'API documentation for utility tags and helper classes like html, SafeHtml, and HTML Escapers.'
---

Helper classes and tags to manage security and custom markup insertions.

## 1. `html` template tag

Creates a `SafeHtml` wrapper around a template literal, allowing you to build raw HTML content safely. Parameters inserted are automatically escaped unless they are instances of `SafeHtml`.

```javascript
import { html } from 'avenx-core/runtime';

const userContent = "<script>alert('xss')</script>";
const element = html`<div class="content">${userContent}</div>`;
// Output escapes userContent safely!
```

## 2. `SafeHtml` class

A wrapper class designating that a string is verified and safe for raw output. Evaluated directly without escaping inside `{{{ ... }}}` expressions.

## 3. `HtmlEscaper`

Internal utility class providing character replacement mappings to prevent code injections:

```javascript
const escaper = new HtmlEscaper();
escaper.escape('<h1>Text</h1>');
// Returns: <h1>Text</h1>
```
