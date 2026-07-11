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
