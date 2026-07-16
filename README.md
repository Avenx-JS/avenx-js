![Avenx Header](https://raw.githubusercontent.com/Avenx-JS/.github/refs/heads/main/media/core-header.jpeg)

# 🚀 Avenx-JS

**Avenx-JS** is a lightweight, experimental frontend framework designed for simplicity and performance. It features a custom compiler-driven component system, Proxy-based reactivity, scoped CSS, and powerful CLI tooling—all with zero runtime dependencies.

---

## ✨ Why Avenx?

Modern frontend development often requires complex build chains and heavy runtime libraries. Avenx explores a different path by providing:

- **⚡ Zero Boilerplate:** Logic, state, and template in a single unified component file.
- **🔄 Transparent Reactivity:** Automatic UI updates via JavaScript Proxies without manual `setState` or `ref` calls.
- **🎨 Scoped Styling:** CSS is automatically scoped to your component using hashed class generation.
- **🛠️ Integrated Tooling:** A built-in CLI handles project scaffolding, component generation, and development servers.
- **📦 Lightweight Core:** Minimal runtime footprint for fast loading and execution.

---

## ⚡ Key Features

### 🔄 Proxy-based Reactivity

State management is built directly into the core. Changing a property on the `state` object automatically triggers a re-render of only the affected parts of the DOM.

### 🧩 Declarative Components

Define your UI using standard HTML with added superpowers. Components support `state`, `computed` properties, and `actions` (methods) defined directly in the `.component.js` file.

### 🎨 Intelligent Scoped CSS

Styles defined in `.component.css` are automatically scoped to that specific component. Use the `<@global>` tag for global variables and the `<@css>` tag for component-specific styles.

### 🌐 Reactive Bridges (Shared State)

Shared state across multiple components is handled via **Bridges**. These are global reactive objects that any component can subscribe to and update.

### 🛠️ CLI-First Workflow

Generate components, pages, and bridges with a single command. The built-in dev server provides hot-reloading for a seamless development experience.

---

## 🚀 Quick Start

### Installation

```bash
npm install avenx-core
```

### Scaffolding a Project

```bash
# Initialize project structure
npx avenx init

# Create a new component
npx avenx g counter

# Start development server
npx avenx serve
```

Your app will be running at `http://localhost:3000`.

---

## 🧠 Core Concepts & Syntax

### 1. Component Structure

An Avenx component consists of two files: `<name>.component.js` and `<name>.component.css`.

#### JavaScript (`.component.js`)

```html
<state count="0" title="Counter" />

<computed name="doubleCount" value="count * 2" />

<action name="increment"> state.count++; </action>

<div class="card">
  <h1>{{ title }}</h1>
  <p>Count: {{ count }} (Double: {{ doubleCount }})</p>
  <button @click="increment()">Increment</button>
</div>
```

#### CSS (`.component.css`)

```css
<@global>
    @def primary-color #646cff;
    @def bg-color #242424;
</@global>

<@css>
    .card {
        padding: 2rem;
        border-radius: 8px;
        background: var(--bg-color);
    }

    button {
        background-color: var(--primary-color);
        color: white;
        border: none;
        padding: 0.6em 1.2em;
        cursor: pointer;
    }
</@css>
```

### 2. Reactive Bridges (Shared State)

Bridges allow you to share reactive state between components without complex prop drilling. They are defined in the `src/global/` directory.

#### Creation

```bash
npx avenx g bridge auth
```

#### Definition (`src/global/auth.bridge.js`)

```javascript
import { AvenxBridge } from 'avenx-core/runtime';

export default class AuthBridge extends AvenxBridge {
  constructor() {
    super();
    this.isLoggedIn = false;
    this.user = {
      name: 'Guest',
      role: 'visitor',
    };
  }
}
```

#### Usage in Component

Bridges are automatically available in your component templates and actions.

```html
<p>Welcome, {{ AuthBridge.user.name }}</p>

<action name="login"> AuthBridge.isLoggedIn = true; AuthBridge.user.name = 'John Doe'; </action>
```

---

### 3. Pages & Routing

Pages are special components designed for top-level routing. They reside in `src/pages/`.

#### Creation

```bash
npx avenx g page profile
```

#### Definition (`src/pages/profile.page.js`)

Pages use the same syntax as components (`<state>`, `<computed>`, `<action>`).

```html
<state userId="123" />

<div class="profile-page">
  <h1>User Profile</h1>
  <p>Viewing ID: {{ userId }}</p>
</div>
```

#### Routing (`src/main.app.js`)

Pages are registered in the main application entry point and handled by the built-in router.

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import Home from './pages/home.page.js';
import Profile from './pages/profile.page.js';

const app = new AvenxApp({ target: '#app' });

app.registerPage('Home', Home);
app.registerPage('Profile', Profile);

app.mountPage('Home'); // Initial page
```

---

### 4. Nesting Components

Components can be nested by using their name in PascalCase. Use `<slot />` tags to define where transcluded child content should render:

```html
<Navbar />
<main>
  <Sidebar />
  <slot />
</main>
```

### 5. Events

Use the `@` prefix to bind event listeners:

```html
<button @click="count++">Inline Action</button> <input @input="state.text = event.target.value" />
```

### 6. CSS Preprocessors (Sass, SCSS, PostCSS, Less)

Avenx-JS supports Sass/SCSS, PostCSS, and Less preprocessors inside `.component.css` or `.page.css` files.

To enable a preprocessor, add the `style` settings to your `avenx.config.json` file:

```json
{
  "style": {
    "preprocessor": "scss"
  }
}
```

Available preprocessor options are `"sass"`, `"scss"`, `"postcss"`, and `"less"`.

When a preprocessor is enabled:

- You can write nested SCSS/Sass styles, variables, functions, and mixins directly inside your stylesheet.
- The compiler will automatically run your styles through the preprocessor module before applying Avenx-JS scoping logic.
- If the configured preprocessor package (e.g. `sass`) is not installed, the compiler gracefully falls back to raw CSS processing and logs a warning.

---

## 📁 Project Structure

A typical Avenx project looks like this:

```text
my-avenx-app/
├── src/
│   ├── components/       # UI Components
│   │   └── counter/
│   │       ├── counter.component.js
│   │       └── counter.component.css
│   ├── pages/            # Application Pages (Routed)
│   ├── global/           # Shared Bridges & Styles
│   └── main.app.js       # App entry point & registration
├── dist/                 # Compiled bundle (generated)
├── index.html            # Main entry HTML
└── package.json
```

---

## 🛠️ CLI Reference

| Command                   | Description                                            |
| :------------------------ | :----------------------------------------------------- |
| `avenx init`              | Scaffolds a new project structure.                     |
| `avenx g <name>`          | Generates a new component (alias: `generate`).         |
| `avenx g p <name>`        | Generates a new page for routing (alias: `g page`).    |
| `avenx g bridge <name>`   | Generates a new shared reactive bridge.                |
| `avenx g guard <name>`    | Generates a new route guard.                           |
| `avenx d <name>`          | Deletes a component (alias: `destroy`).                |
| `avenx d p <name>`        | Deletes a page (alias: `d page`).                      |
| `avenx d bridge <name>`   | Deletes a shared reactive bridge.                      |
| `avenx d guard <name>`    | Deletes a route guard.                                 |
| `avenx build` (or `b`)    | Compiles the project into `dist/`.                     |
| `avenx clean`             | Clears build output directory.                         |
| `avenx check` (or `lint`) | Validates component templates without building.        |
| `avenx serve [port]`      | Starts the dev server with hot-reload (default: 3000). |
| `avenx watch` (or `w`)    | Watch for file changes and rebuild automatically.      |

### Options

| Option                | Description                                                                    |
| :-------------------- | :----------------------------------------------------------------------------- |
| `--dry-run`, `-d`     | Preview actions for generators and destructors without writing/deleting files. |
| `--port`, `-p <port>` | Configure the port for the development server.                                 |
| `--host`, `-h <host>` | Configure the host for the development server (default: `localhost`).          |

---

## 📌 Status

This project is currently a proof-of-concept framework and actively evolving.

---

## 🤝 Contributing

We are actively looking for contributors! Avenx-JS is PR and first-time open-source friendly. Whether you are fixing a typo, updating documentation, or adding features, we welcome your help.

Check out our [CONTRIBUTING.md](CONTRIBUTING.md) to get started!

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

## ⭐ Support

If you like what we're building, please give us a ⭐ on [GitHub](https://github.com/avenx-js/avenx-js)!

Built with ❤️ by the Avenx Team.
