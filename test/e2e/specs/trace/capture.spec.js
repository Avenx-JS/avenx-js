import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';

import {
  test as devTest,
  expect,
  findFreePort,
  startServer,
  terminate,
} from '../../support/dev-server.js';
import { REPO_ROOT as repoRoot } from '../../support/apps.js';

const cli = path.join(repoRoot, 'bin/avenx.js');
const run = promisify(execFile);
const componentPath = 'src/components/trace-counter/trace-counter.component.js';
const secret = 'synthetic-trace-secret-42';

/**
 * Creates an authored component, compiled by the real serve command.
 * @param {string} projectDir - Isolated scratch project.
 * @param {boolean} withBridge - Include the privacy interaction.
 * @returns {Promise<void>}
 */
async function writeFixture(projectDir, withBridge) {
  const files = {
    'src/main.app.js': `import { AvenxApp } from 'avenx-core/runtime';
import TraceCounter from './components/trace-counter/trace-counter.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('TraceCounter', TraceCounter);
app.mount('TraceCounter');
`,
    [componentPath]: `${withBridge ? "import session from '../../bridges/session.bridge.js';" : ''}
<state count="0" />
<action name="increment"> state.count = state.count + 1; </action>
<span data-testid="count">{{ count }}</span>
<button data-testid="increment" @click="increment()">Increment</button>
${withBridge ? `<action name="signIn"> session.signIn('${secret}'); </action>
<button data-testid="sign-in" @click="signIn()">Sign in</button>
<span data-testid="ready">{{ session.ready }}</span>` : ''}
`,
    'src/components/trace-counter/trace-counter.component.css': '',
    'src/bridges/session.bridge.js': `import { bridge } from 'avenx-core/runtime';
export default bridge({
  state: { token: '', ready: false },
  signIn(token) { this.token = token; this.ready = true; },
});
`,
    'avenx.config.json': JSON.stringify({
      srcDir: 'src',
      distDir: 'dist',
      trace: { redact: withBridge ? ['token'] : [] },
    }),
  };
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(projectDir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

const test = devTest.extend({
  traceEnabled: [true, { option: true }],
  withBridge: [false, { option: true }],
  devServer: async ({ projectDir, traceEnabled, withBridge }, use) => {
    await writeFixture(projectDir, withBridge);
    const server = await startServer(
      projectDir, await findFreePort(), traceEnabled ? ['--trace'] : [],
    );
    try {
      await use(server);
    } finally {
      await terminate(server.child);
    }
  },
});

/**
 * Saves through the browser control surface and reads the server's stored file.
 * @param {import('@playwright/test').Page} page - Browser recording the app.
 * @param {string} projectDir - Scratch project receiving the POST.
 * @returns {Promise<object>} Persisted recording.
 */
async function saveTrace(page, projectDir) {
  const saved = await page.evaluate(async () => {
    const result = await window.avenxTrace.save();
    window.avenxTrace.stop();
    return result;
  });
  expect(saved.ok).toBe(true);
  return JSON.parse(await fs.readFile(
    path.join(projectDir, '.avenx/traces', `${saved.id}.json`), 'utf8',
  ));
}

/**
 * Determines causal ancestry without assuming fixed numeric node ids.
 * @param {object} node - Observation to inspect.
 * @param {number} ancestor - The original click's id.
 * @param {object[]} nodes - Recorded causal graph.
 * @returns {boolean} Whether the click caused this observation.
 */
function descendsFrom(node, ancestor, nodes) {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const visited = new Set();
  while (node && node.parent !== null && !visited.has(node.id)) {
    if (node.parent === ancestor) return true;
    visited.add(node.id);
    node = byId.get(node.parent);
  }
  return false;
}

test('browser clicks export a passing regression that detects a changed action', async ({
  page, projectDir, devServer,
}) => {
  await expect(page.getByTestId('count')).toHaveText('0');
  await page.getByTestId('increment').click();
  await expect(page.getByTestId('count')).toHaveText('1');
  await page.getByTestId('increment').click();
  await expect(page.getByTestId('count')).toHaveText('2');

  const trace = await saveTrace(page, projectDir);
  expect(trace.determinism.status).toBe('deterministic');
  const clicks = trace.nodes.filter((node) => node.type === 'event' && node.eventType === 'click');
  expect(clicks).toHaveLength(2);
  for (const [index, click] of clicks.entries()) {
    const effects = trace.nodes.filter((node) => descendsFrom(node, click.id, trace.nodes));
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'action', name: 'increment' }),
      expect.objectContaining({ type: 'write', path: 'count', from: index, to: index + 1 }),
      expect.objectContaining({ type: 'dom', op: 'text' }),
    ]));
  }

  const options = { cwd: projectDir, timeout: 15_000, windowsHide: true };
  const view = await run(process.execPath, [cli, 'trace', 'view', 'latest'], options);
  expect(view.stdout).toContain('increment');
  const exported = 'regression/counter.test.mjs';
  await run(process.execPath, [cli, 'trace', 'export', 'latest', '--out', exported], options);
  const source = await fs.readFile(path.join(projectDir, exported), 'utf8');
  expect(source).toContain('result.verified');
  expect(source).not.toContain('allowBestEffort');

  // Resolve the published imports to this checkout, leaving the exported test
  // itself unchanged. The link is owned by this scratch project's fixture.
  await fs.mkdir(path.join(projectDir, 'node_modules'), { recursive: true });
  const link = path.join(projectDir, 'node_modules/avenx-core');
  await fs.symlink(repoRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const hook = pathToFileURL(path.join(repoRoot, 'test/helpers/register-happy-dom.js')).href;
    const args = ['--import', hook, path.join(projectDir, exported)];
    const passed = await run(process.execPath, args, options);
    expect(passed.stdout).toContain('✅');

    // Stop the watcher before introducing the deliberate regression. Only
    // the previously exported test is now run against the changed source.
    await terminate(devServer.child);
    const component = path.join(projectDir, componentPath);
    const original = await fs.readFile(component, 'utf8');
    await fs.writeFile(component, original.replace('count + 1', 'count + 2'));
    const failed = await run(process.execPath, args, options).then(
      (result) => ({ ...result, code: 0 }), (error) => error,
    );
    expect(failed.code).not.toBe(0);
    expect(failed.stdout + failed.stderr).toMatch(/diverg|mismatch|step/i);
    expect(failed.stdout + failed.stderr).toMatch(/count|increment/);
  } finally {
    await fs.unlink(link);
  }
});

test.describe('privacy', () => {
  test.use({ withBridge: true });

  test('a configured redaction withholds a bridge value recorded in the browser', async ({
    page, projectDir,
  }) => {
    await expect(page.getByTestId('ready')).toHaveText('false');
    await page.getByTestId('sign-in').click();
    await expect(page.getByTestId('ready')).toHaveText('true');
    const trace = await saveTrace(page, projectDir);
    expect(trace.redacted).toBe(true);
    expect(trace.redactions).toContain('token');
    expect(trace.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'bridge-action', name: 'signIn' }),
      expect.objectContaining({ type: 'write', path: 'token' }),
    ]));
    expect(JSON.stringify(trace)).not.toContain(secret);
  });
});

test('trace ingestion refuses bodies over 32 MiB without creating a trace', async ({
  devServer, projectDir, request,
}) => {
  const response = await request.post(`${devServer.url}/__avenx/trace`, {
    data: 'x'.repeat(32 * 1024 * 1024 + 1),
    headers: { 'Content-Type': 'application/json' },
  });
  expect(response.status()).toBe(413);
  await expect(fs.access(path.join(projectDir, '.avenx/traces'))).rejects.toThrow();
});

test.describe('without --trace', () => {
  test.use({ traceEnabled: false });

  test('the working app has no browser recorder or writable trace endpoint', async ({
    page, projectDir, devServer, request,
  }) => {
    await expect(page.getByTestId('count')).toHaveText('0');
    await page.getByTestId('increment').click();
    await expect(page.getByTestId('count')).toHaveText('1');
    expect(await page.evaluate(() => typeof window.avenxTrace)).toBe('undefined');
    const html = await (await request.get(`${devServer.url}/index.html`)).text();
    expect(html).not.toContain('installTraceRecorder');
    const response = await request.post(`${devServer.url}/__avenx/trace`, {
      data: { traceVersion: 1, id: 'unexpected', nodes: [] },
    });
    expect(await response.text()).not.toContain('"ok":true');
    await expect(fs.access(path.join(projectDir, '.avenx/traces'))).rejects.toThrow();
  });
});
