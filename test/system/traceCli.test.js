/**
 * Exercises the `avenx trace` commands against a real project directory, by
 * running the CLI as a subprocess the way a developer does.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createTrace, Determinism, NonDeterminismReason, TraceNodeType } from '../../lib/core/trace/schema.js';
import { saveTrace, listTraces, loadTrace, isValidTraceId } from '../../lib/core/trace/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

console.log('🧪 Testing the avenx trace CLI...');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-trace-cli-'));

/**
 * Runs the CLI in the temp project.
 * @param {string[]} args - CLI arguments.
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function avenx(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

/**
 * Builds a small but complete trace for the CLI to operate on.
 * @param {string} id - The trace id.
 * @param {object} [overrides] - Fields to merge into the envelope.
 * @returns {object} A trace.
 */
function makeTrace(id, overrides = {}) {
  const trace = createTrace({ url: 'http://localhost:3000/#/cart' });
  trace.id = id;
  trace.createdAt = new Date().toISOString();
  trace.nodes = [
    {
      id: 1,
      parent: null,
      seq: 1,
      type: TraceNodeType.EVENT,
      eventType: 'click',
      target: { selector: 'button.inc', nth: 0 },
      component: 'Counter',
      handler: 'increment()',
    },
    { id: 2, parent: 1, seq: 2, type: TraceNodeType.ACTION, name: 'increment', component: 'Counter' },
    { id: 3, parent: 2, seq: 3, type: TraceNodeType.WRITE, path: 'count', from: 0, to: 1 },
    {
      id: 4,
      parent: 3,
      seq: 4,
      type: TraceNodeType.DOM,
      op: 'text',
      target: { selector: 'span.value', nth: 0 },
      from: '0',
      to: '1',
    },
  ];
  return { ...trace, ...overrides };
}

try {
  // A project skeleton the CLI recognises, with a component that export can find.
  fs.mkdirSync(path.join(workDir, 'src/components/counter'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'avenx.config.json'), JSON.stringify({ srcDir: 'src' }, null, 2));
  fs.writeFileSync(
    path.join(workDir, 'src/components/counter/counter.component.js'),
    ['<state count="0" />', '', '<action name="increment"> state.count = state.count + 1; </action>', '', '<div><span class="value">{{ count }}</span><button class="inc" @click="increment()">+</button></div>', ''].join('\n'),
  );

  // --- Empty state is helpful rather than blank -----------------------------

  let run = avenx(['trace', 'list']);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('No traces recorded yet'), 'an empty listing says so');
  assert.ok(run.stdout.includes('avenx serve --trace'), 'and tells the developer how to record one');

  run = avenx(['trace', 'view', 'latest']);
  assert.notStrictEqual(run.status, 0, 'viewing nothing is an error');

  // --- list -----------------------------------------------------------------

  const olderTrace = makeTrace('trace-4f2a', {
    createdAt: new Date(Date.now() - 10000).toISOString(),
  });
  const file1 = saveTrace(workDir, olderTrace);
  const now = Math.floor(Date.now() / 1000);
  fs.utimesSync(file1, now - 10, now - 10);

  const newerTrace = makeTrace('trace-a91c', {
    createdAt: new Date(Date.now()).toISOString(),
    determinism: {
      status: Determinism.BEST_EFFORT,
      reasons: [{ reason: NonDeterminismReason.POLLING_RESOURCE, detail: 'ticker polls every 5000ms' }],
    },
  });
  const file2 = saveTrace(workDir, newerTrace);
  fs.utimesSync(file2, now, now);

  run = avenx(['trace', 'list']);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('TRACE ID'), 'a header row is printed');
  assert.ok(run.stdout.includes('trace-4f2a'), 'both traces are listed');
  assert.ok(run.stdout.includes('trace-a91c'));
  assert.ok(run.stdout.includes('deterministic'), 'status is shown');
  assert.ok(run.stdout.includes('best-effort'), 'and distinguishes best-effort traces');
  assert.ok(run.stdout.includes('2 traces'), 'the count is summarised');

  run = avenx(['trace', 'list', '--json']);
  assert.strictEqual(run.status, 0);
  const listed = JSON.parse(run.stdout);
  assert.strictEqual(listed.length, 2, 'JSON output is machine-readable');
  assert.ok(listed.every((entry) => entry.id && entry.status), 'each row carries id and status');

  // --- view -----------------------------------------------------------------

  run = avenx(['trace', 'view', 'trace-4f2a']);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('click <button.inc>'), 'the causal root is rendered');
  assert.ok(run.stdout.includes('action Counter.increment()'), 'the action is rendered');
  assert.ok(run.stdout.includes('write count 0 → 1'), 'the write is rendered');
  assert.ok(run.stdout.includes('patched <span.value>'), 'the DOM patch is rendered');
  assert.ok(run.stdout.includes('Determinism: deterministic'), 'the verdict is shown');

  run = avenx(['trace', 'view', 'trace-a91c']);
  assert.strictEqual(run.status, 0);
  assert.ok(run.stdout.includes('best-effort'), 'a best-effort trace says so');
  assert.ok(run.stdout.includes('ticker polls'), 'and gives the specific reason');

  run = avenx(['trace', 'view', 'no-such-trace']);
  assert.notStrictEqual(run.status, 0, 'an unknown id is an error');
  assert.ok(run.stderr.includes('avenx trace list'), 'and points at the listing');

  // `latest` resolves to the most recently written trace.
  run = avenx(['trace', 'view', 'latest']);
  assert.strictEqual(run.status, 0);
  assert.ok(run.stdout.includes('trace-a91c'), 'latest resolves to the newest recording');

  // --- export ---------------------------------------------------------------

  run = avenx(['trace', 'export', 'trace-4f2a', '--out', 'test/counter.test.js']);
  assert.strictEqual(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('test/counter.test.js'), 'the test path is reported');
  assert.ok(run.stdout.includes('test/counter.trace.json'), 'the trace is written beside the test');

  const generated = fs.readFileSync(path.join(workDir, 'test/counter.test.js'), 'utf8');
  assert.ok(generated.includes("from 'avenx-core/testing'"), 'the generated test imports the testing entry');
  assert.ok(generated.includes('counter.component.js'), 'the component source was discovered automatically');
  assert.ok(generated.includes('case 0:'), 'the recorded input became a step');
  assert.ok(
    fs.existsSync(path.join(workDir, 'test/counter.trace.json')),
    'the trace travels with the test, so pruning cannot break it',
  );

  // Refuses to clobber without --force.
  run = avenx(['trace', 'export', 'trace-4f2a', '--out', 'test/counter.test.js']);
  assert.notStrictEqual(run.status, 0, 'an existing file is not overwritten silently');
  assert.ok(run.stderr.includes('--force'), 'and the flag to override is named');

  run = avenx(['trace', 'export', 'trace-4f2a', '--out', 'test/counter.test.js', '--force']);
  assert.strictEqual(run.status, 0, '--force overwrites');

  // A best-effort export warns loudly.
  run = avenx(['trace', 'export', 'trace-a91c', '--out', 'test/flaky.test.js']);
  assert.strictEqual(run.status, 0);
  assert.ok(run.stdout.includes('best-effort'), 'the warning appears on stdout');
  const flaky = fs.readFileSync(path.join(workDir, 'test/flaky.test.js'), 'utf8');
  assert.ok(flaky.includes('allowBestEffort: true'), 'the generated test opts in explicitly');
  assert.ok(!flaky.includes('result.verified, true'), 'and never asserts verification');

  // --dry-run prints instead of writing.
  run = avenx(['trace', 'export', 'trace-4f2a', '--out', 'test/preview.test.js', '--dry-run']);
  assert.strictEqual(run.status, 0);
  assert.ok(run.stdout.includes('Would write'), 'a dry run says what it would do');
  assert.ok(!fs.existsSync(path.join(workDir, 'test/preview.test.js')), 'and writes nothing');

  // --- prune ----------------------------------------------------------------

  run = avenx(['trace', 'prune', '--keep=1', '--dry-run']);
  assert.strictEqual(run.status, 0);
  assert.ok(run.stdout.includes('Would remove 1 trace'), 'a dry run reports the plan');
  assert.strictEqual(listTraces(workDir).length, 2, 'and removes nothing');

  run = avenx(['trace', 'prune', '--keep=1']);
  assert.strictEqual(run.status, 0);
  assert.ok(run.stdout.includes('Removed 1 trace'));
  assert.strictEqual(listTraces(workDir).length, 1, 'the newest survives');
  assert.strictEqual(listTraces(workDir)[0].id, 'trace-a91c');

  run = avenx(['trace', 'prune', '--keep=notanumber']);
  assert.notStrictEqual(run.status, 0, 'a bad --keep is rejected rather than defaulted');

  run = avenx(['trace', 'prune', '--all']);
  assert.strictEqual(run.status, 0);
  assert.strictEqual(listTraces(workDir).length, 0, '--all clears the directory');

  // --- Unknown subcommand explains itself -----------------------------------

  run = avenx(['trace', 'wat']);
  assert.notStrictEqual(run.status, 0);
  assert.ok(run.stdout.includes('avenx trace list'), 'usage is printed for an unknown subcommand');

  // --- Store safety ---------------------------------------------------------

  assert.ok(isValidTraceId('trace-4f2a'));
  assert.ok(!isValidTraceId('../../etc/passwd'), 'a traversal id is rejected');
  assert.ok(!isValidTraceId('a/b'), 'a path separator is rejected');
  assert.ok(!isValidTraceId(''), 'an empty id is rejected');
  assert.strictEqual(loadTrace(workDir, '../../etc/passwd'), null, 'traversal cannot reach outside the store');
  assert.throws(() => saveTrace(workDir, { id: '../evil' }), /unusable id/, 'saving a traversal id is refused');

  // A corrupt file is surfaced rather than hidden.
  fs.mkdirSync(path.join(workDir, '.avenx/traces'), { recursive: true });
  fs.writeFileSync(path.join(workDir, '.avenx/traces/broken.json'), '{ not json');
  const withBroken = listTraces(workDir);
  assert.strictEqual(withBroken.length, 1);
  assert.strictEqual(withBroken[0].broken, true, 'an unreadable trace is listed as broken, not skipped');
  run = avenx(['trace', 'list']);
  assert.ok(run.stdout.includes('unreadable'), 'and the listing says so');
  assert.throws(() => loadTrace(workDir, 'broken'), /not valid JSON/, 'reading it explains why it failed');

  console.log('✅ avenx trace CLI tests passed.');
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
