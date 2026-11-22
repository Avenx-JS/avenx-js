import assert from 'node:assert/strict';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { getDiagnostic } from '../../lib/core/diagnostics/catalogue.js';

function compile(source, config = {}) {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const parser = new ComponentParser(new StyleProcessor());
    parser.config = config;
    const output = parser.extractTemplate(source, {}, 'Example', 'example.component.js', {}, {}, {});
    return { output, warnings: warnings.filter((w) => w.includes('AVX_W77')) };
  } finally {
    console.warn = original;
  }
}

for (const marker of ['data-ax-static', 'data-ax-key', 'data-ax-skip']) {
  for (const value of ['', '="true"']) {
    const { warnings } = compile(`<section><p ${marker}${value}>text</p></section>`);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(marker));
    assert.ok(warnings[0].includes('<p>'));
    assert.match(warnings[0], marker === 'data-ax-key' ? /key expression on <@for>/ : /Remove it/);
    assert.match(warnings[0], /1 \| <section>/);
  }
}
assert.equal(compile('<p DATA-AX-STATIC>text</p>').warnings.length, 1);
assert.deepEqual(compile('<p data-ax-static>text</p>', { warnings: { AVX_W77: 'off' } }).warnings, []);
assert.throws(() => compile('<p data-ax-static>text</p>', { warnings: { AVX_W77: 'error' } }), /AVX_W77/);
for (const source of [
  '<div><p>static subtree</p></div>',
  '<!-- <p data-ax-static>comment</p> --><p>text</p>',
  '<p title="data-ax-static">text</p>',
  '<div><@for item in items key="item.id"><p>{{item.id}}</p></@for></div>',
]) assert.deepEqual(compile(source).warnings, []);
assert.equal(getDiagnostic('AVX_W77').name, 'CompilerReconciliationMarker');
console.log('Reconciliation marker diagnostics pass.');
