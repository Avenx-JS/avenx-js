/**
 * System tests for `avenx inspect --graph` on a freshly scaffolded project
 * and on the Atlas fixture (which includes routes, pages, components,
 * bridges, and guards).
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');
const atlasFixture = path.join(repoRoot, 'test/fixtures/atlas-app');

console.log('🧪 Testing avenx inspect --graph...');

/**
 * Run the Avenx CLI in a project directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory.
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function avenx(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-inspect-graph-'));

try {
  // ── 1. Scaffolded project: node set matches `avenx inspect --json` ─────────
  const scaffoldDir = path.join(tmp, 'scaffold-app');
  const createRes = avenx(['init', 'scaffold-app'], tmp);
  assert.strictEqual(createRes.status, 0, `avenx init failed:\n${createRes.stderr}`);

  const jsonRes = avenx(['inspect', '--json'], scaffoldDir);
  assert.strictEqual(jsonRes.status, 0, `avenx inspect --json failed:\n${jsonRes.stderr}`);
  const inventory = JSON.parse(jsonRes.stdout);

  const mermaidRes = avenx(['inspect', '--graph'], scaffoldDir);
  assert.strictEqual(mermaidRes.status, 0, `avenx inspect --graph failed:\n${mermaidRes.stderr}`);
  assert.ok(mermaidRes.stdout.startsWith('flowchart LR\n'), 'default --graph emits a Mermaid flowchart');

  for (const page of inventory.pages) {
    assert.ok(
      mermaidRes.stdout.includes(`page: ${page.name}`),
      `Mermaid graph includes page "${page.name}" from inspect`,
    );
  }
  for (const component of inventory.components) {
    assert.ok(
      mermaidRes.stdout.includes(`component: ${component.name}`),
      `Mermaid graph includes component "${component.name}" from inspect`,
    );
  }
  for (const bridge of inventory.bridges) {
    assert.ok(
      mermaidRes.stdout.includes(`bridge: ${bridge.name}`),
      `Mermaid graph includes bridge "${bridge.name}" from inspect`,
    );
  }
  console.log('  ✅ scaffolded project Mermaid graph matches inspect node set');

  // ── 2. DOT format ──────────────────────────────────────────────────────────
  const dotRes = avenx(['inspect', '--graph', '--format', 'dot'], scaffoldDir);
  assert.strictEqual(dotRes.status, 0, `avenx inspect --graph --format dot failed:\n${dotRes.stderr}`);
  assert.ok(dotRes.stdout.startsWith('digraph Atlas {\n'), '--format dot emits a DOT digraph');
  for (const page of inventory.pages) {
    assert.ok(dotRes.stdout.includes(`page: ${page.name}`), `DOT graph includes page "${page.name}"`);
  }
  console.log('  ✅ --format dot emits valid DOT digraph');

  // ── 3. --out writes file and prints nothing ────────────────────────────────
  const outFile = path.join(scaffoldDir, 'structure.mmd');
  const outRes = avenx(['inspect', '--graph', '--out', 'structure.mmd'], scaffoldDir);
  assert.strictEqual(outRes.status, 0, `avenx inspect --graph --out failed:\n${outRes.stderr}`);
  assert.strictEqual(outRes.stdout, '', '--out prints nothing to stdout');
  assert.strictEqual(fs.readFileSync(outFile, 'utf8'), mermaidRes.stdout, '--out file matches stdout graph');
  console.log('  ✅ --out writes graph file and prints nothing');

  // ── 4. Atlas fixture: includes guards by default, and --kinds filters ─────
  const fixtureRes = avenx(['inspect', '--graph'], atlasFixture);
  assert.strictEqual(fixtureRes.status, 0, `avenx inspect --graph on atlas-app failed:\n${fixtureRes.stderr}`);
  assert.ok(fixtureRes.stdout.includes('guard: '), 'inspect --graph includes guard nodes by default');
  assert.ok(fixtureRes.stdout.includes('route: '), 'inspect --graph includes route nodes by default');

  const filteredRes = avenx(['inspect', '--graph', '--kinds', 'pages,components'], atlasFixture);
  assert.strictEqual(filteredRes.status, 0, `avenx inspect --graph --kinds failed:\n${filteredRes.stderr}`);
  assert.ok(filteredRes.stdout.includes('page: '), 'filtered graph includes pages');
  assert.ok(filteredRes.stdout.includes('component: '), 'filtered graph includes components');
  assert.ok(!filteredRes.stdout.includes('bridge: '), 'filtered graph excludes bridges');
  assert.ok(!filteredRes.stdout.includes('guard: '), 'filtered graph excludes guards');
  console.log('  ✅ --kinds filters node kinds and includes guards by default');

  // ── 5. Usage errors match atlas --graph ────────────────────────────────────
  const badFormat = avenx(['inspect', '--graph', '--format', 'svg'], atlasFixture);
  assert.notStrictEqual(badFormat.status, 0, 'invalid --format exits non-zero');
  assert.match(badFormat.stderr, /--format must be mermaid or dot, not "svg"/);

  const badKinds = avenx(['inspect', '--graph', '--kinds', 'nope'], atlasFixture);
  assert.notStrictEqual(badKinds.status, 0, 'invalid --kinds exits non-zero');
  assert.match(badKinds.stderr, /Unknown Atlas node kind "nope"/);

  const bothFlags = avenx(['inspect', '--graph', '--json'], atlasFixture);
  assert.notStrictEqual(bothFlags.status, 0, '--graph and --json together exit non-zero');
  assert.match(bothFlags.stderr, /Choose --graph or --json, not both/);
  console.log('  ✅ flag validation errors match atlas --graph');

  console.log('✅ inspect --graph system tests passed!');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
