import { isErrorOverlayEnabled, buildStatusFromPass, overlayMessageFor, getErrorOverlayScript } from './serve/overlay/index.js';
export { isErrorOverlayEnabled, buildStatusFromPass, overlayMessageFor, getErrorOverlayScript, relativeDiagnosticPath } from './serve/overlay/index.js';
import { getInspectorHtml } from './serve/inspector/index.js';
export { getInspectorHtml, escapeInlineJson } from './serve/inspector/index.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { createSecureContext } from 'tls';
import { spawn } from 'child_process';
import { runBuildPass } from './build.js';
import { reportRebuildFailure } from '../fatal.js';
import { cyan, green, yellow, red, gray } from '../colors.js';
import { watchDirectories } from '../utils.js';
import { saveTrace } from '../../lib/core/trace/store.js';
import { TRACE_ENDPOINT } from '../../lib/core/trace/devtools.js';

/**
 * The largest request body the trace ingest endpoint will buffer.
 *
 * A recording is bounded by the recorder's ring buffer, so anything larger is
 * not a trace and must not be accumulated in memory.
 * @type {number}
 */
const MAX_TRACE_BYTES = 32 * 1024 * 1024;

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

/**
 * Formats an HTTP response status code with ANSI colors.
 * @param {number|string} status
 * @returns {string}
 */
export function formatStatusCode(status) {
  const code = Number(status) || 0;
  if (code >= 200 && code < 300) {
    return green(code);
  }
  if (code >= 300 && code < 400) {
    return yellow(code);
  }
  if (code >= 400) {
    return red(code);
  }
  return String(code);
}

/**
 * Formats a log line for an incoming HTTP request.
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - Request URL path.
 * @param {number|string} statusCode - Response HTTP status code.
 * @param {number} durationMs - Execution time in milliseconds.
 * @param {Date} [date] - Timestamp date object.
 * @returns {string} The formatted log string.
 */
export function formatRequestLog(method, url, statusCode, durationMs, date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const timestamp = `[${hours}:${minutes}:${seconds}]`;

  const formattedStatus = formatStatusCode(statusCode);
  const formattedDuration = `${Number(durationMs || 0).toFixed(1)}ms`;

  return `${timestamp} ${method} ${url} - ${formattedStatus} (${formattedDuration})`;
}

/**
 * Attaches an HTTP request logging listener to a response object.
 * @param {object} req
 * @param {object} res
 * @param {Function} [logger] - Custom logger function.
 * @returns {Function} Completion logger handler.
 */
export function attachRequestLogger(req, res, logger = console.log) {
  const startTime = performance.now();
  let logged = false;

  const logResponse = () => {
    if (logged) return;
    logged = true;
    const durationMs = performance.now() - startTime;
    const statusCode = res.statusCode || 200;
    const method = req.method || 'GET';
    const url = req.url || '/';
    const logLine = formatRequestLog(method, url, statusCode, durationMs);
    logger(logLine);
  };

  res.on('finish', logResponse);
  res.on('close', () => {
    if (!res.writableEnded) {
      logResponse();
    }
  });

  return logResponse;
}

/**
 * Applies configured custom headers to an HTTP response.
 * @param {object} res - Node HTTP response object.
 * @param {object} [headers] - Header name/value pairs from server.headers.
 */
export function applyCustomHeaders(res, headers = {}) {
  for (const [name, value] of Object.entries(headers || {})) {
    res.setHeader(name, value);
  }
}

/**
 * The command that opens a URL in the default browser, per platform.
 *
 * None of them goes through a shell. `start`, the obvious Windows choice, is a
 * cmd.exe builtin and needs `shell: true` -- and then Node concatenates the
 * arguments into a cmd command line unescaped, so an `&` in the configured
 * host would start a second command. `explorer.exe` is a real executable that
 * opens a URL with the registered handler, so it is spawned directly.
 * @param {string} platform - A `process.platform` value.
 * @returns {string} The executable to spawn with the URL as its argument.
 */
export function browserOpener(platform) {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'explorer.exe';
  return 'xdg-open';
}

/**
 * Opens the browser to the specified URL.
 * @param {string} url - The URL to open.
 * @param {object} [options] - Seams for tests.
 * @param {string} [options.platform] - Overrides `process.platform`.
 * @param {Function} [options.spawnImpl] - Overrides `child_process.spawn`.
 * @returns {void}
 */
export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  // The URL is an argument, never part of a command string, so nothing in the
  // configured host can reach a shell on any platform.
  const child = spawnImpl(browserOpener(platform), [url], { shell: false, stdio: 'ignore', detached: true });
  // A missing opener (no xdg-open on a headless box) must not crash the server
  // the developer asked for; the URL is printed either way.
  child.on?.('error', () => {});
  child.unref();
}

/**
 * Generates the default index.html template content.
 * @param {object} cli
 * @returns {string} The initial HTML template string.
 */
export function getInitialHtml(cli) {
  const dist = (cli.config.distDir || 'dist').replace(/\\/g, '/');
  const name = cli.config.outputName || 'bundle';
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Avenx App</title>
    <link rel="stylesheet" href="${dist}/${name}.css">
</head>
<body>
    <div id="app"></div>
    <script src="${dist}/${name}.js"></script>
</body>
</html>`;
}


/**
 * Serialises one live-reload message as an SSE frame.
 *
 * Objects are sent as JSON. `JSON.stringify` escapes every newline inside the
 * payload, so a code frame -- which is nothing but newlines -- cannot break
 * out of the single `data:` line an SSE frame allows.
 * @param {object|string} payload - The message to send.
 * @returns {string} The complete SSE frame, terminator included.
 */
export function formatSseMessage(payload) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return `data: ${data}\n\n`;
}

/**
 * The project-root files the dev server actually depends on. Everything else
 * in the root is ignored by the watcher, so a log file, an editor backup or a
 * build artifact written there cannot reload the page -- and a server whose
 * output lands in the project directory cannot drive itself into a reload loop.
 * An allowlist, not a denylist: the next noisy filename is always one nobody
 * thought of in advance.
 */
const ROOT_RELOAD_FILES = new Set(['index.html']);
const ROOT_RESTART_FILES = new Set(['avenx.config.json', 'package.json']);

const isRootRestartFile = (filename) => ROOT_RESTART_FILES.has(filename) || /^\.env(?:\.|$)/.test(filename);

const isWatchedRootFile = (filename) => ROOT_RELOAD_FILES.has(filename) || isRootRestartFile(filename);

/**
 * Watches the src directory for changes and triggers a rebuild.
 * @param {object} cli
 */
export function watchProject(cli) {
  let timeout;
  let pendingChange = null;
  const baseDir = path.resolve(cli.baseDir);
  const srcPath = path.join(baseDir, cli.config.srcDir || 'src');
  const templateDirs = [cli.config.templatesDir || '.avenxtemplates', 'templates'];
  const sourceDirs = [srcPath, ...templateDirs.map((dir) => path.join(baseDir, dir))];
  const assetDirs = ['public', 'assets'].map((dir) => path.join(baseDir, dir));

  if (!fs.existsSync(srcPath)) return null;

  const snapshotDirectories = (directories) => {
    const snapshot = new Map();
    const visit = (directory) => {
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(entryPath, { bigint: true });
          snapshot.set(entryPath, `${stat.mtimeNs}:${stat.size}`);
        }
      }
    };

    directories.forEach(visit);
    return snapshot;
  };

  const snapshotRootFiles = () => {
    const snapshot = new Map();
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isFile() || !isWatchedRootFile(entry.name)) continue;
      const entryPath = path.join(baseDir, entry.name);
      const stat = fs.statSync(entryPath, { bigint: true });
      snapshot.set(entryPath, `${stat.mtimeNs}:${stat.size}`);
    }
    return snapshot;
  };

  const changedPaths = (previous, next) => {
    const candidates = new Set([...previous.keys(), ...next.keys()]);
    return [...candidates].filter((filePath) => previous.get(filePath) !== next.get(filePath));
  };

  let sourceSnapshot = snapshotDirectories(sourceDirs);
  let assetSnapshot = snapshotDirectories(assetDirs);
  let rootSnapshot = snapshotRootFiles();

  const sendEvent = (event) => {
    if (cli.liveReloadClients) {
      const frame = formatSseMessage(event);
      cli.liveReloadClients.forEach((client) => client.write(frame));
    }
  };

  // The overlay is driven by the last pass, and a client that connects later
  // -- a manual refresh while the build is broken -- is told about it then.
  const publishBuildStatus = (status) => {
    cli.buildStatus = status;
    if (!isErrorOverlayEnabled(cli)) {
      return;
    }
    const message = overlayMessageFor(status);
    // A clean build after a failure still has to clear the overlay, so the
    // `ok` message is sent even when it carries nothing.
    sendEvent(message || { type: 'ok', diagnostics: [] });
  };

  const scheduleChange = (kind, filename) => {
    if (!pendingChange || kind >= pendingChange.kind) {
      pendingChange = { kind, filename };
    }

    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const change = pendingChange;
      pendingChange = null;
      if (!change) return;

      if (change.kind === 3) {
        console.log(yellow(`\n⚠️ Change detected: ${change.filename}. Restart the dev server to load the new configuration.`));
        return;
      }

      if (change.kind === 1) {
        console.log(`\n${cyan(`📄 Change detected: ${change.filename}. Reloading...`)}`);
        sendEvent({ type: 'reload' });
        return;
      }

      console.log(`\n${cyan(`📄 Change detected: ${change.filename}. Rebuilding...`)}`);
      const startedAt = performance.now();
      const pass = runBuildPass(cli, { watch: true });
      const status = buildStatusFromPass(pass, baseDir);
      if (!pass.ok) {
        // A watch session keeps going: the next save usually fixes it. The
        // browser is not reloaded, so it keeps showing the last good build --
        // with the overlay on top of it, naming what broke.
        reportRebuildFailure(pass.error);
        publishBuildStatus(status);
        return;
      }

      console.log(green(`✅ Rebuilt in ${Math.round(performance.now() - startedAt)}ms`));
      publishBuildStatus(status);
      const previous = cli.liveReloadHashes;
      const next = getBundleHashes(cli);
      cli.liveReloadHashes = next;
      if (previous && previous.js === next.js && previous.css !== next.css) {
        sendEvent({ type: 'css' });
      } else {
        sendEvent({ type: 'reload' });
      }
    }, 100);
  };

  const refreshDirectorySnapshot = (directories, previous, kind) => {
    const next = snapshotDirectories(directories);
    for (const filePath of changedPaths(previous, next)) {
      scheduleChange(kind, path.relative(baseDir, filePath));
    }
    return next;
  };

  const refreshSourceSnapshot = () => {
    sourceSnapshot = refreshDirectorySnapshot(sourceDirs, sourceSnapshot, 2);
  };
  const refreshAssetSnapshot = () => {
    assetSnapshot = refreshDirectorySnapshot(assetDirs, assetSnapshot, 1);
  };
  const refreshRootSnapshot = () => {
    const next = snapshotRootFiles();
    for (const filePath of changedPaths(rootSnapshot, next)) {
      const filename = path.basename(filePath);
      scheduleChange(isRootRestartFile(filename) ? 3 : 1, filename);
    }
    rootSnapshot = next;
  };

  const watchers = [
    watchDirectories(sourceDirs, refreshSourceSnapshot),
    watchDirectories(assetDirs, refreshAssetSnapshot),
    fs.watch(baseDir, refreshRootSnapshot),
  ].filter(Boolean);

  const startupScan = setImmediate(() => {
    refreshSourceSnapshot();
    refreshAssetSnapshot();
    refreshRootSnapshot();
  });

  const watcher = {
    close() {
      clearTimeout(timeout);
      clearImmediate(startupScan);
      for (const activeWatcher of watchers) activeWatcher.close();
    },
  };

  if (cli) {
    cli._watcher = watcher;
  }
  return watcher;
}

/**
 * The address a configured host should actually bind.
 *
 * `localhost` is a name, and Node resolves it to a single family. On a machine
 * whose resolver answers `::1` first, `server.listen(port, 'localhost')` binds
 * IPv6 only, and every client that reaches for `127.0.0.1` -- curl, a proxy, a
 * container, the E2E harness -- gets ECONNREFUSED while the browser works. The
 * loopback interface is bound explicitly instead, and the IPv6 loopback is
 * added alongside it by {@link listenLoopbackAlias}, so both families answer.
 * @param {string} host - The configured host.
 * @returns {string} The address to bind.
 */
export function bindAddressFor(host) {
  return host === 'localhost' ? '127.0.0.1' : host;
}

/**
 * Adds a second listener on the IPv6 loopback for a server bound to 127.0.0.1.
 *
 * Only for the default `localhost` host: an explicitly configured address is
 * bound exactly as asked. Failure is not an error -- a machine without IPv6, or
 * one where something already holds `[::1]` on this port, simply keeps the IPv4
 * listener it already has.
 * @param {object} requestListener - The handler both listeners share.
 * @param {string} host - The configured host.
 * @param {number} port - The port the primary listener bound.
 * @param {object|null} [tlsOptions] - The primary listener's certificate and key.
 * @returns {object|null} The secondary server, or null when one was not added.
 */
export function listenLoopbackAlias(requestListener, host, port, tlsOptions = null) {
  if (host !== 'localhost') {
    return null;
  }
  const alias = tlsOptions
    ? https.createServer(tlsOptions, requestListener)
    : http.createServer(requestListener);
  alias.on('error', () => {
    // No IPv6 loopback, or it is already taken: the IPv4 listener stands alone.
  });
  alias.listen(port, '::1');
  return alias;
}

/**
 * Listens on the requested port, incrementing it when the address is occupied.
 * @param {object} server
 * @param {number|string} requestedPort
 * @param {string} host
 * @param {Function} onListening
 */
export function listenWithPortFallback(server, requestedPort, host, onListening) {
  let port = Number(requestedPort);
  const address = bindAddressFor(host);

  server.once('listening', () => onListening(port === 0 ? server.address().port : port));
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE' || port >= 65535) {
      throw err;
    }

    const occupiedPort = port;
    port += 1;
    console.warn(`\n${yellow(`Port ${occupiedPort} is already in use. Trying ${port} instead.`)}`);
    server.listen(port, address);
  });

  server.listen(port, address);
}

/**
 * Reads and validates the development certificate before any build or watcher starts.
 * @param {object} cli - The project and merged server configuration.
 * @returns {{options: object, files: Set<string>}|null} TLS options and private file paths.
 */
function loadServerTls(cli) {
  const server = cli.config.server;
  if (!server.https) return null;
  if (!server.cert || !server.key) {
    throw new Error(
      'HTTPS requires --cert and --key (or server.cert and server.key). ' +
      'Create a trusted development pair with: mkcert -install && ' +
      'mkcert -cert-file dev.pem -key-file dev-key.pem localhost 127.0.0.1 ::1 <device-IP>',
    );
  }
  try {
    const certPath = fs.realpathSync(path.resolve(cli.baseDir, server.cert));
    const keyPath = fs.realpathSync(path.resolve(cli.baseDir, server.key));
    const options = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    createSecureContext(options);
    return { options, files: new Set([certPath, keyPath]) };
  } catch (error) {
    throw new Error(`Cannot load HTTPS certificate/key: ${error.message}`, { cause: error });
  }
}

/**
 * Starts a local development server and watches for changes.
 * @param {object} cli
 * @param {number|string} port
 * @param {string} [host]
 * @param {boolean} [open]
 * @returns {object} The primary HTTP or HTTPS server.
 */
export function serveProject(cli, port, host = 'localhost', open = false) {
  const tls = loadServerTls(cli);
  // The first build is recorded like any rebuild, so a warning from it is
  // already waiting when the first browser connects. A failure here is still
  // fatal: there is no previous output to fall back on.
  const initialPass = runBuildPass(cli, { watch: true });
  cli.buildStatus = buildStatusFromPass(initialPass, cli.baseDir);
  if (!initialPass.ok) {
    throw initialPass.error;
  }
  cli.liveReloadHashes = getBundleHashes(cli);

  if (cli.config.server.liveReload) {
    cli.liveReloadClients = [];
    watchProject(cli);
  }

  const requestListener = (req, res) => {
    attachRequestLogger(req, res);
    applyCustomHeaders(res, cli.config.server.headers);
    if (cli.config.server.liveReload && req.url === '/__avenx_live_reload__') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(formatSseMessage({ type: 'connected' }));

      // A page loaded or refreshed while the build is broken has no way of
      // knowing that, so a failed pass is replayed to every client that
      // connects. Without this, the one reflex a developer has when the page
      // looks wrong -- reload it -- is what hides the explanation. Warnings
      // are not replayed: they would then sit on the page from the moment it
      // loads, every load, which is what makes an overlay get switched off.
      if (isErrorOverlayEnabled(cli) && cli.buildStatus && !cli.buildStatus.ok) {
        const pending = overlayMessageFor(cli.buildStatus);
        if (pending) {
          res.write(formatSseMessage(pending));
        }
      }

      cli.liveReloadClients.push(res);

      req.on('close', () => {
        cli.liveReloadClients = cli.liveReloadClients.filter((client) => client !== res);
      });
      return;
    }
    // Trace ingest. Only mounted for `avenx serve --trace`, so a dev server
    // without the flag has no endpoint that writes to disk at all.
    if (cli.traceEnabled && req.method === 'POST' && req.url === TRACE_ENDPOINT) {
      // A trace becomes a generated test, so accepting one from another origin
      // would let any page the developer visits plant source in the project.
      if (!isSameOriginRequest(req)) {
        console.warn(
          yellow(`Refused a cross-origin trace upload from ${String(req.headers.origin).slice(0, 120)}.`),
        );
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cross-origin trace uploads are refused' }));
        return;
      }
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk) => {
        body += chunk;
        // A trace is bounded by the recorder's ring buffer, so anything past
        // this is not a trace and must not be buffered indefinitely.
        if (body.length > MAX_TRACE_BYTES) {
          tooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Trace too large' }));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) {
          return;
        }
        try {
          const trace = JSON.parse(body);
          const savedPath = saveTrace(cli.baseDir, trace);
          const nodes = Array.isArray(trace.nodes) ? trace.nodes.length : 0;
          const status = (trace.determinism && trace.determinism.status) || 'unknown';
          console.log(
            `\n${green(`📼 Recorded ${trace.id}`)} ${gray(`· ${nodes} nodes · ${status}`)}\n` +
            `   ${cyan(`avenx trace view ${trace.id}`)}\n` +
            `   ${cyan(`avenx trace export ${trace.id}`)}\n`,
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id: trace.id, path: savedPath }));
        } catch (error) {
          console.error(`Failed to save trace: ${error.message}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    if (req.url === '/__avenx-inspect') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getInspectorHtml(cli));
      return;
    }

    const filePath = resolveRequestPath(cli.baseDir, req.url);

    if (filePath === null) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // A configured private key may live under the project root. It and aliases
    // to it must never be served as static assets.
    if (tls) {
      try {
        if (tls.files.has(fs.realpathSync(filePath))) {
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
        if (cli.config.server.liveReload && extname === '.html') {
          const script = `
<script>
    if ('EventSource' in window) {
        const source = new EventSource('/__avenx_live_reload__');
        let pendingStylesheet = null;
        let stylesheetSwapToken = 0;
        const swapStylesheet = () => {
            const current = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
                .find((link) => new URL(link.href, document.baseURI).pathname.endsWith('/bundle.css'));
            if (!current) return;

            if (pendingStylesheet && pendingStylesheet.parentNode) {
                pendingStylesheet.parentNode.removeChild(pendingStylesheet);
            }

            const replacement = document.createElement('link');
            replacement.rel = 'stylesheet';
            const url = new URL(current.href, document.baseURI);
            url.searchParams.set('t', String(Date.now()));
            replacement.href = url.href;
            const token = ++stylesheetSwapToken;
            pendingStylesheet = replacement;
            replacement.onload = () => {
                if (token !== stylesheetSwapToken) return;
                if (current.parentNode) current.parentNode.removeChild(current);
                pendingStylesheet = null;
            };
            replacement.onerror = () => {
                if (replacement.parentNode) replacement.parentNode.removeChild(replacement);
                if (token === stylesheetSwapToken) pendingStylesheet = null;
            };
            current.parentNode.insertBefore(replacement, current.nextSibling);
        };
        // Messages are JSON objects carrying a type, and a bare string is
        // still understood so an older payload shape cannot break reloading.
        const parseMessage = (data) => {
            if (typeof data !== 'string') return { type: '' };
            if (data.charAt(0) !== '{') return { type: data };
            try {
                const parsed = JSON.parse(data);
                return parsed && typeof parsed === 'object' ? parsed : { type: '' };
            } catch {
                return { type: data };
            }
        };
        source.onmessage = (e) => {
            const message = parseMessage(e.data);
            const diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];

            if (message.type === 'error' || message.type === 'ok') {
                // Absent when the overlay is switched off; the reload
                // behaviour below is unaffected either way.
                if (window.__avenxDevOverlay) {
                    window.__avenxDevOverlay.render(diagnostics);
                }
                return;
            }
            if (message.type === 'reload') {
                window.location.reload();
            } else if (message.type === 'css') {
                swapStylesheet();
            }
        };
    }
</script>
`;
          const traceScript = cli.traceEnabled
            ? `
<script>
    // Injected by \`avenx serve --trace\`. Recording is opt-in and never
    // reaches a production build.
    window.addEventListener('DOMContentLoaded', function () {
        if (window.Avenx && window.Avenx.installTraceRecorder) {
            window.Avenx.installTraceRecorder(${JSON.stringify({
    endpoint: TRACE_ENDPOINT,
    redact: (cli.config.trace && cli.config.trace.redact) || [],
    maxNodes: (cli.config.trace && cli.config.trace.maxNodes) || undefined,
  })});
        } else {
            console.warn('[Avenx] --trace is on but the runtime did not load; nothing is being recorded.');
        }
    });
</script>
`
            : '';

          // The inspector flag has to be set *before* the application bundle
          // runs: `new AvenxApp()` calls `initInspector`, which returns
          // immediately when the flag is not yet there. Injected at the end of
          // the body -- after the bundle's <script> -- it always was, so the
          // inspector page never received any data. The flag therefore goes
          // into the head, and everything that only reacts to later events
          // stays at the end of the body.
          const headScript = '\n<script>window.__avenx_inspect_enabled = true;</script>\n';
          let contentStr = content.toString('utf-8');
          if (contentStr.includes('</head>')) {
            contentStr = contentStr.replace('</head>', `${headScript}</head>`);
          } else {
            contentStr = headScript + contentStr;
          }

          // The overlay is declared before the live-reload client so that
          // `window.__avenxDevOverlay` exists by the time a message arrives.
          const overlayScript = isErrorOverlayEnabled(cli) ? getErrorOverlayScript() : '';
          const injected = `${overlayScript}${script}${traceScript}`;
          if (contentStr.includes('</body>')) {
            responseContent = contentStr.replace('</body>', `${injected}</body>`);
          } else {
            responseContent = contentStr + injected;
          }
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(responseContent, 'utf-8');
      }
    });
  };

  const server = tls
    ? https.createServer(tls.options, requestListener)
    : http.createServer(requestListener);

  listenWithPortFallback(server, port, host, (activePort) => {
    // `localhost` names both loopback families. The primary listener holds the
    // IPv4 one; this adds the IPv6 one so neither address is refused.
    cli._loopbackAlias = listenLoopbackAlias(requestListener, host, activePort, tls?.options);
    const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    const url = `${tls ? 'https' : 'http'}://${urlHost}:${activePort}`;
    console.log(`\n${green(`🚀 Dev-Server running at ${url}`)}`);
    if (cli.config.server.liveReload) {
      console.log(cyan(`👀 Watching for changes in ${cli.config.srcDir}/...\n`));
    }
    if (cli.traceEnabled) {
      console.log(green('📼 Trace recording is ON.'));
      console.log(gray('   Reproduce the behaviour, then run `await avenxTrace.save()` in the console'));
      console.log(gray('   (or navigate away — the trace is sent automatically).\n'));
    }
    if (open) {
      openBrowser(url);
    }
  });
  return server;
}
