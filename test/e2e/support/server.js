/**
 * Static file server for the compiled fixture applications.
 *
 * Deliberately dumb: it serves what is on disk under `test/e2e/apps` and
 * returns a real 404 for anything else. The previous server fell back to a
 * routing fixture for any extensionless path, so a typo in a test URL returned
 * HTTP 200 and the wrong document -- tests then failed for reasons that had
 * nothing to do with the framework. Avenx routes on the hash, so an SPA
 * fallback buys nothing and costs exactly that clarity.
 * @module test/e2e/support/server
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { APPS_DIR } from './apps.js';

const PORT = Number(process.env.E2E_PORT) || 3100;

/**
 * Content types for the files a compiled Avenx app serves.
 * @type {Object<string, string>}
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Resolves a request path to a file inside the apps directory.
 *
 * Returns null when the path escapes the served root, so a traversal attempt
 * is a 404 rather than a read of an arbitrary repository file.
 * @param {string} pathname - The decoded request path.
 * @returns {string|null} An absolute path inside APPS_DIR, or null.
 */
function resolveFile(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const absolute = path.resolve(APPS_DIR, relative);
  const root = path.resolve(APPS_DIR);

  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    return null;
  }
  return absolute;
}

/**
 * Writes a plain-text response.
 * @param {import('http').ServerResponse} res - The response.
 * @param {number} status - HTTP status code.
 * @param {string} body - Response body.
 * @returns {void}
 */
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (pathname === '/health') {
    send(res, 200, 'ok');
    return;
  }

  const filePath = resolveFile(pathname);
  if (!filePath) {
    send(res, 404, 'Not Found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        send(res, 404, `Not Found: ${pathname}`);
      } else {
        send(res, 500, `Internal Server Error: ${err.message}`);
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      // Fixture bundles are rebuilt every run; a cached one would be a lie.
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[e2e] serving fixture apps from ${APPS_DIR} on http://localhost:${PORT}`);
});
