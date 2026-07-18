---
title: 'Error Codes'
description: 'Troubleshooting reference for compile-time and runtime error codes in Avenx-JS.'
---

Avenx-JS uses structured error codes starting with `AVX_C` for compiler errors and `AVX_R` for runtime issues.

## The `AvenxError` Class

Every runtime error code in this guide (e.g. `AVX_R01`) is ultimately thrown as an instance of `AvenxError`, a custom error class exported from the framework's runtime module. It extends the native `Error` and pairs a structured `code` with a formatted, human-readable `message`. Understanding this class is useful if you're writing custom guards, components, or services and want to throw or catch framework-consistent errors yourself.

### Constructor

```
new AvenxError(code, ...args)
```

| Parameter | Type     | Description                                                                                          |
| --------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `code`    | `string` | One of the `AvenxErrorCodes` identifiers (e.g. `'AVX_R01'`). Selects which message template is used. |
| `...args` | `any[]`  | Values substituted into the message template's `{0}`, `{1}`, etc. placeholders, in order.            |

### Public Properties

| Property  | Type     | Description                                                                                                                  |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `code`    | `string` | The raw error code passed to the constructor (e.g. `'AVX_R01'`).                                                             |
| `message` | `string` | The fully formatted message, prefixed with the code, e.g. `[AVX_R01] Mount target selector "#app" was not found in the DOM.` |
| `name`    | `string` | Always `'AvenxError'`. Useful for distinguishing it from other `Error` subclasses in a `catch` block.                        |

### Importing

```js
import { AvenxError, AvenxErrorCodes } from 'avenx-js';
```

### Throwing an `AvenxError`

```js
import { AvenxError, AvenxErrorCodes } from 'avenx-js';

function mount(selector) {
  const target = document.querySelector(selector);
  if (!target) {
    throw new AvenxError(AvenxErrorCodes.MOUNT_TARGET_NOT_FOUND, selector);
  }
  // ...
}
```

### Catching and Inspecting an `AvenxError`

```js
import { AvenxError, AvenxErrorCodes } from 'avenx-js';

try {
  mount('#app');
} catch (err) {
  if (err instanceof AvenxError) {
    console.error(`Avenx error [${err.code}]:`, err.message);

    if (err.code === AvenxErrorCodes.MOUNT_TARGET_NOT_FOUND) {
      // Handle this specific failure mode
    }
  } else {
    throw err; // Not an Avenx-specific error, rethrow
  }
}
```

> **Tip:** Branch on `err.code`, not `err.message` — `code` is a stable identifier, while the formatted message text may change between versions.

### Non-throwing formatting with `formatMessage`

To get the same formatted error string without throwing (for example, to log a warning), use the exported `formatMessage` helper. It applies the same code-to-template lookup and placeholder substitution as the `AvenxError` constructor:

```js
import { formatMessage, AvenxErrorCodes } from 'avenx-js';

console.warn(formatMessage(AvenxErrorCodes.SANDBOX_VIOLATION, 'disallowed eval() call'));
// -> "[AVX_R15] Sandbox security violation: disallowed eval() call"
```

## Compiler Codes (`AVX_C*`)

| Code        | Default Message                                                                             | Cause & Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[AVX_C01]` | Could not create dist directory at "{dir}".                                                 | **Cause:** Write permission failure.<br />**Resolution:** Adjust your operating system directory write permissions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `[AVX_C02]` | "src" directory not found.                                                                  | **Cause:** Running the build command outside of an Avenx project root.<br />**Resolution:** Run `npx avenx init` to set up the workspace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `[AVX_C03]` | Duplicate component name(s) detected. These files compile to the same class name: {details} | **Cause:** Two or more component files (e.g. `card.component.js` in different directories) resolve to the same generated class name, since Avenx-JS derives a component's class name from its file name. This causes a naming collision when the components are bundled together.<br />**Resolution:** Rename one of the conflicting files, or move it to a location that produces a distinct class name — for example, renaming `card.component.js` to `profile-card.component.js`. The build halts and lists every conflicting file path so you can identify exactly which components need to be renamed. |

## Compiler Warnings

Unlike the error codes above, which halt compilation, Avenx-JS also emits **warnings** during the build step. Warnings do not stop the build, but they flag potential mistakes in your templates that are worth fixing.

### Undeclared Variable or Method Warning

```text
[Avenx Validation Warning] Undeclared variable or method "x" referenced in template.
```

**Cause:** During compilation, the `validateTemplate` function (in `ComponentParser.js`) scans every template for identifiers used in interpolations (`{{ }}`), bindings (`data-ax-bind`), loops (`<@for>`), and event handlers, then cross-checks each one against everything declared in the component's `state`, `computed`, `actions`, and `bridges`. If a variable or method is referenced in the template but isn't declared in any of these sources, Avenx-JS emits this warning at compile time.

This typically happens for a few common reasons:

- A typo in the variable or method name (e.g. `{{ state.usernmae }}` instead of `{{ state.username }}`).
- Forgetting to declare a new property in `state` or `computed` before referencing it in the template.
- Referencing a method in an event handler (e.g. `onclick="handleSubmit"`) that was never added to `actions`.
- Referencing a bridge that wasn't registered.

**Resolution:** To resolve this warning:

1. Double-check the spelling of the identifier in your template against its declaration in the component script.
2. Make sure the variable or method is actually declared under `state`, `computed`, `actions`, or `bridges` — not just used implicitly.
3. If the identifier is intentionally dynamic (e.g. supplied only at runtime through a bridge that isn't statically known to the parser), you can safely ignore the warning, though most cases indicate a genuine bug.

This validation exists purely to help catch mistakes early — it will not prevent your app from compiling or running, but an undeclared reference will typically resolve to `undefined` at runtime, so it's best to address the warning rather than ignore it.

### AVX_W11 — ROUTE_TITLE_EVALUATION_FAILED

**Warning Message**

```
title() threw an error: {0}
```

**Cause:** This warning is emitted when the `title()` callback defined in a route configuration throws an unhandled exception while the router is evaluating the page title during navigation.This can occur when the callback accesses undefined properties, assumes route data is always available, or performs operations that result in a runtime exception.

**Resolution:** To resolve this warning:

1. Ensure the `title()` callback safely handles missing or undefined values.
2. Use optional chaining when accessing nested properties.
3. Provide a fallback title when the required data is unavailable.

**Incorrect**

```js
export default {
  path: '/users/:id',
  title: (route) => route.data.user.name,
};
```

If `route.data` or `route.data.user` is undefined, the callback throws an exception and AVX_W11 is emitted.

**Correct**

```js
export default {
  path: '/users/:id',
  title: (route) => route.data?.user?.name ?? 'Users',
};
```

The callback safely accesses nested properties and returns a fallback title if the expected data is unavailable.

**Defensive Example**

```js
export default {
  path: '/users/:id',
  title: (route) => {
    const user = route.data?.user;
    return user?.name ?? 'Users';
  },
};
```

Using optional chaining and fallback values helps prevent runtime exceptions during route title evaluation.

### AVX_W12 — PAGE_PROP_EVALUATION_FAILED

**Warning Message**
Failed to evaluate prop expression: {0}. Error: {1}

**Cause:** This warning is emitted during the mounting lifecycle of a routed page when a property mapped to that route — via a route parameter, query mapping, or resolver — fails to resolve or throws an exception during evaluation. Since page props are typically evaluated before the page component fully mounts, an error here can prevent the page from receiving the data it expects.

This typically happens for a few common reasons:

- A resolver function tied to the route throws an exception (e.g. it depends on data that hasn't loaded, or accesses a property on `null`/`undefined`).
- A prop expression references a route parameter or query value that doesn't exist for the current navigation.
- An asynchronous resolver rejects instead of resolving, and the rejection isn't handled.
- A typo or syntax error in the prop mapping expression itself.

**Resolution:** To resolve this warning:

1. Ensure resolver functions handle missing or `undefined` route parameters gracefully, with a sensible fallback value instead of throwing.
2. Wrap resolver logic in a `try...catch` (or handle promise rejections) so failures produce a controlled fallback rather than an unhandled error.
3. Double-check that prop expressions reference route parameters and query keys that actually exist for every route the page can be reached from.
4. If a prop depends on asynchronous data (e.g. an API call), provide a default/loading value so the page can mount safely while data resolves.

**Incorrect**

```javascript
const pageProps = {
  userId: (route) => route.params.user.id
};
```

```html
<!-- Route: /profile (no "user" param defined) -->
```

Since `route.params.user` is `undefined` for this route, accessing `.id` throws, and the prop expression fails to evaluate.

**Correct**

```javascript
const pageProps = {
  userId: (route) => route.params.userId || null
};
```

```html
<!-- Route: /profile/:userId -->
```

**Defensive Example**

```javascript
const pageProps = {
  userId: (route) => {
    try {
      return route.params.userId ?? null;
    } catch (err) {
      console.warn('Failed to resolve userId prop:', err);
      return null;
    }
  }
};
```

Wrapping the resolver and falling back to a safe default ensures the page can still mount even if the expected route data is missing, rather than failing the prop evaluation entirely.

### AVX_W14 — COMPONENT_RESTORE_SLOT_CONTENT_FAILED

**Warning Message**
Failed to restore default slot content. Error: {0}

**Cause:** This warning relates to how Avenx-JS handles component **slots** — placeholder regions inside a component's template where a parent can inject custom ("transcluded") content, falling back to the component's own default markup when nothing is provided. When transcluded content is unmounted (for example, when a parent stops passing slot content, or the component itself unmounts and remounts), Avenx-JS attempts to restore the slot's original default template elements so the component returns to a consistent state. This warning is emitted when that restore step fails.

This typically happens for a few common reasons:

- Code outside the component (custom DOM manipulation, a third-party library, or a browser extension) directly mutated the DOM nodes inside the slot, so the renderer's internal reference to the original default content no longer matches the live DOM.
- The default slot content itself contained elements that were later removed or replaced by other framework logic before the restore attempt ran.
- Rapid mount/unmount cycles on the same component instance interrupted the restore process before it completed.

**Impact:** When this restore fails, the slot may be left empty or in an inconsistent state rather than falling back to the component's intended default content. This is a rendering consistency issue, not a security issue, but it can result in visibly broken or missing UI where default slot content was expected.

**Resolution:** To resolve this warning:

1. Avoid directly mutating the DOM inside a component's slot region from outside the framework (e.g. via `document.querySelector` plus manual `appendChild`/`removeChild` calls). Let Avenx-JS own all DOM updates within its managed tree.
2. If you're integrating a third-party library that manipulates the DOM (such as a jQuery plugin or a non-Avenx widget), mount it outside the component's slot boundary, or use a dedicated wrapper/bridge pattern instead of injecting it directly into slot content.
3. Avoid rapidly toggling a component's mounted state or its slot content in the same render cycle; batch these changes where possible.
4. If the warning persists without any external DOM manipulation, it may indicate a genuine bug — check for other components or event handlers that could be mutating shared DOM nodes.

**Incorrect**

```javascript
// Directly manipulating DOM nodes inside a component's slot from outside Avenx-JS
const slotContainer = document.querySelector('.my-component .slot-content');
slotContainer.innerHTML = '<p>Injected externally</p>';
```

Manipulating the slot's DOM outside of Avenx-JS's rendering tree causes the renderer's internal reference to the default content to become stale, so it cannot reliably restore it later.

**Correct**

```html
<MyComponent>
  <p>Custom transcluded content</p>
</MyComponent>
```

Pass content through the component's own slot mechanism so Avenx-JS can track and restore it correctly.

**Defensive Example**

```javascript
// If integrating a non-Avenx widget, mount it in its own container
// outside the component's slot boundary rather than inside it.
```

```html
<MyComponent></MyComponent>
<div id="third-party-widget-container"></div>
```

Keeping externally-managed DOM separate from Avenx-managed slot regions prevents the renderer from losing track of default slot content.

### AVX_W15 — COMPONENT_INJECT_KEY_NOT_FOUND

**Warning Message**

```
Injected key "{0}" not found in any ancestor component.
```

**Cause:** This warning is emitted at runtime when a component's `inject` option requests a key that no ancestor component provides via the `provide` option. Avenx-JS walks up the DOM tree from the component to find a matching provider; if none is found, the injected property resolves to `undefined` and this warning is issued.

The Provide/Inject API enables parent components to share data or methods with all descendants in the tree without passing them through every intermediate component via props. A provider component declares values using `provide`, and any descendant retrieves them using `inject`.

**Resolution:** To resolve this warning:

1. Ensure an ancestor component declares the requested key in its `provide` option.
2. Verify the component hierarchy — the provider must be an ancestor in the DOM tree (sibling and child components are not searched).
3. If the injected value is optional, guard against `undefined` at the point of use with a fallback value.

**Incorrect**

```js
// ChildComponent
export default {
  inject: ['theme'],
  template: `<p>Theme: {{ theme }}</p>`,
};
```

No ancestor provides a `theme` key, so accessing `theme` triggers AVX_W15 and returns `undefined`.

**Correct**

```js
// ParentComponent
export default {
  provide: {
    theme: 'dark',
  },
  // ...
};
```

```js
// ChildComponent
export default {
  inject: ['theme'],
  template: `<p>Theme: {{ theme }}</p>`,
};
```

The `provide` option accepts an object mapping keys to values, or an array of keys to expose from the component's `state`, `props`, `computed`, or `actions`. The `inject` option accepts an array of keys (local key matches provide key) or an object mapping local property names to provide keys:

```js
export default {
  inject: { currentTheme: 'theme' },
  template: `<p>Theme: {{ currentTheme }}</p>`,
};
```

**Defensive Example**

```js
// ChildComponent — handle optional injection with a default value
export default {
  inject: { currentTheme: 'theme' },
  computed: {
    safeTheme() {
      return this.currentTheme || 'light';
    },
  },
};
```

Using a computed property as a fallback ensures your component behaves gracefully even when no matching provider exists in the ancestor tree.

### AVX_W16 — SECURITY_SANITIZED_TAG

**Warning Message**
Sanitized tag "<{0}>" when stripping content.

**Cause:** This warning is emitted when Avenx-JS's HTML sanitizer detects a forbidden or potentially dangerous tag inside dynamic content being rendered (for example, through `data-ax-html`) and strips it before injecting the content into the DOM. This is a security safeguard against cross-site scripting (XSS) attacks, since dynamic HTML from user input, API responses, or other untrusted sources could otherwise execute arbitrary scripts or embed malicious content.

By default, Avenx-JS forbids the following tags when sanitizing dynamic HTML:

- `<script>`
- `<object>`
- `<embed>`
- `<iframe>`
- `<link>`
- `<style>`
- `<form>`

Any of these tags found in dynamic content are stripped out, and this warning is logged so developers are aware the sanitizer intervened.

**Why these tags are flagged:** Each of these tags can be used to execute or load unauthorized code or content:

- `<script>` can run arbitrary JavaScript.
- `<object>`, `<embed>`, and `<iframe>` can load external content or plugins outside the app's control.
- `<link>` and `<style>` can be used for CSS-based attacks or to exfiltrate data via crafted stylesheets.
- `<form>` can be used to construct unauthorized submissions, including phishing-style attacks.

**Resolution:** This warning does not indicate a bug to "fix" in the traditional sense — it means the sanitizer is working as intended. However, if you're seeing it unexpectedly:

1. Confirm the dynamic content actually needs to include the flagged tag. In most cases it doesn't, and the warning can be safely ignored.
2. If you legitimately need to render rich content (e.g. embedding a video), use a dedicated, purpose-built component instead of raw HTML injection — this keeps the source of the embed under your control rather than passing through arbitrary untrusted markup.
3. Never bypass or disable the sanitizer to "fix" this warning. If you find yourself needing to allow a forbidden tag, treat that as a sign the approach needs to change, not the sanitizer.

**Example**

```javascript
const state = {
  userBio: '<p>Hello!</p><script>alert("xss")</script>',
};
```

```html
<div data-ax-html="state.userBio"></div>
```

When rendered, the sanitizer strips the `<script>` tag and logs:
[Avenx Validation Warning] Sanitized tag "<script>" when stripping content.

The safe portion of the markup (`<p>Hello!</p>`) still renders normally.

**Safe Alternative**

```javascript
const computed = {
  safeBio() {
    return sanitizeUserContent(state.userBio); // pre-sanitized on the server, or use a trusted markdown renderer
  },
};
```

```html
<div data-ax-html="computed.safeBio"></div>
```

Sanitizing or escaping dynamic content at the source — before it ever reaches `data-ax-html` — avoids relying on the framework's sanitizer as a last line of defense.

### AVX_W17 — SECURITY_SANITIZED_ATTRIBUTE

```text
[Avenx Validation Warning] Sanitized attribute "{0}" when stripping content.
```

**Cause:** This warning is emitted when Avenx's HTML sanitizer detects an unsafe HTML attribute or URI while processing templates or raw values. To protect applications from Cross-Site Scripting (XSS) attacks, the sanitizer removes dangerous inline event handler attributes (such as `onclick`, `onload`, and `onerror`) and unsafe URI protocols (such as `javascript:`) before rendering.

**Impact:** Unsafe attributes and protocol URIs can allow arbitrary JavaScript execution in the browser, creating Cross-Site Scripting (XSS) vulnerabilities. Sanitizing these values helps prevent malicious code from being executed.

**Resolution:** To resolve this warning:

1. Remove inline event handler attributes such as `onclick`, `onload`, and `onerror`.
2. Avoid using `javascript:` or other unsafe URI protocols in attributes such as `href` or `src`.
3. Attach event handlers using the framework's supported event binding mechanism or standard JavaScript event listeners.
4. Sanitize any user-provided HTML before rendering it.

**Incorrect**

```html
<img src="image.png" onerror="alert('XSS')" />

<a href="javascript:alert('Hello')">Click me</a>
```

**Correct**

```js
button.addEventListener('click', handleClick);
```

```html
<a href="/dashboard">Dashboard</a>
```

> **Note:** This warning indicates that Avenx removed one or more unsafe attributes during sanitization. Although the application can continue running, the affected attribute will not be rendered. Review the source HTML and replace unsafe attributes with secure alternatives.

### AVX_W18 — RENDER_LIST_EVALUATION_FAILED

**Warning Message**

```
Failed to evaluate list expression: {0}. Error: {1}
```

**Cause:** This warning is emitted at runtime when Avenx-JS attempts to evaluate a dynamic list expression used in `<@for>` or `data-ax-for`, but the expression throws an exception or does not resolve to a valid iterable. This commonly occurs when the referenced variable is `undefined`, `null`, not an array or iterable, or when the expression itself contains an error.

**Resolution:** To resolve this warning:

1. Ensure the list variable is declared before it is used in the template.
2. Verify that the evaluated value is an array or another iterable object.
3. Check for typographical errors in variable or property names.
4. Initialize dynamic lists with an empty array when data may not yet be available.
5. If the list depends on asynchronous data, ensure the data has loaded before rendering.

**Incorrect**

```javascript
const state = {};
```

```html
<@for="user in state.users">
  {{ user.name }}
</@for>
```

Since `state.users` is `undefined`, the renderer cannot evaluate the list expression.

**Correct**

```javascript
const state = {
  users: [],
};
```

```html
<@for="user in state.users">
  {{ user.name }}
</@for>
```

**Defensive Example**

```javascript
const users = Array.isArray(state.users) ? state.users : [];
```

Using a default empty array ensures that the renderer always receives a valid iterable and prevents evaluation failures.

### AVX_W19 — RENDER_KEY_EVALUATION_FAILED

**Warning Message**

```text
Failed to evaluate list key expression: {0}. Error: {1}
```

**Cause:** This warning is emitted at runtime when Avenx-JS attempts to evaluate the expression provided to `data-ax-key`, but the expression throws an exception. This commonly happens when the expression references an undefined property, calls a method that throws, or contains an invalid expression.

**Impact:** The list continues to render, but Avenx-JS falls back to using the item's index as the key for the affected item. While rendering can continue, using index-based keys may reduce the effectiveness of keyed DOM updates if the list is reordered or modified.

**Resolution:** To resolve this warning:

1. Ensure the expression used in `data-ax-key` references properties that exist for every item.
2. Check for typographical errors in property or method names.
3. Avoid calling methods that can throw exceptions while computing the key.
4. Prefer stable, unique values such as database IDs or UUIDs.

**Incorrect**

```javascript
const state = {
  users: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ]
};
```

```html
<li
  data-ax-for="user in state.users"
  data-ax-key="user.profile.id"
>
  {{ user.name }}
</li>
```

Since the `profile` property does not exist on every user object, evaluating the key expression throws and this warning is emitted.

**Correct**

```html
<li
  data-ax-for="user in state.users"
  data-ax-key="user.id"
>
  {{ user.name }}
</li>
```

Each item provides a stable, unique key that can be evaluated successfully.

**Defensive Example**

```html
<li
  data-ax-for="user in state.users"
  data-ax-key="user?.id ?? index"
>
  {{ user.name }}
</li>
```

Using a fallback expression ensures every item can produce a valid key, even when some objects are missing the preferred identifier.

**Note:** When a key expression cannot be evaluated, Avenx-JS logs this warning and falls back to using the item's index as the key so rendering can continue.

### AVX_W20 — RENDER_LIST_DUPLICATE_KEY

```text
[Avenx Validation Warning] Duplicate key "{0}" detected in list expression "{1}". Appending index suffix to prevent node reuse conflict.
```

**Cause:** This warning is emitted when multiple items rendered from the same list evaluate to the same key. Avenx uses keys to uniquely identify list elements during updates. When duplicate keys exist, the renderer cannot reliably determine which DOM node belongs to which item.

**Impact:** Duplicate keys can cause incorrect DOM node reuse, stale UI updates, or unexpected rendering behavior because the renderer can no longer reliably associate DOM nodes with their corresponding data items.

**Resolution:** To resolve this warning:

1. Use a property that is guaranteed to be unique for every item (for example, a database ID or UUID).
2. Ensure your source data does not contain duplicate identifiers.
3. Avoid using values that may repeat across list items.

**Incorrect**

```js
const users = [
  { id: 1, name: 'Alice' },
  { id: 1, name: 'Bob' },
];

users.map((user) => <UserCard key={user.id} />);
```

**Correct**

```js
const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

users.map((user) => <UserCard key={user.id} />);
```

> **Note:** When duplicate keys are detected, Avenx automatically appends the item's index to the duplicate key so rendering can continue. This is a fallback mechanism and should not be relied upon as a substitute for stable, unique keys.

### AVX_W21 — DIRECTIVE_HTML_EVALUATION_FAILED

**Warning Message**
Failed to evaluate data-ax-html: {0}. Error: {1}

**Cause:** This warning is emitted at runtime when Avenx-JS attempts to evaluate the expression bound to a `data-ax-html="..."` directive, but the expression throws an exception during evaluation. Since `data-ax-html` injects raw HTML directly into the DOM, any error in the underlying expression — such as referencing an undefined variable, calling a method that doesn't exist, or a malformed expression — prevents the directive from resolving to a valid HTML string.

This typically happens for a few common reasons:

- The bound expression references a variable or property that is `undefined` or `null` at the time of evaluation.
- A method called within the expression throws internally (e.g. a formatting or sanitization helper failing on unexpected input).
- Asynchronous data the expression depends on hasn't loaded yet.
- A typo or syntax error in the expression itself.

**Resolution:** To resolve this warning:

1. Ensure the variable or property bound to `data-ax-html` is declared and initialized before the directive evaluates.
2. Guard against `undefined`/`null` values with a fallback, e.g. an empty string.
3. Wrap any custom formatting or sanitization logic in a `try...catch` so failures degrade gracefully instead of throwing during evaluation.
4. If the HTML content depends on asynchronous data, initialize the bound property with a safe default (empty string) until the data has loaded.
5. Avoid embedding complex logic directly in the `data-ax-html` expression — compute the HTML string in a `computed` property instead, where it's easier to test and guard.

**Incorrect**

```javascript
const state = {};
```

```html
<div data-ax-html="state.description.toUpperCase()"></div>
```

Since `state.description` is `undefined`, calling `.toUpperCase()` on it throws, and the directive fails to evaluate.

**Correct**

```javascript
const state = {
  description: '',
};
```

```html
<div data-ax-html="state.description"></div>
```

**Defensive Example**

```javascript
const computed = {
  safeDescription() {
    return typeof state.description === 'string' ? state.description : '';
  },
};
```

```html
<div data-ax-html="computed.safeDescription"></div>
```

Deriving the value through a guarded `computed` property ensures `data-ax-html` always receives a valid string and prevents evaluation failures.

### AVX_W22 — DIRECTIVE_SHOW_EVALUATION_FAILED

**Warning Message**
Failed to evaluate data-ax-show: {0}. Error: {1}

**Cause:** This warning is emitted at runtime when Avenx-JS attempts to evaluate the condition bound to a `data-ax-show="..."` directive, but the expression throws an exception. Since `data-ax-show` toggles an element's visibility based on the truthiness of the evaluated expression, any error during evaluation — such as accessing a property on `null`/`undefined`, calling an undeclared method, or a malformed expression — prevents the renderer from determining whether the element should be shown or hidden.

This typically happens for a few common reasons:

- The bound expression accesses a nested property on a value that is `null` or `undefined` (e.g. `state.user.isActive` when `state.user` hasn't loaded yet).
- A method referenced in the expression was never declared in `actions` or `computed`.
- Asynchronous data the condition depends on hasn't resolved yet.
- A typo or syntax error in the expression itself.

**Resolution:** To resolve this warning:

1. Ensure any object referenced in the expression is initialized before `data-ax-show` evaluates, even if just as an empty object or `null` with a guarded check.
2. Guard nested property access with optional chaining or an explicit check, e.g. `state.user && state.user.isActive`.
3. If the condition depends on asynchronous data, default it to `false` until the data has loaded so the element stays hidden safely.
4. Move complex conditions into a `computed` property, where the logic is easier to guard and test.

**Incorrect**

```javascript
const state = {};
```

```html
<div data-ax-show="state.user.isActive">Welcome back!</div>
```

Since `state.user` is `undefined`, accessing `.isActive` throws, and the directive fails to evaluate.

**Correct**

```javascript
const state = {
  user: null,
};
```

```html
<div data-ax-show="state.user && state.user.isActive">Welcome back!</div>
```

**Defensive Example**

```javascript
const computed = {
  isUserActive() {
    return Boolean(state.user && state.user.isActive);
  },
};
```

```html
<div data-ax-show="computed.isUserActive">Welcome back!</div>
```

Deriving the condition through a guarded `computed` property ensures `data-ax-show` always receives a safe boolean and prevents evaluation failures.

## Runtime Codes (`AVX_R*`)

| Code        | Default Message                                                                         | Cause & Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[AVX_R01]` | Mount target selector "{selector}" was not found in the DOM.                            | **Cause:** Missing container tag in `index.html`.<br />**Resolution:** Verify your index file has a matching tag like `<div id="app"></div>`.                                                                                                                                                                                                                                                                                                                                                                                |
| `[AVX_R02]` | Page "{name}" is not registered.                                                        | **Cause:** Mapping route patterns to non-existent or un-compiled pages.<br />**Resolution:** Check spelling and verify page JS exists inside `src/pages/`.                                                                                                                                                                                                                                                                                                                                                                   |
| `[AVX_R03]` | Component "{name}" is not registered.                                                   | **Cause:** Declaring a custom component tag (e.g. `<MyButton />`) without registering it.<br />**Resolution:** Import and register it inside `src/main.app.js`.                                                                                                                                                                                                                                                                                                                                                              |
| `[AVX_R04]` | Circular dependency detected in computed property "{name}".                             | **Cause:** Computed getters reference themselves directly or indirectly.<br />**Resolution:** Refactor computed expressions so they do not reference their own keys.                                                                                                                                                                                                                                                                                                                                                         |
| `[AVX_R05]` | Failed to evaluate computed property "{name}".                                          | **Cause:** Unhandled exceptions inside custom getter scripts.<br />**Resolution:** Review expression syntax and ensure referenced states are defined.                                                                                                                                                                                                                                                                                                                                                                        |
| `[AVX_R06]` | Navigation guard denied transition.                                                     | **Cause:** A guard returned false (Expected behavior for access controls).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `[AVX_R07]` | Navigation guard threw an error.                                                        | **Cause:** Route guard evaluations failed.<br />**Resolution:** Wrap asynchronous fetches in try/catch blocks.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `[AVX_R08]` | Failed to render interpolation expression "{expr}".                                     | **Cause:** Accessing properties on undefined or null properties.<br />**Resolution:** Guard properties in template: `{{ state.user ? state.user.name : '' }}`.                                                                                                                                                                                                                                                                                                                                                               |
| `[AVX_R09]` | Event handler execution failed.                                                         | **Cause:** Unhandled exceptions in event listener actions.<br />**Resolution:** Verify method declarations match event expressions.                                                                                                                                                                                                                                                                                                                                                                                          |
| `[AVX_R10]` | Bridge "{name}" already exists.                                                         | **Cause:** Duplicate registrations.<br />**Resolution:** Assign unique names to bridges.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `[AVX_R11]` | STATE_MUTATION_IN_UPDATE: Synchronous state mutation detected during component update.  | **Cause:** Modifying reactive state synchronously inside a template expression, computed property, or `onUpdate` hook causes the runtime to re-trigger the same update cycle, resulting in an infinite update/render loop.<br />**Resolution:** Never mutate state directly inside templates or computed getters. If a side-effect state change is required after an update, defer it asynchronously (e.g. `setTimeout(() => { this.state.value = newValue; }, 0)`) or derive the value through a computed property instead. |
| `[AVX_R12]` | Error in component "{name}" during lifecycle hook "{hook}": {error}                     | **Cause:** An unhandled error was thrown inside a component lifecycle hook (`onMount`, `onUpdate`, or `onUnmount`).<br />**Resolution:** Wrap lifecycle hook logic in a `try...catch` block, inspect the hook implementation for bugs, and ensure asynchronous operations properly handle rejected promises.                                                                                                                                                                                                                 |
| `[AVX_R13]` | DOM parsing failed due to malformed HTML. Parser error: {error}. HTML context: "{html}" | **Cause:** DOM parsing failed due to malformed HTML in component templates or dynamically rendered content (e.g., unclosed tags or mismatched elements).<br />**Resolution:** Verify your template HTML is well-formed. Ensure all elements are properly nested and all tags are closed.                                                                                                                                                                                                                                     |
| `[AVX_R14]` | ROUTER_GUARD_TIMEOUT: A route guard exceeded the configured timeout duration.           | **Cause:** One or more sequential route guards returned promises that failed to resolve within the configured timeout period, causing navigation transitions to stall.<br />**Resolution:** Inspect route guard logic for unresolved or hanging promises. Optimize long-running asynchronous operations, ensure all promises properly resolve or reject, or adjust the `guardTimeout` configuration if longer execution times are expected.                                                                                  |
| `[AVX_R15]` | SANDBOX_VIOLATION: A sandbox security violation occurred.                               | **Cause:** Template or runtime expressions attempted to access restricted properties such as `__proto__`, `constructor`, or `prototype`, or unauthorized global variables. This restriction prevents prototype pollution, template injection, and unauthorized global scope access.<br />**Resolution:** Restrict expressions to authorized variables only. Avoid accessing or modifying prototype-related properties and unauthorized globals. If necessary, wrap values securely before exposing them to expressions.      |
| `[AVX_R16]` | Cannot reassign component state directly.                                               | **Cause:** Assigning a new object to `this.state`, such as `this.state = { count: 1 }`, replaces the reactive Proxy and breaks change detection.<br />**Resolution:** Mutate properties on the existing state object instead, such as `this.state.count = 1`, or update several properties with `Object.assign(this.state, { count: 1 })`.                                                                                                                                                                                   |
