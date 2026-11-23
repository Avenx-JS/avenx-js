import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { saveTrace } from '../../lib/core/trace/store.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-trace-diff-')));
const componentPath = path.join(workDir, 'src/components/counter/counter.component.js');
const recordScript = path.join(workDir, 'record.mjs');
const hook = pathToFileURL(path.join(root, 'test/helpers/register-happy-dom.js')).href;
const moduleURL = (name) => JSON.stringify(pathToFileURL(path.join(root, 'lib/core', name)).href);

/**
 * Invokes the actual CLI from a project directory.
 * @param {string[]} args - Command arguments.
 * @returns {object} Process result.
 */
function cli(args) {
  return spawnSync(process.execPath, [path.join(root, 'bin/avenx.js'), 'trace', 'diff', ...args], {
    cwd: workDir,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

/**
 * Compiles, mounts and records a real component in an independent process.
 * @param {string} name - The output recording name.
 * @returns {object} The recording produced by the runtime.
 */
function record(name) {
  const run = spawnSync(process.execPath, ['--import', hook, recordScript, name], {
    cwd: workDir,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.strictEqual(run.status, 0, run.stderr || run.error?.message);
  return JSON.parse(fs.readFileSync(path.join(workDir, `${name}.trace.json`), 'utf8'));
}

try {
  fs.mkdirSync(path.dirname(componentPath), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'avenx.config.json'), JSON.stringify({ srcDir: 'src' }));
  const source =
    '<state count="0" analytics="0" />\n' +
    '<action name="increment">state.count += 1;</action>\n' +
    '<div><button id="inc" @click="increment()">+</button><span id="count">{{ count }}</span><span id="badge">{{ analytics }}</span></div>';
  fs.writeFileSync(componentPath, source);
  fs.writeFileSync(componentPath.replace('.js', '.css'), '');
  fs.writeFileSync(
    recordScript,
    `
import fs from 'fs';
import { loadComponent } from ${moduleURL('tooling/index.js')};
import { mountTestComponent, flushPromises } from ${moduleURL('testing.js')};
import { startRecording, stopRecording } from ${moduleURL('trace/recorder.js')};
const Component = loadComponent(${JSON.stringify(componentPath)});
const wrapper = await mountTestComponent(Component, {});
const recorder = startRecording({ id: process.argv[2] });
recorder.arm();
try {
  wrapper.find('#inc').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flushPromises();
} finally {
  stopRecording();
  wrapper.unmount();
}
fs.writeFileSync(process.argv[2] + '.trace.json', JSON.stringify(recorder.toJSON()));
`,
  );

  const baseline = record('before');
  record('unchanged');
  let run = cli(['before.trace.json', 'unchanged.trace.json', '--json', '--fail-on-change']);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(JSON.parse(run.stdout).changed, false, 'unchanged real recordings have no noise diff');

  fs.writeFileSync(componentPath, source.replace('state.count += 1;', 'state.count += 1; state.analytics += 1;'));
  const changed = record('after');
  const oldFile = saveTrace(workDir, baseline);
  saveTrace(workDir, changed);
  const oldTime = Date.now() / 1000 - 60;
  fs.utimesSync(oldFile, oldTime, oldTime);

  run = cli(['before', 'latest', '--json']);
  assert.strictEqual(run.status, 0, run.stderr);
  const comparison = JSON.parse(run.stdout);
  assert.strictEqual(comparison.comparable, true);
  assert.strictEqual(comparison.steps.length, 1);
  assert.ok(comparison.steps[0].nodes.some((node) => node.status === 'added' && node.after.path === 'analytics'));
  assert.ok(comparison.summary.domAfter > comparison.summary.domBefore, 'the extra DOM patch is counted');
  assert.strictEqual(cli(['before', 'after', '--fail-on-change']).status, 1);
  run = cli(['before.trace.json', 'after.trace.json']);
  assert.strictEqual(run.status, 0);
  assert.ok(run.stdout.includes('analytics'));
  assert.ok(run.stdout.includes('DOM patches:'));

  const different = structuredClone(changed);
  different.nodes.find((node) => node.type === 'event').eventType = 'input';
  fs.writeFileSync(path.join(workDir, 'different.trace.json'), JSON.stringify(different));
  run = cli(['before', 'different.trace.json', '--json']);
  assert.strictEqual(run.status, 1);
  assert.strictEqual(JSON.parse(run.stdout).comparable, false);
  assert.strictEqual(cli(['before']).status, 1);
  assert.strictEqual(cli(['missing', 'latest']).status, 1);
  fs.writeFileSync(path.join(workDir, 'invalid.trace.json'), '{invalid');
  assert.strictEqual(cli(['invalid.trace.json', 'latest']).status, 1);
  console.log('Trace diff records, recompiles and compares a real interaction successfully.');
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
