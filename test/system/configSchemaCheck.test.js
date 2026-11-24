import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const temporary = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-schema-check-'));
try {
  fs.mkdirSync(path.join(temporary, 'scripts'));
  fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(repository, 'scripts/generateConfigSchema.js'), path.join(temporary, 'scripts/generateConfigSchema.js'));
  fs.symlinkSync(path.join(repository, 'lib'), path.join(temporary, 'lib'), 'junction');
  const run = (...args) => spawnSync(process.execPath, ['scripts/generateConfigSchema.js', ...args], {
    cwd: temporary, encoding: 'utf8',
  });
  const output = path.join(temporary, 'schema/avenx.config.schema.json');
  const missing = run('--check');
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /npm run generate:config-schema/);
  assert.equal(fs.existsSync(path.dirname(output)), false, 'check must not create directories');

  assert.equal(run().status, 0);
  const expected = fs.readFileSync(output, 'utf8');
  const unchanged = () => [fs.readFileSync(output, 'utf8'), fs.statSync(output).mtimeMs];
  for (const content of [expected, expected.replace(/\n/g, '\r\n')]) {
    fs.writeFileSync(output, content);
    const before = unchanged();
    assert.equal(run('--check').status, 0);
    assert.deepEqual(unchanged(), before);
  }
  for (const content of ['{}\n', `${expected}\nextra`]) {
    fs.writeFileSync(output, content);
    const before = unchanged();
    const stale = run('--check');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /npm run generate:config-schema/);
    assert.doesNotMatch(stale.stderr, /line 0/);
    assert.deepEqual(unchanged(), before, 'check must preserve stale bytes and mtime');
  }
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), expected);
  console.log('Schema checks reject missing/stale files without writes; default generation is unchanged.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
