/**
 * Exercises `avenx serve --trace`: the injected bootstrap, the ingest endpoint
 * that writes recordings to .avenx/traces/, and the guarantee that a dev server
 * without the flag has neither.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { listTraces } from '../../lib/core/trace/store.js';
import { createTrace, TraceNodeType } from '../../lib/core/trace/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing avenx serve --trace...');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-trace-serve-'));

/**
 * Waits until a predicate holds or a deadline passes.
 * @param {function(): (boolean|Promise<boolean>)} predicate - What to wait for.
 * @param {number} [timeoutMs] - How long to wait.
 * @returns {Promise<boolean>} Whether the predicate held.
 */
async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Starts a dev server and resolves once it reports its port.
 * @param {string[]} args - Extra CLI arguments.
 * @param {number} port - The port to listen on.
 * @returns {Promise<{child: object, output: string[], url: string}>}
 */
function startServer(args, port) {
  const child = spawn(process.execPath, [cliPath, 'serve', String(port), ...args], {
    cwd: workDir,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  return waitFor(() => output.join('').includes('Dev-Server running')).then((up) => {
    if (!up) {
      child.kill('SIGKILL');
      throw new Error(`server did not start:\n${output.join('')}`);
    }
    return { child, output, url: `http://localhost:${port}` };
  });
}

let running = null;

try {
  // A minimal project the dev server can serve.
  spawnSync(process.execPath, [cliPath, 'init'], { cwd: workDir, stdio: 'ignore' });
  spawnSync(process.execPath, [cliPath, 'build'], { cwd: workDir, stdio: 'ignore' });
  assert.ok(fs.existsSync(path.join(workDir, 'index.html')), 'the project scaffolded');

  // --- Without --trace, nothing trace-related exists ------------------------

  running = await startServer([], 4611);
  let html = await (await fetch(`${running.url}/index.html`)).text();
  assert.ok(!html.includes('installTraceRecorder'), 'no recorder is injected without --trace');
  assert.ok(html.includes('__avenx_live_reload__'), 'the usual dev-server injection is untouched');

  let post = await fetch(`${running.url}/__avenx/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ traceVersion: 1, id: 'trace-sneaky', nodes: [] }),
  });
  // The path falls through to the dev server's ordinary static handling, so
  // what matters is not the status code but that nothing was ingested: without
  // --trace there is no endpoint that writes to disk at all.
  const refused = await post.text();
  assert.ok(!refused.includes('"ok":true'), 'the post was not accepted as a trace');
  assert.strictEqual(listTraces(workDir).length, 0, 'and nothing was written to disk');
  assert.ok(
    !fs.existsSync(path.join(workDir, '.avenx', 'traces')),
    'the trace directory is not even created without --trace',
  );

  running.child.kill('SIGKILL');
  running = null;

  // --- With --trace, the bootstrap is injected ------------------------------

  running = await startServer(['--trace'], 4612);
  assert.ok(
    running.output.join('').includes('Trace recording is ON'),
    'the server says recording is on',
  );

  html = await (await fetch(`${running.url}/index.html`)).text();
  assert.ok(html.includes('installTraceRecorder'), 'the recorder bootstrap is injected');
  assert.ok(html.includes('/__avenx/trace'), 'and points at the ingest endpoint');
  assert.ok(html.includes('__avenx_live_reload__'), 'live reload still works alongside it');

  // --- The ingest endpoint stores a posted trace ----------------------------

  const trace = createTrace({ url: `${running.url}/#/` });
  trace.id = 'trace-b33f';
  trace.createdAt = new Date().toISOString();
  trace.nodes = [
    {
      id: 1,
      parent: null,
      seq: 1,
      type: TraceNodeType.EVENT,
      eventType: 'click',
      target: { selector: 'button', nth: 0 },
    },
    { id: 2, parent: 1, seq: 2, type: TraceNodeType.WRITE, path: 'count', from: 0, to: 1 },
  ];

  post = await fetch(`${running.url}/__avenx/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trace),
  });
  assert.strictEqual(post.status, 200, 'the trace was accepted');
  const body = await post.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.id, 'trace-b33f');

  const stored = listTraces(workDir);
  assert.strictEqual(stored.length, 1, 'the trace reached the store');
  assert.strictEqual(stored[0].id, 'trace-b33f');
  assert.strictEqual(stored[0].trace.nodes.length, 2, 'with its nodes intact');

  assert.ok(
    await waitFor(() => running.output.join('').includes('avenx trace view trace-b33f')),
    'the server prints the next command to run',
  );

  // --- A malformed post is rejected, not stored -----------------------------

  post = await fetch(`${running.url}/__avenx/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json at all',
  });
  assert.strictEqual(post.status, 400, 'malformed input is rejected');
  assert.strictEqual(listTraces(workDir).length, 1, 'and nothing extra was written');

  // A traversal id cannot escape the trace directory.
  post = await fetch(`${running.url}/__avenx/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ traceVersion: 1, id: '../../pwned', nodes: [] }),
  });
  assert.strictEqual(post.status, 400, 'a traversal id is refused');
  assert.ok(!fs.existsSync(path.join(workDir, '../../pwned.json')), 'and wrote nothing outside the store');
  assert.strictEqual(listTraces(workDir).length, 1);

  // --- The CLI can read what the browser posted -----------------------------

  const view = spawnSync(process.execPath, [cliPath, 'trace', 'view', 'trace-b33f'], {
    cwd: workDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.strictEqual(view.status, 0, view.stderr);
  assert.ok(view.stdout.includes('click <button>'), 'the round trip from browser to terminal works');
  assert.ok(view.stdout.includes('write count 0 → 1'));

  console.log('✅ avenx serve --trace tests passed.');
} finally {
  if (running && running.child) {
    running.child.kill('SIGKILL');
  }
  fs.rmSync(workDir, { recursive: true, force: true });
}
