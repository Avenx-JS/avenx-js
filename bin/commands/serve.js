import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { buildProject } from './build.js';
import { reportRebuildFailure } from '../fatal.js';
import { cyan, green, yellow, red } from '../colors.js';
import { watchDirectory } from '../utils.js';

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

  return filePath;
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
<html>
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
 * Generates the Dev Server Inspection Dashboard HTML page.
 * @param {object} cli
 * @returns {string} The dashboard HTML content.
 */
export function getInspectorHtml(cli) {
  const configJson = JSON.stringify(cli.config);
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
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

        .brand .title {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text-main);
            letter-spacing: -0.01em;
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
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
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

        .card h3 {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 1.25rem;
            color: var(--text-main);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card h4 {
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
    </style>
</head>
<body>
    <div class="dashboard-wrapper">
        <header class="app-header">
            <div class="brand">
                <span class="title">Avenx Inspector</span>
            </div>
            <div class="status-indicator">
                <span class="badge" id="statusBadge">Connecting...</span>
            </div>
        </header>

        <main class="dashboard-main">
            <!-- Sidebar for Config Info -->
            <aside class="sidebar">
                <div class="card config-card">
                    <h3>Dev Server Config</h3>
                    <div class="config-item"><strong>Port:</strong> <span id="confPort">-</span></div>
                    <div class="config-item"><strong>Host:</strong> <span id="confHost">-</span></div>
                    <div class="config-item"><strong>Src Dir:</strong> <span id="confSrc">-</span></div>
                    <div class="config-item"><strong>Dist Dir:</strong> <span id="confDist">-</span></div>
                </div>
            </aside>

            <!-- Dashboard Grid Content -->
            <section class="dashboard-grid">
                <!-- Routing Section -->
                <div class="card grid-card routing-card">
                    <h3>Active Routing Table</h3>
                    <div id="routingList" class="info-list"></div>
                    <hr />
                    <h4>Current Route</h4>
                    <div id="currentRouteInfo" class="route-info">-</div>
                </div>

                <!-- Components Section -->
                <div class="card grid-card components-card">
                    <h3>Active Component Tree</h3>
                    <div id="componentsList" class="info-list"></div>
                </div>

                <!-- Bridges Section -->
                <div class="card grid-card bridges-card">
                    <h3>Bridges & Reactive State</h3>
                    <div id="bridgesList" class="info-list"></div>
                </div>
            </section>
        </main>
    </div>

    <script>
        window.__avenx_config = ${configJson};
        
        const channel = new BroadcastChannel('avenx-inspector-channel');
        let lastUpdate = 0;

        function updateStatus(connected) {
            const badge = document.getElementById('statusBadge');
            if (connected) {
                badge.textContent = 'Live';
                badge.className = 'badge connected';
            } else {
                badge.textContent = 'Disconnected';
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
                            <span class="route-path">\${pattern}</span>
                            <span class="route-page">\${pageName}</span>
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
                    <div style="margin-bottom:0.25rem;"><strong>Hash:</strong> <span style="color:var(--accent-blue);">\${data.currentRoute.hash}</span></div>
                    <div style="margin-bottom:0.25rem;"><strong>Page:</strong> \${data.currentRoute.page}</div>
                    <div style="margin-top:0.5rem;"><strong>Params:</strong></div>
                    <pre class="state-explorer">\${JSON.stringify(data.currentRoute.params || {}, null, 2)}</pre>
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
                            <span class="comp-name">\${comp.name}</span>
                        </div>
                        <div class="comp-details">
                            <div style="margin-top:0.25rem;"><strong>Props:</strong></div>
                            <pre class="state-explorer">\${JSON.stringify(comp.props, null, 2)}</pre>
                            <div style="margin-top:0.5rem;"><strong>State:</strong></div>
                            <pre class="state-explorer">\${JSON.stringify(comp.state, null, 2)}</pre>
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
                            <span class="bridge-header">\${name}</span>
                        </div>
                        <pre class="state-explorer">\${JSON.stringify(state, null, 2)}</pre>
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
  const srcPath = path.join(cli.baseDir, cli.config.srcDir);

  if (!fs.existsSync(srcPath)) return null;

  const watcher = watchDirectory(srcPath, (eventType, filename) => {
    if (filename) {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        console.log(`\n${cyan(`📄 Change detected: ${filename}. Rebuilding...`)}`);

        try {
          buildProject(cli);
        } catch (error) {
          // A watch session keeps going: the next save usually fixes it. The
          // browser is not reloaded, so it keeps showing the last good build
          // rather than a blank page.
          reportRebuildFailure(error);
          return;
        }

        if (cli.liveReloadClients) {
          cli.liveReloadClients.forEach((client) => {
            client.write('data: reload\n\n');
          });
        }
      }, 100);
    }
  });

  if (cli) {
    cli._watcher = watcher;
  }
  return watcher;
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

  server.once('listening', () => onListening(port));
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE' || port >= 65535) {
      throw err;
    }

    const occupiedPort = port;
    port += 1;
    console.warn(`\n${yellow(`Port ${occupiedPort} is already in use. Trying ${port} instead.`)}`);
    server.listen(port, host);
  });

  server.listen(port, host);
}

/**
 * Starts a local development server and watches for changes.
 * @param {object} cli
 * @param {number|string} port
 * @param {string} [host]
 * @param {boolean} [open]
 */
export function serveProject(cli, port, host = 'localhost', open = false) {
  buildProject(cli);

  if (cli.config.server.liveReload) {
    cli.liveReloadClients = [];
    watchProject(cli);
  }

  const server = http.createServer((req, res) => {
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
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
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
        if (cli.config.server.liveReload && contentType === 'text/html') {
          const script = `
<script>
    window.__avenx_inspect_enabled = true;
    if ('EventSource' in window) {
        const source = new EventSource('/__avenx_live_reload__');
        source.onmessage = (e) => {
            if (e.data === 'reload') {
                window.location.reload();
            }
        };
    }
</script>
`;
          const contentStr = content.toString('utf-8');
          if (contentStr.includes('</body>')) {
            responseContent = contentStr.replace('</body>', `${script}</body>`);
          } else {
            responseContent = contentStr + script;
          }
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(responseContent, 'utf-8');
      }
    });
  });

  listenWithPortFallback(server, port, host, (activePort) => {
    const url = `http://${host}:${activePort}`;
    console.log(`\n${green(`🚀 Dev-Server running at ${url}`)}`);
    if (cli.config.server.liveReload) {
      console.log(cyan(`👀 Watching for changes in ${cli.config.srcDir}/...\n`));
    }
    if (open) {
      openBrowser(url);
    }
  });
}