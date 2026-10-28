import assert from 'assert';
import http from 'http';
import { EventEmitter } from 'events';
import { bindAddressFor, listenWithPortFallback, formatStatusCode, formatRequestLog, attachRequestLogger, applyCustomHeaders, getInitialHtml } from '../../bin/commands/serve.js';
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

async function main() {
  try {
    testGetInitialHtmlLanguage();
    testRequestLoggerFormatting();
    testAttachRequestLogger();
    await testHttpDevServerRequestLogging();
    runTests();
    await testCliServeParsing();
    console.log('Dev server port fallback, request logger formatting, HTTP request logging, and CLI serve sanitization tests passed!');
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
