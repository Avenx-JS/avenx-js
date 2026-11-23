import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-stats-compare-'));
function execute(file, args) {
  return spawnSync(process.execPath, [path.join(root, file), ...args], {
    cwd: temporary, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 4 * 1024 * 1024,
  });
}
function cli(...args) {
  return execute('bin/avenx.js', args);
}
function successful(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}
try {
  successful(cli('init', '--yes'));
  assert.equal(cli('stats', '--save').status, 1, 'a missing build must fail');
  successful(cli('build', '--force'));
  const saved = JSON.parse(successful(cli('stats', '--save', '--json')).stdout);
  const baselineFile = path.join(temporary, '.avenx/size-baseline.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(baselineFile, 'utf8')), saved);
  assert.ok(saved.assets['bundle.js'].raw > 0);
  assert.ok(saved.assets['bundle.css'].gzipped > 0);

  successful(execute('scripts/size-check.js', ['--action', 'build', '--repo', root, '--out', 'ci.json']));
  const ci = JSON.parse(fs.readFileSync(path.join(temporary, 'ci.json'), 'utf8'));
  assert.deepEqual(saved.assets['bundle.js'], ci.js, 'same scaffold build matches CI JS measurements');
  assert.deepEqual(saved.assets['bundle.css'], ci.css, 'same scaffold build matches CI CSS measurements');
  assert.deepEqual(saved.total, ci.total);

  const unchanged = JSON.parse(successful(cli('stats', '--compare', '--max-increase', '0%', '--json')).stdout);
  assert.equal(unchanged.exceeded, false);
  for (const metrics of Object.values(unchanged.total)) assert.equal(metrics.bytes, 0);

  fs.mkdirSync(path.join(temporary, 'dist/chunks'));
  fs.writeFileSync(path.join(temporary, 'dist/chunks/extra.js'), 'globalThis.extra = "new code";');
  const growth = cli('stats', '--compare', '--max-increase=0%', '--json');
  assert.equal(growth.status, 1);
  const larger = JSON.parse(growth.stdout);
  assert.equal(larger.exceeded, true);
  const added = larger.assets.find((asset) => asset.name === 'chunks/extra.js');
  assert.equal(added.status, 'added');
  assert.equal(added.metrics.raw.percent, null, 'growth from zero has no finite percentage');
  assert.ok(added.metrics.gzipped.bytes > 0);
  const text = successful(cli('stats', '--compare')).stdout;
  assert.match(text, /chunks\/extra.js \/ raw/);
  assert.match(text, /bundle.js \/ gzipped/);

  fs.rmSync(path.join(temporary, 'dist/bundle.css'));
  const removed = JSON.parse(successful(cli('stats', '--compare', '--json')).stdout)
    .assets.find((asset) => asset.name === 'bundle.css');
  assert.equal(removed.status, 'removed');
  assert.equal(removed.metrics.raw.current, 0);
  assert.equal(removed.metrics.raw.bytes, -saved.assets['bundle.css'].raw);

  successful(cli('stats', '--save=custom/baseline.json', '--json'));
  successful(cli('stats', '--compare', 'custom/baseline.json', '--max-increase', '5%', '--json'));
  for (const args of [['--save', '--compare'], ['--max-increase', '5%'],
    ['--compare', '--max-increase'], ['--compare', '--max-increase=-1%'], ['--compare', '--max-increase=NaN'],
    ['--save='], ['--compare', 'missing.json']]) {
    assert.equal(cli('stats', ...args).status, 1, args.join(' '));
  }
  fs.writeFileSync(baselineFile, JSON.stringify({ version: 1, assets: { 'bundle.js': { raw: -1 } } }));
  assert.equal(cli('stats', '--compare', '--json').status, 1);
  console.log('Bundle baselines, CI parity, deltas, chunks, removals and threshold exits pass.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
