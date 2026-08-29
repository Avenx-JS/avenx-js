/**
 * The Atlas produced for `test/fixtures/atlas-app`, compared against a
 * committed golden model.
 *
 * The golden file is the regression net for every future template feature: a
 * construct Atlas stops understanding changes this file, and a reviewer sees
 * exactly which relationships were lost. Regenerate it deliberately with
 * `UPDATE_ATLAS_GOLDEN=1 node test/run-tests.js unit atlasModel.test.js`, and
 * read the diff before committing it.
 *
 * Source locations are asserted separately and specifically, because they are
 * the part most likely to drift silently: the compiler rewrites a template
 * before it validates it, and Atlas has to report the line the developer
 * actually wrote.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AvenxCompiler from '../../lib/compiler.js';
import { buildAtlas } from '../../lib/compiler/atlas/emit.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';
import { ATLAS_VERSION, AtlasEdgeKind, Confidence } from '../../lib/compiler/atlas/AppModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'atlas-app');
const GOLDEN = path.join(__dirname, '..', 'fixtures', 'atlas-app.golden.json');

console.log('🧪 Testing the Atlas model against the fixture application...');

/**
 * Analyses the fixture from a cold cache.
 * @returns {import('../../lib/compiler/atlas/AppModel.js').AppModel} The model.
 */
function analyzeFixture() {
  clearAtlasCache();
  const compiler = new AvenxCompiler({
    rootDir: FIXTURE,
    srcDir: 'src',
    distDir: 'dist',
    logging: { silent: true },
  });
  return compiler.analyze();
}

/**
 * The artifact with the one field that legitimately changes between runs
 * removed, so two builds of unchanged sources compare equal.
 * @param {object} model - The model.
 * @returns {object} The comparable artifact.
 */
function stable(model) {
  const atlas = buildAtlas(model);
  delete atlas.generatedAt;
  return atlas;
}

/**
 * Finds an edge.
 * @param {object} model - The model.
 * @param {string} from - Source node id.
 * @param {string} to - Target node id.
 * @param {string} kind - Edge kind.
 * @returns {object|undefined} The edge.
 */
function edge(model, from, to, kind) {
  return model.edges.find((item) => item.from === from && item.to === to && item.kind === kind);
}

try {
  const model = analyzeFixture();

  // ── The model resolves cleanly ────────────────────────────────────────────
  assert.strictEqual(
    model.unresolved.length,
    0,
    `the fixture is written to resolve completely; unresolved: ${JSON.stringify(model.unresolved, null, 2)}`,
  );
  assert.deepStrictEqual(model.errors, [], 'the fixture compiles');

  // ── Cross-file relationships ──────────────────────────────────────────────
  assert.ok(
    edge(model, 'getter:bridge:cart.total', 'state:bridge:cart.items', AtlasEdgeKind.READS),
    'a bridge getter reads the bridge state it derives from',
  );
  assert.ok(
    edge(model, 'action:component:CartItem.incQty', 'action:bridge:cart.addQty', AtlasEdgeKind.INVOKES),
    'a component action invokes a bridge action across a file boundary',
  );
  assert.ok(
    edge(model, 'action:bridge:cart.addQty', 'event:bridge:cart.changed', AtlasEdgeKind.EMITS),
    'a bridge action emits its declared event',
  );
  assert.ok(
    edge(model, 'component:CartList', 'component:CartItem', AtlasEdgeKind.RENDERS),
    'a template tag is a renders edge',
  );
  assert.ok(
    edge(model, 'route:/checkout', 'page:Checkout', AtlasEdgeKind.ROUTES_TO),
    'a route resolves to its page',
  );
  assert.ok(
    edge(model, 'route:/checkout', 'guard:AuthGuard', AtlasEdgeKind.GUARDED_BY),
    'a route object form carries its guards',
  );
  assert.ok(
    !edge(model, 'route:/cart', 'guard:AuthGuard', AtlasEdgeKind.GUARDED_BY),
    'an unguarded route is not reported as guarded',
  );

  // ── Confidence is used, not decorative ────────────────────────────────────
  const aliasedWrite = edge(model, 'action:bridge:cart.addQty', 'state:bridge:cart.items', AtlasEdgeKind.WRITES);
  assert.ok(aliasedWrite, 'a write through a local alias is still recorded');
  assert.strictEqual(
    aliasedWrite.confidence,
    Confidence.POSSIBLE,
    'and is possible, not certain: which element items.find() returned is unknowable',
  );
  assert.strictEqual(aliasedWrite.path, '[].qty', 'the member it wrote is still known');

  const directRead = edge(model, 'computed:component:CartItem.lineTotal', 'state:component:CartItem.qty', AtlasEdgeKind.READS);
  assert.strictEqual(directRead.confidence, Confidence.CERTAIN, 'a read straight from a declaration is certain');

  // ── Loop variables resolve through to the list ────────────────────────────
  const loopRead = model.edges.find(
    (item) =>
      item.to === 'state:bridge:cart.items' &&
      item.kind === AtlasEdgeKind.READS &&
      item.path === '[].qty' &&
      item.from.startsWith('binding:component:CartList'),
  );
  assert.ok(loopRead, 'reading item.qty inside <@for item in cart.items> reads cart.items[].qty');

  // ── Two-way binding is both directions ────────────────────────────────────
  const bindBinding = [...model.nodes.values()].find(
    (node) => node.binding === 'data-ax-bind' && node.owner === 'page:Checkout',
  );
  assert.ok(bindBinding, 'a data-ax-bind directive is a binding node');
  assert.ok(
    edge(model, bindBinding.id, 'state:page:Checkout.note', AtlasEdgeKind.READS),
    'data-ax-bind renders the value',
  );
  assert.ok(
    edge(model, bindBinding.id, 'state:page:Checkout.note', AtlasEdgeKind.WRITES),
    'and writes it back',
  );

  // ── Determinism ───────────────────────────────────────────────────────────
  const first = stable(model);
  const second = stable(analyzeFixture());
  assert.deepStrictEqual(second, first, 'two analyses of unchanged sources produce an identical artifact');

  const warm = stable(
    (() => {
      const compiler = new AvenxCompiler({
        rootDir: FIXTURE,
        srcDir: 'src',
        distDir: 'dist',
        logging: { silent: true },
      });
      return compiler.analyze();
    })(),
  );
  assert.deepStrictEqual(warm, first, 'a warm cache produces the same artifact as a cold one');

  assert.strictEqual(first.atlasVersion, ATLAS_VERSION, 'the artifact declares its format version');

  // ── Golden comparison ─────────────────────────────────────────────────────
  if (process.env.UPDATE_ATLAS_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, `${JSON.stringify(first, null, 2)}\n`);
    console.log(`  ✍️  Regenerated ${path.relative(process.cwd(), GOLDEN)}`);
  } else {
    assert.ok(fs.existsSync(GOLDEN), 'the golden model is committed');
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf-8'));
    assert.deepStrictEqual(
      first,
      golden,
      'the Atlas for the fixture changed. Read the diff: if the change is intended, regenerate with UPDATE_ATLAS_GOLDEN=1',
    );
  }

  console.log('✅ Atlas model tests passed.');
} catch (err) {
  console.error('❌ Atlas model test failed:', err);
  process.exit(1);
}
