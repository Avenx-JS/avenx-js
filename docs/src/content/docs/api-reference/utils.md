---
title: 'Utility Functions'
description: 'API documentation for utility tags, helper classes, and reactivity APIs in Avenx-JS.'
---

Helper classes and APIs for managing security, custom markup insertion, and programmatic reactivity.

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
// Returns: &lt;h1&gt;Text&lt;/h1&gt;
```

## 4. `Sanitizer`

A utility class used to escape and clean up templates and dynamic HTML tags by stripping dangerous elements/attributes while preserving safe markup.

### Constructor

```javascript
import { Sanitizer } from 'avenx-core/runtime';

const sanitizer = new Sanitizer(config);
```

- `config` (optional): An object to customize the allowed HTML tags and attributes.
  - `allowedTags` (string[]): Custom array of allowed tag names. Defaults to a standard safe set of elements (e.g., `div`, `span`, `p`, `a`, `img`, etc.).
  - `allowedAttributes` (Record<string, string[]>): Custom mapping of tag names to allowed attribute arrays. Use `*` to specify attributes allowed globally on all elements.

### Methods

#### `sanitize(html)`

Sanitizes an input string containing HTML by filtering it against the allowed tags and attributes configuration. Dangerous elements (like `<script>`, `<style>`, `<iframe>`, etc.) and unsafe URL protocols (like `javascript:`, `data:` except for safe image data) are stripped.

**Parameters:**

- `html` (any): The raw content to sanitize (coerced to a string).

**Returns:**

- `string`: The sanitized, safe HTML string.

**Example**

```javascript
import { Sanitizer } from 'avenx-core/runtime';

const sanitizer = new Sanitizer();

const dirtyHtml = '<div>Hello <script>alert("xss")</script> <a href="javascript:alert(1)">World</a></div>';
const cleanHtml = sanitizer.sanitize(dirtyHtml);

console.log(cleanHtml);
// Output: <div>Hello  <a>World</a></div>
```

## 5. Reactivity API Reference

Avenx-JS exposes APIs for programmatically creating reactive state objects and observing reactive values.

The core reactivity APIs include `StateFactory`, `AvenxWatcher`, and the `AvenxComponent.watch()` instance method.

## 6. `StateFactory`

`StateFactory` creates reactive proxy objects from regular JavaScript objects.

### Constructor

```javascript
import { StateFactory } from 'avenx-core';

const stateFactory = new StateFactory();
```

The constructor optionally accepts a proxy handler factory class.

```javascript
new StateFactory(handlerFactoryClass);
```

- `handlerFactoryClass` (optional): The factory class used to create proxy handlers. Defaults to `ProxyHandlerFactory`.

#### `create(initialState, options)`

Creates and returns a reactive proxy for the provided state object.

```javascript
const state = stateFactory.create(initialState, options);
```

**Parameters**

- `initialState` (object, optional): The initial state object to make reactive. Defaults to an empty object.
- `options` (object, optional): Configuration options passed to the proxy handler factory. Defaults to an empty object.

**Returns**

- `Proxy`: A reactive proxy around the provided state object.

If `initialState` is already an Avenx reactive proxy, `create()` returns the existing proxy instead of wrapping it in another proxy.

**Example**

```javascript
import { StateFactory } from 'avenx-core';

const stateFactory = new StateFactory();

const state = stateFactory.create({
  count: 0,
  user: {
    name: 'Avenx User',
  },
});

state.count++;
state.user.name = 'Updated User';
```

Options supplied to `create()` are forwarded to the underlying `ProxyHandlerFactory`.

```javascript
const state = stateFactory.create(
  {
    count: 0,
  },
  {
    onChange() {
      console.log('State changed');
    },
  },
);
```

## 7. `AvenxWatcher`

`AvenxWatcher` observes values returned by reactive getter functions. During getter evaluation, the watcher tracks accessed reactive properties and responds when those dependencies change.

### Constructor

```javascript
import { AvenxWatcher } from 'avenx-core';

const watcher = new AvenxWatcher(getter, callback, options);
```

**Parameters**

- `getter` (function): A function that returns the reactive value or expression to observe.
- `callback` (function | null, optional): Called when the watched value changes. The callback receives the new value and previous value.
- `options` (object, optional): Configuration options controlling watcher behavior.

### Options

#### `immediate`

```javascript
{
  immediate: true;
}
```

When `true`, the callback runs immediately after the initial value is evaluated.

The initial callback receives the current value as the first argument and `undefined` as the previous value.

#### `lazy`

```javascript
{
  lazy: true;
}
```

When `true`, the initial getter evaluation is postponed until the watcher is evaluated.

### Properties

- `getter` — The reactive evaluation function supplied to the constructor.
- `callback` — The callback function invoked when the watched value changes.
- `options` — The watcher configuration object.
- `deps` — A `Set` containing the reactive dependencies tracked by the watcher.
- `dirty` — A boolean indicating whether a lazy watcher needs to be re-evaluated.
- `value` — The currently stored value returned by the getter.

### Methods

#### `get()`

Evaluates the getter inside the active watcher context and tracks reactive dependencies.

```javascript
const value = watcher.get();
```

#### `evaluate()`

Evaluates a lazy watcher when it is dirty and returns the stored value.

```javascript
const value = watcher.evaluate();
```

#### `update()`

Re-evaluates the watcher when one of its tracked dependencies changes.

For non-lazy watchers, the callback runs when the value changes or when the evaluated value is an object.

For lazy watchers, the watcher is marked as dirty.

#### `teardown()`

Removes the watcher from all tracked dependencies and clears its dependency collection.

```javascript
watcher.teardown();
```

Use `teardown()` when manually managing an `AvenxWatcher` instance that is no longer needed.

## 8. `AvenxComponent.watch()`

Every `AvenxComponent` instance provides a `watch()` method for observing reactive values programmatically.

### Signature

```javascript
this.watch(getter, callback, options);
```

**Parameters**

- `getter` (function): A function returning the reactive value to observe.
- `callback` (function): Called when the watched value changes. Receives `newValue` and `oldValue`.
- `options` (object, optional): Watcher configuration options such as `immediate` and `lazy`.

**Returns**

- `AvenxWatcher`: The watcher instance created for the component.

Watchers registered with `this.watch()` are stored by the component and automatically cleaned up when the component is unmounted.

### Watching Dynamic State

The getter function determines which reactive state properties should be tracked.

```javascript
import { AvenxComponent } from 'avenx-core';

class CounterComponent extends AvenxComponent {
  constructor() {
    super({
      count: 0,
    });

    this.watch(
      () => this.state.count,
      (newValue, oldValue) => {
        console.log(`Count changed from ${oldValue} to ${newValue}`);
      },
    );
  }
}
```

Whenever `state.count` changes, the getter is re-evaluated and the callback receives the new and previous values.

### Using the `immediate` Option

Set `immediate` to `true` to execute the callback immediately with the initial value.

```javascript
this.watch(
  () => this.state.count,
  (newValue, oldValue) => {
    console.log('Current count:', newValue);
  },
  {
    immediate: true,
  },
);
```

During the initial callback, `oldValue` is `undefined`.

### Watching Dynamic Dependencies

Watchers track reactive properties that are accessed while the getter executes. This allows the watched dependency to change dynamically.

```javascript
this.watch(
  () => {
    return this.state.usePrimary ? this.state.primaryValue : this.state.secondaryValue;
  },
  (newValue, oldValue) => {
    console.log('Selected value changed:', newValue, oldValue);
  },
);
```

The getter observes `usePrimary` and accesses either `primaryValue` or `secondaryValue` based on the current state.

### Cleaning Up Watchers

Watchers created with `this.watch()` are automatically cleaned up when the component is unmounted.

When creating an `AvenxWatcher` manually, call `teardown()` when the watcher is no longer required:

```javascript
const watcher = new AvenxWatcher(
  () => state.count,
  (newValue, oldValue) => {
    console.log(newValue, oldValue);
  },
);

watcher.teardown();
```
