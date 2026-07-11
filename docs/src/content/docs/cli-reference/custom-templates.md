---
title: 'Custom Templates'
description: 'Override the default code generation templates used by the Avenx CLI with your own .avenxtemplates directory.'
---

The Avenx CLI generates boilerplate for components, pages, bridges, and guards from a set of built-in templates. If you want your generated files to follow your own conventions, you can override any of these templates locally without modifying the framework itself.

## How Template Overrides Work

When you run `npx avenx generate`, the CLI resolves each template file in the following order:

1. **Structured local path**: `<project_root>/<templatesDir>/<subfolder>/<filename>`
2. **Flat local path**: `<project_root>/<templatesDir>/<filename>`
3. **Global fallback**: the framework's built-in template shipped with Avenx-JS

The first match found is used. If no local override exists, the CLI falls back to the default built-in template.

`<templatesDir>` defaults to `.avenxtemplates` and can be customized via `avenx.config.json`:

```json
{
  "templatesDir": ".avenxtemplates"
}
```

## Creating a `.avenxtemplates` Directory

Create the directory at your project root, then add subfolders matching the type of file you want to override: `component`, `page`, `bridge`, or `guard`.
.avenxtemplates/
├── component/
│   ├── component.js.template
│   └── component.css.template
├── page/
│   └── page.js.template
├── bridge/
│   └── bridge.js.template
└── guard/
└── guard.js.template

You only need to add the specific template(s) you want to override — any type you don't provide will continue to use the default built-in template.

## Placeholder Syntax

Templates use `{{ name }}` as a placeholder, which the CLI replaces with the parsed name of the generated item (e.g., `avenx g counter` → `Counter`).

## Example: Custom Component Template

**`.avenxtemplates/component/component.js.template`**

```html
<state count="0" />

<div>
    <@css container />
    <h1 @css title>{{ name }}</h1>
</div>
```

**`.avenxtemplates/component/component.css.template`**

```css
<@css>
    container {
        padding: 1rem;
        border-radius: 0.5rem;
    }

    title {
        font-weight: 600;
    }
</ @css>
```

Once these files exist, running `npx avenx g counter` will use your custom templates instead of the framework defaults, generating `src/components/counter/counter.component.js` and `.css` based on your overrides.

## Example: Custom Bridge Template

**`.avenxtemplates/bridge/bridge.js.template`**

```javascript
import { AvenxBridge } from 'avenx-core/runtime';

/**
 * {{ name }} - custom bridge template
 */
export default class {{ name }} extends AvenxBridge {
    constructor() {
        super();
        this.value = null;
    }
}
```

## Notes

- Overrides are matched per file, not per template set — you can override just `component.css.template` while leaving `component.js.template` as the default.
- The `guard` and `bridge` subfolders each expect a single `.js.template` file.
- Changes to `.avenxtemplates` take effect immediately on the next `avenx generate` run — no build step required.
