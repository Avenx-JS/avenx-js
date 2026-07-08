const assert = require('assert');
const { TemplateRenderer } = require('../../lib/core/renderer/renderTemplate');
const { HtmlEscaper, SafeHtml, html } = require('../../lib/core/security/escapeHtml');

try {
  console.log('🧪 Testing HtmlEscaper...');
  const escaper = new HtmlEscaper();

  // Test direct escaping of special characters
  assert.strictEqual(
    escaper.escape('<script>alert("xss")</script>'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
  );
  assert.strictEqual(escaper.escape("john & jane's"), 'john &amp; jane&#39;s');
  console.log('  ✅ HtmlEscaper tests passed!');

  console.log('🧪 Testing TemplateRenderer automatic HTML escaping...');
  const renderer = new TemplateRenderer();

  const resolve = (expr) => {
    const scope = {
      unsafeName: '<script>alert(1)</script>',
      safeName: 'John',
      rawHtml: '<strong>bold</strong>',
      safeHtmlObj: html('<em>italic</em>'),
      numberVal: 42,
      nullVal: null,
      undefinedVal: undefined,
    };
    return scope[expr];
  };

  // 1. Escapes normal braces
  assert.strictEqual(renderer.render('Hello {{ unsafeName }}', resolve), 'Hello &lt;script&gt;alert(1)&lt;/script&gt;');

  assert.strictEqual(renderer.render('User: {{ safeName }}', resolve), 'User: John');

  assert.strictEqual(renderer.render('Age: {{ numberVal }}', resolve), 'Age: 42');

  assert.strictEqual(renderer.render('Null: {{ nullVal }}', resolve), 'Null: ');

  // 2. Triple braces (raw interpolation)
  assert.strictEqual(renderer.render('Html: {{{ rawHtml }}}', resolve), 'Html: <strong>bold</strong>');

  assert.strictEqual(
    renderer.render('Mix: {{ safeName }} and {{{ rawHtml }}} and {{ unsafeName }}', resolve),
    'Mix: John and <strong>bold</strong> and &lt;script&gt;alert(1)&lt;/script&gt;',
  );

  // 3. SafeHtml instance resolves raw even with double braces
  assert.strictEqual(renderer.render('Result: {{ safeHtmlObj }}', resolve), 'Result: <em>italic</em>');

  console.log('  ✅ TemplateRenderer escaping tests passed!');

  console.log('🧪 Testing html(...) helper and SafeHtml wrapper...');

  // Function usage
  const safeStr = html('<div>Safe</div>');
  assert.ok(safeStr instanceof SafeHtml);
  assert.strictEqual(String(safeStr), '<div>Safe</div>');

  // Tagged template literal usage
  const userVal = '<script>bad</script>';
  const safeInner = html('<b>Clean</b>');

  const templateResult = html`<div>${userVal} and ${safeInner} and ${42}</div>`;
  assert.ok(templateResult instanceof SafeHtml);
  assert.strictEqual(String(templateResult), '<div>&lt;script&gt;bad&lt;/script&gt; and <b>Clean</b> and 42</div>');

  console.log('  ✅ html(...) helper tests passed!');
} catch (error) {
  console.error('❌ XSS and HTML Escaping tests failed!');
  console.error(error);
  process.exit(1);
}
