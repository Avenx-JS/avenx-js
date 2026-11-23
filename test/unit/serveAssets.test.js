import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getInspectorHtml, getErrorOverlayScript } from '../../bin/commands/serve.js';

// Captured from the original template strings. Preserve the full response,
// including whitespace, script escaping and marker-like configuration values.
const configs = [
  {},
  { server: { port: 9876, host: '</script><b>$& {{AVENX_CLIENT}}\u2028\u2029' }, name: '\u96ea', srcDir: 'source' },
];
const expected = [
  'e876577c89adea0bdf831714dbf69d2757e67d34ed47a1c16674ca373cfa018d',
  'f9cc87884c5ee7ce1a15ac91f3d6d7c1835f64b5e54ce0f52945ea640ecd212c',
];
for (const [index, config] of configs.entries()) {
  const html = getInspectorHtml({ config });
  assert.equal(createHash('sha256').update(html).digest('hex'), expected[index]);
}
console.log('Inspector responses remain byte-identical after asset extraction');

assert.equal(createHash('sha256').update(getErrorOverlayScript()).digest('hex'), '48ea2ac1d4931cde610e8433029759c09175ed7bcdead080547e1d0785489c91');
