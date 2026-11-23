/**
 * Which engine renders a component, and how that decision is made.
 *
 * The compiler decides per template: everything the IR models lowers to a
 * render program, and anything else keeps the string renderer. That decision
 * is recorded twice -- as a `program` on the compiled class, and as an entry in
 * the compiler's `renderFallbacks` list -- and the two have to agree, because
 * the first is what the runtime dispatches on and the second is what the build
 * uses to decide whether to link the fallback renderer at all.
 *
 * When they disagreed, a component asked for an engine the bundle did not
 * contain and rendered nothing. These tests hold them together.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/register-happy-dom.js';

import AvenxCompiler from '../../lib/compiler.js';

/**
 * Compiles one component in a throwaway project and reports what happened.
 * @param {string} template - The component source.
 * @returns {{compiled: string, fallbacks: object[], program: object|null}} The result.
 */
function compileOne(template) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-select-')));
  try {
    const dir = path.join(root, 'src', 'components', 'probe');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'probe.component.js');
    fs.writeFileSync(file, template);
    fs.writeFileSync(path.join(root, 'avenx.config.json'), JSON.stringify({ srcDir: 'src', distDir: 'dist' }));

    const compiler = new AvenxCompiler({ rootDir: root });
    compiler.init();
    compiler.componentParser.renderFallbacks = [];
    const compiled = compiler.compileComponent(file);

    // The emitted module carries the program as a static. Its presence is the
    // runtime's entire dispatch condition.
    const hasProgram = /__axProgram\s*=/.test(compiled);
    return {
      compiled,
      hasProgram,
      fallbacks: [...compiler.componentParser.renderFallbacks],
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Templates the IR models, which must compile to a render program. */
const COMPILED = {
  'plain interpolation': '<state n="1" />\n<div><p>{{ n }}</p></div>',
  'a conditional': '<state n="1" />\n<div><@if (n > 0)><p>yes</p><@else><p>no</p></@if></div>',
  'a keyed list': '<state items="[1,2]" />\n<div><@for i in items><span>{{ i }}</span></@for></div>',
  'a slot outlet': '<state n="1" />\n<div><slot /></div>',
  'an event binding': '<state n="1" />\n<action name="go">n = n + 1;</action>\n<div><button @click="go()">{{ n }}</button></div>',
};

/** Templates the IR refuses, which must keep the string renderer. */
const REFUSED = {
  '<@suspense>': '<state n="1" />\n<div><@suspense><@fallback><em>p</em></@fallback><span>{{ n }}</span></@suspense></div>',
  '<@errorBoundary>': '<state n="1" />\n<div><@errorBoundary><@fallback as="e"><b>{{ e.message }}</b></@fallback><span>{{ n }}</span></@errorBoundary></div>',
  '<@deadlock>': '<state n="1" />\n<div><@deadlock name="b"><span>{{ n }}</span><@fallback as="e"><i>{{ e.message }}</i></@fallback></@deadlock></div>',
};

test('renderer selection', async (t) => {
  await t.test('templates the IR models compile to a render program', () => {
    for (const [label, template] of Object.entries(COMPILED)) {
      const result = compileOne(template);
      assert.ok(result.hasProgram, `${label} should compile to a render program`);
      assert.strictEqual(
        result.fallbacks.length,
        0,
        `${label} should not be recorded as a fallback; got ${JSON.stringify(result.fallbacks)}`,
      );
    }
  });

  await t.test('templates the IR refuses keep the string renderer, and say so', () => {
    for (const [label, template] of Object.entries(REFUSED)) {
      const result = compileOne(template);
      assert.ok(!result.hasProgram, `${label} should not compile to a render program`);
      assert.strictEqual(
        result.fallbacks.length,
        1,
        `${label} should be recorded once as a fallback; got ${JSON.stringify(result.fallbacks)}`,
      );
      assert.ok(
        result.fallbacks[0].reason,
        `${label} should record why it was refused, not merely that it was`,
      );
    }
  });

  await t.test('the two records of the decision never disagree', () => {
    // This is the invariant the defect broke. `renderFallbacks` is what the
    // build consults to decide whether to link the string renderer; the
    // `program` static is what the runtime dispatches on. A component with no
    // program that is absent from renderFallbacks is a component asking at run
    // time for an engine the build was never told to include -- which is a
    // blank page, and it is silent.
    for (const template of [...Object.values(COMPILED), ...Object.values(REFUSED)]) {
      const result = compileOne(template);
      assert.strictEqual(
        result.hasProgram,
        result.fallbacks.length === 0,
        'a component has a render program if and only if it was not recorded as a fallback',
      );
    }
  });
});
