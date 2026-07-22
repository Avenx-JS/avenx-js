import fs from 'fs';
import path from 'path';
import http from 'http';
import { exec } from 'child_process';
import { buildProject } from './build.js';

/**
 * Opens the browser to the specified URL.
 * @param {string} url
 */
export function openBrowser(url) {
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${start} ${url}`);
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
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0f1015;
            --card-bg: rgba(22, 24, 33, 0.7);
            --card-border: rgba(255, 255, 255, 0.08);
            --primary-gradient: linear-gradient(135deg, #a78bfa, #6366f1);
            --text-main: #f3f4f6;
            --text-muted: #9ca3af;
            --accent-cyan: #22d3ee;
            --accent-green: #34d399;
            --accent-red: #f87171;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            min-height: 100vh;
            overflow-x: hidden;
            background-image: 
                radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(167, 139, 250, 0.1) 0px, transparent 50%);
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
            padding: 1.5rem 2rem;
            border-bottom: 1px solid var(--card-border);
            background: rgba(15, 16, 21, 0.8);
            backdrop-filter: blur(12px);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .logo {
            font-size: 1.5rem;
            background: var(--primary-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 800;
        }

        .brand .title {
            font-size: 1.25rem;
            font-weight: 700;
            letter-spacing: -0.025em;
        }

        .badge {
            font-size: 0.8rem;
            font-weight: 600;
            padding: 0.35rem 0.75rem;
            border-radius: 9999px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            transition: all 0.3s ease;
        }

        .badge.disconnected {
            background: rgba(248, 113, 113, 0.15);
            color: var(--accent-red);
            border: 1px solid rgba(248, 113, 113, 0.3);
        }

        .badge.connected {
            background: rgba(52, 211, 153, 0.15);
            color: var(--accent-green);
            border: 1px solid rgba(52, 211, 153, 0.3);
            box-shadow: 0 0 10px rgba(52, 211, 153, 0.2);
        }

        .dashboard-main {
            display: flex;
            flex: 1;
            padding: 2rem;
            gap: 2rem;
        }

        .sidebar {
            width: 300px;
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
            border-radius: 16px;
            padding: 1.5rem;
            backdrop-filter: blur(16px);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.3);
            border-color: rgba(255, 255, 255, 0.15);
        }

        .card h3 {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 1.25rem;
            color: var(--text-main);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card h4 {
            font-size: 0.95rem;
            font-weight: 600;
            margin-top: 1rem;
            margin-bottom: 0.75rem;
            color: var(--accent-cyan);
        }

        .config-item {
            font-size: 0.9rem;
            margin-bottom: 0.75rem;
            display: flex;
            justify-content: space-between;
        }

        .config-item strong {
            color: var(--text-muted);
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
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 0.75rem 1rem;
            font-size: 0.85rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            transition: background 0.2s;
        }

        .info-item:hover {
            background: rgba(255, 255, 255, 0.06);
        }

        .info-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
        }

        .route-path {
            font-family: monospace;
            color: var(--accent-cyan);
            font-weight: 600;
        }

        .route-page {
            color: var(--text-muted);
        }

        .route-info {
            background: rgba(34, 211, 238, 0.05);
            border: 1px solid rgba(34, 211, 238, 0.15);
            border-radius: 8px;
            padding: 0.75rem 1rem;
            font-family: monospace;
            font-size: 0.85rem;
            color: var(--accent-cyan);
        }

        .comp-name {
            font-weight: 600;
            color: #a78bfa;
        }

        .comp-details {
            padding-left: 0.75rem;
            border-left: 2px solid rgba(167, 139, 250, 0.3);
            font-size: 0.8rem;
            color: var(--text-muted);
            width: 100%;
        }

        .bridge-header {
            font-weight: 600;
            color: var(--accent-green);
        }

        .state-explorer {
            font-family: monospace;
            background: rgba(0, 0, 0, 0.2);
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
                <span class="logo">▲</span>
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
                    <div style="margin-bottom:0.25rem;"><strong>Hash:</strong> <span style="color:var(--accent-cyan);">\${data.currentRoute.hash}</span></div>
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

  if (!fs.existsSync(srcPath)) return;

  fs.watch(srcPath, { recursive: true }, (eventType, filename) => {
    if (filename) {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        console.log(`\n📄 Change detected: ${filename}. Rebuilding...`);
        buildProject(cli);

        if (cli.liveReloadClients) {
          cli.liveReloadClients.forEach((client) => {
            client.write('data: reload\n\n');
          });
        }
      }, 100);
    }
  });
}

/**
 * Starts a local development server and watches for changes.
 * @param {object} cli
 * @param {number|string} port
 * @param {string} [host]
 */
export function serveProject(cli, port, host = 'localhost') {
  buildProject(cli);

  if (cli.config.server.liveReload) {
    cli.liveReloadClients = [];
    watchProject(cli);
  }

  const server = http.createServer((req, res) => {
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

    let filePath = path.join(cli.baseDir, req.url === '/' ? 'index.html' : req.url);

    if (!fs.existsSync(filePath) && !path.extname(filePath)) {
      filePath = path.join(cli.baseDir, 'index.html');
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

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n❌ Port ${port} is already in use.\n` +
          `   Stop the process using that port, or start the dev server on a different one.\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`\n🚀 Dev-Server running at ${url}`);
    if (cli.config.server.liveReload) {
      console.log(`👀 Watching for changes in ${cli.config.srcDir}/...\n`);
    }
    openBrowser(url);
  });
}
