/**
 * @file prettierPlugin.test.js
 * @description The Avenx Prettier plugin preserves template syntax while formatting.
 *
 * `printers.html` used to shadow Prettier's HTML printer `preprocess` with a
 * wrapper that never called the original. The printer then read normalisation
 * flags that were never set, and any node with a child crashed with
 * `TypeError: Cannot read properties of undefined (reading 'startsWith')`
 * (issue #1346). The plugin had no test file, so nothing caught it.
 */
import assert from 'node:assert';
import * as prettier from 'prettier';
import plugin from '../../lib/core/tooling/prettierPlugin.js';
import { tokenizeMarkup } from '../../lib/core/utils/markupLexer.js';

/**
 * Formats an Avenx template with the repository's plugin.
 * @param {string} source - The Avenx template source.
 * @param {object} [options] - Parser selection or file path.
 * @returns {Promise<string>} Formatted source.
 */
function format(source, options = { parser: 'avenx-template' }) {
  return prettier.format(source, {
    ...options,
    plugins: [plugin],
  });
}

// Compare the compiler lexer's reading, independently of Prettier's HTML AST.
// Ignore layout between tags and around text, but retain tag order/case,
// self-closing markers, directive headers, attribute values and interpolation text.
function syntax(source) {
  return tokenizeMarkup(source).flatMap((token) => {
    if (token.type === 'open') {
      const header = token.directive ? source.slice(token.nameEnd, token.attrEnd).trim() : null;
      return [[token.type, token.name, token.selfClosing, header, token.attrs.map(({ name, value }) => [name, value])]];
    }
    if (token.type === 'close') {
      return [[token.type, token.name]];
    }
    const content = source.slice(token.start, token.end).trim();
    return content ? [[token.type, content]] : [];
  });
}

async function roundTrip(source, options) {
  const output = await format(source, options);
  assert.ok(!/avenx-|data-avenx-/.test(output), `no encoding placeholders in ${source}`);
  assert.deepStrictEqual(syntax(output), syntax(source), `syntax and content preserved in ${source}`);
  assert.strictEqual(await format(output, options), output, `idempotent formatting of ${source}`);
  return output;
}

try {
  console.log('🧪 The Avenx Prettier plugin formats and round-trips templates');

  // The reported crash: a template as plain as this one failed to format.
  const plain = await format('<div>x</div>\n');
  assert.strictEqual(plain, '<div>x</div>\n');

  console.log('  ✅ A plain element formats without crashing');

  // Plain nesting -- a parent with children is the case that threw.
  const nested = await format('<div><p>hi</p><span>there</span></div>\n');
  assert.strictEqual(nested, '<div>\n  <p>hi</p>\n  <span>there</span>\n</div>\n');

  console.log('  ✅ Nested elements format correctly');

  // Standard HTML attributes and void elements remain intact alongside formatting.
  const standardHtml =
    '<div id="main" class="container" data-custom="value">' +
    '<input type="checkbox" checked disabled />' +
    '<p title="summary">Details</p>' +
    '</div>\n';
  const standardHtmlOutput = await roundTrip(standardHtml);
  assert.ok(standardHtmlOutput.includes('checked disabled'), 'boolean attributes are preserved');
  assert.ok(standardHtmlOutput.includes('data-custom="value"'), 'data attributes are preserved');

  console.log('  ✅ Standard HTML attributes and nested markup remain valid');

  // Round-trip: formatting an already-formatted file is a no-op.
  const again = await format(nested);
  assert.strictEqual(again, nested);

  console.log('  ✅ Reformatting formatted output is a no-op');

  // A <@for> with an interpolation prints its closing tag as `</@for\n>`;
  // reformatting that output must still parse (issue #1380).
  const loop = await format('<@for item in items key="item.id"><p>{{ item.name }}</p></@for>\n');
  assert.strictEqual(await format(loop), loop);
  assert.deepStrictEqual(syntax(loop), syntax('<@for item in items key="item.id"><p>{{ item.name }}</p></@for>\n'));
  assert.ok(!/avenx-|data-avenx-/.test(loop), 'no placeholder names in loop output');

  console.log('  ✅ Reformatting a formatted <@for> is a no-op');

  // No encoding placeholders may leak into the printed source.
  assert.ok(!/avenx-|data-avenx-/.test(plain), 'no placeholder names in plain output');
  assert.ok(!/avenx-|data-avenx-/.test(nested), 'no placeholder names in nested output');

  console.log('  ✅ No avenx- placeholders survive');

  const directive = '<div><@css card /><p>Card</p></div>\n';
  const directiveOutput = await roundTrip(directive);
  assert.match(directiveOutput, /<@css card \/>/, 'the CSS directive stays self-closing and keeps its block name');

  // #1347 also requests a forced avenx-template parser preservation check.
  // This is stylesheet source, not a compiler-valid component template (AVX_C24).
  // Its production parser is avenx-css, which formats the bodies below.
  const globalCss = 'body{margin:0;color:red}';
  const scopedCss = 'card{padding:2px;color:blue}';
  const styles = `<@global>${globalCss}</@global>\n<@css>${scopedCss}</@css>\n`;
  const parserOnlyStyles = await roundTrip(styles, { parser: 'avenx-template' });
  assert.strictEqual(parserOnlyStyles.match(/<@global>([\s\S]*?)<\/@global>/)[1], globalCss);
  assert.strictEqual(parserOnlyStyles.match(/<@css>([\s\S]*?)<\/@css>/)[1], scopedCss);

  console.log('  ✅ CSS directive and forced-template parser preservation checks pass');

  // Keep fallback and empty in their enclosing boundary/loop contexts.
  const structural = [
    '<@if ready><p>Ready</p></@if>',
    '<@for item in items key="item.id"><p>{{ item.name }}</p><@empty><p>No items</p></@empty></@for>',
    '<@defer when="visible"><p>{{ message }}</p></@defer>',
    '<@suspense><@fallback><p>Loading</p></@fallback><p>{{ users }}</p></@suspense>',
    '<@errorBoundary><@fallback as="err"><p>{{ err.message }}</p></@fallback><p>Content</p></@errorBoundary>',
    '<@deadlock name="chart" action="fallback"><p>Chart</p><@fallback as="err"><p>{{ err.message }}</p></@fallback></@deadlock>',
  ];
  for (const source of structural) {
    await roundTrip(source);
  }

  console.log('  ✅ Supported structural tags preserve headers, nested content and closing tags');

  // Issue #1365: `<@elseif>` / `<@else>` continue an `<@if>` chain and have no
  // closing form, so the HTML parser cannot accept a structural encoding.
  // Chains with continuations are preserved verbatim; a `>` inside a bracketed
  // condition on a lone `<@if>` must still not end the open tag.
  const ifChains = [
    '<div><@if (n > 0)><p>y</p><@else><p>n</p></@if></div>\n',
    '<@if a><p>1</p><@elseif b><p>2</p><@else><p>3</p></@if>\n',
    '<@if (n > 0)><p>y</p><@elif (n > -1)><p>m</p><@else><p>n</p></@if>\n',
    '<@if outer><@if (inner > 0)><p>y</p><@else><p>n</p></@if><@else><p>z</p></@if>\n',
  ];
  for (const source of ifChains) {
    await roundTrip(source);
  }

  const reported = await format('<div><@if (n > 0)><p>y</p><@else><p>n</p></@if></div>\n');
  assert.ok(reported.includes('<@if (n > 0)><p>y</p><@else><p>n</p></@if>'), 'if/else chain source is preserved');
  assert.ok(!/avenx-|data-avenx-/.test(reported), 'no encoding placeholders leak from if/else chains');

  const bracketedIf = await roundTrip('<@if (n > 0)><p>y</p></@if>\n');
  assert.ok(bracketedIf.includes('<@if (n > 0)>'), 'bracketed if condition survives formatting');
  assert.ok(!bracketedIf.includes('<@if (n>'), 'comparison > is not treated as the tag end');

  console.log('  ✅ <@if> / <@elseif> / <@elif> / <@else> chains format and round-trip');

  const click = 'count > 1 ? count-- : count++';
  const bindings = `<button @css button @click="${click}">{{ count }}</button>`;
  const bindingOutput = await roundTrip(bindings);
  assert.ok(bindingOutput.includes(`@click="${click}"`), 'the handler expression is preserved verbatim');
  assert.match(bindingOutput, /@css button/, 'the style binding keeps its valueless block-name syntax');

  const interpolations = '<p title="{{ user.name }}">{{ count + 1 }} / {{ user.name }}</p>';
  await roundTrip(interpolations);

  const complexInterpolations =
    '<div><p>{{ count + 1 * 2 }}</p><span data-label="{{ user.name }}">{{ user.bio }}</span></div>\n';
  await roundTrip(complexInterpolations);

  console.log('  ✅ Event/style bindings and text/attribute interpolations retain their contents');

  for (const filepath of ['card.component.js', 'home.page.js']) {
    // No explicit parser: Prettier must infer avenx-template from the suffix.
    await roundTrip(directive + bindings, { filepath });
  }

  console.log('  ✅ Component and page file paths select the template parser');

  const cssOptions = { parser: 'avenx-css' };
  const formattedCss = await format(styles, cssOptions);
  const expectedCss =
    '<@global>\n  body {\n    margin: 0;\n    color: red;\n  }\n</@global>\n\n' +
    '<@css>\n  card {\n    padding: 2px;\n    color: blue;\n  }\n</@css>\n\n';
  assert.strictEqual(formattedCss, expectedCss, 'standalone stylesheets receive standard CSS formatting');
  assert.notStrictEqual(formattedCss, parserOnlyStyles, 'CSS and template modes have distinct formatting contracts');
  assert.ok(!/avenx-|data-avenx-/.test(formattedCss), 'no placeholders in standalone CSS');
  assert.strictEqual(await format(formattedCss, cssOptions), formattedCss);

  console.log('  ✅ Standalone Avenx CSS formats declarations and is idempotent');

  // Multiple CSS blocks interspersed with raw CSS outside Avenx blocks.
  const mixedCss =
    '.header { color: red; }\n' +
    '<@global>\nbody { margin: 0; }\n</@global>\n' +
    '.footer { display: flex; }\n' +
    '<@css>\ncard { padding: 4px; }\n</@css>\n';
  const formattedMixedCss = await format(mixedCss, cssOptions);
  const expectedMixedCss =
    '.header {\n  color: red;\n}\n' +
    '<@global>\n  body {\n    margin: 0;\n  }\n</@global>\n\n' +
    '.footer {\n  display: flex;\n}\n' +
    '<@css>\n  card {\n    padding: 4px;\n  }\n</@css>\n\n';
  assert.strictEqual(formattedMixedCss, expectedMixedCss, 'mixed raw and block CSS formats declarations');
  assert.ok(!/avenx-|data-avenx-/.test(formattedMixedCss), 'no placeholders in mixed CSS');
  assert.strictEqual(
    await format(formattedMixedCss, cssOptions),
    formattedMixedCss,
    'mixed CSS formatting is idempotent',
  );

  console.log('  ✅ Multiple CSS blocks and raw CSS outside Avenx blocks format correctly and are idempotent');

  console.log('All Avenx Prettier plugin tests passed!');
} catch (error) {
  console.error('❌ Avenx Prettier plugin tests failed:', error);
  process.exitCode = 1;
}
