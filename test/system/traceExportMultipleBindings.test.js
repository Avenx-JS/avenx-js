/**
 * Regression test for #1764:
 * Multiple text bindings inside the same DOM element.
 *
 * Verifies that:
 * - Individual binding values are not compared against
 *   the entire element textContent.
 * - An exported regression test passes against the
 *   original component.
 * - Replay detects incorrect state updates.
 * - Replay detects incorrect DOM text operations even
 *   when the state updates remain unchanged.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

console.log('Testing trace export with multiple bindings in the same element...');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-multiple-bindings-'));

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

try {
  // 1. Create a real component containing two text bindings.
  const componentPath = path.join(workDir, 'src/components/multiple/multiple.component.js');

  function writeComponent({ incrementSecond = 2, secondExpression = 'second' } = {}) {
    write(
      componentPath,
      [
        '<state first="0" second="0" />',
        '',
        '<action name="update">',
        '  state.first = state.first + 1;',
        `  state.second = state.second + ${incrementSecond};`,
        '</action>',
        '',
        '<div class="example">',
        `  <p class="values">{{ first }} / {{ ${secondExpression} }}</p>`,
        '  <button class="update" @click="update()">Update</button>',
        '</div>',
        '',
      ].join('\n'),
    );

    write(path.join(workDir, 'src/components/multiple/multiple.component.css'), '');
  }

  writeComponent();

  // 2. Record real interactions and export the trace.
  const recordScript = path.join(workDir, 'record.mjs');

  write(
    recordScript,
    `
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { loadComponent } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/tooling/index.js')).href)};

import { mountTestComponent, flushPromises } from ${JSON.stringify(
    pathToFileURL(path.join(repoRoot, 'lib/core/testing.js')).href,
  )};

import { startRecording, stopRecording } from ${JSON.stringify(
    pathToFileURL(path.join(repoRoot, 'lib/core/trace/recorder.js')).href,
  )};

import { generateTest } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/trace/exportTest.js')).href)};

const Component = loadComponent(${JSON.stringify(componentPath)});
const wrapper = await mountTestComponent(Component, {});

const recorder = startRecording({
  id: 'multiple-text-bindings',
  meta: { url: 'http://localhost:3000/' },
});

recorder.arm();

wrapper.find('button.update').dispatchEvent(
  new window.MouseEvent('click', { bubbles: true }),
);

await flushPromises();

assert.strictEqual(
  wrapper.find('p.values').textContent.trim(),
  '1 / 2',
  'both text bindings should contribute to the element text',
);

wrapper.find('button.update').dispatchEvent(
  new window.MouseEvent('click', { bubbles: true }),
);

await flushPromises();

assert.strictEqual(
  wrapper.find('p.values').textContent.trim(),
  '2 / 4',
  'both text bindings should update after the second click',
);

stopRecording();

const trace = recorder.toJSON();
wrapper.unmount();

fs.writeFileSync(
  ${JSON.stringify(path.join(workDir, 'multiple.trace.json'))},
  JSON.stringify(trace, null, 2),
);

fs.writeFileSync(
  ${JSON.stringify(path.join(workDir, 'generated.test.mjs'))},
  generateTest(trace, {
    tracePath: './multiple.trace.json',
    componentPath: './src/components/multiple/multiple.component.js',
    componentName: 'MultipleBindings',
    title: 'multiple text bindings in the same element',
  }),
);

console.log('DETERMINISM:' + trace.determinism.status);
`,
  );

  function runScript(scriptPath) {
    return spawnSync(
      process.execPath,
      ['--import', path.join(repoRoot, 'test/helpers/register-happy-dom.js'), scriptPath],
      {
        encoding: 'utf8',
        cwd: repoRoot,
      },
    );
  }

  const recordRun = runScript(recordScript);

  assert.strictEqual(recordRun.status, 0, `recording failed:\n${recordRun.stdout}\n${recordRun.stderr}`);

  assert.ok(
    recordRun.stdout.includes('DETERMINISM:deterministic'),
    `the recorded trace must be deterministic:\n${recordRun.stdout}`,
  );

  console.log('PASS: real interactions recorded successfully');

  // 3. Inspect the exported regression test.
  const generatedPath = path.join(workDir, 'generated.test.mjs');

  const generated = fs.readFileSync(generatedPath, 'utf8');

  assert.ok(generated.includes('case 0:'), 'the generated test must include the first recorded input');

  assert.ok(generated.includes('case 1:'), 'the generated test must include the second recorded input');

  assert.ok(
    !generated.includes('.textContent'),
    'individual binding values must not be asserted against the complete element text',
  );

  assert.ok(generated.includes('result.verified'), 'the generated test must verify deterministic replay');

  assert.ok(!generated.includes('allowBestEffort'), 'deterministic replay must not opt out of verification');

  console.log('PASS: generated test avoids incorrect text assertions');

  // 4. Resolve imports against the current repository.
  const runnablePath = path.join(workDir, 'runnable.test.mjs');

  write(
    runnablePath,
    generated
      .replace("'avenx-core/testing'", JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/testing.js')).href))
      .replace(
        "'avenx-core/tooling'",
        JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/tooling/index.js')).href),
      ),
  );

  // 5. The exported test must pass against the original component.
  const passRun = runScript(runnablePath);

  assert.strictEqual(
    passRun.status,
    0,
    `the generated test must pass against the original component:\n${passRun.stdout}\n${passRun.stderr}`,
  );

  console.log('PASS: generated regression test runs successfully');

  // 6. Introduce an incorrect state update.
  writeComponent({
    incrementSecond: 3,
  });

  const stateFailRun = runScript(runnablePath);

  assert.notStrictEqual(stateFailRun.status, 0, 'the generated test must fail when a binding state update changes');

  const stateFailOutput = `${stateFailRun.stdout}\n${stateFailRun.stderr}`;

  assert.ok(
    stateFailOutput.includes('AVX_R27'),
    `an incorrect state update must cause a replay divergence:\n${stateFailOutput}`,
  );

  console.log('PASS: incorrect state updates are detected');

  // 7. Introduce a DOM-only regression.
  // State updates remain identical to the original recording.
  // Only the rendered expression changes.
  writeComponent({
    incrementSecond: 2,
    secondExpression: 'second + 10',
  });

  const domFailRun = runScript(runnablePath);

  assert.notStrictEqual(
    domFailRun.status,
    0,
    'the generated test must fail when rendered text changes despite identical state updates',
  );

  const domFailOutput = `${domFailRun.stdout}\n${domFailRun.stderr}`;

  assert.ok(
    domFailOutput.includes('AVX_R27'),
    `incorrect rendered text must cause a replay divergence:\n${domFailOutput}`,
  );

  console.log('PASS: DOM-only text regressions are detected');

  console.log('PASS: trace export supports multiple bindings and detects regressions');
} finally {
  fs.rmSync(workDir, {
    recursive: true,
    force: true,
  });
}
