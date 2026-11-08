---
title: 'Resources & Async Data'
description: 'Learn how to handle asynchronous data fetching, dependency tracking, Suspense integration, and automatic re-fetching using the <resource> SFC tag and Resource API.'
---

Avenx-JS provides built-in reactive data fetching abstractions through the `<resource>` Single File Component (SFC) compiler tag and the runtime `Resource` class (`lib/core/reactive/Resource.js`). Resources automatically track reactive state dependencies using an internal `AvenxWatcher`, trigger automatic re-fetches when dependencies change, and expose a `.read()` method compatible with Suspense and Error Boundaries.

---

## SFC Compiler Tag Syntax (`<resource>`)

In Avenx Single File Components (`.component.js`), resources are declared at the top of component templates using `<resource>` tags. Avenx-JS supports two syntax formats:

### 1. Block Syntax

Use block syntax to define inline asynchronous expressions or multi-line fetch logic:

```html
<resource name="userData">
  return fetch(`/api/users/${state.userId}`).then(res => res.json());
</resource>
```

> [!NOTE]
> For single-line expressions in block syntax, if `return` is omitted and no trailing semicolon exists (e.g. `fetch('/api/data').then(r => r.json())`), the Avenx compiler automatically prepends `return` and appends a semicolon.

### 2. Self-Closing Syntax

Use self-closing syntax to delegate resource fetching to a component action/method or an inline string expression:

```html
<!-- Referencing an inline handler expression -->
<resource name="posts" handler="fetch('/api/posts').then(r => r.json())" />

<!-- Referencing a component action method -->
<resource name="profile" handler="this.fetchUserProfile" />
```

### 3. Background Polling (`pollInterval`)

Configure automated background polling by specifying the `pollInterval` attribute in milliseconds on any `<resource>` tag:

```html
<resource name="liveMetrics" pollInterval="5000">
  return fetch('/api/metrics').then(res => res.json());
</resource>
```

---

## Runtime `Resource` Class API

Under the hood, every declared resource creates an instance of the `Resource` class (`lib/core/reactive/Resource.js`).

### Constructor Signature

```javascript
import { Resource } from 'avenx-core/runtime';

const resource = new Resource(name, handlerFn, componentContext, options);
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique string identifier for the resource. |
| `handlerFn` | `function(): any` | Function executing the asynchronous operation (e.g., returning a `Promise`). |
| `componentContext` | `object` | The containing component instance context (`this`). |
| `options` | `object` | *(Optional)* Configuration options object. |

### Constructor Options (`options`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `pollInterval` | `number` | `0` | Interval in milliseconds for automated background data polling (disabled if `0`). |

---

## Instance Properties & States

Every `Resource` instance maintains the following public reactive properties:

```typescript
interface ResourceInstance<T = any> {
  /** Resource identifier string */
  name: string;

  /** Current lifecycle status */
  status: 'idle' | 'pending' | 'resolved' | 'rejected';

  /** Resolved data payload (undefined while pending/rejected) */
  value: T | undefined;

  /** Error instance or rejection reason (undefined if resolved/pending) */
  error: Error | any;

  /** Active Promise instance associated with the fetch */
  promise: Promise<T> | null;
}
```

### Resource Status Lifecycle

```
       ┌──────────┐
       │   idle   │
       └────┬─────┘
            │  (fetch initiated)
            ▼
       ┌──────────┐
       │ pending  │
       └────┬─────┘
            │
      ┌─────┴────────────┐
      ▼                  ▼
┌──────────┐       ┌──────────┐
│ resolved │       │ rejected │
└──────────┘       └──────────┘
```

| Status | Value Property (`resource.value`) | Error Property (`resource.error`) | Promise Property (`resource.promise`) |
| :--- | :--- | :--- | :--- |
| `'idle'` | `undefined` | `undefined` | `null` |
| `'pending'` | `undefined` | `undefined` | Active `Promise<any>` |
| `'resolved'` | Resolved result `T` | `undefined` | Resolved `Promise<T>` |
| `'rejected'` | `undefined` | Thrown `Error` / Reason | Rejected `Promise<any>` |

---

## Instance Methods

### `read()`

The `.read()` method provides a Suspense- and Error Boundary-compatible getter:

```javascript
const data = resource.read();
```

- **Pending:** If `status === 'pending'`, `read()` **throws `this.promise`**. Suspense boundaries catch this thrown Promise to display fallback loading UI.
- **Rejected:** If `status === 'rejected'`, `read()` **throws `this.error`**. Error Boundaries catch this thrown error to display fallback error UI.
- **Resolved:** If `status === 'resolved'`, `read()` returns `this.value`.

### `teardown()`

Cleans up the internal `AvenxWatcher` dependency tracker and clears any active background polling timer (`pollTimer`). This is invoked automatically when a component unmounts to prevent memory leaks and unnecessary background re-fetches:

```javascript
resource.teardown();
```

---

## Declarative Suspense & Error Boundaries (`<@suspense>` & `<@errorBoundary>`)

Avenx-JS provides built-in declarative template tags to handle asynchronous loading and error states without writing boilerplate `if (loading) ... else if (error) ...` conditionals in JavaScript.

### 1. The `<@suspense>` Container Tag

The `<@suspense>` tag wraps async component templates and displays a placeholder fallback UI while any contained `<resource>` is in the `'pending'` state:

```html
<@suspense>
  <@fallback>
    <div class="loading-spinner">Loading users...</div>
  </@fallback>

  <div class="content">
    <@for user in users>
      <p>{{ user.name }}</p>
    </@for>
  </div>
</@suspense>
```

- **`<@fallback>` Slot**: Mandatory child tag inside `<@suspense>`. Its contents are rendered immediately whenever a resource inside `<@suspense>` throws a pending Promise or has `status === 'pending'`.
- **Automatic Swap**: Once the resource resolves, Avenx-JS automatically swaps out the fallback markup and renders the resolved template content.

### 2. The `<@errorBoundary>` Container Tag

The `<@errorBoundary>` tag catches unhandled rejections or errors thrown during rendering or resource fetching:

```html
<@errorBoundary>
  <@fallback as="err">
    <div class="error-banner">
      <h3>Failed to load resource</h3>
      <p>{{ err.message }}</p>
    </div>
  </@fallback>

  <!-- Component content or resource that might reject -->
  <MyAsyncComponent />
</@errorBoundary>
```

- **`<@fallback as="alias">` Slot**: Accepts the `as` attribute (e.g. `as="err"` or `as="error"`), which binds the caught `Error` instance to a local template variable.
- **Error Isolation**: Prevents rendering errors in child components or API rejections from crashing the rest of the application interface.

### 3. Combining `<resource>`, `<@errorBoundary>`, and `<@suspense>`

Combining all three primitives provides a complete, robust async data fetching architecture:

```html
<!-- src/components/dashboard-feed.component.js -->
<resource name="feedData">
  return fetch(`/api/feed?user=${state.userId}`).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch feed`);
    return res.json();
  });
</resource>

<@errorBoundary>
  <@fallback as="err">
    <div class="card error-card">
      <h4>Unable to load feed</h4>
      <p>{{ err.message }}</p>
      <button @click="state.userId = state.userId">Try Again</button>
    </div>
  </@fallback>

  <@suspense>
    <@fallback>
      <div class="card loading-card">
        <span class="spinner"></span> Loading your personal feed...
      </div>
    </@fallback>

    <div class="feed-list">
      <h3>Welcome back, {{ feedData.user?.name }}</h3>
      <@for post in feedData.posts>
        <article class="post-item">
          <h4>{{ post.title }}</h4>
          <p>{{ post.body }}</p>
        </article>
      </@for>
    </div>
  </@suspense>
</@errorBoundary>
```

---

## Reactive Re-fetching & Render Lifecycle

`Resource` integrates directly with Avenx-JS reactivity (`AvenxWatcher`) and component update scheduler:

1. **Dependency Tracking:** When a `Resource` is constructed, it wraps `handlerFn` in an `AvenxWatcher`. Any reactive state property accessed during `handlerFn` execution (such as `state.userId` or `state.filter`) is automatically registered as a dependency.
2. **Automatic Re-fetching:** When any tracked state dependency mutates, `AvenxWatcher` triggers `resource.fetch(newVal)` automatically.
3. **Background Polling:** When `pollInterval` is specified (> 0), `Resource` initializes `pollTimer` (`setInterval`). Every `pollInterval` milliseconds, it re-evaluates `handlerFn` to fetch fresh data in the background.
4. **Teardown & Cleanup:** When the component unmounts, `resource.teardown()` automatically clears `pollTimer` via `clearInterval` alongside `AvenxWatcher` cleanup to prevent memory leaks.
5. **Component Re-rendering:** When the async operation resolves or rejects, `Resource` marks `componentContext.renderWatcher.dirty = true` and invokes `componentContext.update()` to flush DOM updates.

---

## Real-Time Polling SFC Example

The following Single File Component demonstrates background polling to periodically check real-time server health every 10 seconds:

```javascript
// src/components/server-status.component.js
export default {
  template: `
    <!-- Poll server status endpoint every 10 seconds -->
    <resource name="serverStatus" pollInterval="10000">
      return fetch('/api/health').then(r => r.json());
    </resource>

    <div class="status-widget">
      <div data-ax-show="serverStatus.status === 'pending'" class="loading">
        Checking server health...
      </div>

      <div data-ax-show="serverStatus.status === 'resolved'" class="status-badge">
        Server Status: <strong>{{ serverStatus.value?.status }}</strong>
        (Uptime: {{ serverStatus.value?.uptime }}s)
      </div>
    </div>
  `,
};
```

---

## Complete SFC Example

The following Single File Component demonstrates a user directory search card using a `<resource>` tag, state dependency tracking (`state.searchQuery`), status checks, and error rendering:

```javascript
// src/components/user-search.component.js
export default {
  state: {
    searchQuery: 'alex',
  },

  actions: {
    updateQuery(event) {
      this.state.searchQuery = event.target.value;
    },
  },

  template: `
    <resource name="searchResults">
      return fetch(\`/api/users/search?q=\${state.searchQuery}\`)
        .then(res => {
          if (!res.ok) throw new Error('Search request failed');
          return res.json();
        });
    </resource>

    <div class="user-search-card">
      <input
        type="text"
        data-ax-bind="searchQuery"
        @input="updateQuery"
        placeholder="Search users..."
      />

      <!-- Pending Loading State -->
      <div data-ax-show="searchResults.status === 'pending'" class="spinner">
        Loading user search results for "{{ state.searchQuery }}"...
      </div>

      <!-- Rejected Error State -->
      <div data-ax-show="searchResults.status === 'rejected'" class="error-banner">
        Error: {{ searchResults.error?.message }}
      </div>

      <!-- Resolved Data State -->
      <ul data-ax-show="searchResults.status === 'resolved'" class="user-list">
        <li data-ax-for="user in searchResults.value">
          <strong>{{ user.name }}</strong> ({{ user.email }})
        </li>
      </ul>
    </div>
  `,
};
```

---

## Rendering Large Datasets with `<VirtualList>`

When fetching large arrays from an API (such as 1,000+ to 100,000+ items), rendering standard DOM elements for every array item with `data-ax-for` or `<@for>` can degrade browser rendering performance and increase memory usage. 

To maintain 60 FPS scrolling and low memory footprint, pass the fetched resource array directly into the built-in `<VirtualList>` component inside `<@suspense>`:

```html
<resource name="largeDataset">
  return fetch('/api/large-dataset').then(r => r.json());
</resource>

<@suspense>
  <@fallback>Loading large dataset...</@fallback>

  <div style="height: 600px;">
    <VirtualList :item-height="40" :items="largeDataset">
      <template data-ax-as="item">
        <div class="row">#{{ index + 1 }} — {{ item.name }}</div>
      </template>
    </VirtualList>
  </div>
</@suspense>
```

> [!TIP]
> `<VirtualList>` recycles DOM nodes as the user scrolls, rendering only the rows currently visible inside the viewport. Combined with `<resource>` and `<@suspense>`, this pattern provides instant loading indicators and smooth scrolling for large API responses.
