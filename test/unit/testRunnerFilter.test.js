import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const runnerPath = fileURLToPath(new URL('../run-tests.js', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-route-filter-'));
const testDirectory = path.join(root, 'test');

try {
  fs.mkdirSync(path.join(testDirectory, 'helpers'), { recursive: true });
  fs.mkdirSync(path.join(testDirectory, 'unit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(runnerPath, path.join(testDirectory, 'run-tests.js'));
  for (const helper of ['register-interpreter.js', 'register-happy-dom.js']) {
    fs.writeFileSync(path.join(testDirectory, 'helpers', helper), '');
  }
  fs.writeFileSync(path.join(testDirectory, 'unit', 'routeQuery.test.js'), 'console.log("ROUTE_SELECTED");');
  fs.writeFileSync(path.join(testDirectory, 'unit', 'unrelated.test.js'), 'console.log("UNRELATED_SELECTED");');

  const run = (filter) => spawnSync(process.execPath, [path.join(testDirectory, 'run-tests.js'), filter], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AVENX_TEST_CONCURRENCY: '2' },
  });

  for (const filter of ['route', 'unit/routeQuery', 'unit\\routeQuery']) {
    const result = run(filter);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('ROUTE_SELECTED'), `missing route test for ${filter}`);
    assert.ok(!result.stdout.includes('UNRELATED_SELECTED'), `unrelated test selected for ${filter}`);
  }

  for (const filter of ['test/unit', path.join(testDirectory, 'unit')]) {
    const result = run(filter);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes('ROUTE_SELECTED'));
    assert.ok(result.stdout.includes('UNRELATED_SELECTED'));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Test runner filters are independent of checkout paths.');
