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
import { APPS_DIR, headersFor } from './apps.js';

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

/**
 * Writes a JSON response with cache disabled.
 * @param {import('http').ServerResponse} res - The response.
 * @param {number} status - HTTP status code.
 * @param {any} body - JSON payload.
 * @returns {void}
 */
function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

let flakyArmed = true;
let pollCounter = 0;

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (pathname === '/health') {
    send(res, 200, 'ok');
    return;
  }

  if (pathname === '/api/rewind') {
    sendJson(res, 200, { ok: searchParams.get('outcome') === 'success' });
    return;
  }

  if (pathname === '/api/delay') {
    const ms = Number(searchParams.get('ms')) || 100;
    const val = searchParams.get('val') || 'delayed data';
    const timer = setTimeout(() => {
      sendJson(res, 200, { data: val });
    }, ms);
    req.on('close', () => clearTimeout(timer));
    return;
  }

  if (pathname === '/api/flaky') {
    if (flakyArmed) {
      send(res, 500, 'Internal Server Error: Flaky endpoint failure');
    } else {
      sendJson(res, 200, { message: 'recovered data' });
    }
    return;
  }

  if (pathname === '/api/flaky/arm') {
    flakyArmed = true;
    sendJson(res, 200, { status: 'armed' });
    return;
  }

  if (pathname === '/api/flaky/recover') {
    flakyArmed = false;
    sendJson(res, 200, { status: 'recovered' });
    return;
  }

  if (pathname === '/api/user') {
    const id = searchParams.get('id') || '1';
    sendJson(res, 200, { id, name: `User ${id}` });
    return;
  }

  if (pathname === '/api/search') {
    const q = searchParams.get('q') || '';
    const delay = Number(searchParams.get('delay')) || 50;
    const timer = setTimeout(() => {
      sendJson(res, 200, { query: q, result: `Result for ${q}` });
    }, delay);
    req.on('close', () => clearTimeout(timer));
    return;
  }

  if (pathname === '/api/poll') {
    pollCounter++;
    sendJson(res, 200, { count: pollCounter });
    return;
  }

  if (pathname === '/api/poll/reset') {
    pollCounter = 0;
    sendJson(res, 200, { status: 'reset' });
    return;
  }

  if (pathname === '/api/profile') {
    sendJson(res, 200, { name: 'Alice', role: 'Engineer' });
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
      // Per-app headers, declared beside the app in apps.js. The CSP fixture
      // is the only one that uses them, and it needs a real header: a <meta>
      // CSP cannot express everything a deployment's policy does, and is not
      // what a deployment sends.
      ...headersFor(pathname),
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[e2e] serving fixture apps from ${APPS_DIR} on http://localhost:${PORT}`);
});
