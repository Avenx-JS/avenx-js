/**
 * AVX_R34 must name the component -- or the operation -- that needs the
 * string renderer.
 *
 * `requireStringRenderer` used to default its name to 'a component', and the
 * router's transition path called it with no name at all, so a page
 * navigation with a configured transition reported
 * `[AVX_R34] <a component> needs the string renderer ...` -- twice over, with
 * nothing to tell the two pages apart. The diagnostic's whole value is the
 * name in that slot.
 *
 * Pinned here:
 * - a bare or blank call can never produce `<a component>` again;
 * - a component that falls back names its own class;
 * - a page transition names the operation and the page being navigated to.
 *
 * The four `AvenxComponent` getters (#renderer, #patcher, #listManager,
 * #deferManager) all pass the same `this.constructor.name`, and the first one
 * reached throws before the rest can run, so the mounted-component case below
 * covers the name they all pass; the transition case covers the one call site
 * that passed nothing.
 */
import assert from 'assert';
import '../../lib/core/renderer/installStringRenderer.js';
import {
  requireStringRenderer,
  hasStringRenderer,
  installStringRenderer,
} from '../../lib/core/renderer/stringRenderer.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/index.js';
import { buildTemplateIR } from '../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../lib/compiler/ir/lower.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';

console.log('🧪 Testing AVX_R34 names the component or operation...');

// The test runner installs the string renderer into every test process, the
// way a development build does. Taking it away is the only way to observe the
// condition, so it is restored immediately afterwards.
const saved = hasStringRenderer() ? requireStringRenderer('test-harness') : null;

try {
  installStringRenderer(null);

  assert.strictEqual(hasStringRenderer(), false, 'the registry should read as empty once cleared');

  // 1. A call with no name -- and one with a blank name -- can never again
  // produce the `<a component>` placeholder.
  for (const name of [undefined, '', '   ']) {
    assert.throws(
      () => requireStringRenderer(name),
      (error) => {
        assert.strictEqual(
          error.code,
          AvenxErrorCodes.RENDERER_UNAVAILABLE,
          'a nameless call should still raise AVX_R34',
        );
        assert.ok(
          !String(error.message).includes('<a component>'),
          `the message must never contain the placeholder; got: ${String(error.message).split('\n')[0]}`,
        );
        assert.ok(
          String(error.message).includes('an unnamed component'),
          'a nameless call should say so plainly instead of faking a name',
        );
        return true;
      },
    );
  }
  console.log('  ✅ a bare or blank requireStringRenderer call never says `<a component>`');

  // 2. A named call still names the component.
  assert.throws(
    () => requireStringRenderer('CartSummary'),
    (error) => {
      assert.strictEqual(error.code, AvenxErrorCodes.RENDERER_UNAVAILABLE);
      assert.ok(String(error.message).includes('CartSummary'), 'the message should name the component');
      assert.ok(!String(error.message).includes('<a component>'), 'the message should not carry the placeholder');
      return true;
    },
  );
  console.log('  ✅ a named call still names the component');

  // 3. End to end through AvenxComponent: a component with no render program
  // reports AVX_R34 naming its own class.
  const capturedPlain = [];
  class Plain extends AvenxComponent {
    constructor() {
      super(
        {},
        {},
        {},
        '<div><h1>Plain</h1></div>',
        {
          onErrorCaptured(error) {
            capturedPlain.push(error);
            return false;
          },
        },
        {},
        {},
        {},
        {},
      );
    }
  }
  const plainHost = document.createElement('div');
  document.body.appendChild(plainHost);
  new Plain().mount(plainHost);
  await nextTick();

  assert.ok(capturedPlain.length > 0, 'the uncompiled component should report its render failure');
  assert.strictEqual(
    capturedPlain[0].code,
    AvenxErrorCodes.RENDERER_UNAVAILABLE,
    'a component with no program still reports AVX_R34',
  );
  assert.ok(
    String(capturedPlain[0].message).includes('Plain'),
    `the component message should name the class; got: ${String(capturedPlain[0].message).split('\n')[0]}`,
  );
  assert.ok(
    !String(capturedPlain[0].message).includes('<a component>'),
    'the component message should not carry the placeholder',
  );
  console.log('  ✅ a component with no program reports AVX_R34 naming its class');

  // 4. End to end through the router: a page navigation with a configured
  // transition names the operation and the page, not `<a component>`.
  // Both pages compile to render programs, so mounting them needs no string
  // renderer -- only the transition does.
  const makePage = (label) => {
    const built = buildTemplateIR(`<div><h1>${label}</h1></div>`, {});
    assert.strictEqual(built.refusal, null, `the ${label} fixture template should compile`);
    const lowered = lowerToProgram(built.ir, {});
    assert.ok(lowered.program, `the ${label} fixture template should lower to a program`);
    return class extends AvenxComponent {
      constructor(bridges) {
        super({}, {}, bridges, `<div><h1>${label}</h1></div>`, {}, {}, {}, {}, { program: lowered.program });
      }
    };
  };

  document.body.innerHTML = '<div id="app"></div>';
  const app = new AvenxApp({ target: '#app' });
  app.pages.set('One', makePage('One'));
  app.pages.set('Two', makePage('Two'));

  app.mountPage('One', {}, {});
  assert.ok(
    document.querySelector('#app').innerHTML.includes('One'),
    'the compiled first page should mount without the string renderer',
  );

  assert.throws(
    () => app.mountPage('Two', {}, { transition: 'fade' }),
    (error) => {
      assert.strictEqual(error.code, AvenxErrorCodes.RENDERER_UNAVAILABLE, 'the transition should raise AVX_R34');
      assert.ok(
        String(error.message).includes('page transition'),
        `the message should name the operation; got: ${String(error.message).split('\n')[0]}`,
      );
      assert.ok(String(error.message).includes('"Two"'), 'the message should name the page being navigated to');
      assert.ok(
        !String(error.message).includes('<a component>'),
        'the transition message should not carry the placeholder',
      );
      return true;
    },
  );
  console.log('  ✅ a page transition reports AVX_R34 naming the operation and the page');

  // Restoring it makes the condition go away again.
  if (saved) {
    installStringRenderer(saved);
    assert.ok(hasStringRenderer(), 'the registry should read as filled once restored');
    console.log('  ✅ a filled registry returns the renderer');
  }

  console.log('✅ All AVX_R34 naming tests passed!');
} finally {
  installStringRenderer(saved);
}
