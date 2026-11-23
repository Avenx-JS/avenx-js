import assert from 'assert';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { once } from 'events';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { AvenxCLI } from '../../bin/cli.js';
import { serveProject } from '../../bin/commands/serve.js';
import loadConfig from '../../lib/config.js';

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-https-'));
const configPath = path.join(baseDir, 'avenx.config.json');
const fixtureDir = fileURLToPath(new URL('../fixtures/https/', import.meta.url));
const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const oldNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';

/**
 * Fetches one response, or just the first SSE event for a streaming endpoint.
 * @param {object} transport - HTTP or HTTPS module.
 * @param {object} options - Request options.
 * @param {boolean} [stream] - Whether to stop after the first chunk.
 * @returns {Promise<object>} The status, headers and body.
 */
function request(transport, options, stream = false) {
  return new Promise((resolve, reject) => {
    const req = transport.get({ ...options, rejectUnauthorized: false }, (res) => {
      let body = '';
      const finish = () => resolve({ status: res.statusCode, headers: res.headers, body });
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (stream) {
          finish();
          res.destroy();
          req.destroy();
        }
      });
      res.on('end', finish);
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
  });
}

/**
 * Closes the primary server, optional IPv6 listener, and file watcher.
 * @param {object} cli - The running CLI instance.
 * @param {object} server - The primary listener.
 * @returns {Promise<void>}
 */
async function stop(cli, server) {
  cli._watcher?.close();
  for (const listener of [server, cli._loopbackAlias]) {
    if (!listener) continue;
    listener.closeAllConnections();
    await new Promise((resolve) => listener.close(resolve));
  }
}

try {
  fs.writeFileSync(path.join(baseDir, 'package.json'), '{"name":"https-test","type":"module"}');
  assert.strictEqual(loadConfig(baseDir).server.https, false);
  for (const server of [{ https: 'true' }, { cert: '' }, { cert: 5 }, { key: null }, { key: [] }]) {
    fs.writeFileSync(configPath, JSON.stringify({ server }));
    assert.throws(() => loadConfig(baseDir), /server\.(https|cert|key) must be/);
  }
  fs.unlinkSync(configPath);

  class ParsingCLI extends AvenxCLI {
    serveProject(port, host, open) {
      this.calledWith = { port, host, open };
    }
  }
  for (const args of [
    ['--https', '--cert', '4567', '--key', 'key.pem', '8123', '--open'],
    ['--https', '--cert=4567', '--key=key.pem', '8123', '--open'],
  ]) {
    const cli = new ParsingCLI({ baseDir });
    await cli.run('serve', args);
    assert.strictEqual(cli.config.server.https, true);
    assert.strictEqual(cli.config.server.cert, '4567');
    assert.strictEqual(cli.config.server.key, 'key.pem');
    assert.deepStrictEqual(cli.calledWith, { port: 8123, host: 'localhost', open: true });
  }
  for (const args of [['--https', '--cert'], ['--https', '--key='], ['--cert', '--key', 'key.pem']]) {
    await assert.rejects(new ParsingCLI({ baseDir }).run('serve', args), /requires a file path/);
  }
  const missingPair = new AvenxCLI({ baseDir });
  missingPair.config.server.https = true;
  assert.throws(() => serveProject(missingPair, 0), /HTTPS requires.*mkcert/);
  assert.strictEqual(missingPair._watcher, undefined);
  missingPair.config.server.cert = 'absent.pem';
  missingPair.config.server.key = 'absent-key.pem';
  assert.throws(() => serveProject(missingPair, 0), /Cannot load HTTPS certificate\/key/);

  execFileSync(process.execPath, [bin, 'init'], { cwd: baseDir, stdio: 'pipe' });
  for (const name of ['server-cert.pem', 'server-key.pem']) {
    fs.copyFileSync(path.join(fixtureDir, name), path.join(baseDir, name));
  }
  fs.writeFileSync(configPath, JSON.stringify({
    server: { https: true, cert: './server-cert.pem', key: './server-key.pem' },
  }));
  const cli = new AvenxCLI({ baseDir });
  const server = serveProject(cli, 0);
  try {
    await once(server, 'listening');
    const options = { host: '127.0.0.1', port: server.address().port };
    const page = await request(https, { ...options, path: '/' });
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('new EventSource'));
    assert.strictEqual((await request(https, { ...options, path: '/__avenx-inspect' })).status, 200);
    const sse = await request(https, { ...options, path: '/__avenx_live_reload__' }, true);
    assert.strictEqual(sse.headers['content-type'], 'text/event-stream');
    assert.ok(sse.body.includes('connected'));
    for (const url of ['/server-key.pem', '/server-cert.pem', '/server%2dkey.pem?download=1']) {
      assert.strictEqual((await request(https, { ...options, path: url })).status, 403);
    }
    let hasAlias = false;
    try {
      fs.symlinkSync(path.join(baseDir, 'server-key.pem'), path.join(baseDir, 'alias.pem'));
      hasAlias = true;
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
    }
    if (hasAlias) {
      assert.strictEqual((await request(https, { ...options, path: '/alias.pem' })).status, 403);
    }
    if (cli._loopbackAlias?.listening) {
      assert.strictEqual((await request(https, { ...options, host: '::1', path: '/' })).status, 200);
    }
  } finally {
    await stop(cli, server);
  }

  fs.unlinkSync(configPath);
  const plainCli = new AvenxCLI({ baseDir });
  plainCli.config.server.liveReload = false;
  const plainServer = serveProject(plainCli, 0, '127.0.0.1');
  try {
    await once(plainServer, 'listening');
    assert.strictEqual((await request(http, {
      host: '127.0.0.1', port: plainServer.address().port, path: '/',
    })).status, 200);
  } finally {
    await stop(plainCli, plainServer);
  }
  console.log('HTTPS configuration, CLI, live endpoints, private files and HTTP default passed');
} finally {
  if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = oldNodeEnv;
  fs.rmSync(baseDir, { recursive: true, force: true });
}
