/**
 * Exercises `avenx atlas`, `avenx impact`, `avenx why`, `avenx check` and the
 * build artifact by running the CLI as a subprocess, the way a developer does.
 *
 * The fixture under `test/fixtures/atlas-app` is a small but complete
 * application: a bridge with state, getters and actions; components that read
 * it directly and through a loop; a two-way binding; guarded and unguarded
 * routes; and deliberately dead state and an uncalled action for the
 * diagnostics to find.
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
const fixture = path.join(repoRoot, 'test/fixtures/atlas-app');

console.log('🧪 Testing the avenx atlas CLI...');

/**
 * Runs the CLI in a project directory.
 * @param {string[]} args - CLI arguments.
 * @param {string} [cwd] - Where to run it.
 * @returns {{status: number, stdout: string, stderr: string}} The result.
 */
function avenx(args, cwd = fixture) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

/**
 * Runs the CLI and parses its JSON output.
 * @param {string[]} args - CLI arguments.
 * @param {string} [cwd] - Where to run it.
 * @returns {object} The parsed document.
 */
function avenxJson(args, cwd = fixture) {
  const result = avenx(args, cwd);
  const start = result.stdout.indexOf('{');
  assert.ok(start !== -1, `expected JSON from "avenx ${args.join(' ')}", got:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.slice(start));
}

const created = [];

try {
  // ── avenx atlas ───────────────────────────────────────────────────────────
  {
    const result = avenx(['atlas']);
    assert.strictEqual(result.status, 0, `avenx atlas failed:\n${result.stderr}`);
    const out = result.stdout;

    assert.ok(out.includes('Avenx Atlas'), 'the overview is titled');
    assert.ok(/Components\s+3/.test(out), 'components are counted');
    assert.ok(/Pages\s+2/.test(out), 'pages are counted');
    assert.ok(/Bridges\s+1/.test(out), 'bridges are counted');
    assert.ok(/State keys\s+10/.test(out), 'state keys are counted');
    assert.ok(/Routes\s+3/.test(out), 'routes are counted');
    assert.ok(/Guards\s+1/.test(out), 'guards are counted');
    assert.ok(out.includes('/checkout'), 'routes are listed');
    assert.ok(out.includes('guarded by AuthGuard'), 'and say what guards them');
    assert.ok(
      out.includes('Every relationship in this project resolved.'),
      'a clean project says so rather than staying silent about completeness',
    );
    assert.ok(!out.trimStart().startsWith('{'), 'the default output is a report, not a JSON dump');
  }

  // ── avenx atlas --json ────────────────────────────────────────────────────
  {
    const atlas = avenxJson(['atlas', '--json']);
    assert.strictEqual(atlas.atlasVersion, 1, 'the document declares its format version');
    assert.ok(Array.isArray(atlas.nodes) && atlas.nodes.length > 0);
    assert.ok(Array.isArray(atlas.edges) && atlas.edges.length > 0);
    assert.ok(Array.isArray(atlas.unresolved), 'unresolved is always present, even when empty');
    assert.ok(atlas.summary && typeof atlas.summary.nodes === 'number');

    for (const edge of atlas.edges) {
      assert.ok(edge.from && edge.to && edge.kind, 'every edge has a source, a target and a kind');
      assert.ok(
        edge.confidence === 'certain' || edge.confidence === 'possible',
        `every edge declares its confidence, got ${edge.confidence}`,
      );
    }

    const ids = new Set(atlas.nodes.map((node) => node.id));
    for (const edge of atlas.edges) {
      assert.ok(ids.has(edge.from) && ids.has(edge.to), `edge ${edge.from} -> ${edge.to} names nodes that exist`);
    }

    assert.ok(
      atlas.nodes.some((node) => node.id === 'state:bridge:cart.items' && node.loc.file.endsWith('cart.bridge.js')),
      'nodes carry a source location',
    );
  }

  // ── avenx impact ──────────────────────────────────────────────────────────
  {
    const result = avenx(['impact', 'cart.items']);
    assert.strictEqual(result.status, 0, `avenx impact failed:\n${result.stderr}`);
    const out = result.stdout;

    assert.ok(out.includes('What depends on: cart.items'));
    assert.ok(out.includes('cart.total'), 'reaches the getter that derives from it');
    assert.ok(out.includes('CartSummary'), 'and the component that renders the getter');
    assert.ok(out.includes('Checkout'), 'across a page boundary too');
    assert.ok(out.includes('/checkout'), 'and out to the route');
    assert.ok(out.includes('writes'), 'the write is shown, not only the reads');
    assert.ok(out.includes('[possible]'), 'an uncertain edge is labelled where it appears');
    assert.ok(out.includes('cart-summary.component.js:'), 'with file and line');
    assert.ok(out.includes('0 unresolved relationships'), 'and states how complete the answer is');
  }

  // ── avenx impact --json ───────────────────────────────────────────────────
  {
    const payload = avenxJson(['impact', 'cart.items', '--json']);
    assert.strictEqual(payload.direction, 'impact');
    assert.strictEqual(payload.target.id, 'state:bridge:cart.items');
    assert.ok(payload.reached.length > 5, 'the reached set is returned');
    assert.deepStrictEqual(payload.unresolved, [], 'and what was not resolved');

    const writes = payload.reached.filter((entry) => entry.via === 'writes');
    assert.ok(writes.length >= 2, 'both writers are in the machine-readable answer');

    // `items.push({...})` mutates the receiver directly, so the relationship is
    // proven. `items.find(...)` then assigning to the result reaches the same
    // state through a local whose element is unknowable, so it is not.
    const byPush = writes.find((entry) => entry.id === 'action:bridge:cart.addItem');
    const byAlias = writes.find((entry) => entry.id === 'action:bridge:cart.addQty');
    assert.ok(byPush && byAlias, 'both kinds of write are reported');
    assert.strictEqual(byPush.confidence, 'certain', 'a direct mutating call is certain');
    assert.strictEqual(byAlias.confidence, 'possible', 'a write through an aliased element is not');

    for (const entry of writes) {
      assert.ok(Array.isArray(entry.path) && entry.path.length > 0, 'each entry carries the path it was reached by');
    }
  }

  // ── avenx why ─────────────────────────────────────────────────────────────
  {
    const result = avenx(['why', 'cart.total']);
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('What this depends on: cart.total'));
    assert.ok(result.stdout.includes('cart.items'), 'a getter depends on the state it reads');

    const payload = avenxJson(['why', 'CartItem.lineTotal', '--json']);
    assert.strictEqual(payload.direction, 'why');
    const reachedIds = payload.reached.map((entry) => entry.id);
    assert.ok(reachedIds.includes('state:component:CartItem.qty'), 'a computed depends on both its operands');
    assert.ok(reachedIds.includes('state:component:CartItem.price'));
  }

  // ── impact and why are opposite directions of one walk ────────────────────
  {
    const impact = avenxJson(['impact', 'cart.items', '--json']);
    const why = avenxJson(['why', 'cart.total', '--json']);
    assert.ok(
      impact.reached.some((entry) => entry.id === 'getter:bridge:cart.total'),
      'cart.total is downstream of cart.items',
    );
    assert.ok(
      why.reached.some((entry) => entry.id === 'state:bridge:cart.items'),
      'and cart.items is upstream of cart.total',
    );
  }

  // ── Unknown and ambiguous symbols ─────────────────────────────────────────
  {
    const missing = avenx(['why', 'no.such.thing']);
    assert.notStrictEqual(missing.status, 0, 'an unknown symbol is a failure');
    assert.ok(missing.stderr.includes('No symbol named'), 'and says so');

    const missingJson = avenx(['impact', 'no.such.thing', '--json']);
    assert.strictEqual(JSON.parse(missingJson.stdout).error, 'not-found', 'reported in JSON too');

    const noArg = avenx(['impact']);
    assert.notStrictEqual(noArg.status, 0, 'a missing symbol is a failure');
    assert.ok(noArg.stderr.includes('name a symbol'));
  }

  // ── Deterministic output ──────────────────────────────────────────────────
  {
    const a = avenx(['impact', 'cart.items', '--json']).stdout;
    const b = avenx(['impact', 'cart.items', '--json']).stdout;
    assert.strictEqual(a, b, 'two identical queries produce identical bytes');

    const atlasA = JSON.parse(avenx(['atlas', '--json']).stdout);
    const atlasB = JSON.parse(avenx(['atlas', '--json']).stdout);
    delete atlasA.generatedAt;
    delete atlasB.generatedAt;
    assert.deepStrictEqual(atlasA, atlasB, 'the model is stable across runs');
  }

  // ── avenx check reports the Atlas diagnostics ─────────────────────────────
  {
    const report = avenxJson(['check', '--json']);
    const codes = report.diagnostics.map((entry) => entry.code);
    assert.ok(codes.includes('AVX_W40'), 'unread state is reported by check');
    assert.ok(codes.includes('AVX_W41'), 'so is an unreachable action');

    const unread = report.diagnostics.find((entry) => entry.code === 'AVX_W40');
    assert.ok(unread.message.includes('cart.'), 'the message names the symbol');

    const text = avenx(['check']);
    assert.ok(text.stdout.includes('AVX_W40') || text.stderr.includes('AVX_W40'), 'and in text mode too');
  }

  // ── avenx explain knows the codes ─────────────────────────────────────────
  {
    for (const code of ['AVX_W40', 'AVX_W41']) {
      const result = avenx(['explain', code]);
      assert.strictEqual(result.status, 0, `avenx explain ${code} failed`);
      assert.ok(result.stdout.includes(code));
      assert.ok(result.stdout.includes('How to Fix'), `${code} explains itself`);
    }
  }

  // ── The build artifact ────────────────────────────────────────────────────
  {
    const distDir = path.join(fixture, 'dist');
    fs.rmSync(distDir, { recursive: true, force: true });
    created.push(distDir);

    const build = avenx(['build', '--force']);
    assert.strictEqual(build.status, 0, `build failed:\n${build.stdout}\n${build.stderr}`);

    const artifactPath = path.join(distDir, 'bundle.atlas.json');
    assert.ok(fs.existsSync(artifactPath), 'the Atlas is written beside the bundle');

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    assert.strictEqual(artifact.atlasVersion, 1);
    assert.ok(artifact.nodes.length > 0 && artifact.edges.length > 0);
    assert.ok(Array.isArray(artifact.unresolved));
    assert.ok(artifact.generatedAt, 'the envelope records when it was produced');
    assert.strictEqual(artifact.srcDir, 'src');

    // The bundle must not carry any of it.
    const bundle = fs.readFileSync(path.join(distDir, 'bundle.js'), 'utf-8');
    assert.ok(!bundle.includes('bundle.atlas.json'), 'the bundle never references the Atlas');
    assert.ok(!bundle.includes('atlasVersion'), 'and does not contain it');
    for (const marker of ['AtlasNodeKind', 'addComponentUnit', 'resolveReference', 'AppModel']) {
      assert.ok(!bundle.includes(marker), `the Atlas subsystem (${marker}) is not in the runtime bundle`);
    }

    // Trace still works alongside it.
    assert.ok(fs.existsSync(path.join(distDir, 'bundle.trace.json')), 'the trace sidecar is still emitted');
    const traceSidecar = JSON.parse(fs.readFileSync(path.join(distDir, 'bundle.trace.json'), 'utf-8'));
    assert.ok(traceSidecar.components.CartItem, 'and still describes the components');
    assert.ok(traceSidecar.bridges.cart, 'and the bridges');
  }

  // ── An empty project ──────────────────────────────────────────────────────
  {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-empty-'));
    created.push(empty);
    fs.mkdirSync(path.join(empty, 'src'), { recursive: true });
    fs.writeFileSync(path.join(empty, 'avenx.config.json'), JSON.stringify({ srcDir: 'src', distDir: 'dist' }));

    const result = avenx(['atlas'], empty);
    assert.strictEqual(result.status, 0, `an empty project should not fail:\n${result.stderr}`);
    assert.ok(result.stdout.includes('Avenx Atlas'));

    const atlas = avenxJson(['atlas', '--json'], empty);
    assert.deepStrictEqual(atlas.nodes, []);
    assert.deepStrictEqual(atlas.edges, []);
    assert.deepStrictEqual(atlas.unresolved, []);
  }

  // ── A project that does not compile still answers ─────────────────────────
  {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-broken-'));
    created.push(broken);
    fs.mkdirSync(path.join(broken, 'src', 'bridges'), { recursive: true });
    fs.mkdirSync(path.join(broken, 'src', 'components', 'card'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'avenx.config.json'), JSON.stringify({ srcDir: 'src', distDir: 'dist' }));
    fs.writeFileSync(path.join(broken, 'src', 'bridges', 'bad.bridge.js'), 'export class NotABridge {}\n');
    fs.writeFileSync(
      path.join(broken, 'src', 'components', 'card', 'card.component.js'),
      '<state n="1" />\n\n<p>{{ n }}</p>\n',
    );

    const result = avenx(['atlas'], broken);
    assert.strictEqual(result.status, 0, 'a query on a broken project is still answerable');
    const atlas = avenxJson(['atlas', '--json'], broken);
    assert.ok(Array.isArray(atlas.errors) && atlas.errors.length > 0, 'and says which phase failed');
    assert.ok(atlas.errors[0].code === 'AVX_C12', 'naming the real compiler diagnostic');
  }

  // ── Unsupported expressions are reported, not dropped ─────────────────────
  {
    const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-odd-'));
    created.push(odd);
    fs.mkdirSync(path.join(odd, 'src', 'components', 'odd'), { recursive: true });
    fs.writeFileSync(path.join(odd, 'avenx.config.json'), JSON.stringify({ srcDir: 'src', distDir: 'dist' }));
    fs.writeFileSync(
      path.join(odd, 'src', 'components', 'odd', 'odd.component.js'),
      ['<state rows="[]" key="a" />', '', '<p>{{ rows[key].label }}</p>', '<p>{{ mystery.value }}</p>', ''].join('\n'),
    );

    const atlas = avenxJson(['atlas', '--json'], odd);
    const reasons = atlas.unresolved.map((entry) => entry.reason);
    assert.ok(reasons.includes('dynamic-member'), 'a computed member key is reported');
    assert.ok(reasons.includes('unknown-identifier'), 'so is an identifier that matches no declaration');
    for (const entry of atlas.unresolved) {
      assert.ok(entry.loc && entry.loc.file, 'every unresolved entry says where it is');
      assert.ok(entry.expr, 'and what it could not follow');
    }

    const text = avenx(['atlas'], odd).stdout;
    assert.ok(text.includes('Unresolved'), 'the report surfaces them rather than claiming completeness');
    assert.ok(text.includes('dynamic-member'));
  }

  console.log('✅ avenx atlas CLI tests passed.');
} catch (err) {
  console.error('❌ avenx atlas CLI test failed:', err);
  process.exit(1);
} finally {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
