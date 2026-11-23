import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import graphlibDot from '@dagrejs/graphlib-dot';
import { AppModel } from '../../lib/compiler/atlas/AppModel.js';
import { renderAtlasGraph } from '../../lib/compiler/atlas/graph.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const fixture = path.join(repo, 'test/fixtures/atlas-app');
const cli = path.join(repo, 'bin/avenx.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-graph-'));
const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false });

function run(args) {
  return spawnSync(process.execPath, [cli, 'atlas', '--graph', ...args], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

try {
  const diagram = run([]);
  assert.equal(diagram.status, 0, diagram.stderr);
  await mermaid.parse(diagram.stdout);
  assert.match(diagram.stdout, /route: \/checkout/);
  assert.match(diagram.stdout, /page: Checkout/);
  assert.doesNotMatch(diagram.stdout, /state:/);
  assert.match(diagram.stdout, /routes-to/);
  assert.equal(run([]).stdout, diagram.stdout, 'unchanged sources produce deterministic output');

  const reactive = run(['--kinds', 'state,action', '--focus', 'cart.items', '--depth', '1']);
  assert.equal(reactive.status, 0, reactive.stderr);
  await mermaid.parse(reactive.stdout);
  assert.match(reactive.stdout, /state: cart.items/);
  assert.match(reactive.stdout, /-\.->/, 'possible relationships use dashed edges');
  assert.doesNotMatch(reactive.stdout, /page:|route:/);

  const output = path.join(temporary, 'atlas.dot');
  const saved = run(['--format=dot', '--kinds', 'routes,pages', '--out', output]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout, '');
  const dot = graphlibDot.read(fs.readFileSync(output, 'utf8'));
  assert.ok(dot.nodeCount() > 0 && dot.edgeCount() > 0);
  assert.ok(dot.nodes().every((id) => /^(route|page):/.test(dot.node(id).label)));

  const model = new AppModel();
  model.addNode({ id: 'odd', kind: 'component', name: 'end "<x>|#\\\n[]' });
  await mermaid.parse(renderAtlasGraph(model));
  const escapedDot = graphlibDot.read(renderAtlasGraph(model, { format: 'dot' }));
  // graphlib-dot preserves DOT escString backslash escapes; Graphviz expands them.
  assert.equal(escapedDot.node('n0').label, String.raw`component: end "<x>|#\\\n[]`);
  assert.equal(escapedDot.nodeCount(), 1, 'label punctuation must not inject nodes');

  for (const args of [['--format', 'svg'], ['--format'], ['--kinds', 'unknown'], ['--focus', 'missing'], ['--depth', '-1'], ['--json']]) {
    const invalid = run(args);
    assert.notEqual(invalid.status, 0, `invalid options must fail: ${args}`);
  }
  console.log('Atlas Mermaid and DOT output parses, filters, focuses, escapes, and writes files.');
} finally {
  window.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
