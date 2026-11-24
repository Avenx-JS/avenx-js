import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import graphlibDot from '@dagrejs/graphlib-dot';
import { displayName } from '../../lib/compiler/atlas/query.js';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const fixture = path.join(repo, 'test/fixtures/atlas-app');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-query-graph-')));
const cli = path.join(repo, 'bin/avenx.js');

function run(args, cwd = fixture) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.ifError(result.error);
  return result;
}

function json(args, cwd = fixture) {
  const result = run([...args, '--json'], cwd);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertDiagram(output, format, atlas, query, kinds) {
  const byId = new Map(atlas.nodes.map((node) => [node.id, node]));
  const context = { getNode: (id) => byId.get(id) };
  const label = (id) => `${byId.get(id).kind}: ${displayName(context, byId.get(id))}`;
  const selected = new Set([query.target.id, ...query.reached.map((entry) => entry.id)]);
  if (kinds) {
    for (const id of selected) if (!kinds.includes(byId.get(id).kind)) selected.delete(id);
  }
  const expectedNodes = [...selected].map(label).sort();
  const expectedEdges = query.reached
    .flatMap((entry) => {
      const from = entry.path[entry.path.length - 2];
      return selected.has(from) && selected.has(entry.id)
        ? [[label(from), label(entry.id), entry.via, entry.confidence === 'possible' ? 'dashed' : 'solid']]
        : [];
    })
    .sort();

  let actualNodes;
  let actualEdges;
  if (format === 'dot') {
    const diagram = graphlibDot.read(output);
    actualNodes = diagram
      .nodes()
      .map((id) => diagram.node(id).label)
      .sort();
    actualEdges = diagram
      .edges()
      .map((edge) => [
        diagram.node(edge.v).label,
        diagram.node(edge.w).label,
        diagram.edge(edge).label,
        diagram.edge(edge).style,
      ])
      .sort();
    const queried = diagram.nodes().find((id) => diagram.node(id).label === label(query.target.id));
    if (queried) assert.equal(diagram.node(queried).penwidth, '3', 'the query root is highlighted');
  } else {
    assert.ok(output.startsWith('flowchart LR\n'), output);
    assert.ok(output.endsWith('\n'));
    const decode = (value) => value.replace(/#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
    const labels = new Map(
      [...output.matchAll(/^ {2}(n\d+)\["([^"\n]*)"\]$/gm)].map((match) => [match[1], decode(match[2])]),
    );
    actualNodes = [...labels.values()].sort();
    actualEdges = [...output.matchAll(/^ {2}(n\d+) (-->|-\.->)\|"([^"\n]*)"\| (n\d+)$/gm)]
      .map((match) => [
        labels.get(match[1]),
        labels.get(match[4]),
        decode(match[3]),
        match[2] === '-.->' ? 'dashed' : 'solid',
      ])
      .sort();
    const queried = [...labels].find(([, value]) => value === label(query.target.id));
    if (queried) assert.match(output, new RegExp(`  style ${queried[0]} .*stroke-width:3px`));
  }
  assert.deepEqual(actualNodes, expectedNodes, 'only nodes from the text/JSON traversal are drawn');
  assert.deepEqual(actualEdges, expectedEdges, 'only traversed edges are drawn, in query direction');
}

try {
  const atlas = json(['atlas']);
  for (const [command, symbol] of [
    ['impact', 'cart.items'],
    ['why', 'CartItem.lineTotal'],
  ]) {
    for (const depth of [1, 12]) {
      const args = [command, symbol, '--depth', String(depth)];
      const query = json(args);
      for (const format of ['mermaid', 'dot']) {
        const result = run([...args, '--graph', ...(format === 'dot' ? ['--format', 'dot'] : [])]);
        assert.equal(result.status, 0, result.stderr);
        assertDiagram(result.stdout, format, atlas, query);
      }
    }
  }

  const output = path.join(root, 'impact.dot');
  const saved = run([
    'impact',
    '--graph',
    '--format',
    'dot',
    '--out',
    output,
    '--kinds',
    'states,actions',
    'cart.items',
  ]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout, '', '--out writes no stdout');
  assertDiagram(fs.readFileSync(output, 'utf8'), 'dot', atlas, json(['impact', 'cart.items']), ['state', 'action']);

  assert.equal(
    run(['why', 'cart.total', '--depth', '1']).stdout,
    'What this depends on: cart.total\n   getter  src/bridges/cart.bridge.js:10\n\n' +
      '└─ reads cart.items .reduce  src/bridges/cart.bridge.js:5\n\n' +
      '1 related node (depth limit reached — pass --depth=N for more)\n\n' +
      '0 unresolved relationships in this answer.\n',
    'the existing text output stays byte-identical',
  );
  for (const command of ['impact', 'why']) {
    for (const [args, message] of [
      [['--format', 'svg'], /--format must be mermaid or dot/],
      [['--format'], /--format requires a value/],
      [['--kinds', 'unknown'], /Unknown Atlas node kind "unknown".*Kinds:/],
      [['--out'], /--out requires a value/],
      [['--json'], /Choose --graph or --json/],
      [['--depth', 'x'], /--depth must be a non-negative integer/],
      [['--depth'], /--depth requires a value/],
      [['--focus', 'Cart'], /already focus on the queried symbol/],
    ]) {
      const invalid = run([command, 'cart.items', '--graph', ...args]);
      assert.equal(invalid.status, 1, `${command}: ${args}\n${invalid.stderr}`);
      assert.match(invalid.stderr, message);
      assert.doesNotMatch(invalid.stderr, /failed|file:\/\/|^\s+at /m, 'invalid options are usage errors');
    }
    assert.notEqual(run([command, '--graph', 'missing']).status, 0);
    assert.notEqual(run([command, '--graph']).status, 0);
  }

  assert.equal(run(['init', '--yes'], root).status, 0);
  assert.equal(run(['generate', 'component', 'Card'], root).status, 0);
  const scaffold = json(['atlas'], root);
  for (const [command, symbol] of [
    ['impact', 'Card.count'],
    ['why', 'Card.reset'],
  ]) {
    const query = json([command, symbol], root);
    const result = run([command, symbol, '--graph'], root);
    assert.equal(result.status, 0, result.stderr);
    assertDiagram(result.stdout, 'mermaid', scaffold, query);
  }
  console.log('Impact/why diagrams preserve traversal nodes, edges, direction, depth, labels and text output.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
