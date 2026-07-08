---
title: 'Project Structure'
description: 'Understand the folder and file structure of an Avenx-JS application workspace.'
---

When you scaffold a project using the `avenx init` command, it builds a organized structure designed to cleanly separate routing, components, page layout, and global configurations.

```text
my-avenx-app/
├── .vscode/              # Editor configurations for VS Code
│   ├── jsconfig.json     # Enables path intelligence
│   └── settings.json     # Custom file association bindings
├── dist/                 # Compilation target output (created by compiler)
│   ├── bundle.js         # Single unified JavaScript runtime and app bundle
│   └── bundle.css        # Combined and scoped application stylesheets
├── src/                  # Main application source directory
│   ├── components/       # UI Components (Reusable elements)
│   │   └── counter/
│   │       ├── counter.component.js
│   │       └── counter.component.css
│   ├── pages/            # Page Components (Routed views)
│   │   └── home.page.js
│   │   └── home.page.css
│   ├── global/           # Shared global assets, Styles, and Bridges
│   │   └── auth.bridge.js
│   ├── guards/           # Route transition guards (e.g. AuthGuard)
│   │   └── auth.guard.js
│   └── main.app.js       # Main application bootstrap and configuration
├── index.html            # Application entry document
└── package.json          # Node dependencies and project scripts
```

:::note
**Compilation Note:** During builds, Avenx-JS bundles the core runtime files, your components, pages, bridges, and guards into a single `dist/bundle.js` and stylesheet `dist/bundle.css`. No runtime bundler like Webpack/Vite is needed.
:::
