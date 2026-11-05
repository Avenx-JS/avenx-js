import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { spawn } from 'child_process';
import { buildProject } from './build.js';
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
 * Opens the browser to the specified URL.
 * @param {string} url
 */
export function openBrowser(url) {
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  // Pass the URL as an argument rather than interpolating it into a shell
  // command, so characters in the configured host cannot reach the shell.
  spawn(start, [url], { shell: process.platform === 'win32', stdio: 'ignore', detached: true }).unref();
}

/**
 * Generates the default index.html template content.
 * @param {object} cli
 * @returns {string} The initial HTML template string.
 */
export function getInitialHtml(cli) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Avenx App</title>
    <link rel="stylesheet" href="${cli.config.distDir}/bundle.css">
</head>
<body>
    <div id="app"></div>
    <script src="${cli.config.distDir}/bundle.js"></script>
</body>
</html>`;
}

/**
 * Serialises a value for embedding inside an inline `<script>` element.
 *
 * `JSON.stringify` does not escape `<`, so a `</script>` sequence anywhere in
 * the data would terminate the script element early. The `<`/`>` escapes are
 * still valid JSON and parse back to the same characters; U+2028/U+2029 are
 * legal in JSON strings but illegal raw in a JS string literal or regex.
 * @param {*} value
 * @returns {string} Escaped JSON safe for inline `<script>` embedding.
 */
export function escapeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Generates the Dev Server Inspection Dashboard HTML page.
 * @param {object} cli
 * @returns {string} The dashboard HTML content.
 */
export function getInspectorHtml(cli) {
  const configJson = escapeInlineJson(cli.config);
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Avenx Inspection Dashboard</title>
    <style>
        :root {
            --bg-color: #09090b;
            --card-bg: #18181b;
            --card-border: #27272a;
            --text-main: #f4f4f5;
            --text-muted: #a1a1aa;
            --accent-blue: #3b82f6;
            --accent-green: #10b981;
            --accent-red: #ef4444;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            min-height: 100vh;
            overflow-x: hidden;
        }

        .dashboard-wrapper {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }

        .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 2rem;
            border-bottom: 1px solid var(--card-border);
            background: var(--card-bg);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .brand h1.title {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text-main);
            letter-spacing: -0.01em;
            margin: 0;
        }

        .badge {
            font-size: 0.75rem;
            font-weight: 600;
            padding: 0.25rem 0.6rem;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .badge.disconnected {
            background: rgba(239, 68, 68, 0.1);
            color: var(--accent-red);
            border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .badge.connected {
            background: rgba(16, 185, 129, 0.1);
            color: var(--accent-green);
            border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .dashboard-main {
            display: flex;
            flex: 1;
            padding: 2rem;
            gap: 2rem;
        }

        .sidebar {
            width: 280px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .dashboard-grid {
            flex: 1;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            align-content: start;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 1.5rem;
        }

        .card:hover {
            border-color: #3f3f46;
        }

        .card h2 {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 1.25rem;
            color: var(--text-main);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card h3 {
            font-size: 0.9rem;
            font-weight: 600;
            margin-top: 1rem;
            margin-bottom: 0.75rem;
            color: var(--accent-blue);
        }

        .config-item {
            font-size: 0.85rem;
            margin-bottom: 0.75rem;
            display: flex;
            justify-content: space-between;
        }

        .config-item strong {
            color: var(--text-muted);
            font-weight: 500;
        }

        .info-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            max-height: 400px;
            overflow-y: auto;
            padding-right: 0.25rem;
        }

        /* Custom Scrollbar */
        .info-list::-webkit-scrollbar {
            width: 6px;
        }
        .info-list::-webkit-scrollbar-track {
            background: transparent;
        }
        .info-list::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }

        .info-item {
            background: rgba(255, 255, 255, 0.01);
            border: 1px solid var(--card-border);
            border-radius: 6px;
            padding: 0.75rem 1rem;
            font-size: 0.85rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            transition: background 0.2s;
        }

        .info-item:hover {
            background: rgba(255, 255, 255, 0.03);
            border-color: #3f3f46;
        }

        .info-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
        }

        .route-path {
            font-family: monospace;
            color: var(--accent-blue);
            font-weight: 600;
        }

        .route-page {
            color: var(--text-muted);
        }

        .route-info {
            background: rgba(59, 130, 246, 0.03);
            border: 1px solid rgba(59, 130, 246, 0.15);
            border-radius: 6px;
            padding: 0.75rem 1rem;
            font-family: monospace;
            font-size: 0.85rem;
            color: var(--accent-blue);
        }

        .comp-name {
            font-weight: 600;
            color: var(--text-main);
        }

        .comp-details {
            padding-left: 0.75rem;
            border-left: 2px solid var(--card-border);
            font-size: 0.8rem;
            color: var(--text-muted);
            width: 100%;
        }

        .bridge-header {
            font-weight: 600;
            color: var(--text-main);
        }

        .state-explorer {
            font-family: monospace;
            background: #09090b;
            border: 1px solid var(--card-border);
            border-radius: 6px;
            padding: 0.5rem;
            margin-top: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
            white-space: pre-wrap;
            word-break: break-all;
            width: 100%;
        }

        hr {
            border: 0;
            border-top: 1px solid var(--card-border);
            margin: 1.25rem 0;
        }

        @media (max-width: 768px) {
            .app-header {
            padding: 1rem;
        }

        .dashboard-main {
            flex-direction: column;
            padding: 1rem;
            gap: 1rem;
        }

        .sidebar {
            width: 100%;
        }

        .dashboard-grid {
            grid-template-columns: 1fr;
        }
}
    </style>
</head>
<body>
    <div class="dashboard-wrapper">
        <header class="app-header">
            <div class="brand">
                <h1 class="title">Avenx Inspector</h1>
            </div>
            <div class="status-indicator">
                <span class="badge" id="statusBadge" role="status" aria-live="polite" aria-atomic="true">Connecting...</span>
            </div>
        </header>

        <main class="dashboard-main">
            <!-- Sidebar for Config Info -->
            <aside class="sidebar">
                <section class="card config-card" role="region" aria-labelledby="config-heading">
                    <h2 id="config-heading">Dev Server Config</h2>
                    <div class="config-item"><strong>Port:</strong> <span id="confPort">-</span></div>
                    <div class="config-item"><strong>Host:</strong> <span id="confHost">-</span></div>
                    <div class="config-item"><strong>Src Dir:</strong> <span id="confSrc">-</span></div>
                    <div class="config-item"><strong>Dist Dir:</strong> <span id="confDist">-</span></div>
                </section>
            </aside>

            <!-- Dashboard Grid Content -->
            <section class="dashboard-grid">
                <!-- Routing Section -->
                <section class="card grid-card routing-card" role="region" aria-labelledby="routing-heading">
                    <h2 id="routing-heading">Active Routing Table</h2>
                    <div id="routingList" class="info-list" aria-live="off"></div>
                    <hr />
                    <h3>Current Route</h3>
                    <div id="currentRouteInfo" class="route-info">-</div>
                </section>

                <!-- Components Section -->
                <section class="card grid-card components-card" role="region" aria-labelledby="components-heading">
                    <h2 id="components-heading">Registered Components</h2>
                    <div id="componentsList" class="info-list" aria-live="off"></div>
                </section>

                <!-- Bridges Section -->
                <section class="card grid-card bridges-card" role="region" aria-labelledby="bridges-heading">
                    <h2 id="bridges-heading">Active Bridges</h2>
                    <div id="bridgesList" class="info-list" aria-live="off"></div>
                </section>
            </section>
        </main>
    </div>

    <script>
        window.__avenx_config = ${configJson};
        
        const channel = new BroadcastChannel('avenx-inspector-channel');
        let lastUpdate = 0;
        let connectionStatus = null;

        function updateStatus(connected) {
            if (connectionStatus === connected) return;
            connectionStatus = connected;
            const badge = document.getElementById('statusBadge');
            if (connected) {
                badge.textContent = '● Connected';
                badge.className = 'badge connected';
            } else {
                badge.textContent = '○ Disconnected';
                badge.className = 'badge disconnected';
            }
        }

        channel.onmessage = (event) => {
            if (event.data && event.data.type === 'inspect-data') {
                updateStatus(true);
                lastUpdate = Date.now();
                renderDashboard(event.data.data);
            }
        };

        // Render server config immediately
        const config = window.__avenx_config || {};
        document.getElementById('confPort').textContent = config.server?.port || '3000';
        document.getElementById('confHost').textContent = config.server?.host || 'localhost';
        document.getElementById('confSrc').textContent = config.srcDir || 'src';
        document.getElementById('confDist').textContent = config.distDir || 'dist';

        // Request data periodically to establish connection
        function requestUpdate() {
            channel.postMessage('request-inspect-data');
            // If no message received for 2.5 seconds, show disconnected
            if (Date.now() - lastUpdate > 2500) {
                updateStatus(false);
            }
        }

        setInterval(requestUpdate, 1000);
        requestUpdate();

        // Everything below is application data -- component state, props,
        // bridge state, route params -- and it routinely holds whatever a user
        // typed or an API returned. It is written with innerHTML, so it is
        // escaped first; an inspector that renders the app's own data as markup
        // is a script-execution sink on the dev server's origin.
        function esc(value) {
            return String(value === undefined ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function renderDashboard(data) {
            // 1. Render routes
            const routingList = document.getElementById('routingList');
            routingList.innerHTML = '';
            if (data.routes && Object.keys(data.routes).length > 0) {
                Object.entries(data.routes).forEach(([pattern, def]) => {
                    const pageName = typeof def === 'string' ? def : def.page;
                    const item = document.createElement('div');
                    item.className = 'info-item';
                    item.innerHTML = \`
                        <div class="info-header">
                            <span class="route-path">\${esc(pattern)}</span>
                            <span class="route-page">\${esc(pageName)}</span>
                        </div>
                    \`;
                    routingList.appendChild(item);
                });
            } else {
                routingList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No routes configured.</div>';
            }

            // 2. Render current route
            const currentRouteInfo = document.getElementById('currentRouteInfo');
            if (data.currentRoute) {
                currentRouteInfo.innerHTML = \`
                    <div style="margin-bottom:0.25rem;"><strong>Hash:</strong> <span style="color:var(--accent-blue);">\${esc(data.currentRoute.hash)}</span></div>
                    <div style="margin-bottom:0.25rem;"><strong>Page:</strong> \${esc(data.currentRoute.page)}</div>
                    <div style="margin-top:0.5rem;"><strong>Params:</strong></div>
                    <pre class="state-explorer">\${esc(JSON.stringify(data.currentRoute.params || {}, null, 2))}</pre>
                \`;
            } else {
                currentRouteInfo.innerHTML = '<div style="color:var(--text-muted);">None (App not routing or on initial load)</div>';
            }

            // 3. Render active components
            const componentsList = document.getElementById('componentsList');
            componentsList.innerHTML = '';
            if (data.activeComponents && data.activeComponents.length > 0) {
                data.activeComponents.forEach((comp) => {
                    const item = document.createElement('div');
                    item.className = 'info-item';
                    item.innerHTML = \`
                        <div class="info-header">
                            <span class="comp-name">\${esc(comp.name)}</span>
                        </div>
                        <div class="comp-details">
                            <div style="margin-top:0.25rem;"><strong>Props:</strong></div>
                            <pre class="state-explorer">\${esc(JSON.stringify(comp.props, null, 2))}</pre>
                            <div style="margin-top:0.5rem;"><strong>State:</strong></div>
                            <pre class="state-explorer">\${esc(JSON.stringify(comp.state, null, 2))}</pre>
                        </div>
                    \`;
                    componentsList.appendChild(item);
                });
            } else {
                componentsList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No active components in DOM.</div>';
            }

            // 4. Render bridges
            const bridgesList = document.getElementById('bridgesList');
            bridgesList.innerHTML = '';
            if (data.registeredBridges && Object.keys(data.registeredBridges).length > 0) {
                Object.entries(data.registeredBridges).forEach(([name, state]) => {
                    const item = document.createElement('div');
                    item.className = 'info-item';
                    item.innerHTML = \`
                        <div class="info-header">
                            <span class="bridge-header">\${esc(name)}</span>
                        </div>
                        <pre class="state-explorer">\${esc(JSON.stringify(state, null, 2))}</pre>
                    \`;
                    bridgesList.appendChild(item);
                });
            } else {
                bridgesList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No bridges registered.</div>';
            }
        }
    </script>
</body>
</html>`;
}

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
      if (!entry.isFile()) continue;
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
      cli.liveReloadClients.forEach((client) => client.write(`data: ${event}\n\n`));
    }
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
        sendEvent('reload');
        return;
      }

      console.log(`\n${cyan(`📄 Change detected: ${change.filename}. Rebuilding...`)}`);
      const startedAt = performance.now();
      try {
        buildProject(cli, { watch: true });
      } catch (error) {
        // A watch session keeps going: the next save usually fixes it. The
        // browser is not reloaded, so it keeps showing the last good build.
        reportRebuildFailure(error);
        return;
      }

      console.log(green(`✅ Rebuilt in ${Math.round(performance.now() - startedAt)}ms`));
      const previous = cli.liveReloadHashes;
      const next = getBundleHashes(cli);
      cli.liveReloadHashes = next;
      if (previous && previous.js === next.js && previous.css !== next.css) {
        sendEvent('css');
      } else {
        sendEvent('reload');
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
      const requiresRestart = filename === 'avenx.config.json'
        || filename === 'package.json'
        || /^\.env(?:\.|$)/.test(filename);
      scheduleChange(requiresRestart ? 3 : 1, filename);
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
 * @returns {object|null} The secondary server, or null when one was not added.
 */
export function listenLoopbackAlias(requestListener, host, port) {
  if (host !== 'localhost') {
    return null;
  }
  const alias = http.createServer(requestListener);
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

  server.once('listening', () => onListening(port));
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
 * Starts a local development server and watches for changes.
 * @param {object} cli
 * @param {number|string} port
 * @param {string} [host]
 * @param {boolean} [open]
 */
export function serveProject(cli, port, host = 'localhost', open = false) {
  buildProject(cli, { watch: true });
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
      res.write('data: connected\n\n');

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
        source.onmessage = (e) => {
            if (e.data === 'reload') {
                window.location.reload();
            } else if (e.data === 'css') {
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

          const injected = `${script}${traceScript}`;
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

  const server = http.createServer(requestListener);

  listenWithPortFallback(server, port, host, (activePort) => {
    // `localhost` names both loopback families. The primary listener holds the
    // IPv4 one; this adds the IPv6 one so neither address is refused.
    cli._loopbackAlias = listenLoopbackAlias(requestListener, host, activePort);
    const url = `http://${host}:${activePort}`;
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
}
