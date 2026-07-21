import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Ensure runtime is built before starting server
function ensureRuntimeBuild() {
  const runtimePath = path.join(rootDir, 'dist/runtime.js');
  if (!fs.existsSync(runtimePath)) {
    console.log('[E2E Server] Building runtime...');
    const buildScript = path.join(rootDir, 'scripts/build.js');
    const child = fork(buildScript, [], { stdio: 'inherit' });
    return new Promise((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Build failed with exit code ${code}`));
      });
    });
  }
  return Promise.resolve();
}

async function startServer() {
  await ensureRuntimeBuild();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    let filePath;
    if (pathname.startsWith('/dist/') || pathname.startsWith('/lib/')) {
      filePath = path.join(rootDir, pathname);
    } else {
      let relativePath = pathname === '/' ? 'counter.html' : pathname;
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }

      // If file exists directly in fixtures, serve it
      filePath = path.join(__dirname, relativePath);

      // If it doesn't exist and has no extension, fallback to routing.html (for SPA navigation testing)
      if (!fs.existsSync(filePath) && !path.extname(filePath)) {
        filePath = path.join(__dirname, 'routing.html');
      }
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`500 Internal Server Error: ${err.message}`);
        }
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  server.listen(PORT, () => {
    console.log(`[E2E Server] Serving fixtures at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[E2E Server] Initialization error:', err);
  process.exit(1);
});
