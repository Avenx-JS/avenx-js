# Avenx-JS 🚀

A lightweight, reactive JavaScript framework Proof-of-Concept featuring **Zero-Classname Styling** and a custom template compiler.

## Features

- **Reactivity**: Uses JavaScript Proxies to automatically re-render components when state changes.
- **Unified Components**: Components are defined using a combination of HTML-like tags and JavaScript logic within `.component.js` files.
- **Scoped Styling**: Styles are defined in `.component.css` files. Use the `<@css />` marker in your template to automatically assign unique hash-classes to your elements.
- **Bridges**: Shared reactive states stored in `src/global/*.bridge.js`. They allow passing values between any components seamlessly.
- **CLI Tooling**: A powerful CLI to initialize projects, generate components, and manage the build process.

## Installation

To use Avenx-JS in your project, install it via npm:

```bash
npm install avenx-core
```

## CLI Usage

Avenx-JS comes with a CLI to streamline development. You can run it using `npx avenx`:

- **Initialize a project**: `npx avenx init`
- **Generate a component**: `npx avenx g <name>`
- **Build the project**: `npx avenx build`
- **Start dev server**: `npx avenx serve [port]`

## Core Concepts

### 1. Components (`.component.js`)
Components contain your template, state, and logic.

```html
<state count="0" />

<action name="increment">
    this.state.count++;
</action>

<h1 @click="increment">
    <@css />
    Count is {{ count }}
</h1>
```

### 2. Styling (`.component.css`)
Styles are scoped using the `<@css>` block. You can also define global variables using `<@global>`.

```css
<@global>
    @def primary-color #ff3e00;
</@global>

<@css>
    h1 {
        color: var(--primary-color);
        cursor: pointer;
        &:hover { opacity: 0.8; }
    }
</@css>
```

### 3. Bridges (Shared State)
Bridges are files in `src/global/*.bridge.js` that export a default object. They are automatically available in all components.

**Definition (`src/global/Auth.bridge.js`):**
```javascript
export default {
    isLoggedIn: false,
    username: ''
}
```

**Usage in a component:**
```html
<p>User: {{ AuthBridge.username }}</p>
```

## Getting Started

1. **Scaffold a new project**:
   ```bash
   mkdir my-app && cd my-app
   npx avenx init
   ```

2. **Start the development server**:
   ```bash
   npx avenx serve
   ```
   This will build your project and start a server at `http://localhost:3000` with hot-reloading.

3. **Build for production**:
   ```bash
   npx avenx build
   ```
   The compiled assets will be located in the `dist/` directory.

## License
MIT
