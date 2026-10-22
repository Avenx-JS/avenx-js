/**
 * @file actionTrustedHtml.test.js
 * @description Documented trusted-HTML helpers must resolve inside `<action>` bodies.
 *
 * The templates guide shows both `new SafeHtml(...)` and the `html` tagged
 * template as the way to opt out of escaping. Free identifiers in an `<action>`
 * body are rewritten to ambient lookup, and without a framework binding those
 * names fall through to `globalThis` where they are undefined, so both throw at
 * runtime with no build diagnostic.
 */
import assert from 'node:assert';
import { compileActionToSource } from '../../lib/compiler/codegen/actions.js';
import {
  EXPRESSION_OPS,
  readAmbientIdentifier,
  typeofAmbientIdentifier,
  writeAmbientIdentifier,
} from '../../lib/core/expression/ops.js';
import { html, SafeHtml } from '../../lib/core/security/escapeHtml.js';

/**
 * Turns generated `($s) => …` source into a callable, with the primitives bound.
 * @param {string} generated - Generated source.
 * @returns {Function} The compiled body.
 */
function link(generated) {
  const names = Object.keys(EXPRESSION_OPS);
  return new Function(...names, `return (${generated});`)(...Object.values(EXPRESSION_OPS));
}

try {
  console.log('🧪 Ambient lookup returns the runtime SafeHtml and html exports');

  assert.strictEqual(readAmbientIdentifier({}, 'SafeHtml'), SafeHtml);
  assert.strictEqual(readAmbientIdentifier({}, 'html'), html);
  assert.strictEqual(typeofAmbientIdentifier({}, 'SafeHtml'), 'function');
  assert.strictEqual(typeofAmbientIdentifier({}, 'html'), 'function');

  // Component scope still wins over the framework binding.
  const shadowed = { SafeHtml: 'from state', html: 'from state' };
  assert.strictEqual(readAmbientIdentifier(shadowed, 'SafeHtml'), 'from state');
  assert.strictEqual(readAmbientIdentifier(shadowed, 'html'), 'from state');

  // Assigning over the framework binding is refused, matching allow-listed globals.
  assert.throws(() => writeAmbientIdentifier({}, 'SafeHtml', null), /Assigning to the global "SafeHtml"/);
  assert.throws(() => writeAmbientIdentifier({}, 'html', null), /Assigning to the global "html"/);

  console.log('🧪 Compiled action bodies can construct trusted HTML');

  const viaCtor = link(
    compileActionToSource("return new SafeHtml('<strong>via SafeHtml</strong>');", { ambient: true }),
  )({});
  assert.ok(viaCtor instanceof SafeHtml);
  assert.strictEqual(String(viaCtor), '<strong>via SafeHtml</strong>');

  const viaTag = link(compileActionToSource('return html`<em>via html</em>`;', { ambient: true }))({});
  assert.ok(viaTag instanceof SafeHtml);
  assert.strictEqual(String(viaTag), '<em>via html</em>');

  // Assign into component state the way the documented example does.
  const scope = { s1: '', s2: '' };
  link(
    compileActionToSource(
      ["s1 = new SafeHtml('<strong>via SafeHtml</strong>');", 's2 = html`<em>via html</em>`;'].join('\n'),
      { ambient: true },
    ),
  )(scope);
  assert.ok(scope.s1 instanceof SafeHtml);
  assert.ok(scope.s2 instanceof SafeHtml);
  assert.strictEqual(String(scope.s1), '<strong>via SafeHtml</strong>');
  assert.strictEqual(String(scope.s2), '<em>via html</em>');

  // A page-level window.html must not hide the framework helper unless scope binds it.
  const previousHtml = globalThis.html;
  globalThis.html = () => {
    throw new Error('page html should not be used');
  };
  try {
    assert.strictEqual(readAmbientIdentifier({}, 'html'), html);
  } finally {
    if (previousHtml === undefined) delete globalThis.html;
    else globalThis.html = previousHtml;
  }

  console.log('  ✅ Action trusted-HTML tests passed!');
} catch (error) {
  console.error('❌ Action trusted-HTML tests failed:', error);
  process.exitCode = 1;
}
