/**
 * Regression test for #1764:
 * Text bindings mixed with literal text inside the same DOM element.
 *
 * Covers:
 * 1. One binding with literal text: "Value: 1"
 * 2. Multiple bindings separated by literal text: "1 / 2"
 * 3. The exported test must not compare a text operation
 *    against the element's full textContent.
 * 4. Replay must pass for the original component and fail
 *    when a binding update is incorrect.
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

// `--import` takes a module specifier, not a path. A bare `C:\...` is read as a
// URL with the scheme `c:` and refused on Windows, so it is passed as a file URL.
const HAPPY_DOM_HOOK = pathToFileURL(path.join(repoRoot, 'test/helpers/register-happy-dom.js')).href;

console.log('Testing trace export with literal text and bindings...');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-literal-text-'));

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

try {
  // 1. Create a real Avenx component with both literal-text cases.
  const componentPath = path.join(workDir, 'src/components/literal/literal.component.js');

  function writeComponent(incrementSecond) {
    write(
      componentPath,
      [
        '<state count="0" first="0" second="0" />',
        '',
        '<action name="update">',
        '  state.count = state.count + 1;',
        '  state.first = state.first + 1;',
        `  state.second = state.second + ${incrementSecond};`,
        '</action>',
        '',
        '<div class="example">',
        '  <span class="single">Value: {{ count }}</span>',
        '  <span class="multiple">{{ first }} / {{ second }}</span>',
        '  <button class="update" @click="update()">Update</button>',
        '</div>',
        '',
      ].join('\n'),
    );

    write(path.join(workDir, 'src/components/literal/literal.component.css'), '');
  }

  writeComponent(1);

  // 2. Record real interactions and generate the exported test.
  const recordScript = path.join(workDir, 'record.mjs');

  write(
    recordScript,
    `
import fs from 'node:fs';
import { loadComponent } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/tooling/index.js')).href)};
import { mountTestComponent, flushPromises } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/testing.js')).href)};
import { startRecording, stopRecording } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/trace/recorder.js')).href)};
import { generateTest } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'lib/core/trace/exportTest.js')).href)};

const Component = loadComponent(${JSON.stringify(componentPath)});
const wrapper = await mountTestComponent(Component, {});

const recorder = startRecording({
  id: 'literal-text-bindings',
  meta: { url: 'http://localhost:3000/' },
});

recorder.arm();

for (let i = 0; i < 2; i++) {
  wrapper.find('button.update').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await flushPromises();
}

stopRecording();
wrapper.unmount();

const trace = recorder.toJSON();

fs.writeFileSync(
  ${JSON.stringify(path.join(workDir, 'literal.trace.json'))},
  JSON.stringify(trace, null, 2),
);

fs.writeFileSync(
  ${JSON.stringify(path.join(workDir, 'generated.test.mjs'))},
  generateTest(trace, {
    tracePath: './literal.trace.json',
    componentPath: './src/components/literal/literal.component.js',
    componentName: 'LiteralText',
    title: 'text bindings with literal text',
  }),
);

console.log('DETERMINISM:' + trace.determinism.status);
`,
  );

  const recordRun = spawnSync(process.execPath, ['--import', HAPPY_DOM_HOOK, recordScript], {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  assert.strictEqual(recordRun.status, 0, `recording failed:\n${recordRun.stdout}\n${recordRun.stderr}`);

  assert.ok(
    recordRun.stdout.includes('DETERMINISM:deterministic'),
    `the recorded session should be deterministic:\n${recordRun.stdout}`,
  );

  // 3. Inspect the generated test.
  const generatedPath = path.join(workDir, 'generated.test.mjs');
  const generated = fs.readFileSync(generatedPath, 'utf8');

  assert.ok(generated.includes('case 0:'), 'the generated test contains the first recorded input');
  assert.ok(generated.includes('case 1:'), 'the generated test contains the second recorded input');

  assert.ok(
    !generated.includes('.textContent'),
    'the generated test must not compare a text binding with the whole element text',
  );

  assert.ok(generated.includes('result.verified'), 'a deterministic trace must verify replay');

  // 4. Make the generated test runnable from this checkout.
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

  // 5. The generated test must pass against the original component.
  const passRun = spawnSync(process.execPath, ['--import', HAPPY_DOM_HOOK, runnablePath], {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  assert.strictEqual(
    passRun.status,
    0,
    `the generated test should pass against the original component:\n${passRun.stdout}\n${passRun.stderr}`,
  );

  // 6. Change one binding update and verify that replay catches it.
  writeComponent(2);

  const failRun = spawnSync(process.execPath, ['--import', HAPPY_DOM_HOOK, runnablePath], {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  assert.notStrictEqual(failRun.status, 0, 'the generated test must fail when a binding update changes');

  const failOutput = `${failRun.stdout}\n${failRun.stderr}`;

  assert.ok(failOutput.includes('AVX_R27'), `the changed component should cause a replay divergence:\n${failOutput}`);

  console.log('PASS: literal text bindings are verified by replay, and incorrect updates are detected');
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
