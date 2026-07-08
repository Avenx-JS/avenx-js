---
title: 'Introduction'
description: 'Learn about Avenx-JS, a lightweight experimental reactive frontend framework with scoped CSS and custom components.'
---

Avenx-JS is a lightweight, experimental frontend framework designed for simplicity and performance.

Modern frontend frameworks often demand complex build setups, extensive configuration, and heavy runtime libraries. Avenx-JS explores an alternative path: it couples a custom compiler-driven component model with zero runtime dependencies and Proxy-based reactivity. This provides a cohesive, developer-friendly experience out of the box.

:::note
**Philosophy:** Write clean, standard-compliant HTML, CSS, and JS, and let the compiler handle scoping, bundling, and optimization.
:::

## ✨ Key Features

- **🔄 Proxy-Based Transparent Reactivity** No `useState`, `setState`, or manual component updates. Property changes on the state object trigger selective DOM updates automatically.

- **🧩 Declarative SFC (Single File Components)** Keep your template, local state, computed values, and actions together in a single `.component.js` file, alongside a scoped `.component.css`.

- **🎨 Intelligent Scoped CSS** Styles defined in your component's CSS file are scoped automatically via unique hashes. Global variables are handled seamlessly using custom `@def` rules.

- **🌐 Shared Bridges (Global State)** Subscribe to and share global reactive state objects easily across multiple components with zero boilerplate.

- **🛠️ CLI-First Tooling** Scaffold, build, run a hot-reloading development server, and generate pages, components, bridges, or guards instantly with the `avenx` CLI.
