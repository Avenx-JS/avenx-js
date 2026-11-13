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
│   ├── components/       # Conventional location for reusable UI components
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
├── eslint.config.mjs     # ESLint flat config (optional template tag validation)
└── package.json          # Node dependencies and project scripts
```

:::note
**Compilation Note:** During builds, Avenx-JS compiles every `.component.js` file under `src/`, plus pages under `src/pages/`, bridges, and guards. It bundles the modules used by your app into `dist/bundle.js` and `dist/bundle.css`. `src/components/` is the conventional component location; components can also live beside the code that uses them, such as in `src/layouts/` or `src/features/`. No runtime bundler like Webpack/Vite is needed.

For IDE and CI/CD component tag casing validation, configure `eslint.config.mjs` with `avenxTemplateParser` and `componentTagNamingRule`. See the [ESLint Template Validation Guide](/guides/eslint) for setup instructions.
:::
