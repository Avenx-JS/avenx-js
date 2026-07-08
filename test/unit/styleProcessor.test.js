const assert = require('assert');
const StyleProcessor = require('../../lib/compiler/StyleProcessor');

try {
  console.log('🧪 Testing StyleProcessor...');
  const sp = new StyleProcessor();

  sp.addVariable('primary-color', '#ff0000');
  assert.strictEqual(sp.cssVariables['primary-color'], '#ff0000');

  sp.addGlobalCSS('body { background: white; }');
  assert.ok(sp.rawGlobalCSS.has('body { background: white; }'));

  const processed = sp.process('<div @css my-class></div>', { 'my-class': 'color: red;' }, 'MyComp');
  assert.ok(processed.includes('class="avenx-'));

  // Test media queries and keyframes scoping
  const complexCss = `
    color: red;
    & h1 { color: blue; }
    @media (max-width: 600px) {
        & h2 { color: green; }
    }
    @keyframes slide {
        from { transform: translateX(0); }
        to { transform: translateX(100px); }
    }
    @supports (display: grid) {
        & .grid { display: grid; }
    }
    `;

  const sp2 = new StyleProcessor();
  const hash = sp2.getHash(complexCss, 'TestComponent');
  sp2.extractRules(complexCss, hash);

  const generatedCss = sp2.scopedStyles;

  // Verify top-level base rule scoping
  assert.ok(generatedCss.includes(`.${hash} { color: red; }`), 'Should scope top-level base properties');
  // Verify nested rule scoping
  assert.ok(generatedCss.includes(`.${hash} h1 { color: blue; }`), 'Should scope nested selectors');
  // Verify media query is compiled at top level and contains nested scoped rule
  assert.ok(generatedCss.includes(`@media (max-width: 600px) {`), 'Should retain @media query');
  assert.ok(generatedCss.includes(`.${hash} h2 { color: green; }`), 'Should scope nested selectors inside @media');
  // Verify keyframes are unmodified inside
  assert.ok(generatedCss.includes(`@keyframes slide {`), 'Should retain @keyframes');
  assert.ok(generatedCss.includes(`from { transform: translateX(0); }`), 'Should keep from keyframe unchanged');
  assert.ok(generatedCss.includes(`to { transform: translateX(100px); }`), 'Should keep to keyframe unchanged');
  // Verify supports queries
  assert.ok(generatedCss.includes(`@supports (display: grid) {`), 'Should retain @supports query');
  assert.ok(
    generatedCss.includes(`.${hash} .grid { display: grid; }`),
    'Should scope nested selectors inside @supports',
  );

  // Verify comments and braces inside quoted strings
  const commentCurlyCss = `
    /* comment { */
    content: "}";
    & sub {
        /* nested comment } */
        content: '{';
    }
    `;
  const spCurly = new StyleProcessor();
  const hashCurly = spCurly.getHash(commentCurlyCss, 'TestComponent');
  spCurly.extractRules(commentCurlyCss, hashCurly);
  const generatedCurlyCss = spCurly.scopedStyles;

  assert.ok(generatedCurlyCss.includes(`.${hashCurly} { content: "}"; }`), 'Should scope and keep content with brace');
  assert.ok(
    generatedCurlyCss.includes(`.${hashCurly} sub { content: '{'; }`),
    'Should scope nested selectors and keep brace',
  );

  // Verify mergeClassIntoTag edge cases
  const sp3 = new StyleProcessor();
  const tagDataClass = sp3.mergeClassIntoTag('div data-class="foo"', 'my-hash');
  assert.strictEqual(tagDataClass, 'div data-class="foo" class="my-hash"', 'Should not merge into data-class');

  const tagCustomClass = sp3.mergeClassIntoTag('div custom-class="foo"', 'my-hash');
  assert.strictEqual(tagCustomClass, 'div custom-class="foo" class="my-hash"', 'Should not merge into custom-class');

  const tagClassDouble = sp3.mergeClassIntoTag('div class="foo"', 'my-hash');
  assert.strictEqual(
    tagClassDouble,
    'div class="my-hash foo"',
    'Should merge into existing class attribute (double quotes)',
  );

  const tagClassSingle = sp3.mergeClassIntoTag("div class='foo'", 'my-hash');
  assert.strictEqual(
    tagClassSingle,
    "div class='my-hash foo'",
    'Should merge into existing class attribute (single quotes)',
  );

  // Verify specificity / rule ordering preservation
  const orderedCss = `
    color: red;
    &:hover { color: blue; }
    color: green;
    `;
  const spOrdered = new StyleProcessor();
  const hashOrdered = spOrdered.getHash(orderedCss, 'TestComponent');
  spOrdered.extractRules(orderedCss, hashOrdered);
  const generatedOrderedCss = spOrdered.scopedStyles;

  // Check exact order by comparing expected output format
  const expectedOrderedOutput = `.${hashOrdered} { color: red; }\n.${hashOrdered}:hover { color: blue; }\n.${hashOrdered} { color: green; }\n`;
  assert.strictEqual(
    generatedOrderedCss,
    expectedOrderedOutput,
    'Should preserve exact ordering of base rules and nested rules',
  );

  console.log('  ✅ StyleProcessor tests passed!');
} catch (error) {
  console.error('❌ StyleProcessor tests failed!');
  console.error(error);
  process.exit(1);
}
