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

Utility class providing character replacement mappings to prevent code injections (XSS) by escaping HTML special characters, as well as reversing entity encoding.

```javascript
import { HtmlEscaper, unescapeHtml } from 'avenx-core/runtime';

const escaper = new HtmlEscaper();

// Escaping
escaper.escape('<h1>Text</h1>');
// Returns: &lt;h1&gt;Text&lt;/h1&gt;

// Unescaping
escaper.unescape('&lt;h1&gt;Text&lt;/h1&gt;');
// Returns: <h1>Text</h1>
```

### `unescapeHtml(str)`

Reverses HTML entity encoding for strings containing entities like `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;`, restoring raw characters. Available as a standalone exported function or via `HtmlEscaper.prototype.unescape()`.

**Signature:**

`unescapeHtml(str: string): string`

**Parameters:**

- `str` (any): The entity-encoded HTML string to decode (coerced to a string).

**Returns:**

- `string`: The unescaped string with decoded characters.

**Supported Entity Mappings:**

| HTML Entity | Decoded Character | Description |
| --- | --- | --- |
| `&amp;` | `&` | Ampersand |
| `&lt;` | `<` | Less-than sign |
| `&gt;` | `>` | Greater-than sign |
| `&quot;` | `"` | Double quote |
| `&#39;` | `'` | Single quote / apostrophe |

**Common Use Cases:**

- **Decoding stored database strings:** Reversing entity encoding from APIs or databases when plain text display is needed.
- **Form input normalization:** Pre-populating form fields or textareas with unescaped text.
- **Raw text template processing:** Decoding encoded text snippets prior to plain-text export or email generation.

**Security Warning (XSS Risks):**

> [!WARNING]
> Never pass unescaped output from `unescapeHtml()` directly into `innerHTML`, unescaped template interpolations (`{{{ ... }}}`), or `SafeHtml` without first passing it through a sanitizer such as `Sanitizer.prototype.sanitize()`. Unescaping untrusted user input restores executable HTML markup (like `<script>` tags and inline event handlers), introducing cross-site scripting (XSS) vulnerabilities.

**Example**

```javascript
import { unescapeHtml, Sanitizer } from 'avenx-core/runtime';

const encodedData = '&lt;script&gt;alert("xss")&lt;/script&gt; &amp; Welcome!';
const rawText = unescapeHtml(encodedData);

console.log(rawText);
// Output: '<script>alert("xss")</script> & Welcome!'

// ALWAYS sanitize if inserting into DOM!
const sanitizer = new Sanitizer();
const safeMarkup = sanitizer.sanitize(rawText);

console.log(safeMarkup);
// Output: ' & Welcome!'
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

#### `Sanitizer.stripTags(html)`

Strips all HTML tags, script elements, style tags, and comments from a string, returning unformatted plain text.

**Signature:**

`Sanitizer.stripTags(html: string): string`

**Parameters:**

- `html` (any): The raw content to strip (coerced to a string).

**Returns:**

- `string`: The extracted plain-text string with all HTML tag markup removed.

**Common Use Cases:**

- **Plain-text preview generation:** Creating article card summaries, post excerpts, or email snippet previews from rich HTML content.
- **Search indexing:** Extracting searchable text content from HTML templates for indexing.
- **Tooltip text formatting:** Clearing markup for native `title` attributes or plain-text tooltips.
- **Meta tag description extraction:** Auto-generating SEO `<meta name="description">` content from body HTML markup.

**Guidelines: `stripTags()` vs. `sanitize()`**

- Use **`Sanitizer.stripTags(html)`** when you need unformatted plain text without any HTML markup (e.g. for previews, search indexes, or tooltips).
- Use **`Sanitizer.prototype.sanitize(html)`** when you want to safely insert user-provided dynamic HTML into the DOM while retaining safe markup structure (such as bold, italics, links, and paragraphs) and filtering out dangerous scripts and attributes.

| Method | Behavior | Primary Use Case | Output |
| --- | --- | --- | --- |
| `Sanitizer.stripTags(html)` | Removes **all** HTML tags, script/style content, and comments entirely. | Text summaries, previews, search indexing, meta descriptions. | Plain text |
| `sanitizer.sanitize(html)` | Filters HTML against allowed tags and attributes policies to prevent XSS. | Rendering rich, user-generated HTML safely in the DOM. | Safe HTML markup |

**Example**

```javascript
import { Sanitizer } from 'avenx-core/runtime';

const richText = '<div><p>Hello <b>World</b>!</p><script>alert("xss")</script><!-- comment --></div>';
const plainText = Sanitizer.stripTags(richText);

console.log(plainText);
// Output: "Hello World!"
```

## 4b. `formatMessage(code, ...args)`

Formats an Avenx error/warning template into a console-ready string **without throwing**. Use this when you want to log or report a framework message yourself.

```javascript
import { AvenxErrorCodes, formatMessage } from 'avenx-core/runtime';

logger.warn(formatMessage(AvenxErrorCodes.COMPONENT_INJECT_KEY_NOT_FOUND, 'theme'));
// => [AVX_W15] Inject key "theme" was not found in the component provide/inject tree.
```

| Param | Type | Description |
| --- | --- | --- |
| `code` | `string` | An `AvenxErrorCodes` value (e.g. `AVX_W15`) |
| `...args` | `any[]` | Values substituted for `{0}`, `{1}`, … placeholders in `AvenxErrorMessages` |

**Returns:** `string` in the form ``[`code`] formatted message``.

Unlike constructing `new AvenxError(code, ...args)`, `formatMessage` never throws—it only builds the text for `logger.warn`, telemetry, or custom UI.

## 4c. `AvenxError` Class & Metadata Schema

All runtime and compilation exceptions thrown by the framework extend `AvenxError`. Beyond standard `Error` properties (`name`, `message`, `stack`), `AvenxError` encapsulates structured diagnostic metadata and supports JSON serialization.

### Constructor & Attributes

```javascript
import { AvenxError, AvenxErrorCodes } from 'avenx-core/runtime';

const err = new AvenxError(code, ...args);
```

#### Property Schema

| Property | Type | Description |
| --- | --- | --- |
| `code` | `string` | The framework error code (e.g. `'AVX_R08'`). |
| `message` | `string` | The formatted message including the `[code]` prefix. |
| `name` | `string` | Always `'AvenxError'` (or `'CompilerError'` for build errors). |
| `details` | `object` | Contextual diagnostic details object (e.g., expression text or failed props). |
| `componentName` | `string \| null` | Name of the component where the exception occurred. |
| `sourceLine` | `number \| null` | Line number in the component template or script where the error originated. |

### Method Specification

#### `.toJSON()`

Serializes the `AvenxError` instance into a plain JavaScript object for structured JSON logging (e.g. Pino, Datadog, Sentry, or REST API error responses).

**Return Signature:**

```typescript
interface AvenxErrorJSON {
  name: string;
  code: string;
  message: string;
  componentName: string | null;
  sourceLine: number | null;
  details: Record<string, any>;
  stack?: string;
}
```

#### Example

```javascript
import { AvenxError, AvenxErrorCodes } from 'avenx-core/runtime';

const error = new AvenxError(AvenxErrorCodes.RENDER_INTERPOLATION_FAILED, 'state.profile.email');
error.componentName = 'UserProfileCard';
error.sourceLine = 24;
error.details = { expression: 'state.profile.email', cause: 'TypeError: Cannot read properties of null' };

// Convert error to a plain JSON object for telemetry pipelines
const serializedError = error.toJSON();

console.log(JSON.stringify(serializedError, null, 2));
```

## 4d. Security Sandbox & `DynamicEvaluator` API

Avenx-JS provides an isolated runtime execution sandbox (`lib/core/security/sandbox.js`) and expression evaluation engine (`lib/core/security/evaluator.js`) to parse and evaluate dynamic template expressions, directive conditions, and event handlers securely.

### Security Architecture & Protections

To protect against Cross-Site Scripting (XSS), prototype pollution, and unauthorized host environment access, all dynamic template expressions execute within a sandboxed `Proxy` wrapper:

```text
Template Expression ──► AvenxSandbox.validateSource() ──► Static AST/Token Validation
                              │
                              ▼
                        AvenxSandbox.createProxy() ──► Isolated Scope & Allowed Globals
                              │
                              ▼
                      DynamicEvaluator.evaluate() ──► Secure Evaluation (with(this))
```

#### 1. Prototype Pollution Prevention

Access to object prototype manipulation properties (`__proto__`, `constructor`, `prototype`) is strictly blocked during static source validation and runtime proxy access. Any attempt to read or write to these properties immediately throws **`AVX_R15` (`SANDBOX_VIOLATION`)**.

#### 2. Restricted Global Scope & Globals Whitelist

Direct access to browser window APIs, network transports, timers, and execution primitives is blocked inside template expressions:

- **Allowed Globals (`ALLOWED_GLOBALS`)**: `Math`, `JSON`, `Array`, `Object`, `String`, `Number`, `Boolean`, `Date`, `Error`, `Map`, `Set`, `Promise`, `console`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `decodeURI`, `decodeURIComponent`, `encodeURI`, `encodeURIComponent`.
- **Restricted Globals (`RESTRICTED_GLOBALS`)**: `window`, `document`, `localStorage`, `sessionStorage`, `location`, `navigator`, `history`, `fetch`, `alert`, `confirm`, `prompt`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `XMLHttpRequest`, `WebSocket`, `process`, `global`, `globalThis`, `eval`, `Function`.

If a template expression accesses a restricted global (e.g. `<button onclick="alert('Done')">` or `data-ax-show="localStorage.getItem('token')"`), execution halts with error **`AVX_R15`**.

> [!TIP]
> **Best Practice:** Decouple native browser ecosystem API calls (`fetch`, `localStorage`, `alert`, `window`) into standard component action methods rather than invoking them inline inside HTML templates.

---

### `DynamicEvaluator` Class Reference

```javascript
import { DynamicEvaluator } from 'avenx-core/runtime';

const evaluator = new DynamicEvaluator();
```

#### Methods

##### `evaluator.evaluateExpression(expression, scope = {}, thisArg = scope)`

Evaluates a JavaScript expression string safely within the sandboxed scope and returns the computed result.

**Parameters:**
- `expression` (`string`): The JavaScript expression to evaluate (e.g., `'items.length > 0'`).
- `scope` (`object`, optional): The variable scope available to the expression (e.g. `{ items: [1, 2, 3] }`).
- `thisArg` (`object`, optional): The `this` context binding for the evaluation.

**Returns:** `any` — The result of evaluating the expression.

```javascript
const result = evaluator.evaluateExpression('count * multiplier', { count: 5, multiplier: 3 });
console.log(result); // 15
```

##### `evaluator.executeStatement(source, scope = {}, thisArg = scope)`

Executes one or more JavaScript statements within the sandboxed scope.

**Parameters:**
- `source` (`string`): The JavaScript statements to execute.
- `scope` (`object`, optional): The variable scope.
- `thisArg` (`object`, optional): The `this` context.

```javascript
const scope = { user: { name: 'Alice' } };
evaluator.executeStatement("user.name = 'Bob'", scope);
console.log(scope.user.name); // 'Bob'
```

##### `evaluator.createMethodMap(methods = {}, getScope, getThisArg)`

Transforms a dictionary of string statement definitions or functions into sandboxed executable method handlers.

##### `evaluator.sanitizeHTML(value, options = {})`

Helper method that delegates to `Sanitizer.prototype.sanitize()`.

---

### `AvenxSandbox` Class Reference

```javascript
import { AvenxSandbox } from 'avenx-core/testing';
```

#### Methods

##### `AvenxSandbox.validateSource(source)`

Statically validates source code against forbidden prototype keywords (`constructor`, `__proto__`, `prototype`). Throws `AVX_R15` if forbidden identifiers are detected.

##### `AvenxSandbox.createProxy(scope, thisArg, excludeParams = false)`

Creates a sandboxed `Proxy` object wrapping `scope` and `thisArg`. Intercepts property lookups (`get`), assignments (`set`), and `has` traps to restrict global access and prevent prototype pollution.

---

### Programmatic Usage Examples

#### 1. Evaluating Custom Directive Expressions in Plugins

```javascript
import { DynamicEvaluator } from 'avenx-core/runtime';

const evaluator = new DynamicEvaluator();

export function evaluateDirectiveCondition(directiveAttr, componentInstance) {
  try {
    const scope = {
      state: componentInstance.state,
      props: componentInstance.props,
      $element: componentInstance.$element,
    };

    return evaluator.evaluateExpression(directiveAttr, scope, componentInstance);
  } catch (err) {
    console.error(`[Directive Error] Failed to evaluate expression "${directiveAttr}":`, err.message);
    return false;
  }
}
```

#### 2. Handling Sandbox Violations (`AVX_R15`)

```javascript
import { DynamicEvaluator } from 'avenx-core/runtime';

const evaluator = new DynamicEvaluator();

try {
  // ❌ Throws AVX_R15 because 'localStorage' is a restricted global
  evaluator.evaluateExpression("localStorage.getItem('token')", {});
} catch (err) {
  console.log(err.code); // 'AVX_R15'
  console.log(err.message);
  // => [AVX_R15] [Avenx Sandbox Violation] Access to global object "localStorage" is restricted inside templates.
}
```

---

## 5. Reactivity API Reference

Avenx-JS exposes APIs for programmatically creating reactive state objects and observing reactive values.

The core reactivity APIs include `StateFactory`, `AvenxWatcher`, and the `AvenxComponent.watch()` instance method.

## 6. `StateFactory`

`StateFactory` creates reactive proxy objects from regular JavaScript objects.

### Constructor

```javascript
import { StateFactory } from 'avenx-core/runtime';

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
import { StateFactory } from 'avenx-core/runtime';

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

### Options Schema

The `options` object passed to `create(initialState, options)` configures the behavior of the created reactive proxy and its underlying `ProxyHandlerFactory`:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `onChange` | `Function` | `() => {}` | A change notification callback executed whenever any reactive property on the target (or nested reactive child objects, arrays, Sets, or Maps) is modified, set, or deleted. |
| `computedKeys` | `Array<String>` | `[]` | An array of property names to treat as dynamic computed properties on the target object. |
| `instance` | `Object` | `null` | Optional component or context instance reference passed for scope resolution and method binding. |
| `bypassSymbol` | `Boolean` | `false` | When `true`, prevents `StateFactory` from defining the internal non-enumerable `__avenx_proxy_ref__` symbol property on the target object. |

---

### The `onChange` Callback API

The `onChange` option allows developers to attach a change listener to a standalone reactive state object created outside of a component lifecycle. 

Whenever a property on the reactive state proxy (or any nested reactive object/array) is modified, set, or deleted, `onChange` is invoked automatically. This enables building custom state management stores, state persistence sync (e.g. with `localStorage`), or external event logs.

#### Example: Standalone Reactive Store with `onChange` Persistence

```javascript
import { StateFactory } from 'avenx-core/runtime';

const stateFactory = new StateFactory();

// Load initial state from localStorage or fallback defaults
const savedState = JSON.parse(localStorage.getItem('app_settings') || '{}');

const settingsState = stateFactory.create(
  {
    theme: savedState.theme || 'dark',
    notifications: savedState.notifications ?? true,
    user: {
      name: 'Alice',
    },
  },
  {
    onChange() {
      // Sync state updates to localStorage whenever any property changes
      localStorage.setItem('app_settings', JSON.stringify({
        theme: settingsState.theme,
        notifications: settingsState.notifications,
        user: settingsState.user,
      }));
      console.log('Settings persisted to localStorage:', settingsState);
    },
  }
);

// Mutating top-level or nested properties automatically triggers onChange
settingsState.theme = 'light'; // Logs and saves to localStorage
settingsState.user.name = 'Bob'; // Triggers onChange for nested mutations
```


## 7. `AvenxWatcher`

`AvenxWatcher` observes values returned by reactive getter functions. During getter evaluation, the watcher tracks accessed reactive properties and responds when those dependencies change.

### Constructor

```javascript
import { AvenxWatcher } from 'avenx-core/runtime';

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

- `getter` â€” The reactive evaluation function supplied to the constructor.
- `callback` â€” The callback function invoked when the watched value changes.
- `options` â€” The watcher configuration object.
- `deps` â€” A `Set` containing the reactive dependencies tracked by the watcher.
- `dirty` â€” A boolean indicating whether a lazy watcher needs to be re-evaluated.
- `value` â€” The currently stored value returned by the getter.

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
import { AvenxComponent } from 'avenx-core/runtime';

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

---

## 8b. Microtask Scheduler Utilities (`nextTick`, `queueJob`, `queueFlushCallback`)

The Avenx-JS reactive rendering engine manages asynchronous DOM updates through a microtask scheduler (`lib/core/reactive/scheduler.js`), exported via `avenx-core/runtime`.

### DOM Patch Timing & Microtask Queue Architecture

To achieve optimal performance and eliminate layout thrashing, Avenx-JS **batches** state mutations. When you modify one or more reactive properties synchronously, the framework does not patch the DOM immediately on every assignment. Instead, it pushes the component's update job to a priority queue and schedules a single asynchronous flush in a microtask.

```text
Synchronous State Mutations ──► queueJob() (Deduplicated) ──► Microtask Scheduled (queueFlush)
                                                                    │
                                                                    ▼
                                                            flushJobs() Loop
                                                            ├─ 1. Sort jobs by Component UID
                                                            ├─ 2. Execute DOM Patches
                                                            └─ 3. Run flushCallbacks (nextTick)
```

Because DOM updates are deferred to the microtask queue, querying element properties (such as `.offsetWidth`, `.scrollHeight`, or `querySelector()`) immediately after modifying state will read pre-update measurements. Using `nextTick()` guarantees that the DOM patch cycle has completed.

---

### Function Signatures & Descriptions

```javascript
import {
  nextTick,
  queueJob,
  queueFlushCallback,
  setSchedulerMaxFlushCount,
  getSchedulerMaxFlushCount,
  onSchedulerDeadlock,
  resetScheduler
} from 'avenx-core/runtime';
```

| Utility Function | Type Signature | Description |
| :--- | :--- | :--- |
| `nextTick(callback?)` | `(cb?: Function) => Promise<void> \| void` | Returns a Promise (or invokes an optional callback) after the scheduler finishes flushing all queued DOM updates and lifecycle patch jobs. |
| `queueJob(job)` | `(job: Function) => void` | Adds a job callback to the pending scheduler queue. Automatically deduplicates identical jobs and schedules a microtask flush if one is not already pending. |
| `queueFlushCallback(cb)` | `(cb: Function) => void` | Registers a callback executed immediately after all active DOM patch jobs in the current flush cycle complete. |
| `setSchedulerMaxFlushCount(count)` | `(count: number) => void` | Configures the recursion threshold before aborting runaway update cycles (defaults to 25). |
| `getSchedulerMaxFlushCount()` | `() => number` | Returns the currently configured maximum flush cycle recursion depth. |
| `onSchedulerDeadlock(handler)` | `(handler: Function) => Function` | Subscribes a listener to reactive deadlock detection events. Returns an unsubscribe cleanup function. |
| `resetScheduler()` | `() => void` | Resets all internal queue arrays, counters, and execution history (used in unit testing). |

---

### Practical Code Examples

#### 1. Awaiting DOM Measurements after State Mutation (`nextTick`)

Inside component actions or methods, use `await nextTick()` (or `this.nextTick()`) to inspect the DOM after new elements or classes have rendered:

```javascript
// src/components/chat-box.component.js
export default {
  actions: {
    async sendMessage(text) {
      // 1. Mutate reactive state
      this.state.messages.push({ id: Date.now(), text });

      // 2. Wait for DOM patch to complete
      await nextTick();

      // 3. Scroll to the newly rendered message
      const chatContainer = this.$element.querySelector('.messages-list');
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }
};
```

#### 2. Post-Flush Callbacks with `queueFlushCallback()`

Execute a task immediately after all scheduled component updates finish rendering in the current tick:

```javascript
import { queueFlushCallback } from 'avenx-core/runtime';

function updateUIAndNotify(component) {
  component.state.status = 'Ready';

  queueFlushCallback(() => {
    console.log('All components have finished DOM patching for this tick.');
    window.dispatchEvent(new CustomEvent('app:rendered'));
  });
}
```

#### 3. Custom Batching Jobs with `queueJob()`

Deduplicate heavy computations or background updates using `queueJob()`:

```javascript
import { queueJob } from 'avenx-core/runtime';

function syncServerState() {
  console.log('Synchronizing state with backend...');
}

// Queue multiple triggers in the same tick; only one job executes
queueJob(syncServerState);
queueJob(syncServerState);
queueJob(syncServerState);
```

---

## 9. AvenxLogger

The `AvenxLogger` class provides Avenx-JS's built-in logging system. It supports configurable log levels, custom formatting, context tagging, and custom transports, making it suitable for both development and production environments.

A shared global logger instance (`logger`) and severity constants (`LogLevels`) are exported from `avenx-core/runtime`.

### Importing

```javascript
import { AvenxLogger, logger, LogLevels, formatContextTag, defaultFormatter } from "avenx-core/runtime";
```

- `AvenxLogger`: Central logger class for instantiating custom loggers.
- `logger`: The default shared global logger instance used across the framework runtime.
- `LogLevels`: Enum-like object mapping severity level names to numeric priorities.

---

### Constructor & Configuration

```javascript
const logger = new AvenxLogger(config);
```

#### `LoggingConfig` Schema

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `level` | `string` | `"info"` | Minimum severity log level to output (`'trace'`, `'debug'`, `'info'`, `'warn'`, `'error'`, `'fatal'`, `'off'`, `'silent'`). |
| `silent` | `boolean` | `false` | When `true`, suppresses all log outputs. |
| `formatter` | `(level: string, args: any[]) => any[]` | `defaultFormatter` | Custom formatting function applied to log messages before dispatching to transports. |
| `transports` | `Array<Object \| Function>` | `[consoleTransport]` | Collection of transport targets (e.g. `console`, file writer, or HTTP log stream). |

---

### Log Levels & `LogLevels` Constants

Log levels in Avenx-JS are ordered by ascending severity priority. `LogLevels` maps level names to numeric priority values:

```javascript
import { LogLevels } from "avenx-core/runtime";

console.log(LogLevels);
/*
{
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
  off: 6,
  silent: 6
}
*/
```

| Severity Level | Priority Value | Description |
| --- | --- | --- |
| `trace` | `0` | Highly verbose diagnostic and internal state tracing. |
| `debug` | `1` | Development and debugging messages. |
| `info` | `2` | Standard application operational events. |
| `warn` | `3` | Warning messages for potential errors or non-fatal issues. |
| `error` | `4` | Error messages for failed operations or caught exceptions. |
| `fatal` | `5` | Critical unrecoverable application failures. |
| `off` / `silent` | `6` | Disables all log outputs completely. |

The logger outputs messages only when their severity priority is greater than or equal to the active configured level.

---

### Class Methods

#### `setLevel(level)`

Programmatically sets the minimum log severity level for the logger instance.

- **Signature:** `setLevel(level: string): void`
- **Parameters:** `level: string` — Target log level name (e.g. `'debug'`, `'warn'`, `'silent'`).
- **Returns:** `void`

```javascript
import { logger } from "avenx-core/runtime";

// Enable verbose debug logging during dev
logger.setLevel('debug');

// Suppress info/debug logs in production
logger.setLevel('warn');
```

#### `configure(config)`

Reconfigures one or more logger settings at runtime.

- **Signature:** `configure(config: LoggingConfig): void`
- **Parameters:** `config: LoggingConfig` — Object containing updated options (`level`, `silent`, `formatter`, `transports`).
- **Returns:** `void`

```javascript
logger.configure({
  level: 'error',
  silent: false,
});
```

If `level` is set to an invalid string, `configure()` logs a warning and falls back to `"info"`.

#### `shouldLog(level)`

Evaluates whether a message of the given severity level will be logged under the current configuration.

- **Signature:** `shouldLog(level: string): boolean`
- **Parameters:** `level: string` — Log level name to evaluate.
- **Returns:** `boolean` — `true` if the level will be logged, otherwise `false`.

```javascript
if (logger.shouldLog('debug')) {
  const detailedPayload = buildComplexDiagnosticData();
  logger.debug('Diagnostic data:', detailedPayload);
}
```

#### `write(level, ...args)`

Writes a log statement through the configured formatter and dispatches it to all transports if `shouldLog(level)` is `true`.

- **Signature:** `write(level: string, ...args: any[]): void`
- **Parameters:**
  - `level: string` — Severity level name.
  - `...args: any[]` — Arguments to format and log.
- **Returns:** `void`

#### Logging Shortcut Methods

Every `AvenxLogger` instance exposes convenience shortcut methods for each severity level:

- `logger.trace(...args: any[]): void`
- `logger.debug(...args: any[]): void`
- `logger.info(...args: any[]): void`
- `logger.log(...args: any[]): void` (Alias for `info()`)
- `logger.warn(...args: any[]): void`
- `logger.error(...args: any[]): void`
- `logger.fatal(...args: any[]): void`

---

### Suppressing Framework Logs in Production

To optimize performance and suppress verbose framework logging in production setups, you can configure the shared global `logger` or pass `logging` options during `AvenxApp` initialization:

#### Option 1: Suppress via `logger.setLevel()` / `logger.configure()`

```javascript
import { logger } from "avenx-core/runtime";

if (process.env.NODE_ENV === 'production') {
  // Suppress info & debug logs; only log warnings and errors
  logger.setLevel('warn');

  // Or suppress ALL framework log output completely:
  // logger.configure({ silent: true });
}
```

#### Option 2: Suppress via `AvenxApp` Constructor

```javascript
import { AvenxApp } from "avenx-core/runtime";

const app = new AvenxApp({
  target: "#app",
  logging: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    silent: process.env.NODE_ENV === 'test', // Completely quiet during automated tests
  },
});
```

---

## Custom Formatter

A formatter receives the log level and the original arguments, then returns the formatted arguments passed to each transport.

```js
const formatter = (level, args) => [
  `[MyApp] [${level.toUpperCase()}]`,
  ...args
];

const logger = new AvenxLogger({
  formatter
});
```

---

## Custom Transport

By default, `AvenxLogger` uses `consoleTransport`, which dispatches each level to a `console` method: `fatal` logs via `console.error`, `trace` logs via `console.debug`, and every other level logs via the matching `console` method (e.g. `info` â†’ `console.info`), falling back to `console.log` if no matching method exists.

Custom transports allow log messages to be forwarded to destinations other than the browser console.

A transport may be either:

- an object exposing a `log()` method
- a function

### Object Transport

```js
const transport = {
  log(level, formattedArgs, rawArgs) {
    console.log("Sending log:", formattedArgs);
  }
};

const logger = new AvenxLogger({
  transports: [transport]
});
```

### Function Transport

```js
const transport = (level, formattedArgs, rawArgs) => {
  console.log(level, formattedArgs);
};

const logger = new AvenxLogger({
  transports: [transport]
});
```

---

## Example

```js
import { logger } from "avenx-core/runtime";

logger.info("Application initialized.");

logger.debug("Loaded configuration.");

logger.warn("Using default settings.");

logger.error("Unable to connect to the server.");

logger.fatal("Unexpected unrecoverable error.");
```

---

## `LruCache` Utility Class

`LruCache` is a Least Recently Used (LRU) cache implementation built using JavaScript `Map`'s key insertion order preservation. It is used internally for features like page keep-alive caching and is exported from `avenx-core/runtime` for application-level data caching.

### Constructor

```javascript
import { LruCache } from 'avenx-core/runtime';

const cache = new LruCache(limit, onEvict);
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | `number` | *Required* | Maximum number of items allowed in the cache. Must be a positive number (> 0). |
| `onEvict` | `(key: string, value: any) => void` | `null` | Optional callback function invoked whenever an item is evicted due to exceeding capacity. |

---

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `limit` | `number` | Capacity limit of the cache instance. |
| `size` | `number` | Getter returning the current count of items stored in the cache. |

---

### Methods

#### `get(key)`

Retrieves an item from the cache and updates its recency to make it the most recently used item.

- **Parameters:** `key: string`
- **Returns:** `any` â€” The cached item, or `undefined` if the key does not exist.

#### `set(key, value)`

Inserts or updates a key-value pair in the cache. If the cache size reaches the specified `limit`, the least recently used (LRU) item is evicted and the optional `onEvict` callback is triggered.

- **Parameters:**
  - `key: string` â€” Item identifier.
  - `value: any` â€” Data payload to cache.
- **Returns:** `void`

#### `has(key)`

Checks whether a key exists in the cache **without** altering its recency ordering.

- **Parameters:** `key: string`
- **Returns:** `boolean` â€” `true` if the key exists, otherwise `false`.

#### `delete(key)`

Removes a specific item from the cache.

- **Parameters:** `key: string`
- **Returns:** `boolean` â€” `true` if the item existed and was removed, otherwise `false`.

#### `clear()`

Removes all items from the cache.

- **Returns:** `void`

---

### Usage Example

```javascript
import { LruCache } from 'avenx-core/runtime';

// Create a cache holding up to 3 items with an eviction listener
const userCache = new LruCache(3, (evictedKey, evictedValue) => {
  console.log(`Cache full. Evicted key "${evictedKey}":`, evictedValue);
});

// Store items
userCache.set('user:101', { name: 'Alice', role: 'admin' });
userCache.set('user:102', { name: 'Bob', role: 'editor' });
userCache.set('user:103', { name: 'Charlie', role: 'viewer' });

console.log(userCache.size); // 3

// Accessing 'user:101' refreshes its recency
const user = userCache.get('user:101');
console.log(user.name); // 'Alice'

// Inserting a 4th item triggers LRU eviction of 'user:102' (since 'user:101' was recently accessed)
userCache.set('user:104', { name: 'Diana', role: 'manager' });
// Output: Cache full. Evicted key "user:102": { name: 'Bob', role: 'editor' }

console.log(userCache.has('user:102')); // false
console.log(userCache.has('user:101')); // true
```

---

## 11. Component Tag Naming Linter Utilities

Avenx-JS provides framework tooling functions in `avenx-core/runtime` (or `lib/core/tooling/componentTagNaming.js`) to audit single-file component (SFC) templates and enforce PascalCase component tag conventions (e.g. `<UserCard />` instead of `<user-card />` or `<userCard />`).

These utilities enable custom build scripts, pre-commit hooks, and ESLint plugins (such as Avenx's built-in ESLint component tag rule) to analyze component markup without executing full compilation.

### `extractLintableTemplate(source)`

Isolates HTML template markup from an Avenx SFC component source string by masking non-template metadata blocks (`<state>`, `<computed>`, `<action>`, `<resource>`, and HTML comments).

**Signature:**

`extractLintableTemplate(source: string): string`

**Parameters:**

- `source` (`string`): The raw single-file component (`.component.js`) file contents.

**Returns:**

- `string`: A masked template string where non-template blocks are replaced with whitespace while strictly preserving line numbers (`\n` and `\r\n`).

**Line Offset Preservation:**

To accurately report diagnostic lint warnings or errors back to IDEs and CLI logs, `extractLintableTemplate` replaces non-line-break characters in metadata blocks (`<state>`, `<action>`, etc.) with blank spaces. Because character indexes and line counts are preserved identically, error locations map directly back to the original source file line and column positions.

### `findInvalidComponentTags(source, registeredComponents)`

Analyzes an Avenx component source template against a set of canonical PascalCase registered component names and identifies tag references that do not adhere to PascalCase naming conventions.

**Signature:**

`findInvalidComponentTags(source: string, registeredComponents: Set<string>): Array<InvalidComponentTagIssue>`

**Parameters:**

- `source` (`string`): The raw component SFC source text.
- `registeredComponents` (`Set<string>`): A set of canonical PascalCase component names (e.g. `new Set(['UserCard', 'Header'])`).

**Returns:**

An array of issue objects:

```typescript
interface InvalidComponentTagIssue {
  tagName: string;      // The invalid tag found in the template (e.g. "user-card")
  expectedName: string; // The canonical PascalCase component name (e.g. "UserCard")
  index: number;        // 1-based character position in the source string
}
```

### Practical Tooling Integration Examples

#### Example 1: Custom Build Script / Linter

```javascript
import fs from 'fs';
import {
  findRegisteredComponents,
  findInvalidComponentTags,
} from 'avenx-core/runtime';

// 1. Discover registered components in src/components
const registered = findRegisteredComponents(process.cwd());

// 2. Read component source
const fileContent = fs.readFileSync('src/pages/dashboard.page.js', 'utf8');

// 3. Find tag naming mismatches
const issues = findInvalidComponentTags(fileContent, registered);

issues.forEach((issue) => {
  console.warn(
    `[Lint Warning] Component tag <${issue.tagName}> at position ${issue.index} ` +
      `should be written in PascalCase: <${issue.expectedName}>`
  );
});
```

#### Example 2: ESLint Rule Integration

```javascript
import {
  extractLintableTemplate,
  findInvalidComponentTags,
} from 'avenx-core/runtime';

export const customTagNamingRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce PascalCase tag naming for registered Avenx components' },
    messages: {
      invalidTag: 'Avenx component <{{tagName}}> must use PascalCase: <{{expectedName}}>',
    },
  },
  create(context) {
    return {
      Program() {
        const source = context.sourceCode.getText();
        const registered = new Set(['UserCard', 'Navbar', 'Footer']);

        const issues = findInvalidComponentTags(source, registered);

        for (const issue of issues) {
          context.report({
            messageId: 'invalidTag',
            data: {
              tagName: issue.tagName,
              expectedName: issue.expectedName,
            },
          });
        }
      },
    };
  },
};
```

---

## 12. DevTools `initInspector` & Runtime Inspection Protocol

`initInspector` (exported from `avenx-core/runtime` / `lib/core/tooling/inspect.js`) enables browser extension DevTools, debugging overlays, and external tools to inspect live Avenx-JS applications in real time.

When inspector mode is enabled, `initInspector` creates a Web `BroadcastChannel` named `'avenx-inspector-channel'`, listens for inspection requests, and automatically broadcasts runtime application state on component lifecycles and page transitions.

### Enabling the Inspector

To enable inspection, set `window.__avenx_inspect_enabled = true;` before initializing your `AvenxApp` instance, or pass `initInspector(app)` during application setup:

```javascript
import { AvenxApp, initInspector } from 'avenx-core/runtime';

// 1. Enable inspector flag on window
window.__avenx_inspect_enabled = true;

// 2. Initialize application
const app = new AvenxApp({
  target: '#app'
});

// 3. Initialize inspector
initInspector(app);
```

---

### `BroadcastChannel` Protocol Specification

`initInspector` uses the standard browser `BroadcastChannel` API (`'avenx-inspector-channel'`) to communicate with browser extension devtools or custom debugging scripts running in adjacent tabs/iframes.

#### Channel Identifier

- **Channel Name:** `'avenx-inspector-channel'`

#### Incoming Request Message

To request a full snapshot of the current application state, post the following message to `'avenx-inspector-channel'`:

```javascript
channel.postMessage('request-inspect-data');
```

#### Outgoing Broadcast Payload (`'inspect-data'`)

Whenever a `'request-inspect-data'` message is received, or when application events occur (`avenx:mount`, `avenx:update`, `avenx:unmount`, `app.updateAll()`, `app.mountPage()`), `initInspector` broadcasts an `'inspect-data'` payload message:

```typescript
interface InspectorDataMessage {
  type: 'inspect-data';
  data: {
    activeComponents: Array<{
      name: string;        // Component class name (e.g. "UserCard")
      state: object;       // Sanitized component reactive state
      props: object;       // Sanitized component props
    }>;
    registeredBridges: Record<string, object>; // Map of active bridge names to instances
    registeredComponents: string[];           // Array of registered component tag names
    registeredPages: string[];                // Array of registered page names
    routes: object;                           // Router routes configuration dictionary
    currentRoute: object | null;              // Currently active route object
  };
}
```

---

### Data Sanitization & Circular Safety (`serializeSafe`)

Before broadcasting payload state across the `BroadcastChannel`, `initInspector` passes the payload through a recursive `serializeSafe()` sanitizer:

- **Functions:** Converted to string placeholders (`"[Function]"`).
- **DOM Elements & Window:** Converted to node summary strings (e.g. `"[DOM Element: DIV]"` or `"[DOM Element: Window]"`).
- **Internal Framework Keys:** Properties starting with double underscores (e.g. `__avenx_comp_instance`) are masked as `"[Internal]"`.
- **Circular References:** Visited objects tracked with `WeakSet` are safely replaced with `"[Circular]"` to prevent postMessage clone exceptions.

---

### Subscribing to DevTools Inspection Events

External debugging tools, browser extension popup windows, or custom overlays can listen to live application state by creating a `BroadcastChannel` listener:

```javascript
// External DevTools script or extension background page
const inspectorChannel = new BroadcastChannel('avenx-inspector-channel');

// Subscribe to state updates broadcast by Avenx-JS
inspectorChannel.onmessage = (event) => {
  if (event.data && event.data.type === 'inspect-data') {
    const { activeComponents, registeredBridges, currentRoute } = event.data.data;

    console.log('Active Component Count:', activeComponents.length);
    console.log('Active Components:', activeComponents);
    console.log('Current Route:', currentRoute);
    console.log('Bridges State:', registeredBridges);
  }
};

// Request an immediate state snapshot
inspectorChannel.postMessage('request-inspect-data');
```

---

## 13. Form Validation Utilities

While component templates use the `data-ax-validate` directive and `this.state.$validation` object for form validation (see the [Form Validation](/core-concepts/form-validation) guide), Avenx-JS exports a suite of low-level, environment-agnostic validation utility functions from `avenx-core/runtime` (or `lib/core/validation/validator.js`).

These functions allow developers to parse rule expressions, validate values programmatically, extract field names from HTML elements, and update `$validation` state objects in custom services, bridges, or standalone scripts.

### Importing

```javascript
import {
  parseValidationRules,
  validateValue,
  getFieldName,
  updateValidationState,
} from 'avenx-core/runtime';
```

---

### Function Reference

#### `parseValidationRules(ruleString)`

Parses a pipe-delimited rule expression string (e.g. `"required|email|min:8|same:password:Passwords do not match"`) into an array of structured rule objects.

- **Signature:** `parseValidationRules(ruleString: string): Array<{ name: string, arg: string|null, customMsg: string|null }>`
- **Parameters:** `ruleString: string` — Pipe-delimited validation rules string.
- **Returns:** `Array<{ name: string, arg: string|null, customMsg: string|null }>`
  - `name`: Lowercase rule identifier (e.g. `'required'`, `'email'`, `'min'`).
  - `arg`: Rule argument string or `null` if no parameter was passed (e.g. `'8'` for `'min:8'`).
  - `customMsg`: Custom error message string override or `null`.

```javascript
const rules = parseValidationRules('required|email|min:8|same:password:Must match password');
console.log(rules);
/*
[
  { name: 'required', arg: null, customMsg: null },
  { name: 'email', arg: null, customMsg: null },
  { name: 'min', arg: '8', customMsg: null },
  { name: 'same', arg: 'password', customMsg: 'Must match password' }
]
*/
```

#### `getFieldName(element)`

Extracts a canonical field name from an HTML element by checking attributes in priority order: `name` → `data-ax-bind` → `id` → fallback `'field'`.

- **Signature:** `getFieldName(element: Element): string`
- **Parameters:** `element: Element` — The HTML DOM element to inspect.
- **Returns:** `string` — Extracted field identifier name.

```javascript
const input = document.createElement('input');
input.setAttribute('data-ax-bind', 'state.email');
console.log(getFieldName(input)); // 'state.email'
```

#### `validateValue(value, rules, context)`

Evaluates a value against an array of parsed validation rules and returns an array of error message strings.

- **Signature:** `validateValue(value: any, rules: Array<RuleObject>, context?: object): string[]`
- **Parameters:**
  - `value: any` — The value to validate (string, number, boolean, array).
  - `rules: Array<RuleObject>` — Array of rule objects returned from `parseValidationRules()`.
  - `context?: object` — Optional context object containing `{ state: object, customMessages: object }`.
- **Returns:** `string[]` — Array of validation error messages. Empty array `[]` if valid.

##### Built-in Rule Types

| Rule Name | Argument | Description & Behavior |
| --- | --- | --- |
| `required` | — | Fails if value is empty string, `false`, or empty array. |
| `email` | — | Validates email address format via regex. |
| `min` | `minValue` | Checks minimum string length, number value, or array length. |
| `max` | `maxValue` | Checks maximum string length, number value, or array length. |
| `numeric` / `number` | — | Validates if string contains a valid number. |
| `alpha` | — | Validates that string contains only alphabetic letters (`a-z`, `A-Z`). |
| `alphanumeric` | — | Validates that string contains only letters and numbers. |
| `url` | — | Validates URL format using Web `URL` constructor. |
| `pattern` / `regex` | `regexPattern` | Validates string against custom regular expression pattern. |
| `same` | `targetProp` | Compares value to `context.state[targetProp]`. |

```javascript
const rules = parseValidationRules('required|email');
const errors = validateValue('invalid-email', rules);
console.log(errors); // ['Invalid email address']
```

#### `updateValidationState(state, fieldName, errors)`

Initializes or updates the `$validation` schema structure on a reactive state object.

- **Signature:** `updateValidationState(state: object, fieldName: string, errors: string[]): void`
- **Parameters:**
  - `state: object` — The target state object to mutate.
  - `fieldName: string` — Field identifier.
  - `errors: string[]` — Array of error messages for the field.
- **Returns:** `void`

```javascript
const state = {};
updateValidationState(state, 'email', ['Invalid email address']);

console.log(state.$validation);
/*
{
  isValid: false,
  errors: { email: ['Invalid email address'] },
  fields: { email: { isValid: false, errors: ['Invalid email address'] } }
}
*/
```

---

### Standalone Validation Example

```javascript
import {
  parseValidationRules,
  validateValue,
  updateValidationState
} from 'avenx-core/runtime';

// Define target form state
const formState = {
  email: 'user@domain',
  password: '123',
  confirmPassword: '456'
};

// Define validation rules dictionary
const formRules = {
  email: 'required|email',
  password: 'required|min:8',
  confirmPassword: 'required|same:password:Passwords must match'
};

// Perform standalone validation
for (const [field, ruleStr] of Object.entries(formRules)) {
  const parsedRules = parseValidationRules(ruleStr);
  const fieldErrors = validateValue(formState[field], parsedRules, { state: formState });
  updateValidationState(formState, field, fieldErrors);
}

console.log('Is Form Valid:', formState.$validation.isValid); // false
console.log('Form Errors:', formState.$validation.errors);
```

---

## 14. Performance Profiler Utilities

The performance profiler utilities (exported from `avenx-core/runtime` / `lib/core/utils/profiler.js`) provide execution profiling helpers (`profile` and `getComponentProfilingInfo`) used internally by `AvenxApp` and `AvenxComponent` to measure mount, render, patch, and lifecycle hook execution times.

These utilities leverage the browser's native `performance.mark` and `performance.measure` APIs, creating entries formatted as `[Avenx] <ComponentName> - <phase>` (e.g. `[Avenx] UserCard - render` or `[Avenx] Dashboard - onMount`).

### Importing

```javascript
import { profile, getComponentProfilingInfo } from 'avenx-core/runtime';
```

---

### Function Reference

#### `profile(enableProfiling, componentName, phase, fn)`

Wraps an execution callback function `fn` with `performance.mark()` start/end points and records a `performance.measure()` entry if profiling is enabled. Supports both synchronous functions and async Promise functions.

- **Signature:** `profile<T>(enableProfiling: boolean, componentName: string, phase: string, fn: () => T): T`
- **Parameters:**
  - `enableProfiling: boolean` — Flag controlling whether performance marks and measures should be created.
  - `componentName: string` — Name of the component being profiled (e.g. `'UserCard'`).
  - `phase: string` — The phase being measured (e.g. `'mount'`, `'render'`, `'patch'`, `'onMount'`).
  - `fn: () => T` — The function or async callback to execute and profile.
- **Returns:** `T` — The return value of `fn()` (or resolved Promise value).

##### Performance Mark Names & Measurement Format

- **Start Mark:** `ax-start-<componentName>-<phase>-<id>`
- **End Mark:** `ax-end-<componentName>-<phase>-<id>`
- **Performance Measure Label:** `[Avenx] <componentName> - <phase>`

```javascript
import { profile } from 'avenx-core/runtime';

// Programmatically profile a heavy rendering or calculation block
const result = profile(true, 'DataGrid', 'render', () => {
  return computeComplexLayoutData();
});
```

#### `getComponentProfilingInfo(element)`

Traverses the DOM tree upwards starting from `element` to find the nearest parent `AvenxComponent` instance. Resolves whether profiling is enabled and retrieves the component's constructor name.

- **Signature:** `getComponentProfilingInfo(element: Element | null): { enableProfiling: boolean, componentName: string }`
- **Parameters:** `element: Element | null` — Target HTML DOM node.
- **Returns:** `{ enableProfiling: boolean, componentName: string }`
  - `enableProfiling`: `true` if `component.$app.enableProfiling` or `window.__avenx_enable_profiling` is enabled.
  - `componentName`: Component constructor name (or `'UnknownComponent'` if no parent component is found).

```javascript
import { getComponentProfilingInfo } from 'avenx-core/runtime';

const button = document.querySelector('#submit-btn');
const { enableProfiling, componentName } = getComponentProfilingInfo(button);

console.log(componentName);     // e.g. "UserForm"
console.log(enableProfiling);   // true or false
```

---

### Programmatic Profiling Benchmark Example

```javascript
import { profile } from 'avenx-core/runtime';

async function measureCustomWorkflow() {
  const isDev = process.env.NODE_ENV !== 'production';

  // Measure synchronous operation
  const html = profile(isDev, 'CustomWidget', 'template-build', () => {
    return buildWidgetMarkup();
  });

  // Measure asynchronous API fetch
  const data = await profile(isDev, 'CustomWidget', 'async-fetch', async () => {
    const res = await fetch('/api/widget-data');
    return res.json();
  });

  // Inspect generated performance entries in Chrome/Firefox DevTools Performance tab
  const measures = performance.getEntriesByType('measure')
    .filter(m => m.name.startsWith('[Avenx]'));

  console.log('Avenx Performance Measures:', measures);
}
```

---

## 15. HtmlDiff DOM Comparison Algorithm & API

`HtmlDiff` is a lightweight string-comparison utility for detecting HTML content changes at the template string level. It compares two raw HTML strings and returns the new content only when they differ, making it suitable for coarse-grained change detection before handing off to a reconciliation engine.

For granular DOM node diffing with in-place patching, attribute synchronization, and directive evaluation, see [DomPatcher](#16-dompatcher).

### Importing

```javascript
import { HtmlDiff } from 'avenx-core/runtime';
```

### Constructor

```javascript
const differ = new HtmlDiff();
```

The constructor takes no arguments.

### Methods

#### `diff(currentHtml, nextHtml)`

Compares two HTML strings for equality. If they differ, returns the next HTML string. If they are identical, returns `null`.

- **Signature:** `diff(currentHtml: string, nextHtml: string): string | null`

- **Parameters:**

  - `currentHtml: string`: The current HTML content to compare against.
  - `nextHtml: string`: The new HTML content to compare.

- **Returns:**

  - `string | null`: `string` if the `nextHtml` value differs from `currentHtml` and `null` if both strings are identical.

### Usage Example

```javascript
import { HtmlDiff } from 'avenx-core/runtime';

const differ = new HtmlDiff();

const oldHtml = '<div class="card"><h2>Title</h2><p>Content</p></div>';
const newHtml = '<div class="card"><h2>Title</h2><p>Updated content</p></div>';
const unchangedHtml = '<div class="card"><h2>Title</h2><p>Content</p></div>';

differ.diff(oldHtml, newHtml);
// Returns: '<div class="card"><h2>Title</h2><p>Updated content</p></div>'

differ.diff(oldHtml, unchangedHtml);
// Returns: null
```

---

## 16. DomPatcher

`DomPatcher` is the internal recursive DOM diffing and patching engine used by `AvenxComponent` for reactive rendering. It performs node comparison, attribute synchronization, directive evaluation, and transition-aware DOM mutations to efficiently update the live DOM.

`DomPatcher` is used internally by the framework during component mount and update cycles. It is exported from `avenx-core/runtime` for advanced use cases where direct DOM manipulation outside of the component lifecycle is required.

### Importing

```javascript
import { DomPatcher } from 'avenx-core/runtime';
```

### Constructor

```javascript
const patcher = new DomPatcher();
```

The constructor takes no arguments. Session state (`sessionElements`, `patchRoot`) is initialized lazily at the start of each `patch()` or `patchElement()` call and restored in a `finally` block, making the patcher safe for reentrant and nested operations.

### Public Methods

#### `patch(target, html, resolveExpression?, app?)`

Main entry point. Parses `html` into a DOM tree via `DOMParser`, then recursively diffs and patches `target` against the parsed result.

- **Signature:** `patch(target: Element, html: string, resolveExpression?: Function, app?: object): void`

- **Parameters:**

  - `target: Element`: The live DOM element to patch.
  - `html: string`: The new HTML string to parse and reconcile against `target`.
  - `resolveExpression: Function` (optional): Callback to evaluate template expressions.
  - `app: object` (optional): The `AvenxApp` instance, used for directive registry and lifecycle hooks.

---

#### `patchElement(oldElement, newElement, resolveExpression?, app?)`

Alternate entry point for diffing two live DOM elements directly, without HTML string parsing.

- **Signature:** `patchElement(oldElement: Element, newElement: Element, resolveExpression?: Function, app?: object): void`

- **Parameters:**

  - `oldElement: Element`: The existing live DOM element to patch in place.
  - `newElement: Element`: The new element to diff against.
  - `resolveExpression: Function` (optional): Callback to evaluate template expressions.
  - `app: object` (optional): The `AvenxApp` instance.

---

#### `applyDirectives(element, resolveExpression, app?)`

Recursively evaluates all directives on an element tree without performing any diffing or patching. Useful for initializing directives on freshly created DOM nodes.

- **Signature:** `applyDirectives(element: Element, resolveExpression: Function, app?: object): void`

---

#### `cleanElement(element)`

Post-processing helper. Flattens `<transition>` wrapper tags and removes boolean attributes that evaluate to `false`. Returns the element.

- **Signature:** `cleanElement(element: Element): Element`

---

#### `enter(el, transitionName)`

Executes the CSS enter-transition sequence on an element.

- **Signature:** `enter(el: Element, transitionName: string): void`

---

#### `leave(el, transitionName, removeCallback)`

Executes the CSS leave-transition sequence on an element, then calls `removeCallback` to handle DOM removal.

- **Signature:** `leave(el: Element, transitionName: string, removeCallback: Function): void`

---

#### `triggerUnmounted(node, app)`

Recursively invokes the `unmounted` lifecycle hook on a node and all its descendants.

- **Signature:** `triggerUnmounted(node: Node, app: object): void`

---

#### `flushLifecycleHooks(app)`

Iterates all elements tracked during the current patch session and dispatches lifecycle hooks: `mounted()` for first-time elements, `updated()` for elements with changed values, and `unmounted()` for disconnected elements.

- **Signature:** `flushLifecycleHooks(app: object): void`

---

### Reconciliation Algorithm

The core diffing logic lives in the private `#patchNode` method. It performs a recursive, position-based reconciliation of the old and new DOM trees.

#### Early-Exit Guards

Before recursing into children, `#patchNode` checks for several special cases where child diffing should be skipped:

| Guard | Condition | Behavior |
| --- | --- | --- |
| Transcluded slot | `<slot data-avenx-transcluded>` (non-root) | Patch attributes only, skip children |
| Component boundary | `data-avenx-comp` or `data-avenx-comp-dynamic` (non-root) | Patch attributes, delegate children to component instance via `__updateTranscludedContent()` |
| Template / @for | `<template>` or `@for` (non-root) | Patch attributes only |
| Static marker | `data-ax-static` (non-root) | Skip entirely - subtree is immutable |
| Memoization | `data-ax-memo` + `isEqualNode()` returns true (non-root) | Skip - subtree is structurally identical |


#### Patch Attributes

If both nodes are elements, `#patchAttributes` synchronizes attributes from the new node to the old node:

- Removes attributes absent in the new node
- Adds or updates attributes present in the new node
- Handles boolean attribute semantics (`checked`, `disabled`, `required`, etc.)
- Force-syncs `value` on form elements (`input`, `textarea`, `select`)
- Optimizes `class` attribute comparison using unordered token-set equality (`classTokensEqual`) - `"foo bar"` and `"bar foo"` are treated as equal
- Cleans up stale dynamic attribute names tracked in `data-ax-dyn-attrs`

After attribute patching, `#applyDirectives` is called to evaluate all directives on the element.

#### Diff and Patch Children

A two-pointer walk reconciles the old and new child node lists:

1. **Normalize**: Consecutive text nodes are coalesced in both lists to prevent spurious diffs from whitespace normalization differences. Nodes with `_isLeaving` (in-flight leave animations) are excluded from the old list.

2. **Walk**: `oldIndex` and `newIndex` advance through both child arrays:

   | Situation | Action |
   | --- | --- |
   | Old child exhausted | **Append** remaining new children (each prepared via `#prepareNode` for SVG namespace correction, directive evaluation, and boolean cleanup). Trigger enter transitions. |
   | Same node type (`#isSameNodeType`) | **Patch in-place**: update `textContent` for text nodes, recurse into `#patchNode` for elements. |
   | Different node type | **Replace**: insert new node, animate old node out via `triggerLeave` if transition exists, otherwise `replaceChild`. Trigger enter transition on new node. |

3. **Sync `<select>`**: After children are patched, if the node is a `<select>`, its `.value` is force-synced from the new node's `value` attribute.

4. **Remove excess**: Any remaining old children (except `data-ax-list-item` nodes managed by `ListManager`) are animated out via `triggerLeave`.

---

### Directive Evaluation

Directives are evaluated inside `#applyDirectives` in a strict priority order. Each stage may set flags (e.g., `skipChildren`) that affect subsequent processing.

| Priority | Directive | Behavior |
| --- | --- | --- |
| 1 | `data-ax-html` | Evaluates expression, sets `innerHTML`. Accepts `SafeHtml` for raw output or escapes via `HtmlEscaper`. Sets `skipChildren = true` - all child diffing is skipped. |
| 2 | `data-ax-show` | Evaluates boolean expression. Toggles `display: none` with transition support (`enter`/`leave`). Preserves original `display` value. |
| 3 | `data-ax-class` | Accepts a string (space-separated classes) or object (`{ className: boolean }`). Removes previous classes, adds new set - idempotent across re-renders. |
| 4 | `:[attr]="expr"` | Dynamic attribute name binding. Evaluates bracketed expression for the actual attribute name. Tracks previous names in `__avenxDynAttrs` for cleanup. |
| 5 | `data-ax-*` (custom) | Custom directive registrations. Splits attribute on `.` for modifier support. Manages lifecycle hooks (`mounted`, `updated`, `unmounted`) via session tracking. |

---

### Key Data Attributes

| Attribute | Purpose |
| --- | --- |
| `data-ax-html` | Sets `innerHTML` with `SafeHtml` bypass or escaping |
| `data-ax-show` | Toggles visibility via `display: none` with transition support |
| `data-ax-class` | Dynamic class binding (string or `{cls: bool}` object) |
| `data-ax-transition` | Names the CSS transition (e.g., `"fade"`, `"slide"`) |
| `data-ax-static` | Marks a subtree as immutable - patching skips it entirely |
| `data-ax-memo` | Memoization - skips patching if `isEqualNode` returns true |
| `data-ax-dyn-attrs` | Internal tracker for previously-applied dynamic attribute names |
| `data-ax-*` (custom) | Custom directive registrations with dot-notation modifiers |
| `data-ax-list-item` | Marks a node as managed by `ListManager` - skipped during diff |
| `data-avenx-comp` | Component boundary marker - patching delegates to component instance |
| `data-avenx-transcluded` | Marks a `<slot>` as containing transcluded content |
| `:[expr]="expr"` | Dynamic attribute name/value binding |


### Usage Example

```javascript
import { DomPatcher } from 'avenx-core/runtime';

const patcher = new DomPatcher();

const target = document.getElementById('app');
const newHtml = '<div class="container"><h1>Hello</h1><p>Updated content</p></div>';

// Patch the target element with new HTML
patcher.patch(target, newHtml, (expression, scope) => {
  // Evaluate template expressions against the component scope
  return evaluate(expression, scope);
});
```

In practice, `DomPatcher` is instantiated internally by `AvenxComponent` and invoked during the component's `runUpdate()` cycle - application code rarely calls it directly.
