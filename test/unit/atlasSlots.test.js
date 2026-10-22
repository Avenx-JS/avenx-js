/**
 * Unit tests for declared / addressed slot collection (AVX_W62 helpers).
 */
import assert from 'assert';
import {
  collectAddressedSlots,
  collectDeclaredSlots,
  findElementInner,
  findUndeclaredSlotNames,
} from '../../lib/compiler/atlas/slots.js';

console.log('🧪 Testing Atlas slot helpers...');

{
  const declared = collectDeclaredSlots(`
<div>
  <slot name="header">FALLBACK-HEADER</slot>
  <slot>FALLBACK-DEFAULT</slot>
</div>
`);
  assert.deepStrictEqual(declared.slots, ['default', 'header']);
  assert.strictEqual(declared.dynamic, false);
}

{
  const declared = collectDeclaredSlots(`<div><slot name="{{ state.n }}"></slot></div>`);
  assert.deepStrictEqual(declared.slots, []);
  assert.strictEqual(declared.dynamic, true);
}

{
  const addressed = collectAddressedSlots(`
    <h2 slot="header">Header</h2>
    <p>Default</p>
    <em slot="typoSlot">this disappears</em>
  `);
  assert.deepStrictEqual(addressed.slots, ['default', 'header', 'typoSlot']);
  assert.strictEqual(addressed.dynamic, false);
}

{
  // Nested slot attrs belong to the nested component, not the outer caller.
  const addressed = collectAddressedSlots(`
    <Layout>
      <p slot="inner">nested</p>
    </Layout>
  `);
  assert.deepStrictEqual(addressed.slots, ['default']);
}

{
  const range = findElementInner('<div><Card><em slot="x">y</em></Card></div>', 'Card', 5);
  assert.ok(range);
  assert.strictEqual(range.inner, '<em slot="x">y</em>');
}

{
  const findings = findUndeclaredSlotNames(['header', 'typoSlot', 'default'], ['header', 'default']);
  assert.deepStrictEqual(
    findings.map((item) => item.slot),
    ['typoSlot'],
  );
}

{
  const findings = findUndeclaredSlotNames(['headr'], ['header', 'default']);
  assert.strictEqual(findings[0].suggestion, 'header');
}

console.log('✅ Atlas slot helper tests passed.');
