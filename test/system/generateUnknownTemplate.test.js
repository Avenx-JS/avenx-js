import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateComponent } from '../../bin/commands/generate.js';

const frameworkDir = fileURLToPath(new URL('../../', import.meta.url));
const binPath = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-unknown-template-'));

const cli = {
  baseDir,
  frameworkDir,
  config: {
    srcDir: 'src',
    templatesDir: '.avenxtemplates',
    generate: { withTests: false },
  },
};

const folder = path.join(baseDir, '.avenxtemplates', 'component');
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'card.component.js.template'), '<p>{{PascalCaseName}} card</p>');

try {
  // 1. A named template that does not exist must stop generation before any file is written.
  assert.throws(
    () => generateComponent(cli, 'bar', { templateName: 'ghost' }),
    (err) =>
      err.code === 'AVENX_TEMPLATE_NOT_FOUND' &&
      err.message.includes('"ghost"') &&
      err.message.includes('.avenxtemplates') &&
      err.message.includes('card'),
  );

  assert.equal(fs.existsSync(path.join(baseDir, 'src/components/bar')), false, 'Unexpected component folder');

  // 2. The CLI dispatch in bin/cli.js must turn that error into exit code 1 and write nothing.
  const run = spawnSync(process.execPath, [binPath, 'generate', 'component', 'Bar', '--template', 'ghost'], {
    cwd: baseDir,
    encoding: 'utf8',
  });

  assert.equal(run.status, 1, `Expected exit 1, got ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /No scaffold template named "ghost"/);
  assert.equal(fs.existsSync(path.join(baseDir, 'src/components/bar')), false, 'Unexpected component folder from CLI');

  // 3. A named template that exists must scaffold from the custom file.
  generateComponent(cli, 'card-demo', { templateName: 'card', noStyle: true });

  assert.equal(
    fs.readFileSync(path.join(baseDir, 'src/components/card-demo/card-demo.component.js'), 'utf8'),
    '<p>CardDemo card</p>',
  );

  // 4. A named template that overrides only the JS file falls back to the built-in CSS for the rest of the kind.
  generateComponent(cli, 'card-style', { templateName: 'card', noStyle: false });

  assert.equal(
    fs.readFileSync(path.join(baseDir, 'src/components/card-style/card-style.component.js'), 'utf8'),
    '<p>CardStyle card</p>',
  );
  assert.equal(fs.existsSync(path.join(baseDir, 'src/components/card-style/card-style.component.css')), true);

  console.log('PASS: unknown --template names fail instead of using the built-in scaffold');
} finally {
  fs.rmSync(baseDir, { recursive: true, force: true });
}
