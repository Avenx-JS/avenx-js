/**
 * @file atlasLoopScope.test.js
 * @description What a `<@for>` header binds, from Atlas's point of view.
 *
 * The loop binding is the one piece of scope Atlas has to construct itself --
 * everything else it reads from a declaration. Getting it wrong is not visible
 * as a wrong answer, only as an unresolved entry, which is easy to read past.
 * So the cases here assert the resolved edge *and* the unresolved count.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AvenxCompiler from '../../lib/compiler.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';

/**
 * Analyses a one-component project built from the given template.
 * @param {string} template - The component body, after its declarations.
 * @returns {object} The analysed model.
 */
function analyze(template) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-loop-'));
  const file = path.join(root, 'src', 'components', 'rows', 'rows.component.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, template);
  fs.writeFileSync(
    path.join(root, 'src', 'main.app.js'),
    "import { AvenxApp } from 'avenx-core/runtime';\nconst app = new AvenxApp({ target: '#app' });\n",
  );

  clearAtlasCache();
  const compiler = new AvenxCompiler({
    rootDir: root,
    srcDir: 'src',
    distDir: 'dist',
    logging: { silent: true },
  });
  return compiler.analyze();
}

/**
 * The rendered paths of every read edge in a model.
 * @param {object} model - The analysed model.
 * @returns {string[]} Node ids that were read.
 */
function readTargets(model) {
  return model.edges.filter((edge) => edge.kind === 'reads').map((edge) => edge.to);
}

function testKeyResolvesAgainstTheLoopBinding() {
  console.log('🧪 Testing a keyed list resolves its key expression...');

  const model = analyze(
    `<state rows='[{"id":1,"qty":2}]' />\n<ul><@for row in rows key="row.id"><li>{{ row.qty }}</li></@for></ul>`,
  );

  // The key is evaluated inside the loop, so `row` is bound when it runs.
  // Analysing it before the binding existed reported the loop variable as an
  // unresolved identifier on every keyed list -- which is the one shape a
  // keyed list always has.
  assert.strictEqual(
    model.unresolved.length,
    0,
    `a keyed list must resolve completely, got: ${JSON.stringify(model.unresolved)}`,
  );

  const targets = readTargets(model);
  assert.ok(
    targets.some((id) => id.includes('rows')),
    'the loop variable resolves back to the state the list iterates',
  );
  console.log('  ✅ key="row.id" resolves, and nothing is left unresolved.');
}

function testDestructuredHeaderBindsEveryName() {
  console.log('🧪 Testing a destructured header binds every name it declares...');

  const model = analyze(
    `<state pairs='[["a",1]]' />\n<ul><@for [name, count] in pairs><li>{{ name }}: {{ count }}</li></@for></ul>`,
  );

  // `[a, b] in pairs` destructures each element. Registering only the first
  // name left the second unresolvable, which read as a missing declaration in
  // a template that has none.
  assert.strictEqual(
    model.unresolved.length,
    0,
    `both destructured names must resolve, got: ${JSON.stringify(model.unresolved)}`,
  );
  console.log('  ✅ both names resolve.');
}

function testLoopBindingDoesNotLeak() {
  console.log('🧪 Testing a loop binding does not outlive its loop...');

  const model = analyze(
    `<state rows='[]' />\n<div><ul><@for row in rows><li>{{ row.qty }}</li></@for></ul><p>{{ row }}</p></div>`,
  );

  // `row` outside the loop is genuinely undeclared, and Atlas has to keep
  // saying so -- a scope that leaked would silently resolve it against the
  // list and produce a confidently wrong edge.
  assert.strictEqual(model.unresolved.length, 1, 'a read outside the loop is reported, not resolved');
  console.log('  ✅ the binding is popped when the loop ends.');
}

testKeyResolvesAgainstTheLoopBinding();
testDestructuredHeaderBindsEveryName();
testLoopBindingDoesNotLeak();

console.log('\n✅ Atlas loop scope tests passed');
