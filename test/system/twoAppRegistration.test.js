import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../lib/compiler.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-two-app-'));

/**
 * Writes a source file in the real fixture application.
 * @param {string} name - Relative filename.
 * @param {string} content - File contents.
 */
function write(name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * Builds the fixture, loads the bundle in a fresh window at the given hash,
 * and returns the two containers' text.
 * @param {string} hash - The starting hash, e.g. '#/widget/home'.
 * @returns {Promise<{app: string, widget: string, bundle: string}>} The rendered text.
 */
async function renderAt(hash) {
  new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', mode: 'development', logging: { silent: true } }).build();
  const bundle = fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8');
  const window = new Window({ url: `http://localhost/${hash}` });
  try {
    window.document.body.innerHTML = '<div id="app"></div><div id="widget"></div>';
    window.eval(bundle);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      app: window.document.querySelector('#app')?.textContent ?? '',
      widget: window.document.querySelector('#widget')?.textContent ?? '',
      bundle,
    };
  } finally {
    await window.happyDOM.close();
  }
}

try {
  write('avenx.config.json', '{}');
  write('src/pages/home.page.js', '<h1>HOST-HOME</h1>');
  write('src/pages/widgethome.page.js', '<h1>WIDGET-HOME</h1>');
  write(
    'src/main.app.js',
    `
import { AvenxApp } from 'avenx-core/runtime';

const hostApp = new AvenxApp({ target: '#app' });
hostApp.initRouter({ '/': 'Home', '*': 'Home' });

const widgetApp = new AvenxApp({ target: '#widget' });
widgetApp.initRouter({ '/home': 'Widgethome', '*': 'Widgethome' }, { prefix: '/widget' });
`,
  );

  // The bundle itself must attribute the pages to their own app (#1813).
  const built = renderAt('#/widget/home');
  const { app, widget, bundle } = await built;
  assert.ok(
    bundle.includes('widgetApp.registerPage("Widgethome"'),
    'the bundle registers Widgethome on the widget app',
  );
  assert.ok(
    !bundle.includes('hostApp.registerPage("Widgethome"'),
    'the bundle must not register Widgethome on the host app',
  );

  // A deep link to the widget route renders the widget page, and the host
  // stays silent: its catch-all yields to the router that claims the hash.
  assert.ok(widget.includes('WIDGET-HOME'), `#/widget/home must render the widget page, got: ${widget}`);
  assert.ok(!app.includes('WIDGET-HOME'), `#/widget/home must not leak the widget page into the host, got: ${app}`);
  assert.strictEqual(app, '', `#/widget/home must leave the host container alone, got: ${app}`);

  // The entry route renders the host and leaves the widget alone.
  const atRoot = await renderAt('#/');
  assert.ok(atRoot.app.includes('HOST-HOME'), `#/ must render the host page, got: ${atRoot.app}`);
  assert.ok(!atRoot.widget.includes('WIDGET-HOME'), `#/ must leave the widget container alone, got: ${atRoot.widget}`);

  console.log('✅ Two-app registration: both containers render');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
