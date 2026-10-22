/**
 * AVX_W40 and AVX_W41 are absence claims — "nothing reads this", "nothing
 * invokes this" — and the interesting half of these tests is the cases where
 * they must stay quiet.
 *
 * A false AVX_W40 on state that is read through a computed member would teach
 * a developer to stop trusting the whole feature, which costs far more than
 * the warnings it suppresses. So every suppression rule gets a test of its
 * own, and each one is paired with a positive case proving the diagnostic can
 * still fire in the same shape of code.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AvenxCompiler from '../../lib/compiler.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';
import {
  RUNTIME_INVOKED_ACTIONS,
  findCircularComputed,
  findUnreachableActions,
  findUnreadState,
  reportAtlasDiagnostics,
} from '../../lib/compiler/atlas/diagnostics.js';
import { walk, resolveSymbol } from '../../lib/compiler/atlas/query.js';
import { getDiagnostic } from '../../lib/core/diagnostics/catalogue.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

console.log('🧪 Testing Atlas diagnostics...');

/**
 * Analyses an in-memory project.
 * @param {Record<string, string>} files - Relative paths to contents.
 * @returns {object} The model.
 */
function analyze(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-diag-'));
  for (const [relative, contents] of Object.entries({
    'avenx.config.json': JSON.stringify({ srcDir: 'src', distDir: 'dist' }),
    ...files,
  })) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  clearAtlasCache();
  const compiler = new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', logging: { silent: true } });
  const model = compiler.analyze();
  fs.rmSync(root, { recursive: true, force: true });
  return model;
}

/**
 * The ids reported unread.
 * @param {object} model - The model.
 * @returns {string[]} Node ids.
 */
const unread = (model) => findUnreadState(model).map((finding) => finding.node.id).sort();

/**
 * The ids reported unreachable.
 * @param {object} model - The model.
 * @returns {string[]} Node ids.
 */
const unreachable = (model) => findUnreachableActions(model).map((finding) => finding.node.id).sort();

try {
  // ── AVX_W40 fires on genuinely dead state ─────────────────────────────────
  {
    const model = analyze({
      'src/bridges/cart.bridge.js': `import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { items: [], discount: 0 },
  get count() {
    return this.items.length;
  },
  applyCoupon() {
    this.discount = 10;
  },
});
`,
      'src/components/list/list.component.js': `import cart from '../../bridges/cart.bridge.js';

<div>{{ cart.count }}</div>
`,
    });

    assert.deepStrictEqual(
      unread(model),
      ['state:bridge:cart.discount'],
      'discount is written by applyCoupon and read nowhere; items is read by count',
    );

    const finding = findUnreadState(model)[0];
    assert.deepStrictEqual(
      finding.writers.map((writer) => writer.id),
      ['action:bridge:cart.applyCoupon'],
      'the finding names who writes it, so the message can say so',
    );
  }

  // ── State with no writers and no readers is still unread ──────────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state used="1" spare="2" />

<p>{{ used }}</p>
`,
    });
    assert.deepStrictEqual(unread(model), ['state:component:Card.spare']);
    assert.deepStrictEqual(findUnreadState(model)[0].writers, [], 'no writers is a different message, not a different rule');
  }

  // ── A dynamic member could be the read, so nothing is claimed ─────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state spare="2" key="spare" />

<action name="peek">
  return state[state.key];
</action>

<p @click="peek()">{{ key }}</p>
`,
    });
    assert.deepStrictEqual(
      unread(model),
      [],
      'state[key] could be reading spare; an absence claim is not available here',
    );
  }

  // ── A shadowed identifier blocks the claim too ────────────────────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state spare="2" />

<action name="go">
  const spare = 1;
  return spare;
</action>

<p @click="go()">hi</p>
`,
    });
    assert.deepStrictEqual(unread(model), [], 'a body containing a shadowing local was not fully followed');
  }

  // ── The block is scoped, not global ───────────────────────────────────────
  {
    const model = analyze({
      'src/components/opaque/opaque.component.js': `<state hidden="1" k="hidden" />

<action name="peek">
  return state[state.k];
</action>

<p @click="peek()">{{ k }}</p>
`,
      'src/components/clear/clear.component.js': `<state dead="1" />

<p>nothing</p>
`,
    });
    assert.deepStrictEqual(
      unread(model),
      ['state:component:Clear.dead'],
      'unresolved analysis in one component does not silence a clean claim in another',
    );
  }

  // ── AVX_W41 fires on a genuinely unreachable action ───────────────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state open="false" />

<action name="toggle">
  state.open = !state.open;
</action>

<action name="orphan">
  state.open = false;
</action>

<button @click="toggle()">{{ open }}</button>
`,
    });
    assert.deepStrictEqual(unreachable(model), ['action:component:Card.orphan']);
  }

  // ── Lifecycle actions the runtime calls by name are exempt ────────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state n="1" />

<action name="onMount">
  state.n = 2;
</action>

<p>{{ n }}</p>
`,
    });
    assert.deepStrictEqual(
      unreachable(model),
      [],
      'AvenxComponent looks up onMount in the component methods; it is reachable with no call site',
    );
    assert.ok(RUNTIME_INVOKED_ACTIONS.has('onMount'));
    assert.ok(RUNTIME_INVOKED_ACTIONS.has('onUnmount'));
  }

  // ── An action reached only from another action is reachable ───────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state n="1" />

<action name="outer">
  inner();
</action>

<action name="inner">
  state.n = state.n + 1;
</action>

<button @click="outer()">{{ n }}</button>
`,
    });
    assert.deepStrictEqual(unreachable(model), [], 'an indirect call site still counts');
  }

  // ── A bridge action invoked from a component is reachable ─────────────────
  {
    const model = analyze({
      'src/bridges/cart.bridge.js': `import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: { n: 0 },
  bump() {
    this.n = this.n + 1;
  },
  unusedAction() {
    this.n = 0;
  },
});
`,
      'src/components/card/card.component.js': `import cart from '../../bridges/cart.bridge.js';

<button @click="cart.bump()">{{ cart.n }}</button>
`,
    });
    assert.deepStrictEqual(
      unreachable(model),
      ['action:bridge:cart.unusedAction'],
      'reachability crosses a file boundary in both directions',
    );
  }

  // ── Both codes route through the warning machinery ────────────────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state dead="1" />

<action name="orphan">
  state.dead = 2;
</action>

<p>hi</p>
`,
    });

    // Warnings go through the framework logger, which the compiler above left
    // silenced. Turn it back on so this asserts on what a developer would see.
    logger.configure({ level: 'warn', silent: false, formatter: (level, args) => args });

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    let summary;
    try {
      summary = reportAtlasDiagnostics(model, {});
    } finally {
      console.warn = originalWarn;
    }

    assert.strictEqual(summary.unreadState, 1);
    assert.strictEqual(summary.unreachableActions, 1);
    assert.ok(
      warnings.some((message) => message.includes('AVX_W40') && message.includes('Card.dead')),
      'the unread-state warning names the symbol',
    );
    assert.ok(
      warnings.some((message) => message.includes('AVX_W41') && message.includes('Card.orphan')),
      'the unreachable-action warning names the symbol',
    );
    assert.ok(
      warnings.some((message) => message.includes('card.component.js')),
      'and points at a file',
    );
    // Message formatting substitutes each placeholder once, so a template that
    // repeats {0} leaks the literal into the text. Nothing else would notice.
    for (const message of warnings) {
      assert.ok(!/\{\d\}/.test(message), `no placeholder survived into: ${message}`);
    }
    assert.ok(
      warnings.some((message) => message.includes('avenx impact Card.dead')),
      'the remedy names the symbol it is talking about',
    );

    // Silenced through the same `warnings` config as every other code.
    const silenced = [];
    console.warn = (...args) => silenced.push(args.join(' '));
    try {
      reportAtlasDiagnostics(model, { warnings: { AVX_W40: 'off', AVX_W41: 'off' } });
    } finally {
      console.warn = originalWarn;
    }
    assert.deepStrictEqual(silenced, [], 'both codes honour the warnings setting');

    // And can be escalated to a build failure, like any other code.
    assert.throws(
      () => reportAtlasDiagnostics(model, { warnings: { AVX_W40: 'error' } }),
      /AVX_W40/,
      'escalation works',
    );
  }

  // ── The catalogue answers `avenx explain` ─────────────────────────────────
  {
    for (const code of ['AVX_W40', 'AVX_W41']) {
      const entry = getDiagnostic(code);
      assert.ok(entry, `${code} is registered in the catalogue`);
      assert.strictEqual(entry.code, code);
      assert.ok(entry.summary && entry.causes.length > 0 && entry.remedies.length > 0, `${code} is documented`);
      assert.strictEqual(getDiagnostic(code.replace('AVX_', '')).code, code, 'the short form resolves too');
    }
    assert.strictEqual(AvenxErrorCodes.ATLAS_UNREAD_STATE, 'AVX_W40');
    assert.strictEqual(AvenxErrorCodes.ATLAS_UNREACHABLE_ACTION, 'AVX_W41');
  }

  // ── AVX_W64: self-referential computed is reported at compile time (#1463) ─
  {
    const model = analyze({
      'src/pages/home.page.js': `<state n='1' />
<computed name='selfref' value='selfref + 1' />
<computed name='dbl' value='n * 2' />
<div><p id='out'>{{ selfref }}</p><p>{{ dbl }}</p></div>
`,
      'src/main.app.js': `import { createApp } from 'avenx-core/runtime';
const app = createApp();
app.mountPage('Home');
`,
    });

    const findings = findCircularComputed(model);
    assert.strictEqual(findings.length, 1, 'one self-loop cycle');
    assert.deepStrictEqual(
      findings[0].nodes.map((node) => node.id),
      ['computed:page:Home.selfref'],
      'the cycle is the selfref node alone',
    );

    const selfNode = resolveSymbol(model, 'Home.selfref')[0];
    assert.ok(selfNode, 'Home.selfref resolves');
    const why = walk(model, selfNode.id, { direction: 'out' });
    assert.ok(
      why.children.some((child) => child.node.id === selfNode.id && child.edge.kind === 'reads'),
      'avenx why must surface the self-loop rather than claim it depends on nothing',
    );

    const dblFindings = findCircularComputed(model).filter((finding) =>
      finding.nodes.some((node) => node.name === 'dbl'),
    );
    assert.deepStrictEqual(dblFindings, [], 'a non-circular computed is not reported');

    logger.configure({ level: 'warn', silent: false, formatter: (level, args) => args });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    let summary;
    try {
      summary = reportAtlasDiagnostics(model, {});
    } finally {
      console.warn = originalWarn;
    }
    assert.strictEqual(summary.circularComputed, 1);
    assert.ok(
      warnings.some((message) => message.includes('AVX_W64') && message.includes('Home.selfref')),
      'the warning names the self-referential computed',
    );
    for (const message of warnings.filter((line) => line.includes('AVX_W64'))) {
      assert.ok(!/\{\d\}/.test(message), `no placeholder survived into: ${message}`);
    }

    const silenced = [];
    console.warn = (...args) => silenced.push(args.join(' '));
    try {
      reportAtlasDiagnostics(model, { warnings: { AVX_W64: 'off' } });
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(
      silenced.every((message) => !message.includes('AVX_W64')),
      'AVX_W64 honours the warnings setting',
    );
  }

  // ── AVX_W64: mutual computed cycle is the same class of bug ───────────────
  {
    const model = analyze({
      'src/components/card/card.component.js': `<state n="1" />

<computed name="a" value="b + 1" />
<computed name="b" value="a + 1" />

<p>{{ a }}</p>
`,
    });
    const findings = findCircularComputed(model);
    assert.strictEqual(findings.length, 1, 'one mutual cycle');
    const names = findings[0].nodes.map((node) => node.name).sort();
    assert.deepStrictEqual(names, ['a', 'b']);
  }

  // ── AVX_W64 catalogue registration ────────────────────────────────────────
  {
    const entry = getDiagnostic('AVX_W64');
    assert.ok(entry, 'AVX_W64 is registered in the catalogue');
    assert.strictEqual(entry.code, 'AVX_W64');
    assert.ok(entry.summary && entry.causes.length > 0 && entry.remedies.length > 0);
    assert.strictEqual(AvenxErrorCodes.ATLAS_COMPUTED_CIRCULAR_DEPENDENCY, 'AVX_W64');
    assert.strictEqual(getDiagnostic('W64').code, 'AVX_W64', 'the short form resolves too');
  }

  console.log('✅ Atlas diagnostics tests passed.');
} catch (err) {
  console.error('❌ Atlas diagnostics test failed:', err);
  process.exit(1);
}
