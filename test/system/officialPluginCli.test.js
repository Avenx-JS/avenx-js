import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { Window } from 'happy-dom';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-official-plugins-')));
const windows = [];

/**
 * Writes a fixture using the published package import forms.
 * @param {string} name - Plugin fixture name.
 * @param {object} files - Relative paths and source contents.
 * @param {object} [config] - Compiler configuration.
 * @returns {string} The isolated project directory.
 */
function fixture(name, files, config = {}) {
  const directory = path.join(workDir, name);
  fs.mkdirSync(path.join(directory, 'node_modules/@avenx'), { recursive: true });
  const link = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(repoRoot, path.join(directory, 'node_modules/avenx-core'), link);
  for (const plugin of ['i18n', 'persistence', 'charts', 'vite']) {
    fs.symlinkSync(
      path.join(repoRoot, 'plugins', `avenx-${plugin}`),
      path.join(directory, 'node_modules/@avenx', plugin),
      link,
    );
  }
  const allFiles = {
    'package.json': JSON.stringify({ name: `avenx-plugin-fixture-${name}`, type: 'module', private: true }),
    'avenx.config.json': JSON.stringify({ srcDir: 'src', distDir: 'dist', ...config }),
    'src/screen.component.css': '',
    ...files,
  };
  for (const [name, source] of Object.entries(allFiles)) {
    const filename = path.join(directory, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
  }
  return directory;
}

/**
 * Builds through an actual command line, including package resolution.
 * @param {string} directory - Fixture root.
 * @param {boolean} [vite] - Use the Vite CLI and official plugin.
 * @returns {string} The emitted browser bundle.
 */
function build(directory, vite = false) {
  const result = spawnSync(process.execPath, [vite ? viteCli : path.join(repoRoot, 'bin/avenx.js'), 'build'], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.strictEqual(result.status, 0, `${directory} build failed:\n${result.stdout}\n${result.stderr}`);
  return fs.readFileSync(path.join(directory, vite ? 'vite-dist' : 'dist', 'bundle.js'), 'utf8');
}

/**
 * Executes only the generated artifact in a fresh DOM, with optional saved data.
 * @param {string} bundle - The CLI output.
 * @param {object} [storage] - Previously persisted storage entries.
 * @returns {object} DOM window and captured runtime errors.
 */
function mount(bundle, storage = {}) {
  const window = new Window({ url: 'http://localhost/' });
  windows.push(window);
  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));
  window.console.error = (...args) => errors.push(args.map(String).join(' '));
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  window.document.body.innerHTML = '<div id="app"></div>';
  window.eval(bundle);
  return { window, errors };
}

/**
 * Waits for the framework's scheduled updates, bounded on a concrete result.
 * @param {function(): boolean} predicate - The observable condition.
 * @param {string|function(): string} message - Failure description.
 * @returns {Promise<void>}
 */
async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), typeof message === 'function' ? message() : message);
}

const app = `
import { AvenxApp } from 'avenx-core/runtime';
import Screen from './screen.component.js';
`;
const mountScreen = `
app.register('Screen', Screen);
app.mount('Screen');
window.__pluginTestApp = app;
`;

try {
  const i18n = fixture(
    'i18n',
    {
      'src/main.app.js': `${app}
import { avenxI18n } from '@avenx/i18n';
const app = new AvenxApp({ target: '#app' });
app.use(avenxI18n, {
  locale: 'en',
  messages: { en: { home: { title: 'Welcome' } }, de: { home: { title: 'Willkommen' } } },
});
${mountScreen}`,
      'src/screen.component.js': `<div>
  <h1 id="translation">{{ t('home.title') }}</h1>
  <p id="number">{{ n(1234.5) }}</p>
  <button id="locale" @click="locale.set('de')">Deutsch</button>
</div>`,
    },
    { templateGlobals: ['t', 'n', 'locale'] },
  );
  const i18nBundle = build(i18n);
  assert.ok(i18nBundle.includes('[avenx-i18n]'), 'i18n implementation reaches the CLI bundle');
  const translated = mount(i18nBundle);
  await until(
    () => translated.window.document.querySelector('#translation')?.textContent === 'Welcome',
    'English renders',
  );
  assert.strictEqual(translated.window.document.querySelector('#number').textContent, '1,234.5');
  translated.window.document.querySelector('#locale').click();
  await until(
    () => translated.window.document.querySelector('#translation').textContent === 'Willkommen',
    'locale switch rerenders',
  );
  assert.strictEqual(translated.window.document.querySelector('#number').textContent, '1.234,5');
  assert.deepStrictEqual(translated.errors, []);
  console.log('✅ CLI i18n: translations, formatting and reactive locale switching.');

  const persistence = fixture('persistence', {
    'src/main.app.js': `${app}
import { avenxPersistence } from '@avenx/persistence';
const app = new AvenxApp({ target: '#app' });
app.use(avenxPersistence, { prefix: 'cli-test:' });
${mountScreen}`,
    'src/global/cart.bridge.js': `import { bridge } from 'avenx-core/runtime';
import { persist } from '@avenx/persistence';
export default bridge({
  state: { count: 0 },
  increment() { this.count++; },
  setup() { return persist(this, { key: 'cart' }); },
});`,
    'src/screen.component.js': `import cart from './global/cart.bridge.js';
<div><span id="count">{{ cart.count }}</span><button id="increment" @click="cart.increment()">Add</button></div>`,
  });
  const persistenceBundle = build(persistence);
  assert.ok(persistenceBundle.includes('[avenx-persistence]'), 'persistence implementation reaches the CLI bundle');
  const persisted = mount(persistenceBundle);
  await until(
    () => persisted.window.document.querySelector('#count')?.textContent === '0',
    'persisted bridge renders initially',
  );
  persisted.window.document.querySelector('#increment').click();
  await until(() => persisted.window.document.querySelector('#count').textContent === '1', 'bridge change renders');
  persisted.window.__pluginTestApp.$persistence.flush();
  const saved = persisted.window.localStorage.getItem('cli-test:cart');
  assert.ok(saved, 'a real storage write occurred');
  assert.strictEqual(JSON.parse(saved).state.count, 1);
  const restored = mount(persistenceBundle, { 'cli-test:cart': saved });
  await until(
    () => restored.window.document.querySelector('#count')?.textContent === '1',
    'a fresh mount rehydrates from storage',
  );
  assert.deepStrictEqual(persisted.errors.concat(restored.errors), []);
  console.log('✅ CLI persistence: bridge rendering, storage write and fresh-mount hydration.');

  const charts = fixture('charts', {
    'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import 'avenx-core/runtime/string-renderer';
import { avenxCharts } from '@avenx/charts';
const app = new AvenxApp({ target: '#app' });
app.use(avenxCharts);
app.initRouter({ '/': 'Dashboard' });`,
    'src/pages/dashboard.page.css': '',
    'src/pages/dashboard.page.js': `<state points="[{month:'Jan',value:10},{month:'Feb',value:30}]" />
<action name="addPoint">points = [...points, {month:'Mar',value:20}];</action>
<div><ChartLine :data="points" x="month" y="value" dots />
<button id="add-point" @click="addPoint()">Add point</button></div>`,
  });
  const chartsBundle = build(charts);
  assert.ok(chartsBundle.includes('ax-chart-line-path'), 'chart implementation reaches the CLI bundle');
  const chart = mount(chartsBundle);
  await until(
    () => chart.window.document.querySelectorAll('.ax-chart-dots circle').length === 2,
    () =>
      `the compiled chart renders two SVG data points\n${chart.errors.join('\n')}\n${chart.window.document.body.innerHTML}`,
  );
  const line = chart.window.document.querySelector('svg .ax-chart-line-path');
  const initialGeometry = line.getAttribute('d');
  assert.ok(initialGeometry, 'the SVG line has real geometry');
  chart.window.document.querySelector('#add-point').click();
  await until(
    () => chart.window.document.querySelectorAll('.ax-chart-dots circle').length === 3,
    'chart updates from page state',
  );
  assert.notStrictEqual(
    chart.window.document.querySelector('svg .ax-chart-line-path').getAttribute('d'),
    initialGeometry,
  );
  assert.deepStrictEqual(chart.errors, []);
  console.log('✅ CLI charts: bundled chart implementation renders SVG geometry.');

  const parity = fixture('vite', {
    'src/main.app.js': `${app}
const app = new AvenxApp({ target: '#app' });
${mountScreen}`,
    'src/screen.component.js': `<state count="2" />
<div><p id="count">Count: {{ count }}</p><button id="increment" @click="count++">Add</button></div>`,
    'vite.config.js': `import { avenxPlugin } from '@avenx/vite';
export default {
  plugins: [avenxPlugin()],
  build: {
    outDir: 'vite-dist', minify: false,
    lib: { entry: 'src/main.app.js', name: 'PluginParity', formats: ['iife'], fileName: () => 'bundle.js' },
  },
};`,
  });
  const cliBundle = build(parity);
  const cliApp = mount(cliBundle);
  const builtApps = [cliApp];
  // @avenx/vite supports Vite 7/8, whose Node minimum is newer than core's.
  // Keep the CLI assertions on Node 18; CI's Node 20/22 jobs also run parity.
  const [major, minor] = process.versions.node.split('.').map(Number);
  const canRunVite = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
  if (canRunVite) {
    const viteBundle = build(parity, true);
    assert.ok(viteBundle.includes('__axProgram'), 'the official Vite plugin emitted the compiled render program');
    builtApps.push(mount(viteBundle));
  }
  for (const current of builtApps) {
    await until(
      () => current.window.document.querySelector('#count')?.textContent === 'Count: 2',
      'the full build renders its initial state',
    );
    current.window.document.querySelector('#increment').click();
    await until(
      () => current.window.document.querySelector('#count').textContent === 'Count: 3',
      'the full build updates reactively',
    );
    assert.deepStrictEqual(current.errors, []);
  }
  if (canRunVite) {
    assert.strictEqual(
      cliApp.window.document.querySelector('#app').textContent,
      builtApps[1].window.document.querySelector('#app').textContent,
    );
    console.log('✅ Full CLI/Vite build parity: the same source renders and updates equivalently.');
  } else {
    console.log('✅ CLI counter passed; Vite parity requires Node 20.19+ or 22.12+.');
  }
} finally {
  for (const window of windows) await window.happyDOM.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}
