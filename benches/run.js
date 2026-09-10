import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const benchesDir = __dirname;
const bootstrapUrl = pathToFileURL(path.join(benchesDir, 'support/environment.js')).href;
const files = fs.readdirSync(benchesDir).filter((f) => f.endsWith('.bench.js'));

const isJson = process.argv.includes('--json');
const results = [];

/**
 * Benchmarks that exited non-zero.
 *
 * A runner that reports success while a benchmark crashes is worse than no
 * runner: `quality-results.yml` publishes this output to a public results
 * repository every week, so a crash used to become a silently missing row
 * rather than a red build. Two had been broken for long enough to encode claims
 * about code that no longer existed.
 * @type {Array<{file: string, status: number, stderr: string}>}
 */
const failures = [];

if (!isJson) {
  console.log('--- Avenx-JS Benchmarks ---');
  console.log(`Found ${files.length} benchmarks.\n`);
}

files.forEach((file) => {
  if (!isJson) console.log(`[Running] ${file}`);
  // Every benchmark runs with the expression interpreter installed. A benchmark
  // builds components directly, so nothing compiled their expressions the way a
  // build would -- without this, a render benchmark measures a binding that
  // throws and reports the resulting near-zero as an improvement.
  const result = spawnSync(
    'node',
    ['--import', bootstrapUrl, path.join(benchesDir, file)],
    { encoding: 'utf-8' },
  );

  const output = result.stdout || '';
  if (result.status !== 0) {
    failures.push({
      file,
      status: result.status === null ? -1 : result.status,
      stderr: (result.stderr || '').trim().split('\n').slice(-6).join('\n'),
    });
  }

  if (!isJson) {
    if (output) console.log(output);
    if (result.stderr) console.error(result.stderr);
    console.log('---------------------------');
  } else {
    // Parse output
    const nameMatch = output.match(/Running (.*?) benchmark/);
    const totalTimeMatch = output.match(/Total time: ([\d.]+)ms/);
    const avgTimeMatch = output.match(/Average time per .*?: ([\d.]+)ms/);
    const opsMatch = output.match(/Ops\/sec: (\d+)/);

    results.push({
      file,
      name: nameMatch ? nameMatch[1] : file,
      totalTime: totalTimeMatch ? parseFloat(totalTimeMatch[1]) : 0,
      avgTime: avgTimeMatch ? parseFloat(avgTimeMatch[1]) : 0,
      ops: opsMatch ? parseInt(opsMatch[1], 10) : 0,
      timestamp: new Date().toISOString(),
    });
  }
});

if (isJson) {
  console.log(JSON.stringify(results, null, 2));
}

if (failures.length > 0) {
  const report = failures
    .map((entry) => `  ${entry.file} (exit ${entry.status})\n${entry.stderr.replace(/^/gm, '    ')}`)
    .join('\n');
  console.error(`\n${failures.length} benchmark(s) failed:\n${report}`);
  process.exit(1);
}

if (!isJson) {
  console.log(`\nAll ${files.length} benchmarks completed.`);
}
