import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateComponent,
  generatePage,
  generateBridge,
  generateGuard,
  generateTest,
} from '../../bin/commands/generate.js';

const frameworkDir = fileURLToPath(new URL('../../', import.meta.url));

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-1758-'));

const cli = {
  baseDir,
  frameworkDir,
  config: {
    srcDir: 'src',
    templatesDir: '.avenxtemplates',
    generate: { withTests: false },
  },
};

const templateText = '{{ name }} | {{name}} | {{PascalCaseName}} | {{file}}';

function setTemplate(type, file, content = templateText) {
  const folder = path.join(baseDir, '.avenxtemplates', type);

  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, file), content);
}

function generated(file) {
  return fs.readFileSync(path.join(baseDir, file), 'utf8');
}

function assertNoOutput(file) {
  assert.equal(fs.existsSync(path.join(baseDir, file)), false, `Unexpected file: ${file}`);
}

try {
  // 1. Component generation and custom test override.
  for (const file of ['component.js.template', 'component.css.template', 'component.test.js.template']) {
    setTemplate('component', file);
  }

  generateComponent(cli, 'my-counter', {
    withTest: true,
  });

  const root = 'src/components/my-counter/my-counter.component';

  const canonical = 'MyCounter | MyCounter | MyCounter | my-counter';

  assert.equal(generated(`${root}.js`), canonical);
  assert.equal(generated(`${root}.css`), canonical);

  // Legacy test {{name}} must still mean the filename.
  assert.equal(generated(`${root}.test.js`), 'MyCounter | my-counter | MyCounter | my-counter');

  // 2. Page templates.
  setTemplate('page', 'page.js.template');
  setTemplate('page', 'page.css.template');

  generatePage(cli, 'my-page');

  assert.equal(generated('src/pages/my-page.page.js'), 'MyPage | MyPage | MyPage | my-page');

  assert.equal(generated('src/pages/my-page.page.css'), 'MyPage | MyPage | MyPage | my-page');

  // 3. Bridge naming conventions.
  setTemplate('bridge', 'bridge.js.template');
  generateBridge(cli, 'my-bridge');

  assert.equal(generated('src/global/my-bridge.bridge.js'), 'myBridge | MyBridge | MyBridge | my-bridge');

  // 4. Guard naming conventions.
  setTemplate('guard', 'guard.js.template');
  generateGuard(cli, 'auth');

  assert.equal(generated('src/guards/auth.guard.js'), 'AuthGuard | AuthGuard | AuthGuard | auth');

  for (const [kind, name, file, expected] of [
    ['page', 'my-page', 'src/pages/my-page.page.test.js', 'MyPage | MyPage | MyPage | my-page'],
    ['bridge', 'my-bridge', 'src/global/my-bridge.bridge.test.js', 'myBridge | MyBridge | MyBridge | my-bridge'],
    ['guard', 'auth', 'src/guards/auth.guard.test.js', 'AuthGuard | AuthGuard | AuthGuard | auth'],
  ]) {
    setTemplate(kind, `${kind}.test.js.template`);
    generateTest(cli, name);
    assert.equal(generated(file), expected);
  }
  generatePage(cli, 'tested-page', { withTest: true });
  assert.equal(generated('src/pages/tested-page.page.test.js'), 'TestedPage | TestedPage | TestedPage | tested-page');

  setTemplate('page', 'page.test.js.template', '{{PascalCaseNam}}');
  for (const dryRun of [false, true]) {
    assert.throws(() => generatePage(cli, 'broken-page', { withTest: true, dryRun }), /Unknown generator placeholder/);
    for (const extension of ['js', 'css', 'test.js']) assertNoOutput(`src/pages/broken-page.page.${extension}`);
  }

  // 5. Runtime bindings must not be removed.
  setTemplate(
    'component',
    'component.js.template',
    '<state count="0" />\n' + '<p>{{ count }}</p>\n' + '<p>{{ props.title }}</p>\n' + '<p>{{ otherValue }}</p>',
  );

  generateComponent(cli, 'runtime-example');

  const runtime = generated('src/components/runtime-example/runtime-example.component.js');

  assert.match(runtime, /{{ count }}/);
  assert.match(runtime, /{{ props.title }}/);
  assert.match(runtime, /{{ otherValue }}/);

  // 6. A typo in a test template must abort generation.
  setTemplate('component', 'component.test.js.template', 'import {{PascalCaseNam}} from "./example.js";');

  assert.throws(
    () =>
      generateComponent(cli, 'broken', {
        withTest: true,
      }),
    (err) =>
      err.message.includes('component.test.js.template') &&
      err.message.includes('{{PascalCaseNam}}') &&
      err.message.includes('{{PascalCaseName}}'),
  );

  // No partial generated files should remain.
  assertNoOutput('src/components/broken/broken.component.js');

  assertNoOutput('src/components/broken/broken.component.css');

  assertNoOutput('src/components/broken/broken.component.test.js');

  // 7. Generator typos inside components must be detected.
  setTemplate('component', 'component.js.template', '<p>{{PascalCaseNam}}</p>');

  assert.throws(() => generateComponent(cli, 'broken-component'), /Did you mean "{{PascalCaseName}}"/);

  assertNoOutput('src/components/broken-component/broken-component.component.js');

  console.log('PASS: issue #1758 custom template regression tests');
} finally {
  fs.rmSync(baseDir, {
    recursive: true,
    force: true,
  });
}
