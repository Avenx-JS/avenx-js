import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../lib/compiler.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-router-link-')));
const markers = [
  'class AvenxRouter',
  'class AvenxGuard',
  'class GuardContext',
  'class RouteMatcher',
  'class BrowserNavigationDelegate',
  'class MemoryNavigationDelegate',
  'function announce(',
  'function manageFocus(',
];
const main = `import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
`;

/**
 * Writes a source file in the isolated application.
 * @param {string} name - Project-relative path.
 * @param {string} source - File contents.
 */
function write(name, source) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
}

/**
 * Builds the application through the production compiler pipeline.
 * @param {object} [options] - Build overrides.
 * @returns {string} The emitted JavaScript.
 */
function build(options = {}) {
  new AvenxCompiler({
    rootDir: root,
    srcDir: 'src',
    distDir: 'dist',
    mode: 'production',
    logging: { silent: true },
    ...options,
  }).build();
  return fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8');
}

/**
 * Checks every router subsystem, including the installer call.
 * @param {string} code - Emitted JavaScript.
 * @param {boolean} present - Whether routing should be installed.
 */
function routing(code, present) {
  for (const marker of markers) assert.equal(code.includes(marker), present, marker);
  assert.equal(/installRouter\(\s*\{/.test(code), present, 'the installer runs exactly when needed');
}

try {
  write('avenx.config.json', '{}');
  write('src/main.app.js', main + '// app.initRouter({}); $route this.$router\n');
  const plain = build();
  routing(plain, false);
  routing(build({ mode: 'development' }), true);

  // Capability discovery is recomputed on every build, including after a route
  // is removed during a watch session.
  const compiler = new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', logging: { silent: true } });
  write('src/main.app.js', main + 'app.initRouter({});');
  compiler.build();
  routing(fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8'), true);
  write('src/main.app.js', main);
  compiler.build();
  routing(fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8'), false);

  // An imported helper, outside srcDir and through an alias, must be visited.
  write('support/routes.js', 'export function start(app) { app["initRouter"]({}); }');
  write('src/main.app.js', main + 'import { start } from "@routing"; start(app);');
  routing(build({ alias: { '@routing': './support/routes.js' } }), true);

  write('src/main.app.js', main + "import 'avenx-core/runtime/router';");
  routing(build(), true);

  for (const expression of ['$route.path', 'this.$router']) {
    write('src/components/probe/probe.component.js', `<div>{{ ${expression} }}</div>`);
    write(
      'src/main.app.js',
      main + "import Probe from './components/probe/probe.component.js'; app.register('Probe', Probe);",
    );
    routing(build(), true);
  }
  fs.rmSync(path.join(root, 'src/components'), { recursive: true });

  write('src/main.app.js', main);
  write('src/guards/auth.guard.js', 'export default class AuthGuard { canActivate() { return true; } }');
  routing(build(), true);
  fs.rmSync(path.join(root, 'src/guards'), { recursive: true });

  write('src/pages/home.page.js', '<h1>Home</h1>');
  routing(build(), true);
  routing(build({ codeSplitting: true }), true);
  write('src/main.app.js', main + "app.initRouter({ '': 'Home' });");
  const routed = build();
  routing(routed, true);
  const window = new Window({ url: 'http://localhost/' });
  try {
    window.document.body.innerHTML = '<div id="app"></div>';
    window.eval(routed);
    await window.happyDOM.whenAsyncComplete();
    assert.equal(window.document.querySelector('h1')?.textContent, 'Home');
    assert.equal(typeof window.AvenxRouter, 'function');
  } finally {
    await window.happyDOM.close();
  }

  // Simulate a broken link while retaining the registry declaration. The
  // compiler must fail before overwriting the last good output.
  const broken = new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', logging: { silent: true } });
  const bundle = broken.runBundler.bind(broken);
  broken.runBundler = (options) => {
    const result = bundle(options);
    result.code = result.code.replace(/installRouter\(\s*\{[^}]+\}\);/, '');
    return result;
  };
  assert.throws(
    () => broken.build(),
    (error) => error.code === 'AVX_C23',
  );
  assert.equal(fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8'), routed);
  console.log(`Routerless bundle: ${Buffer.byteLength(plain)} bytes / ${zlib.gzipSync(plain).length} gzip bytes.`);
  console.log('Router capability presence, linking, runtime and atomic validation passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
