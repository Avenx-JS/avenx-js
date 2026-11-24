import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/avenx.js', import.meta.url));
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-quiet-'));
const write = (name, content) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const run = (...args) => spawnSync(process.execPath, [bin, ...args, '--force'], {
  cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
});
const component = 'src/components/hello/hello.component.js';

try {
  const config = JSON.stringify({ logging: { level: 'debug' }, hooks: { prebuild: 'node -e "process.exit(0)"' } });
  write('avenx.config.json', config);
  const configMtime = fs.statSync(path.join(root, 'avenx.config.json')).mtimeMs;
  write('src/main.app.js', "import { AvenxApp } from 'avenx-core/runtime';\n" +
    "import Hello from './components/hello/hello.component.js';\n" +
    "const app = new AvenxApp({ target: '#app' });\napp.register('Hello', Hello);\napp.mount('Hello');\n");
  write(component, '<state message="Hello" />\n<h1>{{ message }}</h1>');
  for (const command of ['build', 'check']) {
    for (const flag of ['--quiet', '-q']) {
      const result = run(command, flag);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '', `${command} progress should be silent`);
      assert.equal(result.stderr, '', `${command} should have no diagnostics`);
    }
    assert.notEqual(run(command).stdout, '', 'normal invocations retain progress');
  }
  assert.ok(fs.existsSync(path.join(root, 'dist/bundle.js')), 'quiet builds still produce output');

  write(component, '<p>{{ missing }}</p>');
  for (const command of ['build', 'check']) {
    const result = run(command, '--quiet');
    assert.equal(result.status, command === 'build' ? 0 : 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /AVX_W03/);
    assert.doesNotMatch(result.stderr, /Found \d+ validation|validation passed/);
  }
  const json = run('check', '--quiet', '--json');
  assert.equal(json.status, 1);
  assert.equal(json.stderr, '');
  const report = JSON.parse(json.stdout);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === 'AVX_W03'));

  write(component, '<action name="broken">1');
  for (const command of ['build', 'check']) {
    const result = run(command, '-q');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /AVX_C26/);
    if (command === 'build') assert.match(result.stderr, /Build failed/);
  }
  assert.equal(fs.readFileSync(path.join(root, 'avenx.config.json'), 'utf8'), config);
  assert.equal(fs.statSync(path.join(root, 'avenx.config.json')).mtimeMs, configMtime);

  write('avenx.config.json', JSON.stringify({ logging: { silent: true } }));
  const silentFailure = run('build', '--quiet');
  assert.equal(silentFailure.status, 1);
  assert.match(silentFailure.stderr, /Build failed/);
  console.log('Quiet build/check suppress progress, preserve diagnostics and JSON, and never edit config.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
