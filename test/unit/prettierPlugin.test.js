/**
 * @file prettierPlugin.test.js
 * @description Round-trip tests for the Avenx Prettier plugin
 * (`lib/core/tooling/prettierPlugin.js`), the integration behind
 * `avenx format`. The plugin's contract: Avenx syntax in, formatted Avenx
 * syntax out, with nothing left encoded — no `avenx-` placeholder and no
 * `data-avenx-*` attribute may survive in the output (#1347).
 */
import assert from 'assert';
import * as prettier from 'prettier';
import plugin from '../../lib/core/tooling/prettierPlugin.js';

/**
 * Formats Avenx template source the way `bin/commands/format.js` does.
 * @param {string} source - The template source.
 * @returns {Promise<string>} The formatted output.
 */
async function format(source) {
  return prettier.format(source, {
    filepath: 'x.component.js',
    plugins: [plugin],
  });
}

/**
 * Every tag the plugin declares in its `AVENX_TAGS` list, each with a
 * minimal, realistic template that exercises that tag (one assertion per
 * tag is the acceptance criterion in #1347; the spellings match the ones
 * the plugin encodes, e.g. `errorBoundary` camel-case).
 * @type {Array<[string, string, RegExp]>} Tag, source, expected content.
 */
const TAG_CASES = [
  ['css', '<div><@css>body { color: red; }</@css></div>', /@css/],
  ['global', '<@global>h1 { margin: 0; }</@global>', /@global/],
  ['if', '<div><@if visible><p>Yes {{ n }}</p></@if></div>', /@if/],
  ['elseif', '<div><@if a><p>1</p><@elseif b><p>1.5</p></@if></div>', /@elseif/],
  ['elif', '<div><@if a><p>1</p><@elif b><p>1.5</p></@if></div>', /@elif/],
  ['else', '<div><@if a><p>1</p><@else><p>2</p></@if></div>', /@else/],
  ['for', '<div><@for item in items><p>{{ item.name }}</p></@for></div>', /@for/],
  ['defer', '<div><@defer when idle><p>Late</p></@defer></div>', /@defer/],
  ['suspense', '<@suspense><p>Loading</p></@suspense>', /@suspense/],
  ['errorBoundary', '<@errorBoundary><p>OK</p></@errorBoundary>', /@errorBoundary/],
  ['deadlock', '<@deadlock name="d"><p>OK</p></@deadlock>', /@deadlock/],
  ['fallback', '<@fallback as="err"><p>Err {{ err }}</p></@fallback>', /@fallback/],
  ['empty', '<@for item in items><p>{{ item }}</p><@empty><p>No items</p></@for>', /@empty/],
];

/** A composite template exercising several tags at once. */
const COMPOSITE = [
  '<div class="card">',
  '  <@css>.card { border: 1px solid black; }</@css>',
  '  <@for item in items>',
  '    <@if item.active>',
  '      <p>{{ item.name }}</p>',
  '    <@elseif item.pending>',
  '      <p>Pending {{ item.name }}</p>',
  '    <@else>',
  '      <p>Inactive</p>',
  '    </@if>',
  '  </@for>',
  '</div>',
].join('\n');

/** Matches any placeholder the encode pass could leave behind. */
const PLACEHOLDER = /avenx-|data-avenx-/;

(async () => {
  console.log('🧪 Testing the Avenx Prettier plugin round trip...');

  try {
    // 1. Every declared tag round-trips, with no placeholder left behind.
    for (const [tag, source, expected] of TAG_CASES) {
      const out = await format(source);
      assert.ok(!PLACEHOLDER.test(out), `${tag}: no avenx- or data-avenx- placeholder may survive in:\n${out}`);
      assert.ok(expected.test(out), `${tag}: the tag must be restored in:\n${out}`);
    }

    // 2. A header containing `>` survives via the header-attribute encoding.
    const headerOut = await format('<@if (n > 1)><p>x</p></@if>');
    assert.ok(/n > 1/.test(headerOut), `the comparison must survive: ${headerOut}`);
    assert.ok(!PLACEHOLDER.test(headerOut), `no placeholder: ${headerOut}`);

    // 3. Formatting is idempotent: formatting the formatted output changes
    //    nothing.
    const once = await format(COMPOSITE);
    const twice = await format(once);
    assert.strictEqual(twice, once, 'formatting the formatted output must not change it');

    // 4. Style block contents are preserved: the declarations still exist
    //    after formatting, with prettier's CSS formatting applied.
    const styled = await format('<div><@css>body{color:red;margin:0}</@css></div>');
    assert.ok(/@css/.test(styled), 'the css tag must be restored');
    assert.ok(/color:\s*red/.test(styled), 'the css declarations must survive');
    assert.ok(/margin:\s*0/.test(styled), 'both declarations must survive');
    assert.ok(!PLACEHOLDER.test(styled), 'no placeholder survives');

    // 5. Mixed nesting: an `@if` chain containing a `@for`, and a `@for`
    //    with an `@empty` arm containing an `@if`, must survive intact.
    const mixedIfFor = await format(
      '<div><@if a><p>1</p><@else><@for item in items><p>{{ item }}</p></@for></@if></div>',
    );
    assert.ok(!PLACEHOLDER.test(mixedIfFor), `no placeholder in nested if/for: ${mixedIfFor}`);
    assert.ok(/@else/.test(mixedIfFor) && /@for/.test(mixedIfFor), 'both constructs restored');

    const mixedForIf = await format(
      '<@for item in items><@if item.x><p>{{ item }}</p></@if><@empty><p>none</p></@for>',
    );
    assert.ok(!PLACEHOLDER.test(mixedForIf), `no placeholder in nested for/if: ${mixedForIf}`);
    assert.ok(/@empty/.test(mixedForIf) && /@if/.test(mixedForIf), 'both constructs restored');

    // 6. JavaScript body tags (<action>, <computed>, <resource>) are preserved
    //    verbatim and never collapsed (#1622).
    const actionSource = [
      '<state count="0" total="0" />',
      '',
      '<action name="bump">',
      '    // count first, then accumulate',
      '    count = count + 1;',
      '    total = total + count;',
      '</action>',
      '',
      '<div>',
      '    <button @click="bump()">Bump</button>',
      '    <p>count={{ count }} total={{ total }}</p>',
      '</div>',
    ].join('\n');
    const actionOut = await format(actionSource);
    assert.ok(
      actionOut.includes('// count first, then accumulate\n    count = count + 1;'),
      'action body statements must remain on their own lines after a line comment',
    );
    const actionTwice = await format(actionOut);
    assert.strictEqual(actionTwice, actionOut, 'action formatting must be idempotent');

    // 7. Template literal newlines inside <action> survive formatting.
    const multilineLiteral = ['<action name="build">', '    msg = `line one', 'line two`;', '</action>'].join('\n');
    const literalOut = await format(multilineLiteral);
    assert.ok(
      literalOut.includes('`line one\nline two`'),
      'multiline template literal newline must survive formatting',
    );

    // 8. <computed> and <resource> bodies with comments preserve statements.
    const computedAndResource = [
      '<computed name="doubled">',
      '    // double it',
      '    return n * 2;',
      '</computed>',
      '<resource name="info">',
      '    // fetch the thing',
      "    return fetch('/api/info').then((r) => r.json());",
      '</resource>',
    ].join('\n');
    const compResOut = await format(computedAndResource);
    assert.ok(
      compResOut.includes('// double it\n    return n * 2;'),
      'computed body statements must not be swallowed by comment',
    );
    assert.ok(
      compResOut.includes("// fetch the thing\n    return fetch('/api/info')"),
      'resource body statements must not be swallowed by comment',
    );
    const compResTwice = await format(compResOut);
    assert.strictEqual(compResTwice, compResOut, 'computed and resource formatting must be idempotent');

    // 9. Self-closing <computed ... /> remains valid and formatted.
    const selfClosingComputed = '<computed name="doubled" value="count * 2" />\n<div><p>{{ doubled }}</p></div>';
    const selfClosingOut = await format(selfClosingComputed);
    assert.ok(
      selfClosingOut.includes('<computed name="doubled" value="count * 2" />'),
      'self-closing computed formatted',
    );
    assert.ok(!PLACEHOLDER.test(selfClosingOut), 'no placeholder in self-closing computed');

    console.log('  ✅ Prettier plugin round trip tests passed!');
  } catch (error) {
    console.error('  ❌ Prettier plugin round trip tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
