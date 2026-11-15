/**
 * @file traceExportSetup.test.js
 * @description An exported trace test carries the DOM setup it needs, and the
 * exporter recommends a runner that can mount a component.
 *
 * The generated test mounts a component, so it cannot run under `node --test`,
 * which has no DOM. The file says so in its header, and the CLI points at the
 * runner the project's own component scaffold uses.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateTest } from '../../lib/core/trace/exportTest.js';
import { traceExport } from '../../bin/commands/trace.js';

/**
 * Creates an empty project directory with one stored trace.
 * @param {string} id - The trace id.
 * @returns {string} The project directory.
 */
function projectWithTrace(id) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-trace-setup-'));
  const dir = path.join(root, '.avenx', 'traces');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      traceVersion: 1,
      createdAt: '2026-11-16T10:00:00.000Z',
      nodes: [],
      determinism: { status: 'deterministic' },
    }),
  );
  return root;
}

/**
 * Runs a CLI command and returns everything it printed.
 * @param {Function} run - The command invocation.
 * @returns {string} Captured output.
 */
function capture(run) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

const options = { componentName: 'Counter', componentPath: './counter.component.js', tracePath: './t.json' };

try {
  console.log('🧪 The generated header carries the DOM setup');
  const source = generateTest(
    {
      id: 'trace-1',
      traceVersion: 1,
      createdAt: '2026-11-16T10:00:00.000Z',
      nodes: [],
      determinism: { status: 'deterministic' },
    },
    options,
  );
  assert.match(source, /Setup instructions:/, 'the header explains how to run the file');
  assert.match(source, /npm install -D vitest happy-dom/, 'it names the DOM environment package');
  assert.match(source, /test: \{ environment: 'happy-dom' \},/, 'it shows the vitest environment setting');
  assert.match(source, /npx vitest run/, 'it names a runner that has a DOM');

  console.log('🧪 The exporter prints a command that runs the file it wrote');
  const root = projectWithTrace('trace-1');
  try {
    const output = capture(() => traceExport({ baseDir: root, config: {} }, 'latest', ['--out=test/cart.test.js']));
    assert.strictEqual(process.exitCode, undefined, 'the export must succeed');
    assert.match(output, /npx vitest run test\/cart\.test\.js/, 'the printed command names the written file');
    assert.doesNotMatch(output, /node --test/, 'node --test cannot mount a component');
    const written = fs.readFileSync(path.join(root, 'test/cart.test.js'), 'utf8');
    assert.match(written, /Setup instructions:/, 'the file on disk carries its own setup');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('🧪 The default output path is named the same way');
  const defaultRoot = projectWithTrace('trace-2');
  try {
    const output = capture(() => traceExport({ baseDir: defaultRoot, config: {} }, 'latest', []));
    assert.strictEqual(process.exitCode, undefined, 'the export must succeed');
    assert.match(output, /npx vitest run test[\\/]trace-2\.test\.js/, 'the default file is the one named');
  } finally {
    fs.rmSync(defaultRoot, { recursive: true, force: true });
  }

  console.log('  ✅ Trace export setup tests passed!');
} catch (error) {
  console.error('❌ Trace export setup tests failed:', error);
  process.exitCode = 1;
}
