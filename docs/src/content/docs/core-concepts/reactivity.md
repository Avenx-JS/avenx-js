---
title: 'Reactive State'
description: 'Deep dive into the Proxy-based reactive state and transparent dependency tracking in Avenx-JS.'
---

---

Avenx-JS implements a **transparent reactivity system** powered by JavaScript ES6 `Proxy`. There are no state setter functions or hooks required to update the user interface.

> [!TIP]
> For reactive asynchronous data fetching with automatic dependency tracking, Suspense, and error handling, check out the [<resource> SFC Tag & Resource API](/core-concepts/resources) guide.

## How It Works

When a component is instantiated, the framework wraps its initial state object in a reactive Proxy. When an action or callback modifies any field on `state`, the Proxy trap intercepts the change and queues a re-render job.

```javascript
// In an action:
state.counter++; // Automatically schedules a visual update!


Batching Updates & Scheduler
To maximize browser performance, state updates are batched together. If you change multiple state properties sequentially, Avenx does not re-render the DOM for each modification. Instead, the framework queues a single microtask job to flush updates together in the next tick.

<action name="updateUser">
  state.name = "John"; // Queued state.age = 30; // Queued (deduplicated) state.role = "admin"; // Queued (deduplicated)
  // The DOM will render only ONCE at the end of the microtask queue.
</action>Lifecycle & Rendering Flow
When reactive state changes, Avenx-JS processes the update through a scheduled rendering cycle. Updates are batched using the scheduler queue so that multiple state mutations can be processed efficiently within a single microtask.

The update lifecycle follows this sequence:

State Mutation - A value in the reactive state object is changed.

Proxy Interception - The reactive Proxy intercepts the mutation and requests an update.

Scheduler Job Queue - The component's update job is added to the scheduler queue. Multiple updates to the same component can be deduplicated and batched together.

Microtask Flush - The scheduler processes the queued update jobs during the next microtask.

DOM Patch - The component template is rendered and the DOM is patched with the updated values.

Slot Re-fill - Component slots are re-filled with their updated content.

onUpdate Execution - The component's onUpdate lifecycle callback runs after the update has completed.


State Mutation
  │
  ▼
Proxy Interception
  │
  ▼
Scheduler Job Queue
  │
  ▼
Microtask Flush
  │
  ▼
DOM Patch
  │
  ▼
Slot Re-fill
  │
  ▼
onUpdate Execution


Microtask Scheduler & nextTick Utility
Because state mutations are batched asynchronously, DOM updates do not happen immediately upon state assignment. If you inspect DOM dimensions or query rendered elements immediately after modifying this.state, you will read pre-update DOM measurements.

The nextTick utility function allows you to execute callbacks or await Promises immediately after the scheduler finishes flushing pending DOM updates.

Usage Variants
1. Component Instance Method (this.nextTick)
Inside component actions, methods, or lifecycle hooks, use this.nextTick():

// Callback usage
this.state.items.push(newItem);
this.nextTick(() => {
  const lastItem = this.$element.querySelector('li:last-child');
  console.log('New item offsetHeight:', lastItem.offsetHeight);
});

// Promise / Async-Await usage
async function addItem() {
  this.state.showModal = true;
  await this.nextTick();
  const inputEl = this.$element.querySelector('.modal input');
  inputEl.focus();
}

2. Framework Import (nextTick)
Import nextTick directly from avenx-core/runtime when working outside component instance methods:

import { nextTick } from 'avenx-core/runtime';

component.state.title = 'Updated Title';
await nextTick();
console.log(document.title);

Scheduler Architecture & Execution Order (scheduler.js)
Avenx-JS manages asynchronous rendering using an internal microtask scheduler (lib/core/reactive/scheduler.js).


State Mutation
      │
      ▼
queueJob(job)  ──► Deduplicate & push to job queue
      │
      ▼
queueFlush()   ──► Schedule microtask (Promise.resolve().then(...))
      │
      ▼
  flushJobs()
  ├─ 1. Sort job queue by component UID ascending (Parent before Child)
  ├─ 2. Execute DOM patch jobs
  └─ 3. Drain & execute flushCallbacks (nextTick callbacks)


Job Queueing & Deduplication (queueJob): When a reactive state field mutates, the component's update job (#updateJob) is pushed to the queue. Multiple mutations to the same component are deduplicated.

Microtask Deferred Execution (queueFlush): The scheduler defers execution to a microtask using chained promises (Promise.resolve().then(() => Promise.resolve().then(flushJobs))).

Hierarchical Component Ordering: Before executing jobs in flushJobs(), the scheduler sorts the queue ascending by component id (UID). This guarantees that parent components re-render and patch the DOM before child components, preventing redundant updates or orphaned child renders.

Flush Callback Phase: After all DOM patch jobs finish, the scheduler drains and executes flushCallbacks (including nextTick callbacks). If a nextTick callback mutates reactive state again, the scheduler recursively re-flushes until all queues are empty.



State Mutation
    ↓
Proxy Interception
    ↓
Scheduler Job Queue
    ↓
Microtask Flush
    ↓
DOM Patch
    ↓
Slot Re-fill
    ↓
onUpdate Execution

Because updates are queued and processed asynchronously, multiple synchronous state mutations can be grouped into a single rendering cycle instead of causing repeated DOM updates.

Troubleshooting AVX_R11
Troubleshooting AVX_W09
The AVX_W09 (ROUTE_PARAM_DECODE_FAILED) warning occurs when Avenx-JS cannot decode a route parameter because it contains malformed percent-encoding.

This warning is typically raised during route changes when parameters are extracted from the URL and decoded using JavaScript's decodeURIComponent(). If decoding fails because the URI is malformed, Avenx-JS logs the warning instead of crashing the application.

For example, the following route parameter contains invalid percent-encoding:

#/profile/John%2



The %2 sequence is incomplete and cannot be decoded.

A correctly encoded route would be:

#/profile/John%20Doe

where %20 represents a space.

To prevent this warning:

Always encode route parameters using encodeURIComponent() before constructing URLs.

Ensure every % is followed by exactly two hexadecimal digits (0-9, A-F, or a-f).

Avoid manually writing encoded URL values whenever possible.
const userName = "John Doe";
const url = `/profile/${encodeURIComponent(userName)}`;

Common examples of percent encoding:

Valid%20
%2F
%3A

Invalid
%
%2
%ZZ

Troubleshooting AVX_W11
The AVX_W11 (ROUTE_TITLE_EVALUATION_FAILED) warning occurs when a dynamic route title function throws an error while evaluating the route parameters.

For example, this route can trigger the warning if params.id is accessed through code that throws an error:



app.initRouter({
  '/profile/:id': {
    page: 'Profile',
    title: (params) => getProfileTitle(params.id),
  },
});



The AVX_R11 (STATE_MUTATION_IN_UPDATE) error occurs when state is mutated synchronously while Avenx-JS is already processing an update.

This can happen when state is modified from code that runs as part of rendering, such as a computed property or template expression. Updating state during this phase can schedule another update before the current update has finished, potentially creating an infinite rendering loop.

For example, avoid mutating state while computing a value:



get displayName() {
  state.name = state.name.trim(); // Avoid: mutates state during an update
  return state.name;
}

Instead, computed getters should derive and return values without modifying state:

get displayName() {
  return state.name.trim();
}

If a state mutation must happen after the current update cycle has completed, defer it using setTimeout:

setTimeout(() => {
  state.name = state.name.trim();
}, 0);


Deferring the mutation allows the current rendering cycle to finish before another state update is scheduled.

When troubleshooting AVX_R11, check for state mutations inside computed getters, template expressions, or other code that executes during rendering. Prefer deriving values without side effects, and defer necessary state changes until after the current update cycle.

Nested Reactivity
Avenx-JS automatically intercepts nested object mutations. If a state property contains an array or object, mutations within that tree are tracked:

state.todos.push({ text: 'Learn Avenx', done: false }); // Reactive!
state.user.profile.age = 35; // Reactive!
Watchers & Advanced Options ($watch)
Watchers allow components to run side effects (such as making API calls, persisting values to localStorage, or manipulating DOM elements) in response to reactive state changes.

In Avenx-JS, watchers are registered using this.$watch(source, callback, options).

Watcher Method Signature
javascript
this.$watch(source, callback, options)
source: Dot-separated string path (e.g. 'user.settings.theme') or getter function () => this.state.searchQuery.

callback: Function called when the watched value changes (newValue, oldValue) => { ... }.

options: Object specifying configuration options (immediate, deep, flush).

Advanced Options (options)
1. Immediate Execution (immediate: true)
By default, watcher callbacks run only when the watched property changes after watcher registration. Set immediate: true to invoke the callback immediately upon creation with the current value (oldValue will be undefined):

javascript
// Triggers immediately with current searchQuery, then on subsequent changes
this.$watch('searchQuery', (newQuery) => {
  this.performSearch(newQuery);
}, { immediate: true });
2. Deep Tracking (deep: true)
By default, string path watchers track shallow property replacements. Set deep: true to recursively observe nested object property mutations and array modifications:

javascript
// Fires when any property inside state.user.settings changes
this.$watch('user.settings', (newSettings) => {
  this.saveSettingsToLocalStorage(newSettings);
}, { deep: true });
3. Execution Timing (flush: 'pre' | 'post' | 'sync')
The flush option controls when the watcher callback is executed relative to the component's DOM patch lifecycle:

Value	Timing & Behavior	Common Use Cases
'pre' (Default)	Fires before DOM patch rendering takes place.	Preparing state calculations or computing secondary values before render.
'post'	Fires after DOM patch update completes.	Accessing updated DOM element measurements, scroll positions, or canvas elements.
'sync'	Fires synchronously immediately upon state mutation.	Real-time validation or synchronizing state with external non-DOM stores.
javascript
// 'post' flush: container scroll position updated after DOM list re-renders
this.$watch('messages.length', () => {
  const listEl = this.el.querySelector('.chat-messages');
  listEl.scrollTop = listEl.scrollHeight;
}, { flush: 'post' });
Reactivity Injection (Provide / Inject)
For deeply nested component trees, passing data down through props at every level ("prop drilling") gets unwieldy. Avenx-JS offers a lighter-weight alternative to global bridges for this specific case: an ancestor component can provide values, and any descendant, no matter how deeply nested, can inject them directly — without the value passing through, or being known by, the components in between.

Unlike bridges, provide/inject is scoped to a single component subtree rather than the whole application, and it doesn't route through the global bridge/render system, avoiding that overhead for state that's only relevant to one part of the tree.

Providing values
Declare a provide property (or static method) on the ancestor component. It can be:

An object, mapping keys to values or methods

A function (instance or static) returning either form above, evaluated once per instance

An array of keys, exposing matching properties already present on the component's own state, props, methods, or bridges

javascript
// src/pages/dashboard.page.js
<state theme="dark" />;

// Object form: explicit keys and values
provide = {
  theme: this.state.theme,
  setTheme: (value) => {
    this.state.theme = value;
  },
};
javascript
// Array form: re-exposes existing state/props/methods by name
provide = ['theme', 'setTheme'];
Injecting values
Descendant components declare inject the same way — object, function, or array of keys — and the resolved keys become directly accessible as properties on this (and inside template expressions):

javascript
// src/components/theme-toggle/theme-toggle.component.js
inject = ['theme', 'setTheme'];

<button @click="setTheme(theme === 'dark' ? 'light' : 'dark')">
  Current theme: {{ theme }}
</button>
To expose a provided value under a different local name, use the object form of inject, mapping the local key to the key it was provided under:

javascript
inject = {
  currentTheme: 'theme', // accessible as `this.currentTheme` / `{{ currentTheme }}`
};
How resolution works
An injected key is resolved lazily, on every access — it is not copied or cached at mount time. When a descendant reads an injected property, Avenx walks up the DOM tree from the component's root element to find the nearest ancestor component whose provide declares that key, then reads the current value from it.

This has two practical implications:

Object-form provide is reactive. The object passed to provide is wrapped in its own reactive proxy internally. Injecting descendants read through that proxy on every access, so they automatically see updates when the provider changes a provided value — no extra wiring required.

Array-form provide stays reactive too, since it reads the provided key directly off the provider's live state/props/methods each time, rather than a snapshot.

:::note
Only the nearest ancestor providing a given key is used. If multiple ancestors in the chain provide the same key, closer ancestors take precedence.
:::

:::caution
If no ancestor in the tree provides an injected key, the property resolves to undefined and a warning is logged to the console — it does not throw. Double-check ancestor/descendant provide/inject key names match if an injected value is unexpectedly undefined.
:::

AvenxWatcher & Component Watch API
While computed properties automatically derive values and update DOM templates, you often need to execute side effects in response to state changes (such as fetching data from an API, syncing with localStorage, logging analytics, or triggering animations).

Avenx-JS provides the this.$watch() / this.watch() component API and the underlying AvenxWatcher engine (lib/core/reactive/watcher.js) to observe reactive properties and expressions with fine-grained control.

Component Watch API (this.$watch)
Inside component actions, lifecycle hooks, or class methods, register watchers using this.$watch():

typescript
this.$watch(source, callback, options?): AvenxWatcher
Supported source Formats
Format	Syntax Example	Description
State Key (String Path)	'user.profile.name'	Observes top-level or nested properties on this.state. Nested property paths are traversed and resolved automatically.
Getter Function	() => this.state.count * 2	Evaluates a reactive expression and runs the callback whenever any accessed reactive property changes.
Multi-Source Array	[() => this.state.a, () => this.state.b]	Observes multiple sources concurrently. Callback receives arrays of [newA, newB] and [oldA, oldB].
Callback Signature
javascript
callback(newValue, oldValue)
newValue: The latest evaluated value of the watched source.

oldValue: The previous value before mutation (undefined during the initial invocation when immediate: true).

Watcher Configuration Options
Configure watcher execution behavior by passing an options object:

Option	Type	Default	Description
immediate	boolean	false	When true, runs the callback immediately upon watcher registration with the initial value.
deep	boolean	false	When true, recursively traverses nested objects and arrays so modifications to nested child properties trigger the callback.
debounce	number (ms)	undefined	Delays callback execution until number milliseconds of inactivity have elapsed since the last state mutation (debouncing).
throttle	number (ms)	undefined	Limits callback execution frequency to at most once per number milliseconds (throttling).
lazy	boolean	false	Postpones initial value calculation until first evaluated (used internally for lazy computed properties).
Watcher Control Methods (AvenxWatcher Instance)
Calling this.$watch() returns an AvenxWatcher instance that provides programmatic control over its lifecycle:

Method	Description
watcher.pause()	Temporarily pauses watcher callback execution without unregistering reactive dependencies. State mutations occurring while paused do not trigger the callback.
watcher.resume()	Re-enables watcher execution and resumes processing reactive state changes.
watcher.teardown()	Unsubscribes the watcher from all tracked dependencies and clears pending debounce/throttle timers. Automatically invoked when components unmount.
Practical Code Examples
1. Debounced Search Input Watcher
Debounce autocomplete API requests to avoid excess network traffic as the user types:

javascript
// src/components/search-box.component.js
export default {
  actions: {
    onMount() {
      // Debounce input changes by 300ms
      this._searchWatcher = this.$watch(
        'searchQuery',
        async (query) => {
          if (!query || query.trim() === '') {
            this.state.results = [];
            return;
          }
          this.state.isSearching = true;
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
          this.state.results = await res.json();
          this.state.isSearching = false;
        },
        { debounce: 300 }
      );
    },
  },
};
2. Multi-Source Array Watcher
Observe multiple reactive values concurrently and trigger a single combined side effect:

javascript
// Observe changes to both page number and filter category
this.$watch(
  [() => this.state.currentPage, () => this.state.filterCategory],
  ([newPage, newCategory], [oldPage, oldCategory]) => {
    console.log(`Filter changed from (${oldPage}, ${oldCategory}) to (${newPage}, ${newCategory})`);
    this.fetchTableData(newPage, newCategory);
  },
  { immediate: true }
);
3. Deep Object Watching
Observe mutations on nested object properties or arrays:

javascript
this.$watch(
  () => this.state.userPreferences,
  (newPrefs) => {
    localStorage.setItem('user_prefs', JSON.stringify(newPrefs));
  },
  { deep: true }
);
4. Pausing Watchers During Bulk State Updates
Temporarily pause watcher triggers during bulk state assignments to avoid redundant operations:

javascript
const watcher = this.$watch('items', (items) => this.calculateTotal(items));

function loadBatch(newItems) {
  // Pause watcher triggers during batch insertion
  watcher.pause();

  newItems.forEach((item) => {
    this.state.items.push(item);
  });

  // Resume watcher and run recalculation once
  watcher.resume();
  this.calculateTotal(this.state.items);
}
5. Standalone AvenxWatcher Usage
Outside components, create standalone reactive watchers using AvenxWatcher:

javascript
import { AvenxWatcher } from 'avenx-core/runtime';

const watcher = new AvenxWatcher(
  () => appState.theme,
  (newTheme, oldTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme);
  },
  { immediate: true }
);

// Clean up when no longer needed
watcher.teardown();
Cleaning Up Watchers
Watchers created with this.watch() are automatically cleaned up when the component is unmounted.

When creating an AvenxWatcher manually, call teardown() when the watcher is no longer required:

javascript
const watcher = new AvenxWatcher(
  () => state.count,
  (newValue, oldValue) => {
    console.log(newValue, oldValue);
  },
);

watcher.teardown();
Automatic Teardown with Disposal Scopes
Every AvenxComponent instance owns a disposal scope — an object that collects teardown callbacks and releases them all at once. While a component's lifecycle hooks and action handlers are running, that scope is active, so anything that registers a subscription during that window (most notably bridge.on(...)) can tie its cleanup to the component's lifetime automatically, with no manual bookkeeping in onUnmount().

This is the same idea already used for $watch watchers — they're collected and torn down automatically on unmount (see Cleaning Up Watchers above). Disposal scopes generalize that pattern for plugin and bridge authors.

The scope APIs
getScope() returns the currently active DisposalScope, or null if nothing is active.

runInScope(scope, fn) makes scope active for the duration of fn, then restores the previously active scope — even if fn throws.

onScopeDispose(disposer) registers disposer with the active scope, returning an idempotent release function.

Component lifecycle hooks and action handlers already run inside the component's own scope, so calling onScopeDispose anywhere inside them works without any extra setup:

javascript
import { onScopeDispose } from 'avenx-core/runtime';

export default {
  onMount() {
    const id = setInterval(() => this.tick(), 1000);
    onScopeDispose(() => clearInterval(id));
  }
};
No onUnmount() needed — the interval clears itself when the component unmounts.

bridge.on(...) and automatic unsubscription
bridge.on(...) registers its unsubscribe function with onScopeDispose internally when called from inside a component. That's why WebSocket listeners, DOM event subscriptions, and custom event bus handlers wired through bridge.on don't need a matching bridge.off in onUnmount():

javascript
export default {
  onMount() {
    // No need to store this or call bridge.off — released automatically on unmount.
    bridge.on('server:update', this.handleUpdate);
  }
};
Custom resources and event buses
The same pattern applies to any resource you manage yourself:

javascript
export default {
  onMount() {
    const onClick = (e) => this.handleClick(e);
    window.addEventListener('click', onClick);
    onScopeDispose(() => window.removeEventListener('click', onClick));

    const unsubscribe = eventBus.subscribe('theme:change', this.onThemeChange);
    onScopeDispose(unsubscribe);
  }
};
Detaching long-lived work with runInScope(null, fn)
Sometimes work should outlive the component that triggers it — a singleton bridge connection, a background poller, or app-lifetime setup. Passing null to runInScope detaches execution from any active scope, so onScopeDispose calls inside fn won't attach to whichever component happened to call it first:

javascript
import { runInScope, onScopeDispose } from 'avenx-core/runtime';

let bridgeSingleton = null;

export function getBridge() {
  if (!bridgeSingleton) {
    runInScope(null, () => {
      bridgeSingleton = createBridge();
      // Not tied to any component scope — survives every unmount.
      onScopeDispose(() => bridgeSingleton.close());
    });
  }
  return bridgeSingleton;
}
:::caution
onScopeDispose called with no active scope (outside runInScope and outside a component lifecycle) still returns a working release function, but nothing calls it automatically — it isn't attached to anything. If you detach with runInScope(null, ...), you're responsible for disposing of that work yourself, typically by holding onto a DisposalScope instance and calling .dispose() on it when appropriate.
:::

Avoiding memory leaks in plugins and bridges
When authoring a plugin or bridge integration:

Prefer onScopeDispose over manually tracking cleanup in onUnmount() — it's automatic and less error-prone.

Only reach for runInScope(null, fn) when work genuinely needs to outlive the current component — and keep a reference to dispose of it later.

Use getScope() to check whether you're inside a component's lifecycle before registering global singletons — null means you're already detached.

Reactivity Exclusions and Limitations
Avenx-JS uses JavaScript Proxy objects to track changes to reactive state. While this works well for plain JavaScript objects and arrays, some values are intentionally excluded from reactive tracking to preserve native behavior and avoid prototype-related issues.

Untracked Types
The following values are not automatically tracked by the reactivity system:

Type	Reason
Symbol properties	Symbol keys are ignored during reactive tracking.
Date instances	Native class instances are not proxied.
RegExp instances	Regular expression objects are excluded from tracking.
Map	Internal mutations (set, delete, clear) are not observed.
Set	Internal mutations (add, delete, clear) are not observed.
Frozen objects (Object.freeze)	Frozen objects cannot be wrapped or mutated reactively.
Other built-in class instances	Native objects are intentionally excluded to preserve their original behavior.
Why These Types Are Excluded
These exclusions help:

preserve the behavior of native JavaScript objects

avoid prototype pollution

prevent unexpected side effects when wrapping built-in objects

keep the reactivity system predictable

Recommended Alternatives
When possible, store plain JavaScript values inside reactive state instead of native class instances.

For example, instead of storing a Date object directly:

js
state.createdAt = new Date();
store a primitive representation:

js
state.createdAt = Date.now();
or

js
state.createdAt = new Date().toISOString();
Instead of storing a Map:

js
state.users = new Map();
consider using a plain object:

js
state.users = {
  alice: {
    role: "admin"
  },
  bob: {
    role: "editor"
  }
};
or an array of entries:

js
state.users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" }
];
Working with Non-Reactive Objects
If your application needs to use native objects such as Map, Set, or custom class instances, consider storing a primitive representation in reactive state and recreating the object when needed.

For scenarios where external objects change independently of reactive state, update a tracked state property or use your application's refresh mechanism to trigger a UI update after modifying the object.

Summary
For the best reactive experience:

✅ Prefer plain objects and arrays.

✅ Store primitive values such as strings, numbers, and booleans.

✅ Convert native objects to serializable formats when appropriate.

❌ Do not rely on mutations of Date, Map, Set, RegExp, Symbol properties, or frozen objects to trigger UI updates.

Debugging Reactivity (debugReactivity)
During development, tracing dependency graphs and understanding why a component re-rendered or why a watcher triggered can be tricky. Avenx-JS includes a reactivity tracing engine (lib/core/reactive/watcher.js) that logs detailed dependency registration and update events directly to the browser DevTools console.

Enabling Tracing
Reactivity debugging can be enabled through three different mechanisms:

1. Build Configuration (avenx.config.json)
Enable reactivity logging project-wide by setting debug.debugReactivity to true:

json
{
  "debug": {
    "debugReactivity": true
  }
}
2. Programmatic Runtime API (setDebugReactivity)
Enable or disable reactivity debugging dynamically in your code using setDebugReactivity:

javascript
import { setDebugReactivity, isDebugReactivityEnabled } from 'avenx-core/runtime';

// Enable reactivity tracing programmatically
setDebugReactivity(true);

console.log('Reactivity tracing active:', isDebugReactivityEnabled()); // true
3. Dynamic Browser Console Flag (window.__avenx_debug_reactivity__)
Toggle reactivity logging on the fly inside the browser DevTools console without restarting your application:

javascript
// Enable in browser DevTools
window.__avenx_debug_reactivity__ = true;

// Disable when finished debugging
window.__avenx_debug_reactivity__ = false;
What Gets Logged
When reactivity tracing is enabled, Avenx-JS outputs structured log messages:

Dependency Tracking: Logs whenever an AvenxWatcher accesses a Proxy property and registers a reactive dependency.

State Mutations: Logs property modifications and Proxy traps (e.g. state mutations and value updates).

Watcher Invalidation: Logs when dirty state notifications queue a watcher re-render job.

Advanced Reactivity & Proxy Reflection
Avenx-JS exports low-level reflection symbols and utility functions from lib/core/reactive/proxyHandler.js for advanced introspection, devtools extensions, and interoperability with non-reactive third-party libraries.

Reactivity Reflection Symbols
Symbol	Description	Usage Example
RAW_SYMBOL	Unique Symbol key used to unwrap a reactive Proxy and access its raw, underlying non-reactive JavaScript object or array.	const raw = state[RAW_SYMBOL] || state;
IS_REACTIVE_PROXY	Boolean flag Symbol present on all reactive Proxy instances. Evaluates to true on Proxies and undefined on plain objects.	if (state[IS_REACTIVE_PROXY]) { ... }
PROXY_REF_SYMBOL	Global Symbol (Symbol.for('__avenx_proxy_ref__')) referencing the cached Proxy instance attached to a raw target object.	const proxy = rawObject[PROXY_REF_SYMBOL];
Reactivity Inspection Utilities
isReactiveTarget(value)
Determines whether a JavaScript value is eligible to be wrapped in a reactive Proxy.

javascript
import { isReactiveTarget } from 'avenx-core/reactive/proxyHandler.js';

isReactiveTarget({ name: 'Alice' }); // true (Plain Object)
isReactiveTarget([1, 2, 3]);          // true (Array)
isReactiveTarget(new Map());          // true (Map)
isReactiveTarget(new Set());          // true (Set)

isReactiveTarget('hello');            // false (Primitive string)
isReactiveTarget(123);                // false (Primitive number)
isReactiveTarget(null);               // false (null)
isReactiveTarget(new Date());         // false (Native Class Instance)
isReactiveTarget(() => {});           // false (Function)
Eligible targets include:

Plain objects with Object.prototype or null prototype (e.g. Object.create(null)).

Arrays (Array.prototype).

Map and Set collections.

Primitives, functions, promises, and instances of built-in classes (Date, RegExp, DOM elements) return false to prevent internal slot corruption and prototype pollution.

cleanupParentMap(target)
Recursively traverses a detached or replaced reactive object and clears its parent-child tracking metadata from the internal parentMap. This is called automatically when properties on reactive state are reassigned or deleted, preventing memory retention in deep reactive trees.

Practical Use Cases & Examples
1. Unwrapping State for Third-Party Libraries (Charts, Canvas, WebGL)
Third-party libraries (such as Chart.js, D3, Three.js, or Leaflet) may perform identity checks (===), clone objects, or mutate arrays internally. Passing raw non-reactive objects avoids triggering unnecessary component re-renders:

javascript
import { RAW_SYMBOL, IS_REACTIVE_PROXY } from 'avenx-core/reactive/proxyHandler.js';

// Safe unwrapping helper
export function toRaw(observed) {
  return (observed && observed[RAW_SYMBOL]) ? observed[RAW_SYMBOL] : observed;
}

// In a component action or lifecycle hook:
function renderChart() {
  // Extract raw non-reactive data array
  const rawChartData = toRaw(this.state.metrics);

  // Pass plain JavaScript array to charting library
  myChartLibrary.updateData(rawChartData);
}
2. Clean State Serialization & Web Workers (structuredClone / JSON.stringify)
When transferring state across postMessage to Web Workers or serializing data to localStorage, unwrapping the proxy ensures optimal cloning performance:

javascript
import { RAW_SYMBOL } from 'avenx-core/reactive/proxyHandler.js';

function exportStateSnapshot(stateProxy) {
  const rawState = stateProxy[RAW_SYMBOL] || stateProxy;

  // Clone or serialize cleanly without triggering getter traps
  return structuredClone(rawState);
}
3. Building DevTools, Diagnostics & Logging Plugins
Detect whether an arbitrary object is currently wrapped in an Avenx reactive Proxy:

javascript
import { IS_REACTIVE_PROXY, RAW_SYMBOL } from 'avenx-core/reactive/proxyHandler.js';

function inspectObject(obj) {
  if (obj && obj[IS_REACTIVE_PROXY]) {
    console.log('[DevTools] Object is a reactive Avenx Proxy.');
    console.log('[DevTools] Underlying raw target:', obj[RAW_SYMBOL]);
  } else {
    console.log('[DevTools] Object is plain / non-reactive.');
  }
}
text

---

**To use this file:**

1. Copy everything inside the code block above
2. Create a new file named `reactivity.md` on your computer
3. Paste the content into that file
4. Save it

This is the complete file ready to upload or paste into the GitHub web editor.
