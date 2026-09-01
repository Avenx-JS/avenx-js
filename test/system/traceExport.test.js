/**
 * Proves the export path end to end: record a real interaction against a real
 * project component, generate a test file from the trace, run that file as a
 * separate process, and confirm it both passes against the original code and
 * fails against a regression.
 *
 * This is a system test rather than a unit test because "the generated test is
 * executable" is only a meaningful claim if the file is actually executed.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

console.log('🧪 Testing trace export produces a runnable regression test...');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-trace-export-'));

/**
 * Writes a file, creating parent directories.
 * @param {string} filePath - Destination.
 * @param {string} contents - What to write.
 */
function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

try {
  // 1. A real Avenx component, in Avenx's own template syntax.
  const componentPath = path.join(workDir, 'src/components/counter/counter.component.js');
  write(
    componentPath,
    [
      '<state count="0" />',
      '',
      '<action name="increment"> state.count = state.count + 1; </action>',
      '',
      '<div class="counter">',
      '  <span class="value">{{ count }}</span>',
      '  <button class="inc" @click="increment()">+</button>',
      '</div>',
      '',
    ].join('\n'),
  );
  write(path.join(workDir, 'src/components/counter/counter.component.css'), '');

  // 2. Record a session against it, exactly as `avenx serve --trace` would.
  const recordScript = path.join(workDir, 'record.mjs');
  write(
    recordScript,
    `
import fs from 'fs';
import { loadComponent } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/tooling/index.js')).href)};
import { mountTestComponent, flushPromises } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/testing.js')).href)};
import { startRecording, stopRecording } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/trace/recorder.js')).href)};
import { generateTest } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/trace/exportTest.js')).href)};

const Counter = loadComponent(${JSON.stringify(componentPath)});
const wrapper = await mountTestComponent(Counter, {});

const recorder = startRecording({ id: 'trace-export', meta: { url: 'http://localhost:3000/' } });
recorder.arm();
for (let i = 0; i < 2; i++) {
  wrapper.find('button.inc').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flushPromises();
}
stopRecording();
wrapper.unmount();

const trace = recorder.toJSON();
fs.writeFileSync(${JSON.stringify(path.join(workDir, 'counter.trace.json'))}, JSON.stringify(trace, null, 2));
fs.writeFileSync(
  ${JSON.stringify(path.join(workDir, 'generated.test.mjs'))},
  generateTest(trace, {
    tracePath: './counter.trace.json',
    componentPath: './src/components/counter/counter.component.js',
    componentName: 'Counter',
    title: 'counter increments on click',
  }),
);
console.log('DETERMINISM:' + trace.determinism.status);
`,
  );

  const recordRun = spawnSync(
    process.execPath,
    ['--import', path.join(repoRoot, 'test/helpers/register-happy-dom.js'), recordScript],
    { encoding: 'utf8', cwd: repoRoot },
  );
  assert.strictEqual(recordRun.status, 0, `recording failed:\n${recordRun.stderr}`);
  assert.ok(
    recordRun.stdout.includes('DETERMINISM:deterministic'),
    `the recorded session should be deterministic, got:\n${recordRun.stdout}`,
  );

  // 3. The generated file looks like a test a person would accept in review.
  const generatedPath = path.join(workDir, 'generated.test.mjs');
  const generated = fs.readFileSync(generatedPath, 'utf8');

  assert.ok(generated.includes("import { mountTestComponent, replay } from 'avenx-core/testing';"),
    'the generated test uses the published testing entry point');
  assert.ok(generated.includes("with { type: 'json' }"), 'the trace is imported as JSON');
  assert.ok(generated.includes('avenx trace export trace-export'), 'the header says where it came from');
  assert.ok(generated.includes('case 0:') && generated.includes('case 1:'), 'one branch per recorded input');
  assert.ok(generated.includes('assert.strictEqual'), 'assertions were generated');
  assert.ok(generated.includes('textContent.trim(), "1"'), 'the first click asserts the recorded DOM text');
  assert.ok(generated.includes('textContent.trim(), "2"'), 'the second click asserts its own value');
  assert.ok(generated.includes('result.verified'), 'a deterministic trace asserts verification');
  assert.ok(!generated.includes('allowBestEffort'), 'a deterministic trace does not opt out of verification');

  // 4. It runs, against the real component, and passes.
  //    Import specifiers are rewritten to this checkout so the generated file
  //    can run without avenx-core being installed in the temp project.
  const runnablePath = path.join(workDir, 'runnable.test.mjs');
  write(
    runnablePath,
    generated
      .replace(
        "'avenx-core/testing'",
        JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/testing.js')).href),
      )
      .replace(
        "'avenx-core/tooling'",
        JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/tooling/index.js')).href),
      ),
  );

  const passRun = spawnSync(
    process.execPath,
    ['--import', path.join(repoRoot, 'test/helpers/register-happy-dom.js'), runnablePath],
    { encoding: 'utf8', cwd: repoRoot },
  );
  assert.strictEqual(
    passRun.status,
    0,
    `the generated test should pass against the code it was recorded from:\n${passRun.stdout}\n${passRun.stderr}`,
  );
  assert.ok(passRun.stdout.includes('✅'), 'the generated test reported success');

  // 5. Break the component the way a regression would, and confirm the
  //    generated test catches it. A test that cannot fail is not a test.
  write(
    componentPath,
    [
      '<state count="0" />',
      '',
      '<action name="increment"> state.count = state.count + 2; </action>',
      '',
      '<div class="counter">',
      '  <span class="value">{{ count }}</span>',
      '  <button class="inc" @click="increment()">+</button>',
      '</div>',
      '',
    ].join('\n'),
  );

  const failRun = spawnSync(
    process.execPath,
    ['--import', path.join(repoRoot, 'test/helpers/register-happy-dom.js'), runnablePath],
    { encoding: 'utf8', cwd: repoRoot },
  );
  assert.notStrictEqual(failRun.status, 0, 'the generated test must fail once the behaviour changes');
  const failOutput = `${failRun.stdout}\n${failRun.stderr}`;
  assert.ok(failOutput.includes('AVX_R27'), `the failure is reported as a replay divergence:\n${failOutput}`);
  assert.ok(
    failOutput.includes('write count 0 -> 1'),
    'the failure names what the recording expected',
  );
  assert.ok(
    failOutput.includes('write count 0 -> 2'),
    'and what the changed code actually did',
  );

  console.log('✅ Trace export produces a regression test that passes, and fails when the code regresses.');
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
