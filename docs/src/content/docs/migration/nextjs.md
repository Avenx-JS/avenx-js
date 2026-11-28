---
title: 'Migrating from Next.js to Avenx-JS'
description: 'Guide for transitioning from Next.js full-stack and App Router architecture to Avenx-JS client-side single page applications.'
---

This guide details how to migrate applications built with **Next.js** to **Avenx-JS**.

---

## 1. Architectural Overview & Mental Model Shift

Next.js is a full-stack framework with file-based routing (`app/` or `pages/`), React Server Components (RSC), and server actions. Avenx-JS is a client-side Single Page Application (SPA) framework with explicit route definitions in `src/main.app.js` and declarative client-side data fetching.

| Concept | Next.js | Avenx-JS |
| :--- | :--- | :--- |
| **Routing Strategy** | File-system based routing (`app/` directory) | Explicit router configuration via `app.initRouter()` |
| **Rendering Strategy** | Server Components / SSR / SSG / Hydration | Client-Side Rendering (CSR) via `DomPatcher` |
| **Page Components** | `page.tsx` exported React component | `.page.js` component extending `AvenxPage` |
| **Data Fetching** | Server Components / `getServerSideProps` | Client `<resource>` tags + REST API calls |
| **Route Protection** | `middleware.ts` | Async `AvenxGuard` classes implementing `canActivate()` |

---

## 2. Router and Page Architecture

Next.js uses file-system based routing inside the `app/` or `pages/` directory, where file names and folder structures (`app/profile/[id]/page.tsx`) determine application routes automatically on the server.

Avenx-JS uses an **explicit client-side SPA routing architecture**. Creating a `.page.js` file does not automatically expose a URL route. Instead, pages are registered with `app.registerPage()` and routes are explicitly configured using `app.initRouter()` in `src/main.app.js`. See the [Routing](/core-concepts/routing) guide for full specifications and the [Migration Overview](/migration/overview) for paradigm comparisons.

---

### Key Architectural Differences

| Feature | Next.js | Avenx-JS |
| :--- | :--- | :--- |
| **Route Definition** | Automatic based on file tree (`app/profile/[id]/page.tsx`) | Explicit configuration object in `src/main.app.js` (`app.initRouter()`) |
| **Page Component Base** | React component export (`export default function Page()`) | Top-level `.page.js` component (compiles to subclass of `AvenxPage`) |
| **Dynamic Segments** | Square brackets (`[id]`, `[...slug]`) | Colon parameter syntax (`:id`, `:category`) |
| **Params Access** | Component props (`params.id`) | Accessible automatically via `state.id` or `state.params.id` |
| **Page Caching / State Preservation** | Server cache / React tree re-mount | Client-side `keepAlive: true` with configurable `keepAliveLimit` |

---

### Code Migration Example

#### Before — Next.js App Router Page (`app/profile/[id]/page.tsx`)

```tsx
// app/profile/[id]/page.tsx
export default function ProfilePage({ params }: { params: { id: string } }) {
  return (
    <div className="profile-page">
      <h1>Profile ID: {params.id}</h1>
    </div>
  );
}
```

#### After — Avenx.js Page & Router Setup (`src/pages/profile.page.js` & `src/main.app.js`)

```html
<!-- src/pages/profile.page.js -->
<state id="" />

<div class="profile-page">
  <Navbar />
  <h1>Profile ID: {{ state.id }}</h1>
</div>
```

```javascript
// src/main.app.js
import { AvenxApp } from 'avenx-core/runtime';
import ProfilePage from './pages/profile.page.js';
import HomePage from './pages/home.page.js';

const app = new AvenxApp({
  target: '#app',
  keepAliveLimit: 3, // Retain up to 3 cached keep-alive pages in DOM memory
});

// 1. Register page components with the application instance
app.registerPage('Home', HomePage);
app.registerPage('Profile', ProfilePage);

// 2. Explicitly map URL hash routes to registered page names
app.initRouter({
  '/': 'Home',
  '/profile/:id': {
    page: 'Profile',
    keepAlive: true,
  },
  '*': 'Home',
});
```

---

### Dynamic Parameters (`:id`)

In Next.js, dynamic route parameters are defined with square brackets (`[id]`) and passed to the page function as `params`.

In Avenx-JS, dynamic route parameters are defined with colons (`:id`). When a route like `/profile/:id` is matched (e.g. `#/profile/42`), the router automatically injects the extracted parameters into the page's reactive `state`:

- `state.id` (or `state.<paramName>`) is automatically populated.
- `state.params` contains the complete key-value dictionary of all route parameters (e.g. `{ id: '42' }`).

```html
<!-- src/pages/profile.page.js -->
<div>
  <!-- Access dynamic param directly from state -->
  <h2>User #{{ state.id }}</h2>
  <p>Raw params object: {{ JSON.stringify(state.params) }}</p>
</div>
```

---

### Keep-Alive Page Caching & State Retention

Next.js re-renders components on navigation unless client layout caching is explicitly utilized. In long-running SPAs, Avenx-JS provides native **Keep-Alive Page Caching**.

Setting `keepAlive: true` on a route configuration instructs `AvenxRouter` to cache the mounted DOM subtree and component instance state when the user navigates away:

```javascript
app.initRouter({
  '/dashboard': {
    page: 'DashboardPage',
    keepAlive: true, // Retain DOM & state on navigation
  },
});
```

#### Configuring `keepAliveLimit`

To prevent memory leaks when navigating between many cached pages, configure `keepAliveLimit` on `AvenxApp`:

```javascript
const app = new AvenxApp({
  target: '#app',
  keepAliveLimit: 5, // Evicts oldest cached page when limit is exceeded
});
```

#### Keep-Alive Lifecycle Hooks (`onActivate` & `onDeactivate`)

When a keep-alive page is revisited, its DOM is re-attached without running full re-initialization. Use `onActivate` and `onDeactivate` lifecycle methods to handle re-activation logic:

```html
<!-- src/pages/dashboard.page.js -->
<state lastRefreshed="" />

<action name="onActivate">
  const routeParams = args[0];
  console.log("Dashboard re-activated with params:", routeParams);
  state.lastRefreshed = new Date().toLocaleTimeString();
</action>

<action name="onDeactivate">
  console.log("Dashboard backgrounded");
</action>

<div>
  <h1>Dashboard</h1>
  <p>Last active: {{ lastRefreshed }}</p>
</div>
```

---

### Key Conceptual Differences & Migration Pitfalls

#### 1. No File-System Routing

Creating a file like `src/pages/settings.page.js` does **not** create a `/settings` route automatically. You must:
1. Import `SettingsPage` in `src/main.app.js`.
2. Register it via `app.registerPage('Settings', SettingsPage)`.
3. Add the route entry in `app.initRouter({ '/settings': 'Settings' })`.

#### 2. `.page.js` vs `.component.js` Nesting Rules

- `.page.js` files compile to subclasses of `AvenxPage` and serve as top-level router targets.
- Regular `.component.js` files compile to `AvenxComponent` and are nested inside page templates.
- Child components **cannot** host top-level router targets — only `.page.js` components can be assigned as route targets in `app.initRouter()`.

---

## 3. Data Fetching and Async Boundaries

In Next.js App Router, data fetching is typically performed on the server inside **React Server Components (RSC)**, `getServerSideProps`, or `getStaticProps` before HTML is rendered or streamed to the client.

Avenx-JS is a client-side framework (CSR). Asynchronous data loading is declared cleanly in templates using the `<resource>` tag, while UI loading and error states are managed declaratively with `<@suspense>` and `<@errorBoundary>` compiler tags. See the [Resources](/core-concepts/resources) guide for full specifications and the [Migration Overview](/migration/overview) for paradigm comparisons.

---

### Architectural Mapping

| Next.js Data Fetching | Avenx-JS Equivalent | Behavior & Usage Notes |
| :--- | :--- | :--- |
| **Server Component Fetch** (`await fetch()`) | `<resource name="data">` tag | Executes an asynchronous fetch Promise in the browser client. |
| **`React.Suspense` + Fallback** | `<@suspense>` with `<@fallback>` | Displays skeleton or spinner markup while resource Promise resolves. |
| **`error.js` Boundary** | `<@errorBoundary>` with `<@fallback as="err">` | Catches rejected resource Promises and displays client error UI. |
| **`useSWR` / React Query Auto-Refetch** | Automatic Reactive Tracking | Re-fetches automatically when reactive `state` properties in handler change. |
| **`useSWR` Polling (`refreshInterval`)** | `pollInterval="5000"` attribute | Polls the resource endpoint at specified millisecond intervals. |

---

### Code Migration Example

#### Before — Next.js Server Component Fetch (`app/dashboard/page.tsx`)

```tsx
// app/dashboard/page.tsx (Server Component)
async function getDashboardData() {
  const res = await fetch('https://api.example.com/stats', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export default async function DashboardPage() {
  const stats = await getDashboardData();

  return (
    <div className="dashboard">
      <h1>Total Users: {stats.users}</h1>
    </div>
  );
}
```

#### After — Avenx.js Resource & Suspense (`src/pages/dashboard.page.js`)

```html
<!-- src/pages/dashboard.page.js -->
<resource name="stats">
  return fetch('https://api.example.com/stats').then(res => {
    if (!res.ok) throw new Error('Failed to fetch dashboard stats');
    return res.json();
  });
</resource>

<div class="dashboard">
  <@errorBoundary>
    <@suspense>
      <h1>Total Users: {{ stats.value.users }}</h1>

      <!-- Fallback displayed while resource Promise is pending -->
      <@fallback>
        <p>Loading dashboard metrics...</p>
      </@fallback>
    </@suspense>

    <!-- Error fallback displayed if resource Promise rejects -->
    <@fallback as="err">
      <p class="error">Error loading metrics: {{ err.message }}</p>
    </@fallback>
  </@errorBoundary>
</div>
```

---

### Automatic Refetching & Background Polling

#### Automatic Reactive Tracking

When a `<resource>` handler accesses reactive `state` variables, Avenx-JS tracks those dependencies automatically. Whenever the state changes, the resource is automatically re-evaluated:

```html
<state category="all" />

<resource name="products">
  // Automatically re-fetches whenever state.category changes!
  return fetch(`https://api.example.com/products?category=${state.category}`).then(r => r.json());
</resource>

<div>
  <button @click="state.category = 'electronics'">Electronics</button>

  <@suspense>
    <ul>
      <@for item in products.value.items key="item.id">
        <li>{{ item.name }}</li>
      </@for>
    </ul>
    <@fallback><p>Updating products...</p></@fallback>
  </@suspense>
</div>
```

#### Background Polling (`pollInterval`)

Add `pollInterval` to automatically refresh a resource at specified millisecond intervals (similar to SWR `refreshInterval`):

```html
<resource name="liveFeed" pollInterval="5000">
  return fetch('https://api.example.com/live').then(r => r.json());
</resource>
```

---

### Key Conceptual Differences & Security Pitfalls

#### 1. Client-Side Execution & Security Rules

In Next.js Server Components, code inside `fetch()` runs on the Node.js server, allowing direct database access or private secret key usage (`process.env.SECRET_KEY`).

In Avenx-JS, `<resource>` handlers run **entirely in the user's web browser**.

:::caution
Never expose secret API keys, private credentials, or direct database connections inside `<resource>` blocks. All `<resource>` requests must call public REST/GraphQL backend API endpoints.
:::

#### 2. Accessing Resolved Resource Values (`.value`)

Inside `<@suspense>` blocks, access the resolved payload object using `resourceName.value` (e.g. `stats.value.users` or `products.value.items`).

#### 3. Suspense & Error Boundary Syntax

- `<@suspense>` requires a `<@fallback>` tag inside it for the loading UI.
- `<@errorBoundary>` catches uncaught errors from child resources and uses `<@fallback as="err">` to expose the error object (`err.message`).

---

## 4. Server vs Client Decoupling & Route Guards

Next.js can handle both frontend and backend code in the same application using API routes, Server Actions, and middleware. Avenx-JS is client-side, so backend logic should be moved to a separate API server.

### 4.1 Decoupling the Backend

Next.js API routes and Server Actions can be moved to a separate backend such as Express, Fastify, or NestJS.

```text
Browser
  |
  v
Avenx-JS SPA
  |
  | REST API
  v
Backend Server
  |
  v
Database / Services
```

Avenx-JS handles the client-side application, while API requests are sent to the separate backend server.

### 4.2 Replacing Next.js Middleware

Next.js middleware can be used to check authentication before allowing access to a route.

**Before — Next.js Middleware**

```js
// middleware.ts
import { NextResponse } from 'next/server';

export function middleware(request) {
  const token = request.cookies.get('token');

  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
```

With Avenx-JS, the same check can be handled by an `AvenxGuard`.

**After — Avenx-JS Route Guard**

```js
// src/guards/auth.guard.js
import { AvenxGuard } from 'avenx-core/runtime';

export default class AuthGuard extends AvenxGuard {
  async canActivate(to, from) {
    const token = localStorage.getItem('authToken');

    if (!token) {
      return '#/login';
    }

    return true;
  }
}
```

The `canActivate(to, from)` method runs before navigation. Returning `true` allows the navigation, while returning `false` cancels it. Returning a route such as `#/login` redirects the user.

### 4.3 Registering the Guard

The guard can be added to a route in the router configuration.

```js
// src/main.app.js
import AuthGuard from './guards/auth.guard.js';

app.initRouter({
  '#/login': 'Login',
  '#/dashboard': {
    page: 'Dashboard',
    guards: [AuthGuard],
  },
});
```

When the user tries to open `#/dashboard`, the guard runs before the route is entered. The guard can also perform asynchronous checks.

### 4.4 Environment Variables and Static Assets

Next.js uses the `NEXT_PUBLIC_` prefix for environment variables that are exposed to the browser. When migrating to Avenx-JS, use the environment configuration of the client application instead.

Only values that are safe to expose in the browser should be included in client-side configuration. Secrets and private API keys should remain on the backend.

Static files such as images and icons can be placed in the `public/` directory.

For more information, see the [Router Guards](../api-reference/router-guard) and [Migration Overview](./overview) documentation.

