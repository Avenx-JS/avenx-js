---

title: 'Component Structure'
description: 'Understand how Avenx Single File Components are structured with template, script, and style tags.'
----------------------------------------------------------------------------------------------------------------

In Avenx-JS, a component is defined by two companion files in the same directory: `<name>.component.js` (logic and template) and `<name>.component.css` (styles).

## JavaScript File (`.component.js`)

The component file contains configuration tags at the top and the HTML template at the bottom. The configuration tags are parsed at compile-time and stripped out before outputting class declarations.

* `<state key="val" />` - Declares the component's reactive local properties. Attributes are coerced to their corresponding JS types (numbers, booleans, arrays, or objects).

* `<computed name="computedName" value="expression" />` - Defines computed getters. The value attribute accepts stringified JS expressions.

* `<action name="methodName"> ... </action>` - Defines actions (methods) that have access to the component's state, computed attributes, and bridges in their execution scope.

```html
<!-- src/components/greet/greet.component.js -->
<state username="Guest" isLoggedIn="false" />

<computed name="greeting" value="isLoggedIn ? 'Welcome back, ' + username : 'Hello, Guest!'" />

<action name="login"> state.username = "Jane Doe"; state.isLoggedIn = true; </action>

<div class="greet-box">
  <h3>{{ greeting }}</h3>
  <button @click="login()">Log In</button>
</div>
```

## Compilation Lifecycle & Limits

The Avenx compiler processes `.component.js` files by scanning for supported configuration tags and template content. During compilation, only `<state>`, `<computed>`, `<action>`, and template content are preserved and transformed into the generated component output.

Standard JavaScript declarations written outside these supported tags, such as ES module imports, local variables, constants, and helper functions, are not preserved by the compiler. Code that depends on these declarations may therefore cause runtime `ReferenceError` exceptions after compilation.

For example, avoid declaring imports or helper functions directly in a component file:

```javascript
import { formatName } from './utils.js';

const defaultName = 'Guest';

function getDisplayName(name) {
  return formatName(name);
}

<state username="Guest" />

<action name="updateName">
  state.username = getDisplayName(defaultName);
</action>
```

In this example, the `import`, `defaultName`, and `getDisplayName` declarations are outside the supported component tags and may be removed during compilation.

Instead, keep component logic inside supported tags or move reusable utilities into external files that can be accessed through supported application patterns.

For utilities that are intentionally exposed globally, reference them through the `window` object:

```html
<action name="updateName">
  state.username = window.AppUtils.formatName(state.username);
</action>
```

When writing `.component.js` files:

* Keep reactive state declarations inside `<state>` tags.
* Keep computed values inside `<computed>` tags.
* Keep component methods and state mutations inside `<action>` tags.
* Move reusable helper logic into external utility files.
* Reference intentionally global utilities through properties on `window`.

Understanding these compilation limits helps prevent missing imports, undefined helpers, and runtime `ReferenceError` exceptions caused by code being removed from the compiled output.
