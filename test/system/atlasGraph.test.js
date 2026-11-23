import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import graphlibDot from '@dagrejs/graphlib-dot';
import { AppModel } from '../../lib/compiler/atlas/AppModel.js';
import { renderAtlasGraph } from '../../lib/compiler/atlas/graph.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const fixture = path.join(repo, 'test/fixtures/atlas-app');
const cli = path.join(repo, 'bin/avenx.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-graph-'));

// Every line the exporter may emit. A quoted Mermaid label may not contain a raw
// quote or line break, so a label that escapes its quotes fails to match.
const LABEL = '"[^"\\r\\n]*"';
const MERMAID_LINE = new RegExp([
  '^flowchart LR$',
  `^  atlas_status\\[${LABEL}\\]$`,
  `^  n\\d+\\[${LABEL}\\]$`,
  `^  n\\d+ (-->|-\\.->)\\|${LABEL}\\| n\\d+$`,
  '^  linkStyle \\d+ stroke:#[0-9a-f]{6}$',
].join('|'));

/**
 * Structurally validate the Mermaid flowchart subset the exporter produces.
 * @param {string} text - Exporter output.
 * @returns {string[]} The diagram lines without the trailing newline.
 */
function assertMermaid(text) {
  assert.ok(text.endsWith('\n'), 'diagram ends with a newline');
  const lines = text.slice(0, -1).split('\n');
  assert.equal(lines[0], 'flowchart LR');
  for (const line of lines) assert.match(line, MERMAID_LINE);
  const declared = new Set(lines.flatMap((line) => line.match(/^ {2}(n\d+)\[/)?.[1] ?? []));
  const edges = lines.filter((line) => /^ {2}n\d+ -/.test(line));
  for (const edge of edges) {
    const [, from, to] = edge.match(/^ {2}(n\d+) .* (n\d+)$/);
    assert.ok(declared.has(from) && declared.has(to), `edge endpoints are declared: ${edge}`);
  }
  const styles = lines.filter((line) => line.includes('linkStyle')).map((line) => Number(line.split(' ')[3]));
  assert.deepEqual(styles, edges.map((_, index) => index), 'one linkStyle per edge, in order');
  return lines;
}

function run(args) {
  return spawnSync(process.execPath, [cli, 'atlas', '--graph', ...args], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

try {
  const diagram = run([]);
  assert.equal(diagram.status, 0, diagram.stderr);
  assertMermaid(diagram.stdout);
  assert.match(diagram.stdout, /route: \/checkout/);
  assert.match(diagram.stdout, /page: Checkout/);
  assert.doesNotMatch(diagram.stdout, /state:/);
  assert.match(diagram.stdout, /routes-to/);
  assert.equal(run([]).stdout, diagram.stdout, 'unchanged sources produce deterministic output');

  const reactive = run(['--kinds', 'state,action', '--focus', 'cart.items', '--depth', '1']);
  assert.equal(reactive.status, 0, reactive.stderr);
  assertMermaid(reactive.stdout);
  assert.match(reactive.stdout, /state: cart.items/);
  assert.match(reactive.stdout, /-\.->/, 'possible relationships use dashed edges');
  assert.doesNotMatch(reactive.stdout, /page:|route:/);

  const output = path.join(temporary, 'atlas.dot');
  const saved = run(['--format=dot', '--kinds', 'routes,pages', '-o', output]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout, '');
  const dot = graphlibDot.read(fs.readFileSync(output, 'utf8'));
  assert.ok(dot.nodeCount() > 0 && dot.edgeCount() > 0);
  assert.ok(dot.nodes().every((id) => /^(route|page):/.test(dot.node(id).label)));

  const model = new AppModel();
  model.addNode({ id: 'odd', kind: 'component', name: 'end "<x>|#\\\n[]' });
  const odd = assertMermaid(renderAtlasGraph(model));
  assert.equal(odd.filter((line) => /^ {2}n\d+\[/.test(line)).length, 1, 'label punctuation must not inject nodes');
  const escapedDot = graphlibDot.read(renderAtlasGraph(model, { format: 'dot' }));
  // graphlib-dot preserves DOT escString backslash escapes; Graphviz expands them.
  assert.equal(escapedDot.node('n0').label, String.raw`component: end "<x>|#\\\n[]`);
  assert.equal(escapedDot.nodeCount(), 1, 'label punctuation must not inject nodes');

  for (const args of [['--format', 'svg'], ['--format'], ['--kinds', 'unknown'], ['--focus', 'missing'], ['--focus', 'cart.items', '--depth', '-1'], ['--depth', '1'], ['--out'], ['--json']]) {
    const invalid = run(args);
    assert.notEqual(invalid.status, 0, `invalid options must fail: ${args}`);
  }
  console.log('Atlas Mermaid and DOT output parses, filters, focuses, escapes, and writes files.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
