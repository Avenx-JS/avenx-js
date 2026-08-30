/**
 * The three Rewind diagnostics are claims about the *gap* between what an
 * atomic action promises and what a rewind can deliver, so the cases that
 * matter most are the ones where they must stay quiet.
 *
 * AVX_W44 in particular compares two write sets. Computed from an incomplete
 * set it would be a false positive and a false negative at the same time, so
 * it is gated on boundedness — and that gate gets a test paired with a
 * positive case in the same shape of code.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AvenxCompiler from '../../lib/compiler.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';
import {
  findIrreversibleTransactions,
  findOverlappingTransactions,
  findUnboundedTransactions,
  reportRewindDiagnostics,
} from '../../lib/compiler/rewind/diagnostics.js';
import { collectAtomicActions, computeWriteSet } from '../../lib/compiler/rewind/writeSet.js';
import { getDiagnostic } from '../../lib/core/diagnostics/catalogue.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

console.log('🧪 Testing Avenx Rewind diagnostics...');

/**
 * Analyses an in-memory project.
 * @param {Record<string, string>} files - Relative paths to contents.
 * @returns {object} The model.
 */
function analyze(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-rewind-diag-'));
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

/** @param {object} model @returns {string[]} */
const unbounded = (model) => findUnboundedTransactions(model).map((f) => f.action.label).sort();
/** @param {object} model @returns {string[]} */
const irreversible = (model) => findIrreversibleTransactions(model).map((f) => f.action.label).sort();
/** @param {object} model @returns {string[]} */
const overlaps = (model) =>
  findOverlappingTransactions(model)
    .map((f) => [f.left.label, f.right.label].sort().join(' + '))
    .sort();

try {
  // ── The model carries the declaration ─────────────────────────────────────
  {
    const model = analyze({
      'src/components/counter/counter.component.js': `
<state count="0" other="0" />

<action name="bump" atomic>
  count++;
</action>

<action name="bumpForce" atomic onConflict="force">
  other++;
</action>

<action name="plain">
  count = 0;
</action>

<div>{{ count }}{{ other }}<button @click="bump()">+</button><button @click="bumpForce()">f</button><button @click="plain()">r</button></div>
`,
    });

    const bump = model.getNode('action:component:Counter.bump');
    const forced = model.getNode('action:component:Counter.bumpForce');
    const plain = model.getNode('action:component:Counter.plain');

    assert.strictEqual(bump.atomic, true, 'the atomic modifier reaches the model');
    assert.strictEqual(bump.onConflict, undefined, 'no policy is recorded when none is declared');
    assert.strictEqual(forced.onConflict, 'force', 'a declared policy is recorded');
    assert.strictEqual(plain.atomic, undefined, 'a plain action carries no marker');

    const atomicActions = collectAtomicActions(model).map((entry) => entry.label).sort();
    assert.deepStrictEqual(atomicActions, ['Counter.bump', 'Counter.bumpForce'], 'only atomic actions are collected');
    console.log('  ✅ The atomic modifier reaches the semantic model.');
  }

  // ── The write set follows invokes across a bridge ─────────────────────────
  {
    const model = analyze({
      'src/bridges/cart.bridge.js': `import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: { items: [], revision: 0 },
  addQty: atomic(function (id, n) {
    const item = this.items.find((entry) => entry.id === id);
    item.qty = item.qty + n;
    this.revision = this.revision + 1;
  }),
});
`,
      'src/components/cart-item/cart-item.component.js': `import cart from '../../bridges/cart.bridge.js';

<state id="a" busy="false" />

<action name="incQty" atomic>
  busy = true;
  cart.addQty(id, 1);
</action>

<div>{{ busy }}{{ cart.revision }}{{ cart.items }}<button @click="incQty()">+</button></div>
`,
    });

    const set = computeWriteSet(model, 'action:component:CartItem.incQty');
    assert.ok(set.bounded, `the write set should be bounded, reasons: ${JSON.stringify(set.reasons)}`);
    assert.ok(set.writes.includes('CartItem.busy'), 'the action\'s own write is in the set');
    assert.ok(
      set.writes.includes('cart.revision'),
      `a write made by an invoked bridge action is in the set: ${set.writes.join(', ')}`,
    );
    assert.ok(
      set.writes.some((entry) => entry.startsWith('cart.items')),
      `the element write reached through the bridge is in the set: ${set.writes.join(', ')}`,
    );
    console.log('  ✅ The write set follows invokes across a bridge boundary.');
  }

  // ── AVX_W42 fires on a write the analyser could not follow ────────────────
  {
    const model = analyze({
      'src/bridges/cart.bridge.js': `import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: { items: [] },
  setField: atomic(function (id, field, value) {
    const item = this.items.find((entry) => entry.id === id);
    item[field] = value;
  }),
});
`,
      'src/components/editor/editor.component.js': `import cart from '../../bridges/cart.bridge.js';

<action name="rename" atomic>
  cart.setField('a', 'label', 'x');
</action>

<div>{{ cart.items }}<button @click="rename()">go</button></div>
`,
    });

    assert.deepStrictEqual(
      unbounded(model),
      ['Editor.rename', 'cart.setField'],
      'the dynamic member makes the action, and its caller, unbounded',
    );
    const finding = findUnboundedTransactions(model).find((f) => f.action.label === 'cart.setField');
    assert.ok(
      finding.lines.join('\n').includes('dynamic-member'),
      `the reason is named: ${finding.lines.join(' | ')}`,
    );
    console.log('  ✅ AVX_W42 names the reason the write set is incomplete.');
  }

  // ── AVX_W42 fires on a write made after the transaction closes ────────────
  {
    const model = analyze({
      'src/components/saver/saver.component.js': `
<state done="false" />

<action name="save" atomic>
  return Promise.resolve().then(() => { state.done = true; });
</action>

<div>{{ done }}<button @click="save()">go</button></div>
`,
    });

    assert.deepStrictEqual(unbounded(model), ['Saver.save'], 'a write inside .then() is a completeness problem');
    const finding = findUnboundedTransactions(model)[0];
    assert.ok(
      finding.lines.join('\n').includes('runs after the transaction has closed'),
      `the deferred write is explained: ${finding.lines.join(' | ')}`,
    );
    console.log('  ✅ AVX_W42 reports a write the journal will never see.');
  }

  // ── AVX_W42 stays quiet on a fully resolved action ────────────────────────
  {
    const model = analyze({
      'src/components/counter/counter.component.js': `
<state count="0" />

<action name="bump" atomic>
  count = count + 1;
</action>

<div>{{ count }}<button @click="bump()">+</button></div>
`,
    });

    assert.deepStrictEqual(unbounded(model), [], 'nothing unresolved means nothing to report');
    console.log('  ✅ AVX_W42 stays quiet when the analysis was complete.');
  }

  // ── AVX_W43 names each effect a rewind will leave behind ──────────────────
  {
    const model = analyze({
      'src/bridges/session.bridge.js': `import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: { saved: 0 },
  save: atomic(function (stamp) {
    this.saved = stamp;
    localStorage.setItem('saved', String(stamp));
    this.emit('saved', stamp);
  }),
  quiet: atomic(function (stamp) {
    this.saved = stamp;
  }),
});
`,
      'src/components/bar/bar.component.js': `import session from '../../bridges/session.bridge.js';

<action name="go">
  session.save(1);
  session.quiet(2);
</action>

<div>{{ session.saved }}<button @click="go()">go</button></div>
`,
    });

    assert.deepStrictEqual(irreversible(model), ['session.save'], 'only the action with effects is reported');
    const finding = findIrreversibleTransactions(model)[0];
    assert.deepStrictEqual(
      finding.effects.map((effect) => effect.kind),
      ['storage', 'emit'],
      'both effects are classified, in source order',
    );
    assert.ok(
      finding.effects.every((effect) => typeof effect.line === 'number' && effect.line > 0),
      'each effect carries a line',
    );
    console.log('  ✅ AVX_W43 names each irreversible effect and its line.');
  }

  // ── AVX_W43 does not report the request the rewind hangs off ──────────────
  {
    const model = analyze({
      'src/components/saver/saver.component.js': `
<state busy="false" />

<action name="save" atomic>
  busy = true;
  return fetch('/save');
</action>

<div>{{ busy }}<button @click="save()">go</button></div>
`,
    });

    assert.deepStrictEqual(
      irreversible(model),
      [],
      'a returned request is the transaction outcome, not a loose effect',
    );
    console.log('  ✅ AVX_W43 leaves the returned request alone.');
  }

  // ── AVX_W44 fires on two actions that write the same state ────────────────
  {
    const model = analyze({
      'src/components/post/post.component.js': `
<state likes="4" />

<action name="like" atomic>
  likes++;
</action>

<action name="unlike" atomic>
  likes--;
</action>

<div>{{ likes }}<button @click="like()">+</button><button @click="unlike()">-</button></div>
`,
    });

    assert.deepStrictEqual(overlaps(model), ['Post.like + Post.unlike'], 'the pair is reported once');
    assert.deepStrictEqual(
      findOverlappingTransactions(model)[0].shared,
      ['Post.likes'],
      'the shared write is named',
    );
    console.log('  ✅ AVX_W44 reports a genuine overlap.');
  }

  // ── AVX_W44 stays quiet on a caller and its callee ────────────────────────
  {
    const model = analyze({
      'src/bridges/cart.bridge.js': `import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: { revision: 0 },
  bump: atomic(function () {
    this.revision = this.revision + 1;
  }),
});
`,
      'src/components/cart-item/cart-item.component.js': `import cart from '../../bridges/cart.bridge.js';

<action name="inc" atomic>
  cart.bump();
</action>

<div>{{ cart.revision }}<button @click="inc()">+</button></div>
`,
    });

    assert.deepStrictEqual(
      overlaps(model),
      [],
      'a nested transaction joins the enclosing frame, so the pair cannot conflict',
    );
    console.log('  ✅ AVX_W44 stays quiet on a caller and its callee.');
  }

  // ── AVX_W44 stays quiet when a write set is incomplete ────────────────────
  {
    const model = analyze({
      'src/components/post/post.component.js': `
<state likes="4" field="likes" />

<action name="like" atomic>
  likes++;
</action>

<action name="mystery" atomic>
  state[field] = 9;
  likes = 1;
</action>

<div>{{ likes }}{{ field }}<button @click="like()">+</button><button @click="mystery()">?</button></div>
`,
    });

    assert.ok(unbounded(model).includes('Post.mystery'), 'the dynamic write makes the action unbounded');
    assert.deepStrictEqual(
      overlaps(model),
      [],
      'an unbounded write set is excluded from the comparison rather than compared partially',
    );
    console.log('  ✅ AVX_W44 refuses to compare an incomplete write set.');
  }

  // ── Everything routes through the warning machinery ───────────────────────
  {
    const model = analyze({
      'src/components/post/post.component.js': `
<state likes="4" />

<action name="like" atomic>
  likes++;
</action>

<action name="unlike" atomic>
  likes--;
</action>

<div>{{ likes }}<button @click="like()">+</button><button @click="unlike()">-</button></div>
`,
    });

    const messages = [];
    const originalWarn = logger.warn;
    logger.warn = (...args) => messages.push(args.join(' '));
    let counts;
    try {
      counts = reportRewindDiagnostics(model, {});
    } finally {
      logger.warn = originalWarn;
    }

    assert.strictEqual(counts.overlapping, 1, 'the finding is counted');
    assert.ok(messages.some((message) => message.includes('AVX_W44')), 'and reported through the logger');

    // Silencing works, and so does escalation.
    logger.warn = () => {};
    try {
      const silenced = reportRewindDiagnostics(model, { warnings: { AVX_W44: 'off' } });
      assert.strictEqual(silenced.overlapping, 1, 'the finding is still counted when silenced');
      assert.throws(
        () => reportRewindDiagnostics(model, { warnings: { AVX_W44: 'error' } }),
        (error) => error.code === AvenxErrorCodes.COMPILER_TRANSACTION_OVERLAP,
        'escalation to "error" fails the build',
      );
    } finally {
      logger.warn = originalWarn;
    }
    console.log('  ✅ Findings honour the warnings setting, including escalation.');
  }

  // ── Every code is documented ──────────────────────────────────────────────
  {
    for (const code of ['AVX_W42', 'AVX_W43', 'AVX_W44', 'AVX_R29']) {
      const entry = getDiagnostic(code);
      assert.ok(entry, `${code} is in the catalogue`);
      assert.ok(entry.summary && entry.causes.length > 0 && entry.remedies.length > 0, `${code} is documented`);
    }
    assert.strictEqual(AvenxErrorCodes.TRANSACTION_REWIND_FAILED, 'AVX_R29', 'AVX_R29 is registered');
    console.log('  ✅ Every Rewind code is registered and documented.');
  }

  console.log('🎉 Avenx Rewind diagnostics tests passed.');
} catch (error) {
  console.error('❌ Avenx Rewind diagnostics tests failed:', error);
  process.exit(1);
}
