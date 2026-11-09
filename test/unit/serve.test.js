import assert from 'assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import {
  bindAddressFor,
  listenWithPortFallback,
  formatStatusCode,
  formatRequestLog,
  attachRequestLogger,
  applyCustomHeaders,
  getInitialHtml,
  getBundleHashes,
  watchProject,
  formatSseMessage,
  isErrorOverlayEnabled,
  relativeDiagnosticPath,
  buildStatusFromPass,
  overlayMessageFor,
  getErrorOverlayScript,
} from '../../bin/commands/serve.js';
import { splitCodeFrame, parseDiagnostic } from '../../bin/commands/build.js';
import { setColorEnabled } from '../../bin/colors.js';
import { AvenxCLI } from '../../bin/cli.js';

class OccupiedPortServer extends EventEmitter {
  constructor() {
    super();
    this.attempts = [];
  }

  listen(port, host) {
    this.attempts.push({ port, host });
    if (this.attempts.length === 1) {
      const error = new Error('address already in use');
      error.code = 'EADDRINUSE';
      this.emit('error', error);
    } else {
      this.emit('listening');
    }
  }
}

function testGetInitialHtmlLanguage() {
  const html = getInitialHtml({ config: { distDir: 'dist' } });

  assert.ok(
    html.includes('<html lang="en">'),
    'Generated index.html should declare its language'
  );
}

function testBundleHashes() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-bundle-hashes-'));
  const distDir = path.join(baseDir, 'dist');
  fs.mkdirSync(distDir);
  fs.writeFileSync(path.join(distDir, 'bundle.js'), 'const value = 1;');
  fs.writeFileSync(path.join(distDir, 'bundle.css'), '.card { color: red; }');

  try {
    const first = getBundleHashes({
      baseDir,
      config: { distDir: 'dist' },
    });
    fs.writeFileSync(path.join(distDir, 'bundle.css'), '.card { color: blue; }');
    const second = getBundleHashes({
      baseDir,
      config: { distDir: 'dist' },
    });

    assert.strictEqual(second.js, first.js);
    assert.notStrictEqual(second.css, first.css);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function runTests() {
  const server = new OccupiedPortServer();
  const warnings = [];
  const originalWarn = console.warn;
  let activePort;

  try {
    console.warn = (message) => warnings.push(message);
    listenWithPortFallback(server, 3000, 'localhost', (port) => {
      activePort = port;
    });
  } finally {
    console.warn = originalWarn;
  }

  // `localhost` binds the IPv4 loopback explicitly: resolving the name picks a
  // single family, and on a machine that answers ::1 first every client that
  // reaches for 127.0.0.1 was refused. The IPv6 loopback is added alongside it
  // by listenLoopbackAlias.
  assert.deepStrictEqual(server.attempts, [
    { port: 3000, host: '127.0.0.1' },
    { port: 3001, host: '127.0.0.1' },
  ]);
  assert.strictEqual(activePort, 3001);

  // The bind address a configured host resolves to.
  assert.strictEqual(bindAddressFor('localhost'), '127.0.0.1', 'localhost binds the IPv4 loopback');
  assert.strictEqual(bindAddressFor('0.0.0.0'), '0.0.0.0', 'an explicit address is bound as asked');
  assert.strictEqual(bindAddressFor('::1'), '::1');
  assert.strictEqual(bindAddressFor('example.internal'), 'example.internal');
  assert.strictEqual(warnings.length, 1);
  assert.ok(warnings[0].includes('Port 3000 is already in use'));
  assert.ok(warnings[0].includes('Trying 3001'));
}

async function testCliServeParsing() {
  let lastCall = null;
  class TestCLI extends AvenxCLI {
    serveProject(port, host, open) {
      lastCall = { port, host, open };
    }
  }

  const cli = new TestCLI();

  // Test --port 3000/
  await cli.run('serve', ['--port', '3000/']);
  assert.deepStrictEqual(lastCall, { port: 3000, host: 'localhost', open: false });

  // Test --host localhost/
  await cli.run('serve', ['--host', 'localhost/']);
  assert.deepStrictEqual(lastCall, { port: 3000, host: 'localhost', open: false });

  // Test that -h remains the short form of --host rather than help for serve.
  await cli.run('serve', ['-h', '0.0.0.0']);
  assert.deepStrictEqual(lastCall, { port: 3000, host: '0.0.0.0', open: false });

  // Test trailing slashes and accidental whitespace
  await cli.run('serve', ['--port', ' 3000/ ', '--host', ' 127.0.0.1/ ']);
  assert.deepStrictEqual(lastCall, { port: 3000, host: '127.0.0.1', open: false });

  // Test positional port 3000/
  await cli.run('serve', ['3000/']);
  assert.deepStrictEqual(lastCall, { port: 3000, host: 'localhost', open: false });

  // Test flag assignments --port=8080/ --host=localhost/
  await cli.run('serve', ['--port=8080/', '--host=localhost/']);
  assert.deepStrictEqual(lastCall, { port: 8080, host: 'localhost', open: false });

  // Test --open flag
  await cli.run('serve', ['--open']);
  assert.deepStrictEqual(lastCall, {port: 3000, host: 'localhost', open: true});

  // Test -o flag
  await cli.run('serve', ['-o']);
  assert.deepStrictEqual(lastCall, {port: 3000, host: 'localhost', open: true});
}

function testRequestLoggerFormatting() {
  setColorEnabled(false);
  const testDate = new Date();
  testDate.setHours(14, 23, 5);

  const log200 = formatRequestLog('GET', '/src/main.app.js', 200, 2.4, testDate);
  assert.strictEqual(log200, '[14:23:05] GET /src/main.app.js - 200 (2.4ms)');

  const testDate404 = new Date(testDate);
  testDate404.setHours(14, 23, 6);
  const log404 = formatRequestLog('GET', '/favicon.ico', 404, 1.1, testDate404);
  assert.strictEqual(log404, '[14:23:06] GET /favicon.ico - 404 (1.1ms)');

  setColorEnabled(true);
  const status200 = formatStatusCode(200);
  assert.ok(status200.includes('\x1b[32m200\x1b[39m'), '200 should be green in ANSI');

  const status304 = formatStatusCode(304);
  assert.ok(status304.includes('\x1b[33m304\x1b[39m'), '304 should be yellow in ANSI');

  const status404 = formatStatusCode(404);
  assert.ok(status404.includes('\x1b[31m404\x1b[39m'), '404 should be red in ANSI');

  const status500 = formatStatusCode(500);
  assert.ok(status500.includes('\x1b[31m500\x1b[39m'), '500 should be red in ANSI');
}

function testAttachRequestLogger() {
  setColorEnabled(false);
  const logs = [];
  const mockReq = { method: 'GET', url: '/src/main.app.js' };
  const mockRes = new EventEmitter();
  mockRes.statusCode = 200;

  attachRequestLogger(mockReq, mockRes, (log) => logs.push(log));

  mockRes.emit('finish');
  assert.strictEqual(logs.length, 1);
  assert.ok(logs[0].includes('GET /src/main.app.js - 200'));

  // Ensure double emit finish does not duplicate log
  mockRes.emit('finish');
  assert.strictEqual(logs.length, 1);
}

async function testHttpDevServerRequestLogging() {
  setColorEnabled(false);
  const logs = [];
  const customHeaders = {
    'Access-Control-Allow-Origin': '*',
    'X-Avenx-Test': 'enabled',
  };

  const server = http.createServer((req, res) => {
    attachRequestLogger(req, res, (msg) => logs.push(msg));
    applyCustomHeaders(res, customHeaders);
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html></html>');
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    // Send HTTP GET / request (200)
    const rootHeaders = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/`, (res) => {
        const headers = res.headers;
        res.resume();
        res.on('end', () => resolve(headers));
      }).on('error', reject);
    });

    // Send HTTP GET /favicon.ico request (404)
    const notFoundHeaders = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/favicon.ico`, (res) => {
        const headers = res.headers;
        res.resume();
        res.on('end', () => resolve(headers));
      }).on('error', reject);
    });

    assert.ok(logs.some((l) => l.includes('GET / - 200')), 'Should log GET / - 200');
    assert.ok(logs.some((l) => l.includes('GET /favicon.ico - 404')), 'Should log GET /favicon.ico - 404');
    assert.strictEqual(rootHeaders['access-control-allow-origin'], '*');
    assert.strictEqual(rootHeaders['x-avenx-test'], 'enabled');
    assert.strictEqual(notFoundHeaders['access-control-allow-origin'], '*');
    assert.strictEqual(notFoundHeaders['x-avenx-test'], 'enabled');
  } finally {
    server.close();
  }
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(predicate(), message);
}

async function testWatchProjectInputs() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-watch-project-'));
  fs.mkdirSync(path.join(baseDir, 'src'));
  fs.mkdirSync(path.join(baseDir, 'public'));
  for (const [file, content] of Object.entries({
    'src/main.app.js': '', 'index.html': '<html></html>', 'avenx.config.json': '{}',
    '.env.local': 'API_URL=one', 'public/site.css': 'body {}',
  })) fs.writeFileSync(path.join(baseDir, file), content);

  const reloads = [];
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  let watcher;
  try {
    watcher = watchProject({
      baseDir,
      config: { srcDir: 'src', distDir: 'dist', templatesDir: '.avenxtemplates' },
      liveReloadClients: [{ write: (event) => reloads.push(event) }],
    });
    assert.ok(watcher, 'watchProject should return a closable project watcher');
    fs.appendFileSync(path.join(baseDir, 'index.html'), '<!-- updated -->');
    await waitFor(() => reloads.length === 1, 'editing index.html should reload the page');
    fs.appendFileSync(path.join(baseDir, 'public/site.css'), '\nbody { color: red; }');
    await waitFor(() => reloads.length === 2, 'editing a public asset should reload the page');
    for (const file of ['avenx.config.json', '.env.local']) {
      fs.appendFileSync(path.join(baseDir, file), ' ');
      await waitFor(() => messages.some((message) => message.includes(file) && /restart/i.test(message)), `${file} should require a restart`);
    }
    assert.strictEqual(reloads.length, 2, 'config and env edits must not reload stale output');
  } finally {
    if (watcher) watcher.close();
    console.log = originalLog;
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}


function testSseMessageFraming() {
  // Every message is one SSE frame: a single `data:` line and a blank line.
  // A diagnostic carries a code frame, which is nothing but newlines, and a
  // raw newline in the payload would split the frame and truncate the
  // message. JSON escaping is what keeps that from happening.
  const frame = formatSseMessage({
    type: 'error',
    diagnostics: [{ code: 'AVX_C26', message: 'broken', frame: ' 1 | <a\n   | ^' }],
  });

  assert.ok(frame.startsWith('data: '), 'a message is an SSE data frame');
  assert.ok(frame.endsWith('\n\n'), 'and is terminated by a blank line');

  const payloadLine = frame.slice('data: '.length, -2);
  assert.ok(!payloadLine.includes('\n'), 'the payload occupies exactly one line');
  assert.strictEqual(JSON.parse(payloadLine).diagnostics[0].frame, ' 1 | <a\n   | ^');

  // A plain string is still accepted, so the handshake and any older payload
  // shape keep working.
  assert.strictEqual(formatSseMessage('reload'), 'data: reload\n\n');
}

function testErrorOverlayGate() {
  const withServer = (server) => ({ config: { server } });

  assert.strictEqual(
    isErrorOverlayEnabled(withServer({ liveReload: true, errorOverlay: true })),
    true,
    'the overlay is on for a dev server with live reload',
  );
  assert.strictEqual(
    isErrorOverlayEnabled(withServer({ liveReload: true, errorOverlay: false })),
    false,
    'server.errorOverlay: false switches it off',
  );
  // The overlay is delivered over the live-reload channel and rendered by a
  // snippet injected next to the live-reload client, so without live reload
  // there is nothing to carry it.
  assert.strictEqual(
    isErrorOverlayEnabled(withServer({ liveReload: false, errorOverlay: true })),
    false,
    '--no-live-reload disables the overlay with it',
  );
  assert.strictEqual(isErrorOverlayEnabled({}), false, 'and a cli without config is not a dev server');
}

function testDiagnosticPathShortening() {
  const baseDir = path.join(path.sep, 'home', 'dev', 'app');
  const inside = path.join(baseDir, 'src', 'components', 'card.component.js');

  assert.strictEqual(
    relativeDiagnosticPath(inside, baseDir),
    'src/components/card.component.js',
    'a project path is shown the way the developer refers to it',
  );
  assert.strictEqual(
    relativeDiagnosticPath(path.join(path.sep, 'elsewhere', 'vendor.js'), baseDir),
    path.join(path.sep, 'elsewhere', 'vendor.js'),
    'a path outside the project is left alone',
  );
  assert.strictEqual(relativeDiagnosticPath('bundle.js', baseDir), 'bundle.js');
  assert.strictEqual(relativeDiagnosticPath(null, baseDir), null);
}

function testBuildStatusAndOverlayMessages() {
  const baseDir = path.join(path.sep, 'home', 'dev', 'app');
  const error = {
    severity: 'error',
    code: 'AVX_C26',
    file: path.join(baseDir, 'src', 'components', 'card.component.js'),
    message: 'Malformed template',
  };
  const warning = { severity: 'warning', code: 'AVX_W01', file: 'bundle.js', message: 'too big' };

  const failed = buildStatusFromPass({ ok: false, diagnostics: [warning, error] }, baseDir);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.diagnostics.length, 2, 'a failure shows the warnings alongside the error');
  assert.strictEqual(failed.diagnostics[1].file, 'src/components/card.component.js');

  const succeeded = buildStatusFromPass({ ok: true, diagnostics: [warning] }, baseDir);
  assert.strictEqual(succeeded.ok, true);
  assert.deepStrictEqual(
    succeeded.diagnostics.map((diagnostic) => diagnostic.code),
    ['AVX_W01'],
    'a successful pass keeps only its warnings',
  );

  // One broken save can produce hundreds of warnings; the channel carries the
  // first few and the terminal keeps the rest.
  const many = buildStatusFromPass(
    { ok: true, diagnostics: Array.from({ length: 200 }, () => ({ ...warning })) },
    baseDir,
  );
  assert.strictEqual(many.diagnostics.length, 50, 'the payload is capped');

  assert.deepStrictEqual(overlayMessageFor(failed), { type: 'error', diagnostics: failed.diagnostics });
  assert.deepStrictEqual(overlayMessageFor(succeeded), { type: 'ok', diagnostics: succeeded.diagnostics });
  assert.strictEqual(
    overlayMessageFor({ ok: true, diagnostics: [] }),
    null,
    'a clean build has nothing to say to a client that has no overlay',
  );
  assert.strictEqual(overlayMessageFor(undefined), null);
}

function testOverlayClientScript() {
  const script = getErrorOverlayScript();

  assert.ok(script.includes('<script>') && script.includes('</script>'), 'it is a script element');
  assert.ok(script.includes("'__avenx-error-overlay'"), 'under one distinctive element id');
  assert.ok(script.includes('window.__avenxDevOverlay'), 'and exposes the overlay to the live-reload client');

  // The diagnostic text is compiler output quoting the developer's own source,
  // so it is escaped before it reaches the document. An overlay that rendered
  // a broken template as markup would be a script-execution sink on the dev
  // server's origin.
  assert.ok(script.includes("replace(/</g, '&lt;')"), 'diagnostic text is HTML-escaped');
  assert.ok(script.includes("replace(/>/g, '&gt;')"));
  assert.ok(script.includes("replace(/&/g, '&amp;')"));

  // An important declaration in a style attribute outranks any author rule,
  // so the application cannot hide the overlay -- which matters most when the
  // application's stylesheet is exactly what failed to build.
  assert.ok(script.includes("join(' !important;')"), 'the overlay styles itself with important declarations');
  assert.ok(script.includes('position: fixed'), 'and is positioned outside the application layout');

  // Warnings must not take the page away from the developer.
  assert.ok(script.includes('pointer-events: none'), 'the warning presentation passes clicks through');

  // The overlay cannot depend on the application: the application may be
  // exactly what failed to compile.
  assert.ok(!script.includes('bundle.css'), 'it loads no application stylesheet');
  assert.ok(!script.includes('import '), 'and no module');
}

function testDiagnosticCodeFrames() {
  // The compiler appends the caret frame to the message. The overlay renders
  // it as code rather than as prose, so the two are separated here.
  const split = splitCodeFrame('Malformed template\n\n 18 | \n 19 | <broken\n    | ^');
  assert.strictEqual(split.message, 'Malformed template');
  assert.strictEqual(split.frame, ' 18 | \n 19 | <broken\n    | ^');

  const plain = splitCodeFrame('Nothing to see here.');
  assert.strictEqual(plain.message, 'Nothing to see here.');
  assert.strictEqual(plain.frame, null);

  const error = new Error('[AVX_C26] Malformed template at src/a.component.js:19:1\n\n 19 | <broken\n    | ^');
  error.code = 'AVX_C26';
  const diagnostic = parseDiagnostic('error', [error]);
  assert.strictEqual(diagnostic.code, 'AVX_C26');
  assert.strictEqual(diagnostic.severity, 'error');
  assert.strictEqual(diagnostic.line, 19);
  assert.strictEqual(diagnostic.column, 1);
  assert.strictEqual(diagnostic.frame, ' 19 | <broken\n    | ^');
  assert.ok(!diagnostic.message.includes('^'), 'the frame is no longer part of the message');
}


/**
 * Creates a minimal project the compiler can actually build.
 * @param {string} prefix - Temporary directory prefix.
 * @returns {{baseDir: string, componentPath: string, component: string}}
 */
function createBuildableProject(prefix) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(baseDir, 'src/components/mini-card'), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, 'src/main.app.js'),
    "import { AvenxApp } from 'avenx-core/runtime';\n"
      + "import MiniCard from './components/mini-card/mini-card.component.js';\n\n"
      + "const app = new AvenxApp({ target: '#app' });\n"
      + "app.register('MiniCard', MiniCard);\n",
  );
  const component = '<div class="mini-card">Hello</div>\n';
  const componentPath = path.join(baseDir, 'src/components/mini-card/mini-card.component.js');
  fs.writeFileSync(componentPath, component);
  fs.writeFileSync(path.join(baseDir, 'index.html'), '<html><body><div id="app"></div></body></html>');
  fs.writeFileSync(path.join(baseDir, 'avenx.config.json'), '{}');
  return { baseDir, componentPath, component };
}

/**
 * Builds the watcher's view of a dev server for the overlay tests.
 * @param {string} baseDir - Project root.
 * @param {boolean} errorOverlay - The server.errorOverlay setting.
 * @param {string[]} sent - Collects the raw SSE frames.
 * @returns {object} A cli stand-in.
 */
function overlayCli(baseDir, errorOverlay, sent) {
  return {
    baseDir,
    config: {
      rootDir: baseDir,
      srcDir: 'src',
      distDir: 'dist',
      templatesDir: '.avenxtemplates',
      style: {},
      server: { liveReload: true, errorOverlay },
    },
    liveReloadClients: [{ write: (frame) => sent.push(frame) }],
  };
}

/**
 * Reads the SSE frames collected so far as parsed messages.
 * @param {string[]} sent - Raw frames.
 * @returns {object[]} Parsed payloads.
 */
function sseMessages(sent) {
  return sent.map((frame) => {
    const payload = frame.replace(/^data: /, '').replace(/\n\n$/, '');
    try {
      return JSON.parse(payload);
    } catch {
      return { type: payload };
    }
  });
}

async function testWatchProjectBroadcastsDiagnostics() {
  const { baseDir, componentPath, component } = createBuildableProject('avenx-overlay-messages-');
  const sent = [];
  const cli = overlayCli(baseDir, true, sent);

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  let watcher;
  try {
    watcher = watchProject(cli);
    assert.ok(watcher, 'the watcher starts');

    // A template the compiler cannot parse: the browser is told what broke
    // instead of quietly reloading the last good bundle.
    fs.writeFileSync(componentPath, `${component}\n<broken syntax`);
    await waitFor(
      () => sseMessages(sent).some((message) => message.type === 'error'),
      'a failed rebuild broadcasts an error message',
    );

    const failure = sseMessages(sent).find((message) => message.type === 'error');
    const diagnostic = failure.diagnostics.find((entry) => entry.severity === 'error');
    assert.ok(diagnostic, 'the message carries the error diagnostic');
    assert.ok(/^AVX_[A-Z0-9]+$/.test(diagnostic.code), `a searchable code, got ${diagnostic.code}`);
    assert.strictEqual(
      diagnostic.file,
      'src/components/mini-card/mini-card.component.js',
      'named by its project-relative path',
    );
    assert.ok(diagnostic.message.length > 0, 'with a message');
    assert.ok(diagnostic.frame && diagnostic.frame.includes('|'), 'and the caret code frame');
    assert.strictEqual(cli.buildStatus.ok, false, 'the server remembers that the build is broken');
    assert.ok(
      !sseMessages(sent).some((message) => message.type === 'reload'),
      'and the page is not reloaded onto a stale bundle',
    );

    // The next good save clears the overlay and reloads.
    sent.length = 0;
    fs.writeFileSync(componentPath, component.replace('Hello', 'Recovered'));
    await waitFor(
      () => sseMessages(sent).some((message) => message.type === 'reload'),
      'a repaired build reloads the page',
    );

    const types = sseMessages(sent).map((message) => message.type);
    assert.ok(types.includes('ok'), 'and clears the overlay first');
    assert.ok(types.indexOf('ok') < types.indexOf('reload'), 'the clear is sent before the reload');
    assert.strictEqual(cli.buildStatus.ok, true);
  } finally {
    if (watcher) watcher.close();
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

async function testWatchProjectWithoutOverlay() {
  const { baseDir, componentPath, component } = createBuildableProject('avenx-overlay-disabled-');
  const sent = [];
  const cli = overlayCli(baseDir, false, sent);

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  let watcher;
  try {
    watcher = watchProject(cli);

    // With the option off the dev server behaves exactly as it did before the
    // overlay existed: a failed rebuild is a terminal matter and the browser
    // hears nothing at all.
    fs.writeFileSync(componentPath, `${component}\n<broken syntax`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.deepStrictEqual(sent, [], 'a failed rebuild sends nothing');

    fs.writeFileSync(componentPath, component.replace('Hello', 'Recovered'));
    await waitFor(
      () => sseMessages(sent).some((message) => message.type === 'reload'),
      'a repaired build still reloads the page',
    );
    assert.ok(
      !sseMessages(sent).some((message) => message.type === 'ok' || message.type === 'error'),
      'and no overlay message is ever sent',
    );
  } finally {
    if (watcher) watcher.close();
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

async function main() {
  try {
    testGetInitialHtmlLanguage();
    testBundleHashes();
    testSseMessageFraming();
    testErrorOverlayGate();
    testDiagnosticPathShortening();
    testBuildStatusAndOverlayMessages();
    testOverlayClientScript();
    testDiagnosticCodeFrames();
    testRequestLoggerFormatting();
    testAttachRequestLogger();
    await testHttpDevServerRequestLogging();
    await testWatchProjectInputs();
    await testWatchProjectBroadcastsDiagnostics();
    await testWatchProjectWithoutOverlay();
    runTests();
    await testCliServeParsing();
    console.log('Dev server port fallback, request logger formatting, HTTP request logging, error-overlay payloads, and CLI serve sanitization tests passed!');
  } catch (error) {
    console.error('Dev server tests failed!');
    console.error(error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
