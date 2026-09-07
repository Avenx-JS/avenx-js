import assert from 'assert';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import http from 'http';
import { resolveRequestPath, isDeniedProjectPath } from '../../bin/commands/serve.js';

/**
 * Regression coverage for the development server joining the raw request target
 * onto the project root. Node does not normalize `req.url`, so `..` segments
 * survived into `path.join` and any reachable client could read files outside
 * the project directory.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-serve-'));
const projectDir = path.join(tmpRoot, 'project');
const assetsDir = path.join(projectDir, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(path.join(projectDir, 'index.html'), '<html><body>app</body></html>');
fs.writeFileSync(path.join(assetsDir, 'app.js'), 'console.log("app");');
fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), 'SECRET OUTSIDE PROJECT ROOT');

/**
 * Traversal attempts must be rejected rather than resolved.
 */
function testTraversalIsRejected() {
  console.log('🧪 Testing path traversal attempts are rejected...');

  const attempts = [
    '/../secret.txt',
    '/../../../../../../../../etc/hosts',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%2fsecret.txt',
    '/....//secret.txt',
    '/\\../secret.txt',
  ];

  const root = path.resolve(projectDir);
  const secretOutside = path.join(tmpRoot, 'secret.txt');

  for (const attempt of attempts) {
    const resolved = resolveRequestPath(projectDir, attempt);

    // Either the request is refused outright, or it is confined to the project
    // root. Some forms are normalized to a harmless in-root path by URL parsing
    // (which is a safe outcome, not a bypass) — what must never happen is a
    // resolved path escaping the root.
    if (resolved !== null) {
      assert.ok(
        resolved === root || resolved.startsWith(root + path.sep),
        `"${attempt}" resolved outside the project root: ${resolved}`,
      );
      assert.notStrictEqual(resolved, secretOutside, `"${attempt}" reached the file outside the root`);
    }
  }
  console.log(`  ✅ ${attempts.length} traversal attempts contained.`);
}

/**
 * Legitimate requests must still resolve normally.
 */
function testLegitimateRequestsResolve() {
  console.log('🧪 Testing legitimate requests still resolve...');

  assert.strictEqual(resolveRequestPath(projectDir, '/'), path.join(projectDir, 'index.html'));
  assert.strictEqual(resolveRequestPath(projectDir, '/assets/app.js'), path.join(assetsDir, 'app.js'));
  assert.strictEqual(resolveRequestPath(projectDir, '/index.html'), path.join(projectDir, 'index.html'));

  // SPA fallback for extensionless routes that do not exist on disk.
  assert.strictEqual(resolveRequestPath(projectDir, '/dashboard'), path.join(projectDir, 'index.html'));
  console.log('  ✅ Normal paths and the SPA fallback still resolve.');
}

/**
 * Query strings must not leak into the filesystem path or the MIME lookup.
 */
function testQueryStringsAreStripped() {
  console.log('🧪 Testing query strings and fragments are stripped...');

  assert.strictEqual(resolveRequestPath(projectDir, '/assets/app.js?v=2'), path.join(assetsDir, 'app.js'));
  assert.strictEqual(resolveRequestPath(projectDir, '/assets/app.js#anchor'), path.join(assetsDir, 'app.js'));
  assert.strictEqual(
    path.extname(resolveRequestPath(projectDir, '/assets/app.js?v=2')),
    '.js',
    'cache-busting query must not break MIME detection',
  );
  console.log('  ✅ Query strings and fragments stripped.');
}

/**
 * Malformed encodings must be rejected, not thrown out of the request handler.
 */
function testMalformedRequestsAreRejected() {
  console.log('🧪 Testing malformed request targets are rejected...');

  assert.strictEqual(resolveRequestPath(projectDir, '/%E0%A4%A'), null, 'malformed percent-encoding should be rejected');
  assert.strictEqual(resolveRequestPath(projectDir, '/foo%00.js'), null, 'null bytes should be rejected');
  console.log('  ✅ Malformed targets rejected.');
}

/**
 * End-to-end check against a real server using the production request handler,
 * driven by a raw socket so the client does not normalize the path first.
 */
async function testLiveServerRejectsTraversal() {
  console.log('🧪 Testing a live server refuses to serve files outside the root...');

  const server = http.createServer((req, res) => {
    const filePath = resolveRequestPath(projectDir, req.url);
    if (filePath === null) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(200);
        res.end(content);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  /**
   * Issues a raw HTTP request without client-side path normalization.
   * @param {string} target - Raw request target.
   * @returns {Promise<string>} The full response text.
   */
  const rawRequest = (target) =>
    new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`GET ${target} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n`);
      });
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk;
      });
      socket.on('end', () => resolve(buffer));
      socket.on('error', reject);
    });

  try {
    const ok = await rawRequest('/');
    assert.ok(ok.includes('200'), 'the index document should still be served');
    assert.ok(ok.includes('<body>app</body>'), 'index content should be returned');

    // A traversal attempt must never return content from outside the project.
    // It may legitimately 403, 404, or fall back to the SPA entry document.
    const outsideContent = fs.readFileSync(path.join(tmpRoot, 'secret.txt'), 'utf-8');
    const hostsContent = fs.existsSync('/etc/hosts') ? fs.readFileSync('/etc/hosts', 'utf-8').slice(0, 40) : null;

    for (const target of ['/../secret.txt', '/assets/../../secret.txt', '/../../../../../../../etc/hosts']) {
      const response = await rawRequest(target);
      assert.ok(!response.includes(outsideContent), `${target} leaked a file outside the root`);
      if (hostsContent) {
        assert.ok(!response.includes(hostsContent), `${target} leaked /etc/hosts`);
      }
    }
    console.log('  ✅ Live server contained traversal while still serving the app.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Sensitive project files must not be served even when they sit inside the root.
 */
function testSensitiveProjectFilesAreDenied() {
  console.log('Testing sensitive project files are denied...');

  fs.writeFileSync(path.join(projectDir, '.env'), 'SECRET=1');
  fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.git', 'config'), '[core]');
  fs.mkdirSync(path.join(projectDir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'node_modules', 'x', 'index.js'), 'export {}');
  fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"demo"}');

  const denied = ['/.env', '/.git/config', '/node_modules/x/index.js', '/package.json'];
  for (const attempt of denied) {
    assert.strictEqual(resolveRequestPath(projectDir, attempt), null, `${attempt} must be denied`);
  }

  assert.strictEqual(
    resolveRequestPath(projectDir, '/index.html'),
    path.join(projectDir, 'index.html'),
    'application files must still resolve',
  );
  assert.strictEqual(
    resolveRequestPath(projectDir, '/assets/app.js'),
    path.join(assetsDir, 'app.js'),
    'assets must still resolve',
  );

  assert.ok(isDeniedProjectPath(projectDir, path.join(projectDir, '.env')));
  assert.ok(!isDeniedProjectPath(projectDir, path.join(projectDir, 'index.html')));
  console.log('  sensitive project files denied.');
}

(async () => {
  try {
    testTraversalIsRejected();
    testLegitimateRequestsResolve();
    testQueryStringsAreStripped();
    testMalformedRequestsAreRejected();
    testSensitiveProjectFilesAreDenied();
    await testLiveServerRejectsTraversal();
    console.log('🎉 All dev server path traversal tests passed successfully!');
  } catch (err) {
    console.error('❌ Dev server path traversal test failed:', err);
    process.exit(1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})();
