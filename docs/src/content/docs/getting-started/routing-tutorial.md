---
title: 'Routing & Navigation Tutorial'
description: 'Step-by-step tutorial on building a single-page app with AvenxRouter, dynamic parameters, nested layouts, and route guards.'
---

Client-side routing is essential for Single Page Applications (SPAs). In this step-by-step tutorial, you will learn how to set up `AvenxRouter`, map routes to page components, handle dynamic route parameters, perform programmatic navigation, and secure routes using route guards.

---

## Prerequisites

Before starting, make sure you have an Avenx-JS project initialized using the CLI:

```bash
npx avenx init my-router-app
cd my-router-app
```

`avenx init my-router-app` creates the directory and scaffolds into it. Without
a name, `avenx init` scaffolds into the current directory.

---

## Step 1: Create Page Components

In Avenx-JS, top-level view views are stored as Page components in `src/pages/`. Use the CLI generator to scaffold your pages:

```bash
npx avenx g page home
npx avenx g page profile
npx avenx g page login
npx avenx g page not-found
```

---

## Step 2: Configure the Router (`app.initRouter`)

Open `src/main.app.js` to register your page components and initialize the router mapping:

```javascript
// src/main.app.js
import { AvenxApp } from 'avenx-core/runtime';
import Home from './pages/home.page.js';
import Profile from './pages/profile.page.js';
import Login from './pages/login.page.js';
import NotFound from './pages/not-found.page.js';
import AuthGuard from './guards/auth.guard.js';

const app = new AvenxApp({ target: '#app' });

// 1. Register page components
app.registerPage('Home', Home);
app.registerPage('Profile', Profile);
app.registerPage('Login', Login);
app.registerPage('NotFound', NotFound);

// 2. Initialize router configuration
app.initRouter(
  {
    '/': { page: 'Home', title: 'Home' },
    '/login': { page: 'Login', title: 'Sign In' },

    // Route with dynamic parameter and authentication guard
    '/profile/:id': {
      page: 'Profile',
      title: (params) => `User Profile #${params.id}`,
      guards: [AuthGuard],
    },

    // Catch-all 404 fallback route
    '*': { page: 'NotFound', title: 'Page Not Found' },
  },
  {
    titleSuffix: ' — My Avenx App',
  }
);
```

---

## Step 3: Extract Dynamic Route Parameters & Query Strings

Route parameters specified with a colon (e.g. `:id`) and query parameters (e.g. `?tab=settings`) are automatically parsed and passed to page components. They arrive as page state: `:id` becomes `id`, and the query string becomes `query`.

Derive anything you show from them with `<computed>` rather than copying them in
`onMount`. Navigating between two URLs of the same route — which is what the
sub-nav links below do — updates the parameters on the existing page instance
instead of mounting a new one, so `onMount` does not run again and a value
copied there would stay at whatever the first URL said.

Update `src/pages/profile.page.js`:

```html
<!-- src/pages/profile.page.js -->
<computed name="activeTab" value="query && query.tab ? query.tab : 'overview'" />

<action name="onMount">
  // Access route params via state.id or this.$route.params.id
  console.log(`Mounted profile page for user ID: ${this.state.id}`);
</action>

<div class="profile-page">
  <h1>User Profile: #{{ id }}</h1>
  <p>Active Tab: {{ activeTab }}</p>

  <nav class="sub-nav">
    <a href="#/profile/{{ id }}?tab=overview">Overview</a>
    <a href="#/profile/{{ id }}?tab=activity">Activity</a>
  </nav>
</div>
```

---

## Step 4: Programmatic Navigation

In addition to standard HTML hash links (`<a href="#/profile/42">`), you can trigger navigation programmatically inside component actions using `this.$router.navigate(hash)`:

```html
<!-- src/pages/login.page.js -->
<state username="''" password="''" />

<action name="handleLogin">
  if (this.state.username === 'admin') {
    window.isLoggedIn = true;
    
    // Navigate programmatically to the dashboard/profile page
    this.$router.navigate('#/profile/42');
  } else {
    alert('Invalid credentials!');
  }
</action>

<div class="login-page">
  <h2>Sign In</h2>
  <input data-ax-bind="username" placeholder="Username" />
  <button @click="handleLogin()">Log In</button>
</div>
```

The input is bound to `username` with `data-ax-bind`, so typing `admin` and
pressing **Log In** takes the first branch. Without it `username` stays `''`
and the action can only ever reach the `alert`.

---

## Step 5: Protect Routes with Navigation Guards (`AvenxGuard`)

Navigation guards intercept route changes to restrict access (for example, enforcing authentication).

Create `src/guards/auth.guard.js` by extending `AvenxGuard`:

```javascript
// src/guards/auth.guard.js
import { AvenxGuard } from 'avenx-core/runtime';

export default class AuthGuard extends AvenxGuard {
  /**
   * Evaluates navigation access before route activation.
   * @param {object} to - Destination route object (#/profile/:id)
   * @param {object} from - Source route object
   * @returns {boolean|string} Returns true to allow, false to block, or hash path string to redirect.
   */
  canActivate(to, from) {
    // Check if user is authenticated
    if (!window.isLoggedIn) {
      console.warn('[AuthGuard] Access denied. Redirecting to login.');
      // Redirect to login page
      return '#/login';
    }

    return true; // Allow navigation
  }
}
```

---

## Step 6: Testing Your App

Start the local dev server:

```bash
npx avenx serve
```

1. Open `http://localhost:3000/#/`. You will see the **Home** page.
2. Try navigating directly to `http://localhost:3000/#/profile/42`. Because `window.isLoggedIn` is false, `AuthGuard` automatically redirects you to `#/login`!
3. Type `admin` into the username field and click **Log In**. The `handleLogin` action sets `window.isLoggedIn = true` and programmatically navigates to `#/profile/42`. Any other value alerts instead.
4. Try typing an unknown hash like `http://localhost:3000/#/unknown/page`. The wildcard `*` route resolves and renders the **NotFound** 404 page!
