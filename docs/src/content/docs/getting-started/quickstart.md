---
title: 'Quick Start Tutorial'
description: 'Build your first reactive counter component with Avenx-JS in this quickstart tutorial.'
---

Let's create a fully interactive Counter component in just a few minutes.

### Step 1: Scaffold a Project

Create an empty directory, navigate into it, and initialize your project:

```bash
mkdir my-avenx-app
cd my-avenx-app
npx avenx init
```

This creates the basic workspace layout: `src/` folder, `index.html`, and config files.

### Step 2: Generate a Component

Generate a new component named `counter` using the CLI generator:

```bash
npx avenx g counter
```

This creates `src/components/counter/counter.component.js` and `counter.component.css`, and registers it in `src/main.app.js`.

### Step 3: Define Component Logic & Template

Open `src/components/counter/counter.component.js` and update it as follows:

```html
<state count="0" title="Avenx Counter" />

<computed name="doubleCount" value="count * 2" />

<action name="increment"> state.count++; </action>

<action name="decrement"> state.count--; </action>

<div @css card>
  <h2>{{ title }}</h2>
  <p @css number>Value: {{ count }} (Double: {{ doubleCount }})</p>
  <div>
    <button @css action @click="decrement()">Minus</button>
    <button @css action @click="increment()">Plus</button>
  </div>
</div>
```

Styling is attached with the `@css` directive, which names a block in the
stylesheet you are about to write. Avenx does not match styles by class name,
so an element with no `@css` directive is unstyled.

### Step 4: Define Scoped CSS

Open `src/components/counter/counter.component.css` and define your scoped styles:

A `<@css>` block contains **named blocks**, not CSS selectors. `card { ... }`
declares a block called `card`, which the template attaches with `@css card`.
Writing `.card { ... }` would declare a block whose name is `.card` -- a name no
`@css` directive can spell -- and the build reports it as `AVX_W55`.

```css
<@global>
    @def brand-color #4f46e5;
    @def text-dark #1f2937;
</@global>

<@css>
    card {
        padding: 2rem;
        border-radius: 12px;
        background: #f9fafb;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        text-align: center;
        max-width: 320px;
        margin: 2rem auto;
    }

    number {
        font-size: 1.25rem;
        color: @text-dark;
        margin: 1rem 0;
    }

    action {
        background-color: @brand-color;
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        margin: 0.25rem;
        cursor: pointer;
        font-weight: 600;
        transition: opacity 0.2s;

        &:hover {
            opacity: 0.9;
        }
    }
</@css>
```

### Step 5: Run the Development Server

Launch the built-in development server with live reload:

```bash
npx avenx serve
```

Your browser will open to `http://localhost:3000`. Modify code in real-time and watch it hot-reload!

---

### Next Steps & Code Quality

- Validate template markup offline with [`avenx check`](/cli-reference/commands#6-avenx-check-alias-lint).
- Configure ESLint with Flat Config to enforce PascalCase component tag naming in your IDE and CI pipeline using the [ESLint Template Validation Guide](/guides/eslint).

