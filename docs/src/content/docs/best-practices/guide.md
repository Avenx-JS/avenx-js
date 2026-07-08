---
title: 'Best Practices'
description: 'Best practices for maximizing performance and securing Avenx-JS applications.'
---

Maximize performance and security in your Avenx-JS applications by adhering to the following
guidelines.

## Security and XSS Prevention

- **Use Double Curly Braces (`{{ ... }}`) by Default**: Always use double curly braces for content interpolation, as it automatically encodes special HTML entities to prevent script injection.

- **Restrict Triple Curly Braces (`{{{ ... }}}`)**: Only use triple braces when rendering trusted content. Sanitise raw data before outputting.

- **Dynamic URL Attributes**: Be cautious when binding variables to element URLs (such as `href` or `src`) to prevent `javascript:` payload executions.

## Performance Optimisations

- **Assign Unique Keys to Loops**: When using the `<@for>` loop, always provide a `key` attribute (e.g. `key="item.id"`). This allows the `ListManager` to identify elements uniquely and move existing DOM elements instead of rebuilding them.

```html
<!-- HIGHLY RECOMMENDED -->
<@for item in state.items key="item.id">
    <p>{{ item.name }}</p>
</@for>
```

- **Clean up Global Listeners**: If your actions subscribe to window events or set timers, always clean them up in the `onUnmount()` lifecycle callback to prevent memory leaks:

```javascript
onMount() {
    this.timer = setInterval(() => this.state.tick++, 1000);
}
onUnmount() {
    clearInterval(this.timer);
}
```

- **Leverage Computed caching**: Avoid putting heavy calculation scripts inside component actions or template interpolations directly. Define them in a `<computed>` tag so that the runtime caching mechanism can prevent redundant executions.
