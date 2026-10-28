---
title: 'ESLint Template Validation'
description: 'Configure ESLint with avenxTemplateParser, componentTagNamingRule, and templateAccessibilityRule to enforce tag naming and accessibility linting in Avenx SFC templates.'
---

Avenx-JS provides a dedicated custom ESLint parser (`avenxTemplateParser`) and rules (`componentTagNamingRule`, `templateAccessibilityRule`) to validate Single-File Component (SFC) templates, enforce PascalCase component tag naming conventions, and verify template accessibility across your codebase.

---

## Overview

### Template Quality and Conformance

In Avenx-JS templates, static template validation catches syntax and design defects at build time before deployment:

- **PascalCase Component Tags**: Registered custom components must use PascalCase (e.g. `<UserProfileCard />` instead of `<user-profile-card>`).
- **Static Accessibility Validation**: Statically decidable accessibility rules catch missing `alt` attributes, unlabelled form controls, buttons without names, non-interactive click handlers without ARIA roles, anchors without `href`, and positive `tabindex` values.

### How ESLint Validates Avenx Templates

Validation relies on tooling utilities exported from `avenx-core/tooling`:

- **`avenxTemplateParser`**: A custom parser (`lib/core/tooling/avenxTemplateParser.js`) that produces an ESLint-compatible AST for `.component.js` and `.page.js` files. It allows ESLint to inspect Avenx template markup and metadata tags (`<state>`, `<computed>`, `<action>`, `<resource>`) without syntax errors or breaking standard JavaScript parsing rules.
- **`componentTagNamingRule`**: An ESLint rule (`lib/core/tooling/eslintComponentTagNaming.js`) that extracts template markup, scans for custom component tags, and validates them against registered project components to ensure exact PascalCase casing.
- **`templateAccessibilityRule`**: An ESLint rule (`lib/core/tooling/eslintAccessibility.js`) that runs static accessibility checks over template AST nodes, surfacing accessibility findings (AVX_W65–AVX_W70) inline in editor environments.

---

## Setup with Flat Config (`eslint.config.mjs`)

ESLint 9+ uses Flat Config (`eslint.config.mjs`). Import `avenxParser`, `componentTagNamingRule`, and `templateAccessibilityRule` from `avenx-core/tooling/` and configure them as shown below:

```javascript
import avenxParser from 'avenx-core/tooling/avenxTemplateParser';
import { componentTagNamingRule } from 'avenx-core/tooling/eslintComponentTagNaming';
import { templateAccessibilityRule } from 'avenx-core/tooling/eslintAccessibility';

export default [
  {
    files: ['src/**/*.component.js', 'src/**/*.page.js'],
    languageOptions: {
      parser: avenxParser,
    },
    plugins: {
      avenx: {
        rules: {
          'component-tag-naming': componentTagNamingRule,
          'template-accessibility': templateAccessibilityRule,
        },
      },
    },
    rules: {
      'avenx/component-tag-naming': ['error', {
        componentsDir: 'src/components',
      }],
      'avenx/template-accessibility': 'warn',
    },
  },
];
```

---

## Rule Options Reference

The `avenx/component-tag-naming` rule accepts a single options object with the following properties:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `componentsDir` | `string` | Auto-detected | Relative path from project root to the directory containing component definitions. If omitted, Avenx auto-detects `srcDir` from `avenx.config.json` (defaults to `'src'`) and appends `/components`. |
| `componentNames` | `string[]` | `undefined` | Explicit list of registered PascalCase component names (e.g. `['UserProfileCard', 'AdminPanel']`). When set, filesystem scanning of `componentsDir` is bypassed. |

### Usage Options Examples

#### Auto-Detection with `componentsDir` (Recommended)

```javascript
rules: {
  'avenx/component-tag-naming': ['error', {
    componentsDir: 'src/components',
  }],
}
```

#### Explicit Component Array with `componentNames`

```javascript
rules: {
  'avenx/component-tag-naming': ['error', {
    componentNames: ['UserProfileCard', 'Header', 'Footer', 'NavigationMenu'],
  }],
}
```

---

## Error Messages & Diagnostics

When non-PascalCase component tags are detected in templates, `componentTagNamingRule` emits an error using the `invalidName` message ID.

### Message Template

```text
Avenx component <{{tagName}}> must use PascalCase: <{{expectedName}}>.
```

### Diagnostic Output Examples

Given a registered component named `UserProfile` (located at `src/components/user-profile/user-profile.component.js`):

| Template Code | Status | ESLint Diagnostic Output |
| :--- | :--- | :--- |
| `<UserProfile />` | ✅ Valid | Pass |
| `<user-profile />` | ❌ Error | `Avenx component <user-profile> must use PascalCase: <UserProfile>.` |
| `<userprofile />` | ❌ Error | `Avenx component <userprofile> must use PascalCase: <UserProfile>.` |
| `<userProfile />` | ❌ Error | `Avenx component <userProfile> must use PascalCase: <UserProfile>.` |
| `<div>`, `<button>` | ✅ Ignored | Native DOM tags are skipped. |
| `<my-web-component />` | ✅ Ignored | Unregistered custom elements are ignored. |
| `<state>`, `<action>` | ✅ Ignored | Avenx metadata blocks are masked and skipped. |

---

## Accessibility Linting (`templateAccessibilityRule`)

The `avenx/template-accessibility` rule verifies that templates adhere to fundamental web accessibility standards. It uses the exact same static verification logic as `avenx check`, ensuring consistent diagnostics between your editor and build pipeline.

### Rules Enforced

| Rule Code | Focus | Requirement |
| :--- | :--- | :--- |
| `AVX_W65` | `<img>` alt attributes | All `<img>` tags must include an `alt` attribute (use `alt=""` for decorative images). Dynamic values such as `alt="{{ imageAlt }}"` or `:alt="alt"` are accepted. |
| `AVX_W66` | Non-interactive clicks | Non-interactive elements (`<div>`, `<span>`) with `@click` must have an explicit ARIA `role` (e.g. `role="button"`) and keyboard event handling (`@keydown`). |
| `AVX_W67` | Anchor `href` | `<a>` elements must have an `href` attribute. For in-page button behavior, use `<button type="button">`. |
| `AVX_W68` | Form labels | Form controls (`<input>`, `<select>`, `<textarea>`) must have an associated `<label for="...">`, be wrapped in `<label>`, or define `aria-label` / `aria-labelledby`. |
| `AVX_W69` | Button accessible names | `<button>` elements must have non-empty text content or an `aria-label` / `aria-labelledby` attribute. |
| `AVX_W70` | Positive tabindex | Elements must not use positive `tabindex` values (`tabindex > 0`). Use `0` or `-1` instead. |

### Diagnostic Examples

```html
<!-- ❌ AVX_W65: Missing alt attribute -->
<img src="/avatar.png">

<!-- ✅ Valid alt -->
<img src="/avatar.png" alt="User avatar">

<!-- ❌ AVX_W66: Non-interactive click without role/keyboard -->
<div @click="toggleDetails()">Details</div>

<!-- ✅ Use button instead -->
<button type="button" @click="toggleDetails()">Details</button>

<!-- ❌ AVX_W69: Empty button without accessible name -->
<button class="icon-close"></button>

<!-- ✅ Provide aria-label -->
<button class="icon-close" aria-label="Close dialog"></button>
```

---

## IDE & CI/CD Integration

### Running ESLint via CLI

Validate your templates by running ESLint directly:

```bash
npx eslint .
```

You can add a script to `package.json`:

```json
{
  "scripts": {
    "lint": "eslint ."
  }
}
```

Then run:

```bash
npm run lint
```

### Continuous Integration (CI/CD)

Integrate ESLint in your GitHub Actions workflow alongside `avenx check` to validate template tag naming in automated checks:

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npm ci
      - name: Validate Templates with Avenx CLI
        run: npx avenx check
      - name: Lint Template Tag Naming with ESLint
        run: npx eslint .
```

### VS Code Integration

To see real-time ESLint error highlights in VS Code when editing `.component.js` and `.page.js` files:

1. Install the official [VS Code ESLint Extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint).
2. Add the following to `.vscode/settings.json`:

```json
{
  "eslint.validate": [
    "javascript"
  ],
  "eslint.options": {
    "overrideConfigFile": "eslint.config.mjs"
  }
}
```
