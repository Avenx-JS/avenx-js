# Avenx VS Code Extension

Official Visual Studio Code extension for Avenx.

The extension provides Avenx-aware syntax highlighting, snippets, and save-time diagnostics for Avenx source files.

## Features

### Template syntax highlighting

Avenx component templates are highlighted inside:

```js
static template = `
  ...
`;

The extension provides HTML syntax highlighting together with Avenx-specific syntax for:

{{ expression }}
{{{ expression }}}
<@...> compiler tags
data-ax-* attributes
@event bindings

Unescaped {{{ ... }}} expressions receive a distinct syntax scope so they can be visually differentiated from normal escaped interpolations.

CSS highlighting

CSS syntax highlighting is provided inside:

<@css>
  .button {
    color: red;
  }
</@css>

<@global>
  body {
    margin: 0;
  }
</@global>
Snippets

The extension provides snippets for common Avenx constructs.

Available prefixes include:

Prefix	Description
avx-component	Create an Avenx component
avx-page	Create an Avenx page
avx-bridge	Create an Avenx bridge
avx-guard	Create an Avenx guard
avx-if	Insert a compiler conditional
avx-for	Insert a compiler loop
avx-suspense	Insert a suspense block
avx-error	Insert an error boundary
avx-deadlock	Insert a deadlock block
avx-defer	Insert a defer block
avx-interpolation	Insert an escaped interpolation
avx-unescaped	Insert an unescaped interpolation
avx-data	Insert a data-ax-* attribute
avx-event	Insert an Avenx event binding
avx-css	Insert a <@css> block
avx-global	Insert a <@global> block
Supported files

The extension registers the Avenx language for:

*.component.js
*.page.js
*.bridge.js
*.guard.js
*.component.css
Diagnostics

Avenx diagnostics run when an Avenx file is saved.

The extension invokes the project's existing Avenx CLI check command and displays the resulting validation findings directly in the VS Code editor.

Diagnostics use the existing Avenx error codes, including AVX_* codes where provided by the compiler.

Validation is intentionally not performed on every keystroke.

Requirements
Visual Studio Code 1.85 or later
Node.js 18 or later
An Avenx project with the Avenx CLI available

For projects using the repository itself, the extension can use:

bin/avenx.js

For installed projects, it can use the Avenx CLI from:

node_modules/avenx-core/bin/avenx.js
Configuration

The extension provides the following settings.

avenx.enableDiagnostics

Enable or disable save-time Avenx diagnostics.

Default:

true

Example:

{
  "avenx.enableDiagnostics": true
}
avenx.diagnosticDelay

Controls the delay, in milliseconds, before diagnostics are started after saving a file.

Default:

150

Example:

{
  "avenx.diagnosticDelay": 250
}
Project setup

Open an Avenx project as the VS Code workspace root.

The extension looks for the Avenx CLI in the project's installed dependencies and in the repository's bin/avenx.js.

No language server is required.

avenx init

Projects generated or initialized by Avenx can continue using the existing VS Code configuration templates.

The extension provides the language support and diagnostics directly, while the project's existing VS Code settings can remain in place.

Development

The extension source is located at:

extensions/avenx-vscode/

The main files are:

package.json
language-configuration.json
extension.js
syntaxes/avenx.tmLanguage.json
snippets/avenx.code-snippets
README.md

The extension is intentionally isolated from the browser/runtime build.

License

MIT


Save it as:

`extensions/avenx-vscode/README.md`

Then **Commit changes**.

After that, we still need to update the existing CLI diagnostics so the extension receives the actual `line` and `co
