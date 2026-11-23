import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Hashes the emitted JavaScript and CSS bundles for live-reload decisions.
 * @param {object} cli
 * @returns {{js: string, css: string}}
 */
export function getBundleHashes(cli) {
  const distDir = path.resolve(cli.baseDir, cli.config.distDir || 'dist');
  const hashFile = (name) =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(distDir, name))).digest('hex');

  return {
    js: hashFile('bundle.js'),
    css: hashFile('bundle.css'),
  };
}

/**
 * Checks whether a resolved path is the project root itself or sits beneath it.
 * @param {string} root - Absolute, resolved project root.
 * @param {string} target - Absolute, resolved candidate path.
 * @returns {boolean}
 */
function isInsideRoot(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Resolves an incoming request URL to a file path inside the project directory.
 *
 * The request target is parsed as a URL so query strings and fragments never
 * leak into the filesystem path, percent-encoding is decoded before the
 * containment check, and the resolved path is required to stay within the
 * project root. Node does not normalize `req.url`, so `..` segments would
 * otherwise be resolved by `path.join` and escape the project directory.
 * @param {string} baseDir - The project root directory.
 * @param {string} requestUrl - The raw request target from `req.url`.
 * @returns {string|null} An absolute path inside the project, or null when the
 *   request is malformed or attempts to escape the root.
 */
export function resolveRequestPath(baseDir, requestUrl) {
  const root = path.resolve(baseDir);

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://localhost').pathname);
  } catch {
    // Malformed percent-encoding.
    return null;
  }

  if (pathname.includes('\0')) {
    return null;
  }

  const relative = pathname.replace(/^\/+/, '');
  let filePath = relative === '' ? path.join(root, 'index.html') : path.resolve(root, relative);

  if (!isInsideRoot(root, filePath)) {
    return null;
  }

  // SPA fallback: extensionless paths that do not exist serve the entry document.
  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    filePath = path.join(root, 'index.html');
  }

  if (isDeniedProjectPath(root, filePath)) {
    return null;
  }

  return filePath;
}

/**
 * Returns true when a resolved path should not be served from the project root.
 * Dot segments, node_modules, and package manifests are refused after containment.
 * @param {string} root
 * @param {string} filePath
 * @returns {boolean}
 */
export function isDeniedProjectPath(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return true;
  }

  const segments = relative.split(path.sep).filter(Boolean);
  const deniedFiles = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json']);

  for (const segment of segments) {
    if (segment === 'node_modules' || segment.startsWith('.')) {
      return true;
    }
    if (deniedFiles.has(segment)) {
      return true;
    }
  }

  return false;
}

/**
 * Whether a request to a state-changing dev-server endpoint may be honoured.
 *
 * The trace ingest endpoint writes a file to `.avenx/traces`, and that file is
 * later turned into JavaScript by `avenx trace export`. A POST from a page on
 * another origin is a cross-site request: the browser sends it happily, so any
 * site the developer visits while `avenx serve --trace` runs could plant a
 * trace. Same-origin requests carry either no `Origin` (same-origin fetch in
 * some browsers) or one matching the host serving the page.
 * @param {object} req - The incoming request.
 * @returns {boolean} True when the request originates from this server.
 */
export function isSameOriginRequest(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) {
    // No Origin header at all: not a cross-site browser request.
    return true;
  }
  if (origin === 'null') {
    // An opaque origin -- a sandboxed iframe or a data: URL -- is not this
    // server, and is exactly what an attacker page would present.
    return false;
  }
  const host = req.headers && req.headers.host;
  if (!host) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Serves one contained file, with an explicit HTML transform. */
export function serveStaticFile(baseDir, requestUrl, res, privateFiles, injectHtml) {
  const filePath = resolveRequestPath(baseDir, requestUrl);

  if (filePath === null) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // A configured private key may live under the project root. It and aliases
  // to it must never be served as static assets.
  if (privateFiles) {
    try {
      if (privateFiles.has(fs.realpathSync(filePath))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
    } catch {
      // Missing/unreadable files keep the normal file-response handling below.
    }
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error: ' + error.code);
      }
    } else {
      let responseContent = content;
      // Compared against the extension rather than the full Content-Type:
      // the mime map returns 'text/html; charset=utf-8', so an equality test
      // against 'text/html' was never true and live reload was silently dead
      // for every page the dev server served.
      if (extname === '.html') {
        responseContent = injectHtml(content);
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(responseContent, 'utf-8');
    }
  });
}
