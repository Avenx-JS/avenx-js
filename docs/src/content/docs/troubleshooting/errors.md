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

### Public Properties & Metadata Schema

| Property | Type | Description |
| --- | --- | --- |
| `code` | `string` | The raw error code passed to the constructor (e.g. `'AVX_R01'`). |
| `message` | `string` | The fully formatted message, prefixed with the code, e.g. `[AVX_R01] Mount target selector "#app" was not found in the DOM.` |
| `name` | `string` | Always `'AvenxError'` (or `'CompilerError'` for build errors). |
| `details` | `object` | Diagnostic metadata object containing extra context (e.g. failed expression or props). |
| `componentName` | `string \| null` | Name of the component class or file where the exception originated. |
| `sourceLine` | `number \| null` | Line number in the component template or script where the error occurred. |

### JSON Serialization (`.toJSON()`)

Every `AvenxError` instance exposes a `.toJSON()` method that converts the error into a plain JavaScript object for structured JSON loggers (such as Datadog, Sentry, or Pino) or REST API error responses:

```js
import { AvenxError, AvenxErrorCodes } from 'avenx-js';

try {
  // Component logic or evaluation
} catch (err) {
  if (err instanceof AvenxError) {
    // Serialize error into a plain object
    const payload = err.toJSON();
    console.error('Structured Error Payload:', JSON.stringify(payload, null, 2));
    /*
    {
      "name": "AvenxError",
      "code": "AVX_R08",
      "message": "[AVX_R08] Failed to render interpolation expression \"state.user.name\".",
      "componentName": "UserProfile",
      "sourceLine": 42,
      "details": { "expression": "state.user.name" },
      "stack": "AvenxError: ..."
    }
    */
  }
}
```

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

---

## Compiler Error Class Hierarchy

The Avenx compiler uses a hierarchy of specialized error classes defined in `lib/compiler/errors/`. All compiler error classes inherit from `CompilerError`, which itself extends `AvenxError` (the base framework error class). This specialized hierarchy allows build tools, Vite plugins, and custom CLI scripts to catch and inspect compilation issues with domain-specific diagnostic properties.

### Class Hierarchy Diagram

```text
AvenxError (Base framework runtime error)
 └── CompilerError (Base class for compiler diagnostics)
      ├── TemplateValidationError (Template syntax, parsing, and static validation)
      ├── StyleCompilerError (CSS preprocessors, styling, and scoping)
      └── BuildError (Build pipeline, directory, config, and bundle budgets)
```

### Class Overview

- **`CompilerError`**: Base error class for all compiler-related errors and warnings in Avenx-JS. It inherits from `AvenxError` to maintain compatibility with standard error handling across the framework.
- **`TemplateValidationError`**: Specialized error class for template syntax, HTML parsing, structural directives (such as `<@for>`), tag matching, and static validation warnings or errors (e.g., `AVX_W02`, `AVX_W03`, `AVX_W04`, `AVX_W05`, `AVX_W06`, `AVX_W28`, `AVX_W30`).
- **`StyleCompilerError`**: Specialized error class for CSS preprocessor processing, missing style dependencies, preprocessor failures, and CSS scoping errors (e.g., `AVX_W24`, `AVX_W31`).
- **`BuildError`**: Specialized error class for build pipeline, missing `src` or output `dist` directories, component class name collisions, invalid configuration files, and bundle budget errors (e.g., `AVX_C01`, `AVX_C02`, `AVX_C03`, `AVX_W01`, `AVX_W25`).

---

### Constructor Signatures & Location Options

#### `CompilerError`

```javascript
new CompilerError(code, ...args, locationOptions)
```

| Parameter | Type | Description |
| --- | --- | --- |
| `code` | `string` | The AvenxErrorCode identifier (e.g. `'AVX_C02'`, `'AVX_W28'`). |
| `...args` | `any[]` | Arguments formatted into the template message placeholders (`{0}`, `{1}`). |
| `locationOptions` | `object` *(optional)* | Location object containing `{ source, filename, line, column, index, length }`. |

If a location object is passed as the last argument, `CompilerError` automatically invokes `setLocation(locationOptions)` to compute line/column coordinates and generate a visual code frame snippet with carets (`^`).

#### `TemplateValidationError`

```javascript
new TemplateValidationError(code, ...args, locationOptions)
```

Specialized for template syntax, HTML parsing, structural directives, tag matching, and static validation warnings or errors (e.g., `AVX_W02`, `AVX_W03`, `AVX_W04`, `AVX_W05`, `AVX_W06`, `AVX_W28`, `AVX_W30`).

#### `StyleCompilerError`

```javascript
new StyleCompilerError(code, ...args, locationOptions)
```

Specialized for CSS preprocessor processing, missing style dependencies, preprocessor failures, and CSS scoping errors (e.g., `AVX_W24`, `AVX_W31`).

#### `BuildError`

```javascript
new BuildError(code, ...args, locationOptions)
```

Specialized for build pipeline failures, missing `src` or output `dist` directories, component class name collisions, invalid configuration files, and bundle budget errors (e.g., `AVX_C01`, `AVX_C02`, `AVX_C03`, `AVX_W01`, `AVX_W25`).

---

### Location Resolution & Code Frames (`setLocation`)

`CompilerError` provides the `.setLocation(loc)` method to attach location metadata and generate visual code frame snippets highlighting error positions with carets (`^`):

```javascript
const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_MULTIPLE_STATE_TAGS);

err.setLocation({
  source: componentSource,
  index: secondStateTagIndex,
  filename: 'src/components/card.component.js'
});
```

#### Public Properties Reference

| Property | Type | Class Source | Description |
| --- | --- | --- | --- |
| `code` | `string` | `AvenxError` | The raw error code identifier (e.g. `'AVX_C03'`). |
| `name` | `string` | Subclass | Custom name identifier (`'CompilerError'`, `'TemplateValidationError'`, `'StyleCompilerError'`, `'BuildError'`). |
| `message` | `string` | `AvenxError` | Fully formatted error message, prefixed with `[code]` and appended with the visual code frame if available. |
| `line` | `number \| undefined` | `CompilerError` | 1-based line number in the source file where the error occurred. |
| `column` | `number \| undefined` | `CompilerError` | 1-based column offset in the source file where the error occurred. |
| `filename` | `string \| undefined` | `CompilerError` | File path of the source file being compiled. |
| `source` | `string \| undefined` | `CompilerError` | Raw template or component source string. |
| `frame` | `string \| undefined` | `CompilerError` | Formatted visual code frame snippet highlighting the error location with carets (`^`). |
| `cssFilePath` | `string \| null` | `StyleCompilerError` | File path of the stylesheet involved in preprocessor or styling failures. |
| `buildContext` | `object \| string \| null` | `BuildError` | Contextual object or string detailing build directory, config, or duplicate component files. |
| `details` | `object` | `AvenxError` | Diagnostic metadata object containing extra context (e.g., failed expression or props). |
| `stack` | `string` | `Error` | V8 call stack string. |

#### Static Helper Methods

- **`CompilerError.formatCodeFrame(source, line, column, options)`**: Generates a formatted code frame string with carets under `line:column`.
- **`CompilerError.getLineAndColumn(source, index)`**: Computes 1-based `{ line, column }` coordinates from a character offset `index`.

---

### Programmatic Catching & Build Pipeline Integration

Build tools, Vite plugins, or custom CLI scripts can catch and inspect compiler errors programmatically using `instanceof` checks to format rich diagnostics or error overlays.

#### Importing Compiler Error Classes

```javascript
import {
  CompilerError,
  TemplateValidationError,
  StyleCompilerError,
  BuildError,
} from 'avenx-js/compiler';
```

#### Example 1: Custom Build Runner & Pipeline Inspection

```javascript
import { AvenxCompiler } from 'avenx-js/compiler';
import {
  CompilerError,
  TemplateValidationError,
  StyleCompilerError,
  BuildError,
} from 'avenx-js/compiler';

try {
  const compiler = new AvenxCompiler({ rootDir: process.cwd() });
  compiler.build();
} catch (err) {
  if (err instanceof TemplateValidationError) {
    console.error(`[Template Validation Error] ${err.message}`);
    if (err.sourceLine) {
      console.error(`  --> Originating at template line: ${err.sourceLine}`);
    }
  } else if (err instanceof StyleCompilerError) {
    console.error(`[Style Compiler Error] ${err.message}`);
    if (err.cssFilePath) {
      console.error(`  --> File: ${err.cssFilePath}`);
    }
  } else if (err instanceof BuildError) {
    console.error(`[Build Pipeline Error] Code: ${err.code}`);
    if (err.buildContext) {
      console.error(`  Context:`, err.buildContext);
    }
  } else if (err instanceof CompilerError) {
    console.error(`[General Compiler Error] [${err.code}]: ${err.message}`);
  } else {
    throw err;
  }
}
```

#### Example 2: Vite Plugin Integration

```javascript
import {
  CompilerError,
  TemplateValidationError,
  StyleCompilerError,
} from 'avenx-js/compiler';

export function avenxVitePlugin() {
  return {
    name: 'vite-plugin-avenx',
    async transform(code, id) {
      if (!id.endsWith('.component.js')) return;

      try {
        return await compileComponent(code, id);
      } catch (err) {
        if (err instanceof TemplateValidationError) {
          // Format as Vite build error with code line location
          this.error({
            message: err.message,
            id: id,
            line: err.sourceLine || 1,
            column: 0,
          });
        } else if (err instanceof StyleCompilerError) {
          this.error({
            message: `CSS Compilation Error: ${err.message}`,
            id: err.cssFilePath || id,
          });
        } else if (err instanceof CompilerError) {
          this.error(`[${err.code}] ${err.message}`);
        } else {
          throw err;
        }
      }
    },
  };
}
```

---

## Global Error & Warning Interception (`errorHandler` & `warnHandler`)

For centralized error logging and telemetry integration (such as Sentry, LogRocket, or Datadog), Avenx-JS provides root-level application hooks to intercept all uncaught component errors and framework warnings.

### 1. Global Error Handler (`errorHandler` & `app.onError`)

The `errorHandler` callback captures uncaught errors thrown inside component lifecycle hooks (`onMount`, `onUpdate`, `onUnmount`), event listeners (`@click`), template expressions, and route transition guards.

You can configure it in the `AvenxApp` constructor options or via `app.onError(callback)`:

```javascript
import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({
  target: '#app',

  // Global Error Callback
  errorHandler(error, instance, info) {
    console.error(`[Avenx Uncaught Error] in component <${instance?.constructor?.name}> during ${info}:`, error);

    // Telemetry Integration Example (Sentry / Datadog)
    if (window.Sentry) {
      Sentry.captureException(error, {
        tags: {
          component: instance?.constructor?.name || 'Unknown',
          lifecycleHook: info,
        },
      });
    }
  },
});

// Alternative method registration:
app.onError((error, instance, info) => {
  console.log('Additional telemetry listener for origin:', info);
});
```

#### Callback Signature

| Parameter | Type | Description |
| --- | --- | --- |
| `error` | `Error` \| `AvenxError` | The caught error instance containing `code`, `message`, and stack trace. |
| `instance` | `AvenxComponent` \| `null` | The component instance where the error occurred. |
| `info` | `string` | Origin context string (`'onMount'`, `'onUpdate'`, `'onUnmount'`, `'eventHandler'`, `'render'`). |

### 2. Global Warning Handler (`warnHandler`)

Framework warnings (codes `AVX_W01` to `AVX_W32`) warn developers about potential memory leaks, duplicate list keys, missing preprocessors, or unhandled default props.

Intercept framework warnings at runtime using `warnHandler`:

```javascript
const app = new AvenxApp({
  target: '#app',

  // Global Warning Callback
  warnHandler(message, instance) {
    console.warn(`[Avenx Warning] from <${instance?.constructor?.name || 'Core'}>: ${message}`);

    // Log warnings to monitoring dashboard
    if (window.LogRocket) {
      LogRocket.log(`[Warning] ${message}`);
    }
  },
});
```

#### Callback Signature

| Parameter | Type | Description |
| --- | --- | --- |
| `message` | `string` | The formatted warning string including warning code (e.g. `[AVX_W20] RENDER_LIST_DUPLICATE_KEY`). |
| `instance` | `AvenxComponent` \| `null` | The component instance emitting the warning. |

---

## Compiler Codes (`AVX_C*`)

| Code        | Default Message                                                                             | Cause & Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[AVX_C01]` | Could not create dist directory at "{dir}".                                                 | **Cause:** Write permission failure.<br />**Resolution:** Adjust your operating system directory write permissions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `[AVX_C02]` | "src" directory not found at "{path}". Run "avenx init" to scaffold a project. | **Identifier:** `COMPILER_SRC_DIR_MISSING`.<br />**Cause:** Running `avenx build` or `avenx watch` in a project directory where the `src/` folder is missing.<br />**Resolution:** Run `npx avenx init` to scaffold a valid project directory, or manually create the `src/` directory with the required application files. |                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `[AVX_C03]` | Duplicate component name(s) detected. These files compile to the same class name: {details} | **Cause:** Two or more component files (e.g. `card.component.js` in different directories) resolve to the same generated class name, since Avenx-JS derives a component's class name from its file name. This causes a naming collision when the components are bundled together.<br />**Resolution:** Rename one of the conflicting files, or move it to a location that produces a distinct class name — for example, renaming `card.component.js` to `profile-card.component.js`. The build halts and lists every conflicting file path so you can identify exactly which components need to be renamed. |
| `[AVX_C04]` | Node or component tagged with "static" contract contains dynamic expression or binding: {0} | **Cause:** A `static` subtree contains runtime-dependent content such as an interpolation, event handler, two-way binding, or slot.<br />**Resolution:** Remove the dynamic content or remove `static` from the containing node. See the [compiler contracts guide](/core-concepts/compiler-contracts/). |
| `[AVX_C05]` | Isolated component "{0}" violates isolation boundary by accessing external scope or bridge: {1} | **Cause:** An `isolated` component accesses `$bridges`, `this.$bridges`, `$parent`, or `this.$parent` instead of using explicit inputs.<br />**Resolution:** Pass the required value through props or local state. See the [compiler contracts guide](/core-concepts/compiler-contracts/). |
| `[AVX_C06]` | Invalid contract declaration "{0}" in {1}: {2} | **Cause:** The `<contract />` declaration contains an unknown contract name or malformed syntax.<br />**Resolution:** Use only `static`, `pure`, `deterministic`, and `isolated`, then fix the parser reason reported in `{2}`. See the [compiler contracts guide](/core-concepts/compiler-contracts/). |
| `[AVX_C07]` | Bridge import "{0}" in {1} could not be resolved to a bridge module. | **Cause:** A component, page or bridge imports a `*.bridge.js` module that does not exist — usually a typo or a moved file.<br />**Resolution:** Correct the path, or create the bridge. The message lists every bridge the project did discover. See the [Bridges guide](/core-concepts/bridges/). |
| `[AVX_C08]` | Duplicate bridge name(s) detected. | **Cause:** Two `*.bridge.js` files resolve to the same bridge name, which is derived from the file name. `src/bridges/auth.bridge.js` and `src/global/auth.bridge.js` both resolve to `auth`.<br />**Resolution:** Rename one of the files. The build lists every conflicting path. |
| `[AVX_C09]` | Bridge "{0}" imports "{1}", which the Avenx bundler cannot inline. | **Cause:** A bridge module imports something other than the Avenx runtime or another `*.bridge.js` module. Avenx bundles bridges without a general-purpose bundler, so it cannot inline arbitrary modules.<br />**Resolution:** Keep helpers inside the bridge file (code above `export default` is preserved), move shared logic into another bridge, or expose it on `globalThis` from `index.html`. |
| `[AVX_C10]` | Component "{0}" declares the "isolated" contract but imports the bridge "{1}". | **Cause:** An `isolated` component may not reach outside its own state, and importing a bridge does exactly that.<br />**Resolution:** Remove the import and pass the value in as a prop, or drop the `isolated` contract. |
| `[AVX_C11]` | Bridge import cycle: {0}. | **Cause:** Two or more bridge modules import each other. Bridges initialise in dependency order, so a cycle has no valid order and the bundle would fail at load.<br />**Resolution:** Move the shared state into a third bridge that both import, or pass the value in as an action argument instead of reaching across. |
| `[AVX_C12]` | "{0}" is not a bridge module. | **Cause:** A `*.bridge.js` file does not import the `bridge()` factory from the Avenx runtime and export the definition it returns. Class-based bridges were removed, so a class or plain-object default export no longer compiles.<br />**Resolution:** Convert the module to `export default bridge({ ... })` — see [Converting a class bridge](/core-concepts/bridges#converting-a-class-bridge) — or rename the file if it is not meant to be a bridge. |
| `[AVX_C13]` | The Avenx runtime bundle "dist/{0}" is missing. | **Cause:** The prebuilt runtime that every application bundles is not present in the installed package.<br />**Resolution:** Reinstall `avenx-core`. When working inside the framework repository, run `npm run build` to produce it. |
| `[AVX_C14]` | The {0} hook failed: {1} | **Cause:** A `prebuild` or `postbuild` command configured under `hooks` in `avenx.config.json` exited non-zero. A hook is part of the build, so its failure fails the build.<br />**Resolution:** Run the hook command yourself to see its output. Remove it from `hooks` if it is not meant to gate the build. |
| `[AVX_W35]` | COMPILER_DEADLOCK_PARSE_FAILED: Failed to parse <@deadlock> boundary tag in {0}: {1} | **Cause:** Malformed attributes, unclosed tag, or invalid `maxDepth` on a `<@deadlock>` block. The compiler skips the boundary entirely.<br />**Resolution:** Format `<@deadlock>` with valid attributes (`name`, `maxDepth`, `action`) and ensure nested `<@fallback as="...">` is properly closed. See the [<@deadlock> guide](/core-concepts/deadlocks/). |
| `[AVX_W37]` | Bridge "{0}" has no member "{1}". | **Cause:** A template or action reads a property the bridge does not declare — usually a typo. At runtime this would silently read `undefined`.<br />**Resolution:** Use one of the declared members. The warning lists them and suggests the closest match. |
| `[AVX_W38]` | Bridge "{0}" never emits the event "{1}". | **Cause:** Code subscribes with `on()` to an event name that no `emit()` call in the bridge produces, so the handler would never run.<br />**Resolution:** Subscribe to an emitted event, or emit the one you meant. The warning lists the emitted events and suggests the closest match. |
| `[AVX_R19]` | bridge() expects a definition object, received {0}. | **Cause:** `bridge()` was called with no argument, or with something that is not a plain object.<br />**Resolution:** Pass a definition object, e.g. `bridge({ state: { count: 0 } })`. |
| `[AVX_R20]` | Bridge definition declares "{0}", which is reserved by the Bridge API. | **Cause:** The definition declares `on`, `emit`, `$dispose` or `$name`, or a getter/action collides with a state key.<br />**Resolution:** Rename the member. |
| `[AVX_R21]` | Bridge definition declares "{0}" as a top-level value. | **Cause:** Data was placed at the top level of the definition instead of inside `state`.<br />**Resolution:** Move it into the `state` object. Only actions, getters, `state` and `setup` belong at the top level. |
| `[AVX_R22]` | Cannot assign to "{0}.{1}" from outside the bridge. | **Cause:** A component assigned to bridge state. State is read-only for consumers so every mutation has one traceable origin.<br />**Resolution:** Add an action to the bridge and call it instead. |
| `[AVX_R23]` | Invalid bridge event {0}. | **Cause:** `on()` or `emit()` was called with an empty/non-string event name, or `on()` without a listener function.<br />**Resolution:** Pass a non-empty event name string and, for `on()`, a handler function. |
| `[AVX_R24]` | Bridge "{0}" failed during setup(): {1} | **Cause:** A bridge's `setup()` hook threw while initialising, for example because an external connection could not be opened.<br />**Resolution:** Fix the underlying error shown in `{1}`, or guard the setup so a failure is recorded in state instead of thrown. |

### AVX_C04 — static contract violation

**Message:** `Node or component tagged with "static" contract contains dynamic expression or binding: {0}`

A `static` subtree must not depend on runtime values. Interpolations, event handlers, two-way bindings, and slots make the output dynamic.

**Incorrect**

```html
<div static>
  <span>{{ props.title }}</span>
  <button @click="save">Save</button>
</div>
```

**Correct**

```html
<div static>
  <span>Account settings</span>
</div>
```

Remove the dynamic content or remove `static` from the containing node. See the [compiler contracts guide](/core-concepts/compiler-contracts/).

### AVX_C05 — isolated contract violation

**Message:** `Isolated component "{0}" violates isolation boundary by accessing external scope or bridge: {1}`

An `isolated` component may use explicit props and local state, but not `$bridges`, `this.$bridges`, `$parent`, or `this.$parent`.

**Incorrect**

```html
<contract isolated />
<template><p>{{ $bridges.userStore.name }}</p></template>
```

**Correct**

```html
<contract isolated />
<template><p>{{ props.userName }}</p></template>
```

Pass the required value through props or local state. See the [compiler contracts guide](/core-concepts/compiler-contracts/).

### AVX_C06 — invalid contract declaration

**Message:** `Invalid contract declaration "{0}" in {1}: {2}`

This diagnostic identifies an unknown contract name or malformed `<contract />` declaration. The `{1}` placeholder identifies the source location, while `{2}` preserves the parser's specific reason.

**Incorrect**

```html
<contract statc />
```

**Correct**

```html
<contract static pure deterministic isolated />
```

Use only `static`, `pure`, `deterministic`, and `isolated`, and fix the exact parser reason reported in the message. See the [compiler contracts guide](/core-concepts/compiler-contracts/).

### AVX_W33 — deterministic contract violation

**Message:** `Deterministic contract violation in component "{0}": contains non-deterministic expression or call: {1}`

A `deterministic` block must produce the same semantic output for the same inputs. Time, randomness, and environment-dependent APIs violate that contract.

**Incorrect**

```html
<div deterministic>{{ Math.random() }}</div>
```

**Correct**

```html
<div deterministic>{{ props.seededValue }}</div>
```

Compute or inject the changing value outside the deterministic block, then pass it as an explicit input. See the [compiler contracts guide](/core-concepts/compiler-contracts/).

### AVX_W34 — redundant contract declaration

**Message:** `Contract "{0}" is redundant in "{1}" because parent scope already enforces "{2}".`

The validator reports a child declaration when a stricter parent already enforces it. For example, a `pure` child under a `static` parent is redundant.

**Incorrect**

```html
<div static>
  <span pure>Account settings</span>
</div>
```

**Correct**

```html
<div static>
  <span>Account settings</span>
</div>
```

Remove the child declaration unless it communicates a genuinely different boundary. See the [compiler contracts guide](/core-concepts/compiler-contracts/).

### AVX_W35 — COMPILER_DEADLOCK_PARSE_FAILED

**Warning Message**

```text
[AVX_W35] Failed to parse <@deadlock> boundary tag in "{0}": {1}
```

**Cause:** This warning is emitted during template compilation when the component parser (`ComponentParser.js`) encounters a malformed `<@deadlock>` reactive boundary tag.

**Parser Syntax Expectations:**
A `<@deadlock>` block expects the following configuration attributes and nested structure:
- `name`: String identifier for the boundary.
- `maxDepth`: Positive integer specifying the recursion threshold before triggering deadlock recovery (e.g. `maxDepth="50"`).
- `action`: Recovery strategy (`"fallback"`, `"abort"`, or `"reset"`).
- `<@fallback as="err">...</@fallback>`: Optional nested fallback slot to render when a deadlock occurs.

**Compiler Fallback Behavior:**
When syntax validation fails (such as an unclosed tag, non-numeric `maxDepth`, or malformed attributes), **the compiler skips the `<@deadlock>` block entirely**. As a result, the protective boundary silently does not exist at runtime, and any circular update loop inside the subtree will bubble directly to the global scheduler.

**Resolution:** To resolve this warning:

1. Ensure the `<@deadlock>` block has valid attribute values and a numeric `maxDepth`.
2. Verify that nested `<@fallback>` tags are properly closed with `</@fallback>` and declare a valid `as="..."` identifier.
3. Check for syntax typos in tag names.
4. See the [<@deadlock> guide](/core-concepts/deadlocks/) for full syntax specifications.

**Incorrect**

```html
<!-- ❌ Invalid non-numeric maxDepth, missing closing fallback tag, and malformed boundary -->
<@deadlock name="userSync" maxDepth="invalid-limit" action="fallback">
  <UserProfile/>
  <@fallback as="err">
    <p>Failed to sync user profile: {{ err.message }}</p>
  <!-- Missing </@fallback> and </@deadlock> -->
```

**Correct**

```html
<!-- ✅ Properly configured deadlock boundary with fallback slot -->
<@deadlock name="userSync" maxDepth="25" action="fallback">
  <UserProfile/>
  <@fallback as="err">
    <p>Failed to sync user profile: {{ err.message }}</p>
  </@fallback>
</@deadlock>
```

### AVX_C01 — COMPILER_DIST_CREATION_FAILED

**Error Message**

```text
[AVX_C01] Could not create dist directory at "{0}".
```

**Diagnostic Output Format (CLI)**

```text
❌ [AVX_C01] Could not create dist directory at "/path/to/project/dist".
```

**Cause:** This error is emitted during the compiler initialization phase (`AvenxCompiler.init()`) when the build pipeline attempts to create the distribution output directory (`dist/` by default or custom path) via recursive directory creation, but the filesystem operation fails.

This typically happens for a few common reasons:

- **Insufficient File System Permissions**: The user or process executing `avenx build` or `avenx watch` lacks write permissions in the project root directory or the specified distribution path.
- **File Name Conflict**: A regular non-directory file named `dist` (or matching the configured output directory name) already exists in the project root, blocking directory creation.
- **Restricted CI/CD or Docker Environments**: Running the build inside a read-only filesystem, an unprivileged Docker container, or a CI worker without directory write access.
- **Invalid Output Path in Configuration**: The `avenx.config.json` configuration specifies an invalid, inaccessible, or restricted custom directory path.

**Resolution:** To resolve this error:

1. **Verify and Grant Directory Permissions**: Ensure the active user account has write permissions to the project directory:
   ```bash
   # Grant write permissions to the current user (macOS/Linux)
   chmod -R u+w .
   ```
   If files were previously created with root privileges (e.g., via `sudo`), restore ownership:
   ```bash
   sudo chown -R $(whoami) .
   ```
2. **Remove Conflicting Files**: Check if a regular file named `dist` exists in the workspace. If present, delete or rename it:
   ```bash
   rm dist
   ```
3. **Configure CI/CD Pipelines and Dockerfiles**: In automated environments, verify that the working directory is writable and pre-create the output directory if necessary:
   ```dockerfile
   # Dockerfile best practice
   WORKDIR /app
   RUN mkdir -p dist && chown -R node:node /app
   USER node
   ```
4. **Inspect Build Configuration**: Verify that `avenx.config.json` does not point output files to restricted system paths.

**Incorrect**

Attempting to build when the project directory is read-only or a conflicting file blocks directory creation:

```bash
# ❌ Conflicting file named 'dist' blocks mkdir
touch dist
npx avenx build
# Emits: ❌ [AVX_C01] Could not create dist directory at ".../dist".
```

```dockerfile
# ❌ Container running as unprivileged user without write access to /app
FROM node:20-alpine
WORKDIR /app
COPY . .
USER node
# Fails with AVX_C01 if /app is owned by root
RUN npx avenx build
```

**Correct**

Ensuring proper directory permissions and ownership in build pipelines:

```bash
# ✅ Ensure workspace is writable and output directory is clear
rm -f dist
npx avenx build
```

```dockerfile
# ✅ Proper ownership setup in Docker build
FROM node:20-alpine
WORKDIR /app
COPY --chown=node:node . .
USER node
RUN npx avenx build
```

**Defensive Coding Example**

Pre-validating directory write permissions in custom automated build scripts:

```javascript
import fs from 'fs';
import path from 'path';
import { AvenxCompiler } from 'avenx-core';

const distPath = path.resolve(process.cwd(), 'dist');

try {
  if (!fs.existsSync(distPath)) {
    fs.mkdirSync(distPath, { recursive: true });
  }
  // Verify write access
  fs.accessSync(distPath, fs.constants.W_OK);
  
  const compiler = new AvenxCompiler({ rootDir: process.cwd() });
  compiler.build();
} catch (err) {
  console.error(`[Build Setup Error] Cannot initialize dist directory at "${distPath}":`, err.message);
  process.exit(1);
}
```

## Compiler Warnings

Unlike the error codes above, which halt compilation, Avenx-JS also emits **warnings** during the build step. Warnings do not stop the build, but they flag potential mistakes in your templates that are worth fixing.

### COMPILER_PREPROCESSOR_MISSING Warning
The `[AVX_W24]` warning occurs when a CSS preprocessor is configured but the required preprocessor package is not installed.

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

### AVX_W01 — COMPILER_BUNDLE_SIZE_EXCEEDED

**Warning Message**

```text
WARNING: {0} exceeds {1} KB ({2} KB)
```

**Cause:** This warning is emitted during the bundling phase when a compiled JavaScript chunk or CSS asset exceeds the configured bundle size budget. Avenx-JS compares the final output size of generated assets against the thresholds defined in `avenx.config.json`. Exceeding these limits does not stop the build, but it indicates that the generated bundle may negatively affect application performance, particularly initial page load times.

This typically happens for a few common reasons:

- Large third-party dependencies are included in the application bundle.
- Unused code or assets are bundled unnecessarily.
- Large images, fonts, or stylesheets are imported directly into the application.
- Bundle size limits are configured too aggressively for the project's requirements.

**Resolution:** To resolve this warning:

1. Review the generated bundle and identify unusually large JavaScript or CSS assets.
2. Split large features into smaller modules and load them only when needed.
3. Remove unused dependencies and assets from the project.
4. Adjust the configured bundle size budgets if the application's expected size legitimately exceeds the default limits.

**Configure Bundle Budgets**

```json
{
  "build": {
    "bundleBudget": {
      "javascript": 500,
      "css": 100
    }
  }
}
```

The values represent the maximum allowed bundle size (in KB) before Avenx-JS emits a warning.

**Optimization Tips**

- Use lazy-loading for large pages or feature modules.
- Remove unused dependencies and imports.
- Optimize images and other static assets before bundling.
- Split large components into smaller, reusable modules.
- Avoid including development-only libraries in production builds.

**Incorrect**

```javascript
import ChartLibrary from "very-large-chart-library";
import "./large-theme.css";
```

Bundling large dependencies and styles without considering their impact can easily cause bundle size budgets to be exceeded.

**Correct**

```javascript
async function loadCharts() {
  const { default: ChartLibrary } = await import("very-large-chart-library");
}
```

Loading large features only when they are required helps reduce the application's initial bundle size.

**Defensive Example**

```json
{
  "build": {
    "bundleBudget": {
      "javascript": 750,
      "css": 150
    }
  }
}
```

Adjust bundle budgets only when larger assets are expected. Increasing the limits should complement optimization efforts, not replace them.

### AVX_W02 — COMPILER_EMPTY_TEMPLATE

**Warning Message**

```text
Component "{0}" has an empty template.
```

**Cause:** This warning is emitted during compilation when a `.component.js` or `.page.js` file contains no HTML template markup or contains only whitespace. Every component in Avenx-JS is expected to define a visual structure. When the component parser extracts the component's HTML template and finds it empty, the compiler emits **AVX_W02**.

This typically happens for a few common reasons:

- A newly scaffolded `.component.js` file has not had HTML markup added to it yet.
- The HTML template portion of a component file was accidentally deleted during refactoring.
- A placeholder component file contains only `<state>` or `<action>` tags without any HTML element markup.

**Resolution:** To resolve this warning:

1. Add valid HTML markup to the component file.
2. If the component is a placeholder or no longer used, remove the component file or add a minimal element (e.g. `<div></div>`).

**Incorrect**

```html
<!-- Empty component file containing only state and action tags -->
<state count="0" />

<action name="increment">
  count++;
</action>

<!-- Missing HTML element markup! Emits AVX_W02 -->
```

**Correct**

```html
<state count="0" />

<action name="increment">
  count++;
</action>

<div>
  <p>Count: {{ count }}</p>
  <button @click="increment()">Increment</button>
</div>
```

### AVX_W03 — COMPILER_UNDECLARED_REFERENCE


**Warning Message**

```text
Undeclared variable or method "{0}" referenced in template of {1}.
```

**Cause:** This warning is emitted during template validation when the compiler encounters a variable, method, or binding that cannot be resolved from the component's declared members. During compilation, `validateTemplate` checks template interpolations, bindings, directives, and event handlers against the component's `state`, `computed`, `actions`, and `bridges`. If a referenced identifier cannot be resolved statically, Avenx-JS emits this warning.

This typically happens for a few common reasons:

- A typo in a variable or method name.
- Referencing a property that was never declared in `state`.
- Calling an action that was never added to `actions`.
- Using a computed property that does not exist.
- Referencing a bridge that has not been registered.

**Resolution:** To resolve this warning:

1. Verify the spelling of the referenced identifier.
2. Ensure the property exists in `state`, `computed`, `actions`, or `bridges`.
3. Check that renamed variables have been updated throughout the template.
4. If the reference is intentionally resolved only at runtime (for example, through dynamic properties that cannot be statically analysed), the warning can usually be ignored after confirming the behaviour is expected.

**Incorrect**

```html
<state username="John" />

<p>{{ usernmae }}</p>

<button @click="saveProfile()">Save</button>
```

```javascript
<action name="submit">
  console.log("Saving...");
</action>
```

The template references `usernmae` instead of `username`, and calls `saveProfile()` even though only `submit` is declared.

**Correct**

```html
<state username="John" />

<p>{{ username }}</p>

<button @click="submit()">Save</button>
```

```javascript
<action name="submit">
  console.log("Saving...");
</action>
```

The template references only declared state and actions, allowing the compiler to resolve every identifier successfully.

**Defensive Example**

```html
<p>{{ DynamicBridge.currentUser?.name }}</p>
```

If a value is supplied dynamically at runtime and cannot always be determined during static analysis, the compiler may emit this warning even though the application behaves correctly. Verify the behaviour before deciding to ignore the warning.

### AVX_W04 — COMPILER_UNMATCHED_FOR_TAG

**Warning Message**

```text
Unmatched <@for> tags in template.
```

**Cause:** This warning is emitted during template compilation when the parser detects that a `<@for>` loop block is not properly matched with its corresponding closing tag. During static validation, Avenx-JS verifies that every loop block has a valid opening tag, closing tag, and correctly nested structure. If the parser encounters an incomplete or improperly nested loop, it emits this warning.

This typically happens for a few common reasons:

- A `<@for>` block is missing its closing `</@for>` tag.
- Loop blocks are nested incorrectly.
- A closing tag appears without a matching opening tag.
- Template edits accidentally break the structure of a loop block.

**Resolution:** To resolve this warning:

1. Ensure every `<@for>` opening tag has a matching `</@for>` closing tag.
2. Verify that nested loop blocks are opened and closed in the correct order.
3. Check the template for misplaced or missing tags after editing.
4. Use consistent indentation to make loop boundaries easier to identify.

**Incorrect**

```html
<@for item="user" in="users">
  <div>{{ user.name }}</div>
```

Since the `<@for>` block is never closed, the compiler cannot determine the end of the loop and emits **AVX_W04**.

**Correct**

```html
<@for item="user" in="users">
  <div>{{ user.name }}</div>
</@for>
```

The loop block is properly opened and closed, allowing the compiler to parse the template successfully.

**Defensive Example**

```html
<@for item="group" in="groups">
  <h2>{{ group.name }}</h2>

  <@for item="user" in="group.users">
    <p>{{ user.name }}</p>
  </@for>

</@for>
```

When nesting loop blocks, always close the innermost loop before closing the outer loop. Proper nesting helps the compiler validate the template structure correctly.

### AVX_W05 — COMPILER_TRANSITION_PARSE_FAILED

**Warning Message**
Failed to parse transition tags: {0}

**Cause:** This warning is emitted at compile time when Avenx-JS extracts and parses transition wrapper attributes (used to animate elements entering/leaving the DOM) but the parser fails to read the class configuration or duration parameters correctly. This typically happens when the transition attribute's value doesn't match the format the compiler expects — for example, an invalid duration value, malformed class name syntax, or a missing required parameter.

**Expected Format**

A transition block is typically declared with an attribute such as `data-ax-transition`, taking a configuration string with named class and duration parameters:

```html
<div data-ax-transition="name: fade; duration: 300">
  Content
</div>
```

- `name` — a string identifying the transition, used to derive the CSS class names applied during enter/leave (e.g. `fade-enter`, `fade-leave`).
- `duration` — a numeric value in milliseconds specifying how long the transition classes remain applied before being removed.

This typically fails for a few common reasons:

- The `duration` value is not a valid number (e.g. `duration: 300ms` instead of `duration: 300`).
- The configuration string is missing a required `;` separator between parameters.
- The `name` value contains characters that can't be safely used to construct CSS class names (spaces, quotes, or special characters).
- A parameter key is misspelled (e.g. `duraton` instead of `duration`).

**Resolution:** To resolve this warning:

1. Ensure `duration` is specified as a plain number representing milliseconds, without units.
2. Separate multiple parameters with a semicolon (`;`), matching the `key: value; key: value` format.
3. Keep `name` limited to characters valid in CSS class names (letters, numbers, hyphens, underscores).
4. Double-check parameter key spelling against the supported keys (`name`, `duration`).

**Incorrect**

```html
<div data-ax-transition="name: fade, duration: 300ms">
  Content
</div>
```

This fails because a comma is used instead of a semicolon between parameters, and `duration` includes the `ms` unit instead of a plain number.

**Correct**

```html
<div data-ax-transition="name: fade; duration: 300">
  Content
</div>
```

This produces `fade-enter`/`fade-leave` classes applied for 300 milliseconds during the respective transition phase.

**Specifying Transition Classes and Durations**

You can also override the generated class names directly instead of relying on the `name`-derived defaults:

```html
<div data-ax-transition="enterClass: slide-in; leaveClass: slide-out; duration: 250">
  Content
</div>
```

- `enterClass` — the CSS class applied while the element is entering.
- `leaveClass` — the CSS class applied while the element is leaving.
- `duration` — shared duration in milliseconds for both phases, unless overridden separately with `enterDuration`/`leaveDuration`.

Ensuring these parameters follow the expected `key: value` pairs, separated by semicolons, with numeric-only duration values, allows the compiler to parse the transition block successfully.

### AVX_W05 — COMPONENT_PROPS_TYPE_MISMATCH

**Warning Message**

```text
Invalid prop type for "{0}" in component {1}. Expected {2}, got {3}.
```

**Cause:** This warning is emitted at runtime when a parent component passes a prop to a child component, but the type of the passed value does not match the expected type defined in the child component's `props` schema (e.g., passing a `string` when `Number` is required, or passing a `number` when `Boolean` is expected).

This typically happens for a few common reasons:

- Passing a static string literal attribute (e.g. `count="5"`) instead of a dynamic bound property expression (e.g. `:count="5"`).
- Omitting type conversions when passing values parsed from user input, forms, or URL query parameters.
- An overly restrictive or mismatched type definition in the child component's `props` schema declaration.

**Resolution:** To resolve this warning:

1. Use dynamic property binding syntax (`:propName="value"`) to pass non-string primitive types (numbers, booleans, objects, arrays).
2. Convert values to their expected data types (e.g. `Number(state.inputCount)`) before passing them as props.
3. Update the child component's `props` schema if the prop's accepted types should be broadened (e.g., using `[String, Number]`).

**Incorrect**

```html
<!-- Parent Component: Passing a string "10" for a prop expecting Number -->
<UserCard count="10" :isActive="true" />
```

Passing `count="10"` as a static attribute sends the string `'10'`, causing Avenx-JS to emit **AVX_W05** (`Expected Number, got String`).

**Correct**

```html
<!-- Parent Component: Using dynamic binding :count="10" to pass numeric 10 -->
<UserCard :count="10" :isActive="true" />
```

```html
<!-- Child Component (UserCard.component.js) prop declaration -->
<script>
export default {
  props: {
    count: Number,
    isActive: Boolean,
  },
};
</script>
```

### AVX_W06 — COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED


**Warning Message**
Failed to optimize static subtrees: {0}

**Cause:** As part of its build-time optimizations, the Avenx-JS compiler analyzes each component's element tree to identify **static subtrees** — sections of markup that contain no dynamic bindings, interpolations, or directives, and therefore never change after the initial render. Marking these subtrees as static lets the runtime skip re-evaluating and re-diffing them on every update, improving render performance. This warning is emitted when the compiler attempts this analysis but fails, typically because it encounters a malformed tree node or a parser error while walking the template.

This typically happens for a few common reasons:

- Unclosed or mismatched HTML tags within a section the compiler is trying to statically analyze.
- Templates that mix static and dynamic content in ways that produce an inconsistent or invalid node structure (e.g. a directive attribute left incomplete or malformed).
- Deeply nested or unusually structured markup that the tree walker cannot resolve cleanly during the optimization pass.
- Custom or non-standard elements/attributes that the compiler's static analyzer doesn't recognize and cannot safely classify as static or dynamic.

**Impact:** This is a build-time optimization warning, not a runtime error — it does not stop compilation or break your app's functionality. However, when a subtree fails static optimization, the runtime is forced to treat it as dynamic and re-evaluate it on every update, which can measurably impact rendering performance in larger or frequently-updating components.

**Resolution:** To resolve this warning:

1. Verify that all HTML tags in the affected template are properly closed and correctly nested.
2. Check that directive attributes (`data-ax-*`) and interpolations (`{{ }}`) are complete and well-formed — an incomplete directive can confuse the tree walker.
3. Simplify unusually deep or complex nesting where possible, particularly in sections you intend to be purely static.
4. If you're using custom elements, ensure they follow standard HTML structure so the compiler can correctly classify their contents.

**Incorrect**

```html
<div class="card">
  <p>Static header text</p>
  <span>Unclosed span
  <p>More static text</p>
</div>
```

The unclosed `<span>` produces a malformed node structure, so the compiler cannot reliably determine which parts of this subtree are static.

**Correct**

```html
<div class="card">
  <p>Static header text</p>
  <span>Properly closed span</span>
  <p>More static text</p>
</div>
```

With well-formed markup, the compiler can confidently identify this entire subtree as static (since it contains no bindings or directives) and optimize it accordingly.

**Subtree Evaluation Requirements**

For a subtree to qualify as static and be successfully optimized, it must:

- Contain no interpolations (`{{ }}`), directive bindings (`data-ax-*`), or event handlers.
- Be well-formed HTML with properly closed and nested tags.
- Not contain `<@for>` or other structural directives that produce dynamic output.

Subtrees that meet these requirements are hoisted out of the render function and reused across updates without re-evaluation, improving performance for components with large amounts of unchanging markup.

### AVX_W26 — COMPONENT_METHOD_RESERVED_KEY_COLLISION

**Warning Message**

```text
Method name "{0}" in component "{1}" collides with a reserved lifecycle hook or instance method.
```

**Cause:** This warning is emitted during component compilation or runtime instantiation when a component declares an action, method, or property name that collides with reserved internal `AvenxComponent` prototype keys or lifecycle hook names (e.g. `mount`, `update`, `destroy`, `onMount`, `onUpdate`).

Declaring a component action or property with a reserved name overrides the framework's internal component lifecycle methods or prototype functionality, leading to unexpected behavior, broken DOM patching, or unhandled recursion issues.

**Reserved Component Prototype Keys & Lifecycle Hooks:**

| Category | Reserved Keys | Description |
| --- | --- | --- |
| **Core Lifecycle Methods** | `mount`, `unmount`, `update`, `destroy`, `scheduleUpdate` | Framework internal methods controlling component mounting, unmounting, DOM diffing/patching, and update scheduling. |
| **Lifecycle Hooks** | `onBeforeMount`, `onMount`, `onBeforeUpdate`, `onUpdate`, `onUnmount`, `onActivate`, `onDeactivate`, `onErrorCaptured` | Reserved framework lifecycle hook callback names. |
| **Instance Properties & API Helpers** | `$parent`, `$refs`, `$slots`, `$route`, `$keepAlive`, `$nextTick`, `nextTick`, `setProps`, `clearKeepAliveCache`, `watch` | Reserved component instance properties and API methods. |

**Resolution:** To resolve this warning:

1. Rename custom component actions or methods to avoid names in the reserved list (e.g. rename `update` to `updateUserProfile`, or `destroy` to `handleDelete`).
2. If you intended to hook into a framework lifecycle event (such as `onMount` or `onUpdate`), implement it as a standard lifecycle hook callback function rather than redefining it as a custom action method.

**Incorrect**

Defining custom actions with names matching reserved keys:

```html
<state user="Guest" />

<!-- ❌ Collides with internal AvenxComponent.prototype.update -->
<action name="update">
  console.log("Updating user...");
</action>

<!-- ❌ Collides with internal AvenxComponent.prototype.destroy -->
<action name="destroy">
  console.log("Destroying component...");
</action>

<div>
  <p>User: {{ user }}</p>
  <button @click="update()">Update</button>
</div>
```

**Correct**

Renaming custom actions to distinct, non-reserved names:

```html
<state user="Guest" />

<!-- ✅ Renamed to clear, non-colliding action names -->
<action name="updateUser">
  console.log("Updating user...");
</action>

<action name="handleDelete">
  console.log("Deleting item...");
</action>

<div>
  <p>User: {{ user }}</p>
  <button @click="updateUser()">Update</button>
</div>
```

### AVX_W28 — COMPILER_MULTIPLE_STATE_TAGS

**Warning Message**

```text
Multiple <state> tags found in component source. Only the first <state> declaration is reactive; subsequent tags are ignored.
```

**Cause:** This warning is emitted during compilation when a `.component.js` or `.page.js` file contains more than one `<state />` tag declaration. Avenx-JS component templates support a single top-level state block where initial state properties are defined.

**Compiler Fallback Behavior:**

When multiple `<state />` tags are declared:
1. The compiler evaluates and parses **only the first** `<state />` tag found in the component source file.
2. All subsequent `<state />` tags are skipped and ignored during reactive state proxy creation. Any properties declared in secondary `<state />` tags will not be initialized on the component's reactive `state` object.

**Resolution:** To resolve this warning:

Consolidate all initial state properties into a single `<state />` tag at the top of your component file.

**Incorrect**

Declaring multiple `<state />` tags in a single component file:

```html
<!-- ❌ First <state> declaration (parsed) -->
<state count="0" title="Counter" />

<!-- ❌ Second <state> declaration (ignored; emits AVX_W28) -->
<state isLoading="false" username="Guest" />

<action name="increment">
  state.count++;
</action>

<div>
  <h1>{{ title }}</h1>
  <p>Count: {{ count }}</p>
  <!-- username and isLoading are NOT initialized on state! -->
</div>
```

**Correct**

Consolidating all initial state properties into a single `<state />` tag:

```html
<!-- ✅ All initial state properties consolidated into a single <state /> declaration -->
<state count="0" title="Counter" isLoading="false" username="Guest" />

<action name="increment">
  state.count++;
</action>

<div>
  <h1>{{ title }}</h1>
  <p>Count: {{ count }} (User: {{ username }})</p>
</div>
```

### AVX_W31 — COMPILER_PREPROCESSOR_FAILED

**Warning Message**

```text
Error compiling {0}: {1}
```

**Cause:** This warning is emitted during component compilation when the configured CSS preprocessor (e.g. Sass, SCSS, Less, PostCSS) encounters a syntax error or execution failure while processing stylesheet content in `.component.css` or `.page.css` files.

When `StyleProcessor` catches a compilation error from the underlying preprocessor engine, it emits **AVX_W31** containing the preprocessor type (e.g. `scss`) and the detailed parser error message (e.g. `Undefined variable: "$theme-bg"` or `expected "}"`). The compiler then gracefully falls back to passing raw CSS content through the build pipeline.

**Common Causes:**

1. **Preprocessor Syntax Errors:** Referencing undefined SCSS/Sass variables (`$primary`), calling un-imported mixins (`@include flex-center`), unclosed block braces (`{`), or invalid nesting syntax.
2. **Indented Sass Format Violations:** Mixing tabs and spaces or improper indentation levels when `style.preprocessor` is set to `"sass"`.
3. **Missing Imports or Files:** Attempting to `@import` or `@use` an external SCSS/Less stylesheet file that does not exist or has an incorrect file path.
4. **PostCSS Plugin Pipeline Failures:** Malformed PostCSS directives or failing PostCSS plugin transformations.

**Resolution Steps:**

1. **Inspect Preprocessor Output:** Review the detailed error message in `[AVX_W31]` to locate the failing file path, line number, and character position reported by the preprocessor.
2. **Fix Syntax Errors:** Correct typos in variable names, add missing `@import`/`@use` statements, or ensure all braces `{}` and quotes `""` are properly balanced.
3. **Verify Preprocessor Package:** Ensure the required preprocessor npm package (`sass`, `less`, `postcss`) is installed in `devDependencies` and matches the `style.preprocessor` option configured in `avenx.config.json`.

**Incorrect**

Invalid SCSS syntax (referencing an undefined variable `$theme-color` and missing a closing brace):

```css
<@css>
  .card {
    /* ❌ Undefined SCSS variable and missing closing brace; emits AVX_W31 */
    background: $theme-color;
    padding: 1.5rem;
</@css>
```

Invalid Sass indented format (mixing invalid indentation):

```css
<@css>
  .button
    color: red
  /* ❌ Indentation syntax mismatch in Sass mode */
    background-color: blue
</@css>
```

**Correct**

Valid SCSS stylesheet with defined variables and properly balanced braces:

```css
<@css>
  $theme-color: #646cff;

  .card {
    /* ✅ Properly defined variable and balanced closing brace */
    background: $theme-color;
    padding: 1.5rem;
  }
</@css>
```

### AVX_W07 — PAGE_ALREADY_REGISTERED

**Warning Message**

```text
Page "{0}" is already registered and will be overwritten.
```

**Cause:** This warning is emitted when a page is registered more than once using the same registration name. During application initialization, Avenx-JS stores registered pages in its page registry. If another page is later registered with an existing name, the previous entry is overwritten and this warning is emitted.

This typically happens for a few common reasons:

- The same page is registered multiple times.
- Two different page components use the same registration name.
- Duplicate imports or repeated initialization logic register the same page more than once.
- Copying and modifying route configuration without updating the registration name.

**Resolution:** To resolve this warning:

1. Ensure each page is registered only once during application startup.
2. Use unique registration names for every page.
3. Check for duplicate imports or repeated initialization code.
4. Keep page registration centralized to avoid accidental overwrites.

**Incorrect**

```javascript
import HomePage from "./pages/home.page.js";
import DashboardPage from "./pages/dashboard.page.js";

const app = new AvenxApp({ target: "#app" });

app.registerPage("Home", HomePage);
app.registerPage("Home", DashboardPage);
```

Both registrations use the name `"Home"`, so the second registration overwrites the first and Avenx-JS emits **AVX_W07**.

**Correct**

```javascript
import HomePage from "./pages/home.page.js";
import DashboardPage from "./pages/dashboard.page.js";

const app = new AvenxApp({ target: "#app" });

app.registerPage("Home", HomePage);
app.registerPage("Dashboard", DashboardPage);
```

Using unique registration names ensures each page can be resolved correctly by the router.

**Defensive Example**

```javascript
const app = new AvenxApp({ target: "#app" });

app.registerPage("Home", HomePage);
app.registerPage("Profile", ProfilePage);
app.registerPage("Settings", SettingsPage);
```

Register all pages once during application initialization and assign each page a unique registration name to avoid accidental collisions.

### AVX_W08 — ROUTE_PATH_MISSING_LEADING_SLASH

**Warning Message**

```text
Route path "{0}" lacks a leading slash. This may prevent hash paths from resolving properly.
```

**Cause:** This warning is emitted during router initialization when a route is configured with a path that does not begin with a leading `/`. Avenx-JS expects all route paths to use an absolute, slash-prefixed format so they can be matched correctly during hash-based navigation. If a path is defined without the leading slash, the router may fail to resolve the route as expected.

This typically happens for a few common reasons:

- The leading `/` was accidentally omitted when defining a route.
- A route path was copied or renamed without preserving the correct format.
- Route configurations were generated dynamically without normalizing the path.

**Resolution:** To resolve this warning:

1. Ensure every route path begins with a leading `/`.
2. Review route definitions for typos or inconsistent path formatting.
3. Normalize dynamically generated paths before registering them with the router.
4. Keep route definitions consistent throughout the application.

**Incorrect**

```javascript
const routes = [
  {
    path: "dashboard",
    component: DashboardPage,
  },
];
```

Since the route path does not begin with `/`, Avenx-JS emits **AVX_W08** and the route may not match incoming hash navigation correctly.

**Correct**

```javascript
const routes = [
  {
    path: "/dashboard",
    component: DashboardPage,
  },
];
```

Using a leading slash ensures the router can correctly match and resolve the route.

**Defensive Example**

```javascript
const normalizePath = (path) =>
  path.startsWith("/") ? path : `/${path}`;

const routes = [
  {
    path: normalizePath("dashboard"),
    component: DashboardPage,
  },
];
```

Normalizing route paths before registration helps prevent configuration mistakes and ensures all routes follow the expected format.

### AVX_W09 — ROUTE_PARAM_DECODE_FAILED

**Warning Message**

```text
Failed to decode route parameter "{0}": {1}
```

**Cause:** This warning is emitted at runtime when the router matches a URL hash containing dynamic path parameters or query arguments, but `decodeURIComponent` fails to decode one of the percent-encoded values due to a malformed or invalid percent sequence (such as `#/profile/%invalid` or `#/search?query=%E0%A4%A`).

**Fallback Behavior:** When URI decoding fails, Avenx-JS catches the `URIError`, logs warning **AVX_W09**, and falls back to passing the raw, undecoded parameter string directly to the component props / route `params` object. This prevents routing navigation from crashing with an unhandled exception.

This typically happens for a few common reasons:

- A link or user input contains an unescaped `%` character followed by invalid hexadecimal digits.
- A URL parameter string was manually constructed without using `encodeURIComponent()`.
- An external redirect or truncated URL link passed malformed percent-encoded sequences into the hash path.

**Resolution:** To resolve this warning:

1. Ensure all dynamically generated URL path parameters and query strings are encoded using `encodeURIComponent()` before appending them to navigation hashes.
2. Validate user-entered search queries or input before interpolating them into URL hashes.
3. Handle potential raw undecoded string fallbacks defensively inside route components if malformed external links are expected.

**Incorrect**

```javascript
// Manually concatenating parameter strings without encoding
const category = "books & magazines % special";
// Creates malformed hash with unescaped '%' -> '#/category/books%20&%20magazines%20%20special'
window.location.hash = `#/category/${category}`;
```

The malformed percent sequence triggers a `URIError` inside `decodeURIComponent`, causing Avenx-JS to emit **AVX_W09** and pass the raw undecoded string into `params.category`.

**Correct**

```javascript
// Correctly encoding dynamic route parameters
const category = "books & magazines % special";
const safeCategory = encodeURIComponent(category);
// Produces valid percent-encoded hash: '#/category/books%20%26%20magazines%20%25%20special'
window.location.hash = `#/category/${safeCategory}`;
```

### AVX_W10 — ROUTE_NOT_FOUND


**Warning Message**

```text
No route defined for hash: {0}
```

**Cause:** This warning is emitted when the router detects a hash-based navigation request that does not match any registered route in the application's routing table. Since no matching page can be resolved, Avenx-JS cannot complete the navigation and emits this warning.

This typically happens for a few common reasons:

- Navigating to a URL hash that has no corresponding route.
- A typo in the route path or hash.
- The route was removed or renamed but existing links still reference it.
- A fallback or wildcard route has not been configured.

**Resolution:** To resolve this warning:

1. Verify that the requested hash matches a registered route.
2. Update any broken links or navigation code that references outdated route paths.
3. Define a fallback or wildcard route to handle unknown URLs gracefully.
4. Redirect unmatched routes to a dedicated 404 page instead of leaving the application in an undefined state.

**Incorrect**

```javascript
const router = new AvenxRouter();

router.add('/home', HomePage);

// User navigates to:
// #/profile
```

Since `/profile` is not registered, the router emits **AVX_W10** because no matching route exists.

**Correct**

```javascript
const router = new AvenxRouter();

router.add('/home', HomePage);
router.add('/profile', ProfilePage);
```

Registering every navigable route ensures hash navigation can resolve successfully.

**Defensive Example**

```javascript
const router = new AvenxRouter();

router.add('/home', HomePage);
router.add('/profile', ProfilePage);

router.add('*', NotFoundPage);
```

Using a wildcard (fallback) route allows unknown hashes to be redirected to a dedicated 404 page instead of producing an unresolved navigation.

### AVX_W11 — ROUTER_DUPLICATE_ROUTE_NAME

**Warning Message**

```text
Duplicate route name "{0}". Route names should be unique.
```

**Cause:** This warning is emitted during router setup when multiple route definitions in the router configuration share the exact same `name` property. Route names serve as unique string keys for named route navigation (e.g., `router.push({ name: 'user-profile' })`) and path resolution. When two or more routes use identical names, the router cannot determine which route to resolve and emits **AVX_W11**.

This typically happens for a few common reasons:

- Copying and pasting a route configuration block without updating the `name` property.
- Assigning generic names (such as `'details'` or `'index'`) across multiple nested or feature route modules.
- Registering duplicate routes dynamically during application initialization.

**Resolution:** To resolve this warning:

1. Ensure every route in your router configuration has a unique `name` string identifier.
2. Follow a consistent naming convention (e.g. prefixing route names with feature areas like `'user-profile'` and `'company-profile'`).
3. Audit route definitions to remove duplicate entries or conflicting names.

**Incorrect**

```javascript
const routes = [
  {
    path: '/users/:id',
    name: 'profile', // Duplicate route name!
    component: UserProfilePage,
  },
  {
    path: '/company/profile',
    name: 'profile', // Conflict triggers AVX_W11
    component: CompanyProfilePage,
  },
];
```

**Correct**

```javascript
const routes = [
  {
    path: '/users/:id',
    name: 'user-profile', // Unique route name
    component: UserProfilePage,
  },
  {
    path: '/company/profile',
    name: 'company-profile', // Unique route name
    component: CompanyProfilePage,
  },
];
```

**Route Title Evaluation Warning (`title()` Error)**

If `AVX_W11` is triggered during dynamic page title evaluation when a route's `title()` callback throws an exception:

```javascript
// Ensure title() safely accesses route parameters or fallback titles
export default {
  path: '/users/:id',
  name: 'user-profile',
  title: (route) => route.params?.id ? `User ${route.params.id}` : 'User Profile',
};
```


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

### AVX_W13 — PAGE_COMPONENT_NOT_REGISTERED

**Warning Message**

```
Component "{0}" not found in registry.
```

**Cause:** This warning is emitted when the router attempts to mount a page whose registered component cannot be found in the application's page registry. Before a page can be mounted, it must first be imported and registered with the `AvenxApp` instance. If the router resolves a page name that has never been registered, Avenx-JS cannot create the page and emits this warning.

This typically happens for a few common reasons:

- The page component was never imported.
- The page was imported but not registered using `app.registerPage()`.
- The registration name does not match the name used when mounting or routing.
- The page registration occurs after routing has already started.

**Resolution:** To resolve this warning:

1. Ensure the page component is imported into your application's entry file.
2. Register the page with `app.registerPage()` before any routing or page mounting occurs.
3. Verify that the registration name exactly matches the name referenced by your routes or `app.mountPage()`.
4. Keep all page registrations together during application initialization so the router has access to every page before navigation begins.

**Incorrect**

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import Home from './pages/home.page.js';

const app = new AvenxApp({ target: '#app' });

app.mountPage('Home');
```

Since the page was never registered, Avenx-JS cannot locate the component in the page registry.

**Correct**

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import Home from './pages/home.page.js';

const app = new AvenxApp({ target: '#app' });

app.registerPage('Home', Home);
app.mountPage('Home');
```

Registering the page before mounting ensures the router can resolve the requested component successfully.

**Defensive Example**

```javascript
import { AvenxApp } from 'avenx-core/runtime';

import Home from './pages/home.page.js';
import Profile from './pages/profile.page.js';

const app = new AvenxApp({ target: '#app' });

app.registerPage('Home', Home);
app.registerPage('Profile', Profile);

app.mountPage('Home');
```

Registering all pages during application startup helps ensure every routed page is available before navigation begins.

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

```text
[AVX_W15] Injected key "{0}" not found in any ancestor component.
```

**Cause:** This warning is emitted at runtime when a child component attempts to access an injected property defined via its `inject` option (or `inject: ['key']` / `inject: { localName: 'provideKey' }`), but no ancestor component in the DOM component hierarchy exposes a matching key via the `provide` option.

When an injected property is accessed, Avenx-JS performs a bottom-up traversal of the DOM component tree searching for a parent component that provides that key. If the traversal reaches the root component without finding a matching provider, Avenx-JS logs warning **`AVX_W15` (`COMPONENT_INJECT_KEY_NOT_FOUND`)** and evaluates the injected property to `undefined`.

The [Provide / Inject](/core-concepts/provide-inject) API allows parent components to act as dependency providers for their entire subtree without prop-drilling values through intermediate components.

This typically happens for a few common reasons:

- Forgetting to declare `provide` in a root page or parent component.
- Typos in the key name between `provide` and `inject` (e.g. `provide: { appTheme: 'dark' }` but `inject: ['theme']`).
- Attempting to inject a key from a sibling or child component instead of an ancestor in the parent chain.
- Instantiating a component standalone during isolated unit testing without mounting it inside a provider container or sandbox.

**Resolution:** To resolve this warning:

1. Ensure an ancestor component in the component hierarchy declares the requested key using `provide` (as an object or factory function `provide() { return { ... }; }`).
2. Double-check key spelling to ensure exact string matching between `provide` and `inject`.
3. Verify the component hierarchy — `provide` keys are only searchable up the direct parent component hierarchy (sibling components cannot inject from each other).
4. Provide a defensive default fallback value in the injecting component when keys are optional.

**Incorrect**

```javascript
// ChildComponent.component.js
// ❌ Warning AVX_W15: No ancestor component in the tree calls provide for 'theme'
export default {
  inject: ['theme'],
  template: `<p>Theme: {{ theme }}</p>`,
};
```

*Since no parent component provides the `'theme'` key, accessing `theme` triggers **AVX_W15** and resolves to `undefined`.*

**Correct**

```javascript
// AppLayout.component.js (Parent / Ancestor Component)
export default {
  provide: {
    theme: 'dark',
  },
  template: `<main><ChildComponent /></main>`,
};
```

```javascript
// ChildComponent.component.js (Descendant Component)
export default {
  inject: ['theme'],
  template: `<p>Theme: {{ theme }}</p>`,
};
```

*The parent component declares `theme: 'dark'` in its `provide` block, allowing all child components in its subtree to inject `theme` without warnings.*

**Defensive Example with Fallback Default**

When an injected key is optional or may be rendered outside of a provider boundary (such as in isolated component tests), specify a safe fallback default value:

```javascript
// ChildComponent.component.js
export default {
  inject: { currentTheme: 'theme' },
  computed: {
    safeTheme() {
      // Fall back to 'light' if no ancestor provides 'theme' (returns undefined and logs AVX_W15)
      return this.currentTheme || 'light';
    },
  },
  template: `<div class="card" data-theme="{{ safeTheme }}">Content</div>`,
};
```

Using a computed property or nullish coalescing as a fallback ensures your component behaves gracefully even when no matching provider exists in the ancestor tree.

---

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
```text
[Avenx Validation Warning] Sanitized tag "<script>" when stripping content.
```

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

**Warning Message**

```text
[AVX_W20] Duplicate key "{0}" detected in list expression "{1}". Appending index suffix to prevent node reuse conflict.
```

**Cause:** This warning is emitted at runtime by the `ListManager` reconciliation engine when two or more items rendered within a `<@for>` loop block evaluate to identical key values. Avenx-JS relies on unique keys to track, reorder, patch, and reuse DOM elements efficiently across reactive state updates. When key collisions occur, the reconciler cannot unambiguously match existing DOM nodes to updated list items.

**Impact:** Duplicate keys degrade rendering performance and can introduce UI bugs:

- **Performance Overhead:** To prevent execution crashes, Avenx-JS applies a fallback index-suffixing algorithm (`key_0`, `key_1`). This bypasses optimal DOM element recycling, causing unnecessary DOM element creation and destruction cycles on list updates.
- **State Mismatches & Visual Glitches:** Re-using DOM elements with duplicate keys can lead to component state leakage, loss of form input focus, CSS animation glitches, or stale content remaining in rendered list items.

**Resolution:** To resolve this warning:

1. Use a property that is guaranteed to be unique across all list items (such as a database `id`, UUID, or unique slug).
2. Avoid using non-unique attributes like `item.category`, `item.type`, or static strings as key expressions.
3. If list items lack a native unique identifier, construct a composite key (e.g. `item.category + '-' + index`) or combine item properties with the loop index.
4. Ensure source data in `state` does not contain duplicate entries with identical IDs.

**Incorrect**

```html
<state items="[
  { id: 1, category: 'books', title: 'JavaScript Guide' },
  { id: 2, category: 'books', title: 'CSS Mastery' }
]" />

<!-- ❌ Non-unique key: Multiple items share the category 'books' -->
<@for item in state.items key="item.category">
  <div>{{ item.title }}</div>
</@for>
```

*Because multiple items evaluate to `category: 'books'`, `ListManager` detects duplicate keys and emits **AVX_W20**.*

**Correct**

```html
<state items="[
  { id: 1, category: 'books', title: 'JavaScript Guide' },
  { id: 2, category: 'books', title: 'CSS Mastery' }
]" />

<!-- ✅ Unique key: Every item has a distinct id -->
<@for item in state.items key="item.id">
  <div>{{ item.title }}</div>
</@for>
```

**Defensive Example**

When list items lack unique ID properties, construct a composite key or combine properties with the loop index:

```html
<!-- ✅ Composite key using item property and index -->
<@for item in state.items key="item.category + '-' + index">
  <div>{{ item.title }}</div>
</@for>
```

> **Note:** Although Avenx-JS gracefully recovers from duplicate keys by appending index suffixes (e.g. `key_0`, `key_1`), resolving this warning ensures optimal DOM reconciliation performance and prevents UI bugs.

### AVX_W21 — DIRECTIVE_HTML_EVALUATION_FAILED

**Warning Message**

```text
Failed to evaluate data-ax-html: {0}. Error: {1}
```

**Cause:** This warning is emitted at runtime when Avenx-JS attempts to evaluate the expression bound to a `data-ax-html="..."` directive, but the expression throws an exception during evaluation. Since `data-ax-html` injects raw HTML directly into the element's `innerHTML`, any error in the underlying expression — such as referencing an uninitialized variable, calling an undefined method, or a malformed expression — prevents the directive from resolving to a valid HTML string.

This typically happens for a few common reasons:

- The bound expression references a state variable or property that is `undefined` or `null` at the time of evaluation.
- A method called within the expression throws internally (e.g. a formatting or sanitization helper failing on unexpected input).
- Asynchronous data the expression depends on has not finished loading.
- A typo or syntax error exists in the expression itself.

> [!WARNING]
> **Security Guidelines for Raw HTML Bindings (`data-ax-html`):**
> `data-ax-html` renders unescaped raw HTML using `innerHTML`. Inserting untrusted user input directly via `data-ax-html` creates severe Cross-Site Scripting (XSS) vulnerabilities.
> 1. **Use Interpolation by Default**: Use standard template interpolations (`{{ content }}`) whenever possible. Avenx-JS automatically escapes HTML in interpolations to protect against XSS.
> 2. **Sanitize Untrusted HTML**: If you must render dynamic HTML from an API or user input, sanitize the content using a trusted HTML sanitizer (such as DOMPurify) before binding it to `data-ax-html`.
> 3. **Avoid Dynamic Code Execution**: Never construct executable scripts or event handlers within HTML strings bound to `data-ax-html`.

**Resolution:** To resolve this warning:

1. Ensure all state variables referenced in `data-ax-html` are declared in `<state />`.
2. Guard against `undefined`/`null` values with defensive checks or fallback strings.
3. Handle asynchronous data by providing safe initial default values (e.g. `description=""`).
4. Encapsulate complex HTML generation logic within `<computed />` properties to keep template expressions clean and testable.

**Incorrect**

```html
<!-- State initialized without 'description' property -->
<state />

<div data-ax-html="description.toUpperCase()"></div>
```

Since `description` is `undefined`, calling `.toUpperCase()` throws a `TypeError`, triggering **AVX_W21**.

**Correct**

```html
<state description="" />

<div data-ax-html="description"></div>
```

**Defensive Example with Computed Property**

```html
<state rawContent="null" />

<computed name="safeContent" value="typeof rawContent === 'string' ? rawContent : ''" />

<div data-ax-html="safeContent"></div>
```

Deriving the HTML content through a guarded `<computed>` property ensures `data-ax-html` always receives a valid string and prevents evaluation failures.


### AVX_W22 — DIRECTIVE_SHOW_EVALUATION_FAILED

**Warning Message**

```text
Failed to evaluate data-ax-show: {0}. Error: {1}
```

**Cause:** This warning is emitted at runtime when Avenx-JS attempts to evaluate the condition expression bound to a `data-ax-show="..."` directive, but the evaluation throws a runtime exception. Since `data-ax-show` dynamically toggles an element's visibility based on the truthiness of the evaluated expression, an evaluation error — such as accessing properties on an uninitialized or `undefined` state property — prevents the renderer from determining whether the element should be shown or hidden.

This typically happens for a few common reasons:

- The bound expression accesses a property on an `undefined` or `null` state object (e.g. `state.user.isActive` when `state.user` is uninitialized or pending an async fetch).
- An uninitialised state variable is referenced directly before component state setup completes.
- A method referenced in the expression is missing from `actions` or `computed`.
- A syntax error or typo exists within the directive expression string.

**Resolution:** To resolve this warning:

1. **Initialize State Properties**: Ensure state variables referenced in `data-ax-show` are defined in initial component state (e.g. `user: null` or `user: {}`).
2. **Use Defensive Guarding / Optional Chaining**: Guard property access on potentially undefined state values (e.g. `state.user && state.user.isActive` or `state.user?.isActive`).
3. **Handle Async Data State**: Default state properties to safe initial fallback values (e.g., `false`) so `data-ax-show` evaluates safely while waiting for API responses.
4. **Use Computed Properties for Complex Expressions**: Encapsulate conditional state evaluation in a `computed` property with internal error handling or fallback logic.

**Incorrect**

```html
<!-- State initialised without 'user' property -->
<state />

<div data-ax-show="user.isActive">Welcome back!</div>
```

Since `user` is `undefined`, accessing `.isActive` throws a `TypeError`, triggering **AVX_W22**.

**Correct**

```html
<state user="null" />

<div data-ax-show="user && user.isActive">Welcome back!</div>
```

**Defensive Example**

```html
<state user="null" />

<computed name="isUserActive" value="Boolean(user && user.isActive)" />

<div data-ax-show="isUserActive">Welcome back!</div>
```

Deriving the condition through a guarded `<computed>` property ensures `data-ax-show` always receives a safe boolean and prevents evaluation failures.


### AVX_W23 — DIRECTIVE_CLASS_EVALUATION_FAILED

**Warning Message**
Failed to evaluate data-ax-class: {0}. Error: {1}

**Cause:** This warning is emitted at runtime when Avenx-JS attempts to evaluate the expression bound to a `data-ax-class="..."` directive, but the expression throws an exception. Since `data-ax-class` adds and removes classes based on the evaluated value, any error during evaluation prevents the renderer from applying the intended dynamic classes for that update.

This typically happens for a few common reasons:

- The bound expression accesses a nested property on a value that is `null` or `undefined` (e.g. `user.role` before `user` has loaded).
- A class map references an action or computed value that has not been declared.
- Asynchronous data used to choose classes has not resolved yet.
- A typo or syntax error prevents the expression from evaluating.

**Resolution:** To resolve this warning:

1. Initialize any state used by `data-ax-class` before the component renders.
2. Guard nested property access with optional chaining or explicit checks.
3. Return either a string of class names or an object whose keys are class names and whose values are booleans.
4. Move complex class decisions into a `<computed>` property so the template stays small and the logic is easier to test.

**Incorrect**

```html
<state />

<button data-ax-class="{ admin: user.role === 'admin' }">
  Save
</button>
```

Since `user` is `undefined`, accessing `.role` throws, and the dynamic class expression fails to evaluate.

**Correct**

```html
<state user="null" />

<button data-ax-class="{ admin: user && user.role === 'admin' }">
  Save
</button>
```

**Defensive Example**

```html
<state user="null" isSaving="false" />

<computed name="buttonClasses" value="{ admin: user?.role === 'admin', loading: isSaving === true }" />

<button data-ax-class="buttonClasses">Save</button>
```


Deriving class maps through guarded `<computed>` properties ensures `data-ax-class` receives a safe value and prevents evaluation failures when optional state is missing.


### AVX_W27 — ROUTER_GUARD_UNDEFINED_RETURN

**Warning Message**

```text
Navigation guard for route "{0}" returned undefined. Guards should explicitly return true, false, a redirect string, or a control object. Defaulting to allow.
```

**Cause:** This warning is emitted at runtime when a route guard's `canActivate(to, from)` method resolves to `undefined` instead of returning an explicit decision. By design, route guards must explicitly dictate navigation behavior by returning:
- `true`: Allow navigation
- `false`: Abort navigation
- `string`: Redirect to another route (e.g., `'#/login'`)
- `object`: Guard control object (e.g., `{ cancel: true }` or `{ redirect: '#/login' }`)

When a guard returns `undefined`, Avenx-JS logs **AVX_W27** and defaults to allowing the transition. This usually indicates a logic bug such as a missing `return` statement or an unhandled code branch in an `if/else` block within the guard.

This typically happens for a few common reasons:

- Forgetting an explicit `return` statement at the end of `canActivate()`.
- An `if` condition branch performs a check but fails to return `true` on the fallback/else branch.
- An `async` guard resolves an asynchronous operation without explicitly returning a boolean or redirect string.

**Resolution:** To resolve this warning:

1. Ensure every execution path inside `canActivate()` explicitly returns a `boolean`, `string`, or control object.
2. Add a default fallback `return true;` (or `return false;`) at the end of the `canActivate()` method.
3. Review `if/else` conditional logic inside custom route guards to guarantee all branches return an explicit value.

**Incorrect**

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export default class AuthGuard extends AvenxGuard {
  canActivate(to, from) {
    if (!localStorage.getItem('authToken')) {
      return '#/login';
    }
    // Missing explicit return true on authorized path!
    // Implicitly returns undefined, triggering AVX_W27
  }
}
```

**Correct**

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export default class AuthGuard extends AvenxGuard {
  canActivate(to, from) {
    if (!localStorage.getItem('authToken')) {
      return '#/login';
    }

    // Explicit return for allowed navigation
    return true;
  }
}
```

**Async Example**

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export default class AsyncRoleGuard extends AvenxGuard {
  async canActivate(to, from) {
    try {
      const user = await fetchCurrentUser();
      if (!user || user.role !== 'admin') {
        return '#/unauthorized';
      }
      return true;
    } catch {
      return false; // Explicit return on error
    }
  }
}
```

### AVX_W24 — COMPILER_PREPROCESSOR_MISSING


**Warning Message**

```text
WARNING: Preprocessor module "{0}" is not installed. Falling back to raw CSS.
```

**Cause:** This warning is emitted during compilation when a style preprocessor package (such as `sass`, `less`, or `postcss`) is configured in `avenx.config.json` but is not installed in the project's `node_modules`. Avenx-JS attempts to load the specified preprocessor to compile stylesheets (`.scss`, `.sass`, `.less`, or PostCSS files), but if the required package is missing, the compiler gracefully falls back to processing the raw CSS content without transformation.

This typically happens for a few common reasons:

- The preprocessor package was never installed (e.g. `npm install sass` was not run).
- The package was removed from `node_modules` (e.g. after running `npm prune`).
- A lock file mismatch caused the preprocessor to not be installed during `npm install`.
- The preprocessor is listed in `avenx.config.json` but the project only needs vanilla CSS.

**Resolution:** To resolve this warning:

1. Install the required preprocessor package using your package manager (e.g. `npm install sass` for Sass/SCSS, `npm install less` for Less, or `npm install postcss postcss-cli` for PostCSS).
2. Verify the `preprocessor` value in your `avenx.config.json` matches the installed package.
3. If you do not need a preprocessor, remove the `preprocessor` field from the configuration or set it to `none`.
4. After installing, re-run the build to confirm the warning no longer appears.

**Incorrect**

```json
{
  "compiler": {
    "preprocessor": "sass"
  }
}
```

If the `sass` package is not installed, Avenx-JS emits **AVX_W24** and falls back to raw CSS.

**Correct**

```bash
npm install sass
```

Installing the preprocessor package resolves the missing module issue.

**Defensive Example**

If your project does not use a preprocessor, omit the field entirely or set it explicitly:

```json
{
  "compiler": {
    "preprocessor": "none"
  }
}
```

This avoids the warning and ensures stylesheets are processed as vanilla CSS.

### AVX_W25 — COMPILER_INVALID_CONFIG

**Warning Message**

```text
[AVX_W25] Failed to parse avenx.config.json at "{0}": {1}
```

**Cause:** This warning is emitted during project build or compilation when Avenx-JS attempts to load and parse `avenx.config.json` at the root of your project, but the configuration file contains unknown top-level keys, invalid property types, or malformed options. It is also triggered if the file contains invalid JSON syntax (such as missing quotes or trailing commas). When configuration loading or validation fails, Avenx-JS catches the error, logs warning **AVX_W25**, and gracefully falls back to default compiler settings.

This typically happens for a few common reasons:

- Unknown top-level configuration options or typos in key names (e.g., `"src_directory"` instead of `"srcDir"`).
- Invalid property data types (e.g., specifying a string `"3000"` for `server.port` instead of a number `3000`, or a non-boolean for `server.liveReload`).
- Syntax errors in `avenx.config.json` such as trailing commas, single quotes instead of double quotes, or missing closing braces.
- Unrecognized properties inside nested configuration blocks like `server`, `style`, `debug`, `logging`, or `hooks`.

**Resolution:** To resolve this warning:

1. Validate the syntax of `avenx.config.json` using a JSON validator or IDE formatting tool.
2. Ensure standard double quotes (`"`) are used around all keys and string values.
3. Remove any trailing commas after the last key-value pair in JSON objects or arrays.
4. Verify that configuration schema keys match expected framework options (e.g. `srcDir`, `distDir`, `templatesDir`, `server`, `style`, `debug`, `logging`, `voidTags`, `warnings`, `treeShakeComponents`, `preprocessors`, `alias`, `hooks`).
5. Ensure all property values match their expected data types (e.g., `server.port` must be a number between `0` and `65535`).

**Incorrect**

```json
{
  "src_directory": "src",
  "server": {
    "port": "3000"
  }
}
```

*In this example, `"src_directory"` is an unknown configuration key (typo for `"srcDir"`), and `"port"` is given as a string instead of a number, triggering **AVX_W25**.*

**Correct**

```json
{
  "srcDir": "src",
  "distDir": "dist",
  "server": {
    "port": 3000,
    "host": "localhost",
    "liveReload": true
  },
  "style": {
    "preprocessor": "none"
  }
}
```

### AVX_W26 — COMPILER_PREPROCESSOR_FAILED

**Warning Message**

```text
Error compiling {0}: {1}
```

**Cause:** This warning is emitted during project build or template compilation when a preprocessor (e.g. Sass/SCSS, Less, PostCSS, or a custom template transformer hook configured in `avenx.config.json`) throws an exception during execution. When a preprocessor fails due to syntax errors in the source language, invalid preprocessor hooks, or unexpected return values, `AvenxCompiler` catches the exception, logs warning **AVX_W26**, and gracefully falls back to using the raw, un-preprocessed template or stylesheet content.

This typically happens for a few common reasons:

- Syntax errors inside preprocessed stylesheets or templates (e.g. invalid SCSS syntax, unclosed braces, or malformed Pug template indentations).
- A custom preprocessor function throws an unhandled exception or returns `undefined` / `null` instead of a compiled string.
- Incompatible preprocessor plugin versions or missing secondary plugins (e.g., PostCSS plugins configured with invalid options).

**Resolution:** To resolve this warning:

1. Inspect the detailed error message in build logs to pinpoint the exact file path and line number where the preprocessor failed.
2. Fix syntax errors inside your `.scss`, `.less`, or preprocessed template blocks.
3. Wrap custom preprocessor functions in `try...catch` blocks or ensure they always return a valid compiled string.
4. Verify preprocessor dependencies and plugin configurations in `avenx.config.json`.

**Incorrect**

```scss
/* Invalid SCSS syntax inside <@css> block -> Triggers AVX_W26 */
<@css>
    card {
        color: #333
        /* Missing semicolon and closing brace */
</@css>
```

**Correct**

```scss
/* Valid SCSS syntax */
<@css>
    card {
        color: #333;

        &:hover {
            color: #6366f1;
        }
    }
</@css>
```

**Custom Preprocessor Error Handling Example**

```javascript
// Custom preprocessor hook in avenx.config.js
module.exports = {
  style: {
    preprocessor: (code, filename) => {
      try {
        return customTransform(code);
      } catch (err) {
        console.error(`Preprocessing failed for ${filename}:`, err);
        throw err; // Re-throw to allow compiler to handle AVX_W26 reporting
      }
    },
  },
};
```

### AVX_W28 — COMPILER_MULTIPLE_STATE_TAGS



**Warning Message**

```text
Multiple <state> tags found in component template. Only the first <state> tag will be processed; subsequent <state> tags are ignored.
```

**Cause:** This warning is emitted during compilation when a single component template file contains more than one `<state>` tag declaration. Avenx-JS enforces a single `<state>` block per component to maintain predictable state initialization and scoping. When multiple `<state>` blocks are detected, the compiler parses properties from the first `<state>` tag and ignores all subsequent `<state>` tags.

This typically happens for a few common reasons:

- Accidentally declaring separate `<state>` tags for different categories of properties instead of merging them.
- Copy-pasting template code that includes another `<state>` block.
- Splitting initial state and default values across multiple `<state>` tags.

**Resolution:** To resolve this warning:

1. Consolidate all reactive property declarations into a single `<state>` block within the component template.
2. Remove any duplicate or extra `<state>` tags.
3. If necessary, organize reactive properties within a single nested object structure inside the primary `<state>` block.

**Incorrect**

```html
<!-- Multiple separate <state> blocks -->
<state count="0" />
<state user="null" isLoading="false" />

<div>
  <p>Count: {{ count }}</p>
</div>
```

The compiler emits **AVX_W28** and ignores the second `<state>` tag, leaving `user` and `isLoading` uninitialized.

**Correct**

```html
<!-- Consolidated into a single <state> block -->
<state count="0" user="null" isLoading="false" />

<div>
  <p>Count: {{ count }}</p>
</div>
```

**Complex State Object Example**

For larger components with complex state requirements, group properties inside a single `<state>` tag:

```html
<state 
  counter="0"
  settings='{ "theme": "dark", "notifications": true }'
/>
```

### AVX_W29 — COMPILER_CIRCULAR_DEPENDENCY


**Warning Message**

```text
WARNING: Circular dependency detected in component imports: {0}
```

**Cause:** This warning is emitted when the compiler detects a circular dependency in the component import graph. A circular dependency occurs when following component imports eventually leads back to a component that has already appeared in the current dependency chain. This can happen through direct imports (Component A imports Component B, and Component B imports Component A) or through longer dependency chains involving multiple components.

**Resolution:** To resolve this warning:

1. Remove unnecessary component imports that create dependency cycles.
2. Extract shared functionality into a separate component, utility, or shared module that both components can depend on instead of importing each other.
3. Restructure component relationships so imports form an acyclic dependency graph.

**Incorrect**

Direct circular dependency:

```javascript
// comp-a.component.js
import CompB from './comp-b.component.js';
```

```javascript
// comp-b.component.js
import CompA from './comp-a.component.js';
```

Indirect circular dependency:

```text
CompX
 ↓
CompY
 ↓
CompZ
 ↓
CompX
```

**Correct**

```text
Parent
 ↓
Child
```

A one-way dependency does not create a circular import and will compile without this warning.

**Defensive Example**

When two components need the same functionality, move the shared logic into a separate module or utility instead of importing the components into each other. This keeps the dependency graph acyclic and avoids compiler warnings.

### AVX_W30 — COMPILER_DUPLICATE_ID_ATTRIBUTE

**Warning Message**

```text
Duplicate static id attribute "{0}" detected in template of {1}. Static IDs must be unique and should not be used inside loops.
```

**Cause:** This warning is emitted when the compiler detects duplicate static `id` attributes within a component template. HTML requires `id` values to be unique within a document. This warning is also emitted when a static `id` attribute is used inside an `<@for>` loop, since each iteration generates another element with the same `id`.

**Resolution:** To resolve this warning:

1. Ensure every static `id` value within the component is unique.
2. Avoid using static `id` attributes inside `<@for>` loops.
3. Use `class` or `data-*` attributes for repeated elements instead of static HTML `id` values.

**Incorrect**

Duplicate IDs:

```html
<div id="user-card"></div>
<section id="user-card"></section>
```

Static ID inside a loop:

```html
<@for(item in items)>
    <div id="user-card">
        {{ item.name }}
    </div>
</@for>
```

**Correct**

Use unique IDs:

```html
<div id="profile-card"></div>
<section id="settings-card"></section>
```

Use `class` or `data-*` attributes for repeated elements:

```html
<@for(item in items)>
    <div class="user-card" data-user-id="{{ item.id }}">
        {{ item.name }}
    </div>
</@for>
```

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
| `[AVX_R10]` | Bridge "{0}" is already registered. Available bridges: {1}. Suggestion: {2} | **Cause:** An attempt was made to register a global bridge using a name (`app.registerBridge(name, data)`) that has already been registered on the `AvenxApp` instance. Bridge names must be unique across the application.<br />**Resolution:** Assign a unique string identifier to each bridge, or check if the bridge is already registered (`app.hasBridge(name)`) before calling `app.registerBridge()`. |
| `[AVX_R11]` | STATE_MUTATION_IN_UPDATE: Synchronous state mutation detected during component update.  | **Cause:** Modifying reactive state synchronously inside a template expression, computed property, or `onUpdate` hook causes the runtime to re-trigger the same update cycle, resulting in an infinite update/render loop.<br />**Resolution:** Never mutate state directly inside templates or computed getters. If a side-effect state change is required after an update, defer it asynchronously (e.g. `setTimeout(() => { this.state.value = newValue; }, 0)`) or derive the value through a computed property instead. |

| `[AVX_R12]` | Error in component "{name}" during lifecycle hook "{hook}": {error}                     | **Cause:** An unhandled error was thrown inside a component lifecycle hook (`onMount`, `onUpdate`, or `onUnmount`).<br />**Resolution:** Wrap lifecycle hook logic in a `try...catch` block, inspect the hook implementation for bugs, and ensure asynchronous operations properly handle rejected promises.                                                                                                                                                                                                                 |
| `[AVX_R13]` | DOM parsing failed due to malformed HTML. Parser error: {error}. HTML context: "{html}" | **Cause:** DOM parsing failed due to malformed HTML in component templates or dynamically rendered content (e.g., unclosed tags or mismatched elements).<br />**Resolution:** Verify your template HTML is well-formed. Ensure all elements are properly nested and all tags are closed.                                                                                                                                                                                                                                     |
| `[AVX_R14]` | ROUTER_GUARD_TIMEOUT: A route guard exceeded the configured timeout duration.           | **Cause:** One or more sequential route guards returned promises that failed to resolve within the configured timeout period, causing navigation transitions to stall.<br />**Resolution:** Inspect route guard logic for unresolved or hanging promises. Optimize long-running asynchronous operations, ensure all promises properly resolve or reject, or adjust the `guardTimeout` configuration if longer execution times are expected.                                                                                  |
| `[AVX_R15]` | SANDBOX_VIOLATION: A sandbox security violation occurred.                               | **Cause:** Template or runtime expressions attempted to access restricted properties such as `__proto__`, `constructor`, or `prototype`, or unauthorized global variables. This restriction prevents prototype pollution, template injection, and unauthorized global scope access.<br />**Resolution:** Restrict expressions to authorized variables only. Avoid accessing or modifying prototype-related properties and unauthorized globals. If necessary, wrap values securely before exposing them to expressions.      |
| `[AVX_R16]` | Cannot reassign component state directly.                                               | **Cause:** Assigning a new object to `this.state`, such as `this.state = { count: 1 }`, replaces the reactive Proxy and breaks change detection.<br />**Resolution:** Mutate properties on the existing state object instead, such as `this.state.count = 1`, or update several properties with `Object.assign(this.state, { count: 1 })`.                                                                                                                                                                                   |
| `[AVX_R18]` | REACTIVE_DEADLOCK_DETECTED: Circular reactive update cycle detected: {0} | **Cause:** Scheduler exceeded `maxFlushCount` passes or a `<@deadlock>` boundary exceeded `maxDepth` due to a circular reactive update loop.<br />**Resolution:** Break the circular dependency chain indicated in the causation trace, or configure fallback handling via `<@deadlock>`. See the [<@deadlock> guide](/core-concepts/deadlocks/). |

### AVX_R01 — MOUNT_TARGET_NOT_FOUND

**Error Message**

```text
[AVX_R01] Mount target selector "{0}" was not found in the DOM.
```

**Cause:** This error is thrown at runtime when `AvenxApp` attempts to mount the application or a component into the DOM, but the target container element specified by the selector cannot be resolved (`document.querySelector(target)` returns `null`).

This typically happens for a few common reasons:

- **Missing Container Element**: The `index.html` file does not contain an element matching the configured `target` selector (e.g. `<div id="app"></div>`).
- **Script Execution Timing**: The application bootstrap script is executed before the DOM is fully loaded (e.g., placed in the `<head>` without a `defer` or `type="module"` attribute, or executed before the `DOMContentLoaded` event).
- **Selector Typo or Syntax Error**: The selector string contains a typo or missing prefix (e.g., passing `'app'` instead of `'#app'`, or mismatching an ID and a class name).
- **Invalid Custom Mount Target**: Calling `app.mount(componentName, targetSelector)` with an explicit target selector that does not match any element in the active document.

**Resolution:** To resolve this error:

1. Ensure your HTML file (e.g. `index.html`) contains a container element matching the target selector specified in your app configuration:
   ```html
   <div id="app"></div>
   ```
2. Verify that the JavaScript bootstrap file is loaded after the DOM is ready by adding `type="module"` or `defer` to the `<script>` tag:
   ```html
   <script type="module" src="./src/main.app.js"></script>
   ```
3. Check the selector syntax passed to `new AvenxApp({ target })` or `app.mount(name, target)`. Use `'#app'` for elements with `id="app"` and `'.app-root'` for elements with `class="app-root"`.

**Incorrect**

Missing ID prefix or executing script before the DOM element is parsed:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- ❌ Script runs before <body> is parsed, and target selector lacks '#' prefix -->
  <script src="./src/main.app.js"></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>
```

```javascript
// ❌ Invalid selector missing ID hash symbol
const app = new AvenxApp({
  target: 'app'
});
```

**Correct**

Using `type="module"` and a valid CSS selector matching the DOM element:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Avenx Application</title>
</head>
<body>
  <!-- ✅ Matching container element -->
  <div id="app"></div>

  <!-- ✅ Deferred module script executes when DOM is available -->
  <script type="module" src="./src/main.app.js"></script>
</body>
</html>
```

```javascript
// ✅ Valid ID selector matching <div id="app"></div>
const app = new AvenxApp({
  target: '#app'
});
```

**Defensive Coding Example**

Ensuring DOM readiness before initializing the application:

```javascript
function bootstrap() {
  const targetSelector = '#app';
  if (!document.querySelector(targetSelector)) {
    console.error(`Mount container "${targetSelector}" not found. App initialization aborted.`);
    return;
  }

  const app = new AvenxApp({ target: targetSelector });
  app.registerPage('Home', HomePage);
  app.initRouter({ '/': 'Home' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
```

### AVX_R02 — PAGE_NOT_FOUND

**Error Message**

```text
[AVX_R02] Page "{0}" is not registered. Ensure page class is named correctly.
```

**Cause:** This error is thrown at runtime during routing or manual page mounting when `AvenxApp.mountPage(name)` is called with a page name that does not exist in the application's page registry (`app.pages.get(name)` returns `undefined`).

This typically happens for a few common reasons:

- **Unregistered Route Target**: A route in `app.initRouter(routes)` maps a URL path to a page name that was never registered via `app.registerPage(name, PageClass)`.
- **Unregistered Layout**: A route definition specifies a `layout` (e.g. `{ page: 'Profile', layout: 'AdminLayout' }`) but the layout class was not registered with `app.registerPage('AdminLayout', AdminLayoutPage)`.
- **Name Mismatch or Typo**: The string identifier used in the route map (e.g. `'/dashboard': 'Dashboard'`) does not exactly match the name passed to `app.registerPage('dashboard', DashboardPage)` (case sensitivity mismatch).
- **Missing Import**: The page class file was created but not imported into the application bootstrap file (`src/main.app.js`).

**Resolution:** To resolve this error:

1. Import and register every page component with `app.registerPage('PageName', PageClass)` before calling `app.initRouter()`.
2. Verify that the page name strings in the router configuration match the registered page names exactly, including casing.
3. If using layouts for nested routing, ensure both the page component and the layout component are registered with `app.registerPage()`.
4. Inspect the list of registered pages during development using `app.getRegisteredPages()`.

**Incorrect**

Defining a route without registering the corresponding page class:

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import HomePage from './pages/home.page.js';
// ❌ DashboardPage is not imported or registered

const app = new AvenxApp({ target: '#app' });

app.registerPage('Home', HomePage);

// ❌ Navigating to '#/dashboard' throws AVX_R02: Page "Dashboard" is not registered.
app.initRouter({
  '/': 'Home',
  '/dashboard': 'Dashboard'
});
```

**Correct**

Registering all routed pages and layouts before initializing the router:

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import HomePage from './pages/home.page.js';
import DashboardPage from './pages/dashboard.page.js';
import AdminLayout from './layouts/admin.page.js';

const app = new AvenxApp({ target: '#app' });

// ✅ Register all pages and layouts
app.registerPage('Home', HomePage);
app.registerPage('Dashboard', DashboardPage);
app.registerPage('AdminLayout', AdminLayout);

// ✅ All mapped page identifiers are registered
app.initRouter({
  '/': 'Home',
  '/dashboard': { page: 'Dashboard', layout: 'AdminLayout' }
});
```

**Defensive Coding Example**

Validating registered pages before router initialization:

```javascript
const app = new AvenxApp({ target: '#app' });

app.registerPage('Home', HomePage);
app.registerPage('Dashboard', DashboardPage);

const routes = {
  '/': 'Home',
  '/dashboard': 'Dashboard',
  '/settings': 'Settings'
};

// Check for missing registrations before starting router
const registeredPages = new Set(app.getRegisteredPages());
for (const [path, def] of Object.entries(routes)) {
  const pageName = typeof def === 'string' ? def : def.page;
  if (!registeredPages.has(pageName)) {
    console.warn(`[Config Warning] Route "${path}" targets unregistered page "${pageName}".`);
  }
}

app.initRouter(routes);
```

### AVX_R03 — COMPONENT_NOT_FOUND

**Error Message**

```text
[AVX_R03] Component "{0}" is not registered. Registered components: {1}
```

**Cause:** This error is thrown at runtime when `app.mount(name, targetSelector)` is invoked or when the runtime attempts to instantiate a component by name, but the requested component class cannot be found in the component registry (`app.components.get(name)` returns `undefined`).

This typically happens for a few common reasons:

- **Unregistered Custom Component**: Attempting to mount a component with `app.mount('MyComponent')` without first registering it with `app.register('MyComponent', MyComponentClass)`.
- **Typo in Component Name**: A spelling or casing mismatch between the component name passed to `app.mount()` and the name registered with `app.register()`.
- **Missing Component Import**: Forgetting to import the compiled component class into the main application file.

**Resolution:** To resolve this error:

1. Import the component class and register it on the application instance using `app.register('ComponentName', ComponentClass)`.
2. Check the `Registered components: {1}` list provided in the error message to identify whether the component was registered under a different name or omitted entirely.
3. Ensure component registration takes place before calling `app.mount()`.

**Incorrect**

Attempting to mount a component without registering it:

```javascript
import { AvenxApp } from 'avenx-core/runtime';
// ❌ UserCard component is not imported or registered

const app = new AvenxApp({ target: '#app' });

// ❌ Throws AVX_R03: Component "UserCard" is not registered. Registered components: VirtualList
app.mount('UserCard', '#card-slot');
```

**Correct**

Registering the component before mounting:

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import UserCardComponent from './components/user-card.component.js';

const app = new AvenxApp({ target: '#app' });

// ✅ Register component class
app.register('UserCard', UserCardComponent);

// ✅ Mount registered component
app.mount('UserCard', '#card-slot');
```

**Defensive Coding Example**

Centralizing component registration and checking availability:

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import HeaderComponent from './components/header.component.js';
import FooterComponent from './components/footer.component.js';
import UserCardComponent from './components/user-card.component.js';

const app = new AvenxApp({ target: '#app' });

const componentRegistry = {
  Header: HeaderComponent,
  Footer: FooterComponent,
  UserCard: UserCardComponent,
};

// Register all components systematically
for (const [name, compClass] of Object.entries(componentRegistry)) {
  app.register(name, compClass);
}

// Safe mount helper
function safeMount(componentName, selector) {
  if (!app.components.has(componentName)) {
    console.error(`Cannot mount unregistered component "${componentName}".`);
    return;
  }
  app.mount(componentName, selector);
}

safeMount('Header', '#header');
```

### AVX_R04 / AVX_E01 — COMPUTED_CIRCULAR_DEPENDENCY

**Error Message**

```text
[AVX_R04] Circular dependency detected in computed property "{0}".
```

**Cause:** This error is thrown at runtime when a computed property evaluation creates a circular dependency chain. In Avenx-JS, computed properties automatically track their reactive dependencies during getter execution. If Computed Property A reads Computed Property B, and Computed Property B directly or indirectly references Computed Property A (or if a computed getter references its own name), the framework detects an infinite recursion loop, halts evaluation, and throws **AVX_R04** (also referenced as **AVX_E01**).

This typically happens for a few common reasons:

- **Direct Self-Reference**: A computed property expression references its own property name (e.g. `<computed name="total" value="total + 10" />`).
- **Mutual Circular Dependency**: Two computed properties depend on each other (e.g. `computedA` reads `computedB`, while `computedB` reads `computedA`).
- **Indirect Cycle**: A multi-step computed chain loops back to an earlier property (`A -> B -> C -> A`).

**Resolution:** To resolve this error:

1. Inspect computed property getters to ensure expressions only depend on raw `state` properties or upstream computed properties.
2. Refactor computed property definitions so data flows unidirectionally (Acyclic Dependency Graph).
3. If two values depend on each other, combine the calculation into a single computed property or handle the state update inside an `<action>` callback instead of a computed property.

**Incorrect**

Self-referencing computed property:

```html
<state firstName="Alice" lastName="Smith" />

<!-- ❌ Self-referencing: fullName reads fullName -->
<computed name="fullName" value="fullName + ' (' + firstName + ')'" />
```

Mutual circular dependency:

```html
<state count="5" />

<!-- ❌ Circular chain: double depends on triple, triple depends on double -->
<computed name="double" value="triple / 1.5" />
<computed name="triple" value="double * 1.5" />
```

**Correct**

Unidirectional computed dependency:

```html
<state firstName="Alice" lastName="Smith" />

<!-- ✅ Single-direction data flow: derives from raw state -->
<computed name="fullName" value="firstName + ' ' + lastName" />
<computed name="displayName" value="fullName + ' (User)'" />
```

```html
<state count="5" />

<!-- ✅ Both computed properties derive unidirectionally from state.count -->
<computed name="double" value="count * 2" />
<computed name="triple" value="count * 3" />
```

### AVX_R05 — COMPUTED_EVALUATION_FAILED

**Error Message**

```text
[AVX_R05] Failed to evaluate computed property "{0}". Expression: "{1}". Error: {2}
```

**Cause:** This error is thrown at runtime when an unhandled JavaScript exception or type error occurs during the evaluation of a `<computed>` property's getter function. When `ComputedRegistry` evaluates the computed expression, any runtime error (such as reading a property of `null` or `undefined`, calling a non-existent function, or executing an invalid math operation) is caught, wrapped in **AVX_R05**, and thrown with details identifying the computed property name, expression string, and root cause error message.

This typically happens for a few common reasons:

- **Uninitialized or Null State Reference**: Accessing nested object properties (e.g. `user.profile.name`) when `user` or `profile` is `null` or `undefined` (such as before an async API fetch completes).
- **Type Mismatch or Invalid Method Calls**: Calling array or string methods on non-array or non-string values (e.g. `items.filter(...)` when `items` is initialized to `null`).
- **Referencing Undefined State Variables**: Referencing a state variable in a computed expression that was not declared in the component's `<state>` block or instance state.

**Resolution:** To resolve this error:

1. **Use Optional Chaining (`?.`)**: Protect nested property accesses against `null` or `undefined` values during initial component renders.
2. **Provide Fallback Values**: Use logical OR (`||`) or nullish coalescing (`??`) operators to ensure computed getters always return a valid safe default.
3. **Initialize Reactive State**: Ensure all reactive state variables referenced by computed properties are explicitly declared in the `<state>` tag with appropriate initial types (e.g. `items="[]"`, `user="null"`).

**Incorrect**

Accessing nested properties on an uninitialized state object:

```html
<state user="null" />

<!-- ❌ Throws AVX_R05: Cannot read properties of null (reading 'firstName') -->
<computed name="userFullName" value="user.firstName + ' ' + user.lastName" />
```

Calling array methods on an uninitialized state property:

```html
<state searchResults="null" />

<!-- ❌ Throws AVX_R05: searchResults.filter is not a function -->
<computed name="activeResults" value="searchResults.filter(item => item.active)" />
```

**Correct**

Using optional chaining and fallback defaults:

```html
<state user="null" />

<!-- ✅ Safe evaluation: returns fallback 'Guest' when user is null -->
<computed name="userFullName" value="user ? (user.firstName + ' ' + user.lastName) : 'Guest'" />
```

Initializing state with empty collections:

```html
<state searchResults="[]" />

<!-- ✅ Safe evaluation: empty array permits array methods without throwing -->
<computed name="activeResults" value="searchResults ? searchResults.filter(item => item.active) : []" />
```

**Defensive Coding Example**

```html
<state profile="null" />

<computed 
  name="avatarUrl" 
  value="profile?.avatar ?? '/images/default-avatar.png'" 
/>
```

### AVX_R06 — ROUTER_GUARD_DENIED

**Warning Message**

```text
[AVX_R06] Navigation guard denied transition to route "{0}".
```

**Cause:** This warning is emitted at runtime when a route navigation guard explicitly denies a route transition. In Avenx-JS, navigation guards (`AvenxGuard` classes with a `canActivate(to, from)` method, inline guard functions, or `router.beforeEach()` hooks) control access to protected routes. When a guard returns `false` or returns a control object `{ cancel: true }`, the router halts the navigation sequence, leaves or restores the previous route, and logs **AVX_R06**.

This typically happens for a few common reasons:

- **Authentication / Authorization Failure**: An unauthenticated user attempts to navigate to a protected page (e.g. `#/admin`), and the authentication guard returns `false`.
- **Falsy Return Value**: A guard function inadvertently returns `null`, `0`, or `false` instead of returning `true` when access is intended to be permitted.
- **Explicit Cancellation**: A guard returns `{ cancel: true }` without specifying `silent: true`.

**Resolution:** To resolve or properly handle this warning:

1. **Verify Guard Logic**: Ensure `canActivate(to, from)` returns `true` when all criteria are met.
2. **Use Redirects Instead of Hard Denial**: To provide a seamless user experience, return a redirect path string (e.g. `'/login'`) or a redirect descriptor `{ redirect: '/login', query: { from: to.hash } }` rather than simply returning `false`.
3. **Use Silent Cancellation**: If the navigation cancellation is intentional and expected (e.g. an unsaved changes confirmation dialog where the user chooses to stay), return `{ cancel: true, silent: true }` to cancel the navigation without emitting **AVX_R06**.

**Incorrect**

Returning `false` on unauthorized access without redirecting the user:

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export class AuthGuard extends AvenxGuard {
  canActivate(to, from) {
    const isLoggedIn = Boolean(localStorage.getItem('authToken'));
    if (!isLoggedIn) {
      // ❌ Returns false: stops transition and logs AVX_R06 warning, but leaves user on a dead-end
      return false;
    }
    return true;
  }
}
```

**Correct**

Returning a redirect path or control object to guide the user:

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export class AuthGuard extends AvenxGuard {
  canActivate(to, from) {
    const isLoggedIn = Boolean(localStorage.getItem('authToken'));
    if (!isLoggedIn) {
      // ✅ Redirects unauthenticated users to the login route with return target
      return {
        redirect: '/login',
        query: { redirect: to.hash }
      };
    }
    return true;
  }
}
```

**Defensive Coding Example**

Implementing silent cancellation and granular navigation control:

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export class UnsavedChangesGuard extends AvenxGuard {
  canActivate(to, from) {
    const formIsDirty = window.__formIsDirty;

    if (formIsDirty) {
      const confirmLeave = window.confirm('You have unsaved changes. Leave this page anyway?');
      if (!confirmLeave) {
        // ✅ Cancels navigation cleanly without emitting console warnings
        return { cancel: true, silent: true };
      }
    }

    return true;
  }
}
```

### AVX_R07 — ROUTER_GUARD_ERROR

**Error Message**

```text
[AVX_R07] Navigation guard threw an error during evaluation for route "{0}": {1}
```

**Cause:** This error is emitted at runtime when an unhandled JavaScript exception is thrown or an unhandled Promise rejection occurs during the execution of a navigation guard (`canActivate()`), a global guard (`router.beforeEach()`), or a route after-hook (`router.afterHooks`). When an exception occurs inside a guard, Avenx-JS catches the error, logs **AVX_R07** to prevent an uncaught runtime crash, and automatically aborts the route transition to protect the application from entering an unstable state.

This typically happens for a few common reasons:

- **Unhandled API / Network Errors**: An asynchronous guard fetches user permissions from a backend endpoint without wrapping the call in a `try...catch` block.
- **Null or Undefined Property Access**: Accessing properties on uninitialized state or missing objects inside `canActivate(to, from)` (e.g. `authBridge.user.role` when `user` is `null`).
- **Synchronous Exceptions**: Throwing an explicit `Error` or invoking non-existent utility functions within the guard logic.

**Resolution:** To resolve this error:

1. **Wrap Asynchronous Logic in `try...catch`**: Always catch network errors, failed authentication tokens, or rejected promises inside async guards.
2. **Defensive Property Access**: Use optional chaining (`?.`) and nullish coalescing (`??`) when inspecting user profiles, permissions, or route parameters.
3. **Return Fallback Actions**: When an error is caught, return a fallback redirect (e.g. `return '/error'` or `return '/login'`) rather than letting the exception bubble up.

**Incorrect**

Unprotected property access and unhandled API fetch inside a guard:

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export class AdminGuard extends AvenxGuard {
  async canActivate(to, from) {
    // ❌ If the API call fails or user is null, unhandled exception emits AVX_R07
    const response = await fetch('/api/user/me');
    const data = await response.json();

    // ❌ TypeError if data.permissions is undefined
    return data.permissions.includes('admin');
  }
}
```

**Correct**

Guarding against exceptions with `try...catch` and safe navigation fallbacks:

```javascript
import { AvenxGuard } from 'avenx-core/runtime';

export class AdminGuard extends AvenxGuard {
  async canActivate(to, from) {
    try {
      const response = await fetch('/api/user/me');
      if (!response.ok) {
        return { redirect: '/login' };
      }

      const data = await response.json();
      const hasAdminRole = data?.permissions?.includes('admin') ?? false;

      if (!hasAdminRole) {
        return { redirect: '/unauthorized' };
      }

      return true;
    } catch (err) {
      console.error('Guard evaluation failed:', err);
      // ✅ Return fallback redirect rather than throwing
      return { redirect: '/error' };
    }
  }
}
```

**Defensive Coding Example**

Global navigation guard with timeout protection and exception handling:

```javascript
import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

const router = app.initRouter({
  '/': 'Home',
  '/dashboard': { page: 'Dashboard', guards: [AdminGuard] }
});

router.beforeEach(async (to, from) => {
  try {
    // Perform global telemetry or auth checks safely
    if (to.hash.startsWith('#/protected')) {
      const sessionValid = await checkSessionTimeout();
      if (!sessionValid) {
        return { redirect: '/login' };
      }
    }
    return true;
  } catch (error) {
    console.error('Global guard error:', error);
    return { redirect: '/login' };
  }
});
```

### AVX_R09 — EVENT_HANDLER_ERROR

**Error Message**

```text
[AVX_R09] Event handler execution failed for statement "{0}". Error: {1}
[Context] Element: <{TAG}>, Event: '{type}'
```

**Cause:** This error is raised at runtime by `EventExecutor` (`lib/core/events/eventExecutor.js`) when an inline event handler expression (e.g. `@click="handleSubmit"`, `@input="onQueryChange(event)"`) throws an unhandled JavaScript exception during execution.

To streamline debugging in complex component hierarchies, `EventExecutor` captures diagnostic metadata from the triggering DOM event, wraps the underlying error in an internal `AvenxEventExecutionError`, and outputs:
- **`Statement`**: The exact handler expression or action method string defined in the template.
- **`Error`**: The root cause exception message and stack trace.
- **`Context`**: The triggering element's tag name (e.g. `<BUTTON>`, `<FORM>`) and the event type (e.g. `'click'`, `'submit'`).
- **`Component Context`**: The originating component instance and source location if diagnostic logging is enabled.

This typically happens for a few common reasons:

- **Undefined Method or Property Reference**: Calling a method or accessing a property that does not exist on the component instance or active state.
- **Runtime Exceptions in Action Methods**: An unhandled exception occurs inside a component method invoked by an event (e.g. accessing properties of `null` or `undefined`).
- **Invalid Event Argument Passing**: Passing invalid arguments in inline expressions (e.g. `@click="deleteItem(item.id)"` where `item` is `null`).

**Resolution:** To resolve this error:

1. Inspect the context metadata (`Element: <TAG>`, `Event: 'type'`) and statement string in the console output to pinpoint the failing template binding.
2. Ensure the method referenced in `@eventName="methodName"` is declared in the component's `actions` or instance methods.
3. Protect against uninitialized state values inside action methods using optional chaining (`?.`) and safe default values.
4. Wrap asynchronous operations (such as form submission network requests) inside `try...catch` blocks.

**Incorrect**

Accessing nested properties of null state inside an event callback:

```html
<state user="null" />

<action name="saveUser">
  // ❌ Throws TypeError: Cannot read properties of null (reading 'name')
  console.log("Saving user:", user.name.toUpperCase());
</action>

<!-- ❌ Emits AVX_R09 with Context: Element: <BUTTON>, Event: 'click' -->
<button @click="saveUser()">Save User</button>
```

**Correct**

Safely validating state before performing operations:

```html
<state user="null" />

<action name="saveUser">
  if (!user || !user.name) {
    console.warn("Cannot save: User data is not loaded yet.");
    return;
  }
  console.log("Saving user:", user.name.toUpperCase());
</action>

<!-- ✅ Safe event handler execution -->
<button @click="saveUser()">Save User</button>
```

**Defensive Coding Example**

Handling asynchronous operations and capturing user feedback in action handlers:

```html
<state isLoading="false" errorMessage="null" />

<action name="handleFormSubmit" args="event">
  event.preventDefault();

  try {
    isLoading = true;
    errorMessage = null;

    const formData = new FormData(event.target);
    const payload = Object.fromEntries(formData.entries());

    if (!payload.email) {
      throw new Error("Email address is required.");
    }

    await submitFormData(payload);
  } catch (err) {
    errorMessage = err.message || "Failed to submit form. Please try again.";
    console.error("[Form Error]", err);
  } finally {
    isLoading = false;
  }
</action>

<form @submit="handleFormSubmit(event)">
  <input name="email" type="email" placeholder="Enter your email" required />
  <button type="submit" :disabled="isLoading">Submit</button>
  <p class="error" data-ax-show="Boolean(errorMessage)">{{ errorMessage }}</p>
</form>

### AVX_R18 — REACTIVE_DEADLOCK_DETECTED

**Error Message**

```text
[AVX_R18] Circular reactive update cycle detected: {0}
```

**Diagnostic Output Example (CLI / Browser Console)**

```text
❌ [AVX_R18] Circular reactive update cycle detected: Counter -> StatsBridge -> Counter
   at Scheduler.flush (scheduler.js:142)
```

**Cause:** This error is thrown at runtime by the reactivity scheduler (`lib/core/reactive/scheduler.js`) or the deadlock manager (`lib/core/renderer/deadlockManager.js`) when a circular reactive update chain (A -> B -> A) is detected before the browser main thread freezes.

This is triggered when:
- The global reactive update scheduler exceeds its configured maximum flush passes (`maxFlushCount`, default `100`).
- A scoped `<@deadlock>` boundary exceeds its configured `maxDepth` recursion threshold.

**Reading the Causation Trace:**
The diagnostic message includes an execution hops trace (e.g. `{0}` = `Counter -> StatsBridge -> Counter`). Each hop indicates a component, bridge, or watcher mutating a dependency that triggers the next link in the cycle.

**Common Root Causes:**
- **Cross-Bridge Ping-Pong:** Two components or bridges modifying each other's state synchronously within reactive watchers or bridge listeners.
- **Self-Mutating Watchers:** A `$watch` handler directly mutating the reactive source property it is listening to.
- **Computed Property Side Effects:** A computed property containing a hidden write side-effect to a reactive state source.

**Resolution & Recovery:** To resolve this error:

1. **Inspect Causation Trace:** Map each hop back to the originating watcher, bridge action, or computed property and remove synchronous mutations.
2. **Break Synchronous Update Chains:** Defer secondary mutations using `queueMicrotask()` or `setTimeout()`, or derive calculated values via pure `<computed>` properties instead of watchers.
3. **Configure `<@deadlock>` Boundaries:** Wrap fragile or dynamic component subtrees with `<@deadlock action="fallback">` to catch update deadlocks locally and render fallback UI.
4. **Tune Scheduler Limits:** For legitimate deep recursive graphs, adjust thresholds via `setSchedulerMaxFlushCount(n)` or hook into recovery using `onSchedulerDeadlock()`.
5. **Enable Verbose Debugging:** Set `debug.debugReactivity = true` in `avenx.config.json` to log granular dependency-tracking traces in the console.
6. See the [<@deadlock> guide](/core-concepts/deadlocks/) for boundary details and best practices.

**Incorrect**

```javascript
// Component causing immediate circular cycle A -> A
export default {
  watch: {
    count(newVal) {
      // ❌ Mutating the watched property synchronously inside its own watcher
      this.state.count = newVal + 1;
    }
  }
};
```

**Correct**

```javascript
// ✅ Using a computed property instead of self-mutating watcher
export default {
  computed: {
    displayCount() {
      return this.state.count + 1;
    }
  }
};
```

**Defensive Example with `<@deadlock>` and Global Hooks**

```html
<!-- ✅ Scoped boundary catches cycle and renders fallback instead of halting application -->
<@deadlock name="realtimeMetrics" maxDepth="50" action="fallback">
  <RealtimeMetricsChart/>
  <@fallback as="error">
    <div class="metrics-error">
      <p>Metrics loop intercepted: {{ error.message }}</p>
    </div>
  </@fallback>
</@deadlock>
```

```javascript
import { onSchedulerDeadlock, setSchedulerMaxFlushCount } from 'avenx-core/runtime';

// Configure higher threshold and global deadlock telemetry listener
setSchedulerMaxFlushCount(150);

onSchedulerDeadlock((causationChain, componentInstance) => {
  console.error(`[Deadlock Telemetry] Cycle detected: ${causationChain}`, componentInstance);
});
```
