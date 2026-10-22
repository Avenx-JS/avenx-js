/**
 * @file provideInjectGuideExample.test.js
 * @description The provide/inject guide end-to-end example must stay runnable.
 *
 * Issue #1516: the guide named the class modules `AppLayout.page.js` and
 * `ThemeToggleButton.component.js`. Those extensions are single-file templates,
 * so the compiler treated the class source as markup. This test keeps the
 * documented class wiring executable and refuses the broken filenames in the
 * guide's Real-World Example section.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../helpers/register-happy-dom.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = path.join(__dirname, '../../docs/src/content/docs/core-concepts/provide-inject.md');

/**
 * Asserts the guide's end-to-end section uses plain `.js` module paths.
 */
function testGuideFilenames() {
  console.log('🧪 Provide/inject guide uses class module filenames');

  const markdown = fs.readFileSync(GUIDE, 'utf8');
  const exampleHeading = '## Real-World Example: Theme & State Provider';
  const start = markdown.indexOf(exampleHeading);
  assert.ok(start >= 0, 'Real-World Example section should exist');
  const section = markdown.slice(start);

  assert.match(section, /src\/pages\/AppLayout\.js/);
  assert.match(section, /src\/components\/ThemeToggleButton\.js/);
  assert.doesNotMatch(section, /AppLayout\.page\.js/);
  assert.doesNotMatch(section, /ThemeToggleButton\.component\.js/);
  assert.match(section, /app\.register\('ThemeToggleButton'/);
  assert.match(section, /app\.registerPage\('AppLayout'/);

  console.log('  ✅ Guide filenames and registration match class authoring');
}

/**
 * Runs the documented AppLayout + ThemeToggleButton wiring.
 * @returns {Promise<void>}
 */
async function testDocumentedThemeToggle() {
  console.log('🧪 Documented theme toggle provide/inject wiring');

  class ThemeToggleButton extends AvenxComponent {
    static inject = ['theme', 'toggleTheme'];

    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        '<button @click="handleClick()">Switch theme (Current: {{ theme }})</button>',
        {
          handleClick() {
            this.toggleTheme();
          },
        },
        props,
      );
    }
  }

  class AppLayout extends AvenxPage {
    constructor(bridges, componentRegistry, props) {
      super(
        { theme: 'dark', username: 'Alice' },
        {},
        bridges,
        `<div>
  <header>
    <h2>Welcome, {{ username }}</h2>
  </header>
  <main class="app-content">
    <div data-avenx-comp="ThemeToggleButton"></div>
  </main>
</div>`,
        {},
        componentRegistry,
        props,
      );
    }

    provide() {
      return {
        theme: this.state.theme,
        toggleTheme: () => {
          this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
        },
      };
    }
  }

  const root = document.createElement('div');
  document.body.appendChild(root);

  const registry = new Map([['ThemeToggleButton', ThemeToggleButton]]);
  const page = new AppLayout({}, registry);
  page.mount(root);

  await new Promise((resolve) => setTimeout(resolve, 20));

  const childEl = root.querySelector('[data-avenx-comp="ThemeToggleButton"]');
  assert.ok(childEl, 'ThemeToggleButton host should mount');
  const child = childEl.__avenx_comp_instance;
  assert.ok(child, 'ThemeToggleButton instance should exist');
  assert.equal(child.theme, 'dark');
  assert.equal(typeof child.toggleTheme, 'function');
  assert.match(childEl.textContent, /Switch theme \(Current: dark\)/);

  child.handleClick();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(page.state.theme, 'light');
  assert.equal(child.theme, 'light');
  assert.match(childEl.textContent, /Switch theme \(Current: light\)/);

  page.unmount();
  root.remove();

  console.log('  ✅ Documented theme toggle renders and updates');
}

try {
  testGuideFilenames();
  await testDocumentedThemeToggle();
  console.log('✅ provideInjectGuideExample tests passed');
} catch (error) {
  console.error('❌ provideInjectGuideExample tests failed');
  console.error(error);
  process.exitCode = 1;
}
