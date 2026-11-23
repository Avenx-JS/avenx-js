import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codeBlocks } from '../../scripts/check-doc-examples.js';

const script = fileURLToPath(new URL('../../scripts/check-doc-examples.js', import.meta.url));
const scratch = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-doc-harness-'));
const docs = path.join(scratch, 'docs');
const temporary = path.join(scratch, 'tmp');
fs.mkdirSync(docs);
fs.mkdirSync(temporary);

function run(source) {
  fs.writeFileSync(path.join(docs, 'example.md'), source);
  const result = spawnSync(process.execPath, [script, docs], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
    timeout: 90000,
  });
  assert.ifError(result.error);
  assert.deepEqual(fs.readdirSync(temporary), [], 'success and failure must clean their scratch projects');
  return { status: result.status, output: result.stdout + result.stderr };
}

try {
  const nested = codeBlocks('````markdown\n```js avenx-build\nfragment\n```\n````\n~~~js avenx-build\nvalid\n~~~\n', 'nested.md');
  assert.equal(nested.length, 2);
  assert.equal(nested.filter((block) => block.marker).length, 1);
  assert.equal(nested[1].line, 7);
  assert.throws(() => codeBlocks('```js avenx-build\nunfinished', 'broken.md'), /broken.md:2: unclosed/);

  const valid = run('# Example\n\n```javascript avenx-build\nconst app = new AvenxApp({ target: "#app" });\napp.mountPage("Home");\n```\n\n```js\nthis is an unmarked fragment\n```\n');
  assert.equal(valid.status, 0, valid.output);
  assert.match(valid.output, /example.md:4/);
  assert.match(valid.output, /1 covered, 1 unmarked, 0 failed/);

  const broken = run('# Broken\n\n```javascript avenx-build\nimport Missing from "./missing.component.js";\nconst app = new AvenxApp({ target: "#app" });\napp.registerComponent("missing", Missing);\n```\n');
  assert.equal(broken.status, 1, broken.output);
  assert.match(broken.output, /FAIL .*example.md:4/);
  assert.match(broken.output, /missing.component.js/);
  assert.match(broken.output, /1 covered, 0 unmarked, 1 failed/);

  const unknown = run('```js avenx-build=../../outside\nconst app = new AvenxApp();\n```\n');
  assert.equal(unknown.status, 1, unknown.output);
  assert.match(unknown.output, /Unknown documentation fixture/);
  const wrongLanguage = run('```json avenx-build\n{}\n```\n');
  assert.equal(wrongLanguage.status, 1, wrongLanguage.output);
  assert.match(wrongLanguage.output, /requires a javascript or js/);
  console.log('Documentation example harness: real builds, failure locations, fence boundaries and cleanup passed');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
