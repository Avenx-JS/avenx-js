import assert from 'assert';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

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
  // Verify keyframes scoping and unmodified frame body inside
  const hashId = hash.replace(/^avenx-/, '');
  assert.ok(generatedCss.includes(`@keyframes slide-${hashId} {`), 'Should retain scoped @keyframes');
  assert.ok(generatedCss.includes(`from { transform: translateX(0); }`), 'Should keep from keyframe unchanged');
  assert.ok(generatedCss.includes(`to { transform: translateX(100px); }`), 'Should keep to keyframe unchanged');
  // Verify supports queries
  assert.ok(generatedCss.includes(`@supports (display: grid) {`), 'Should retain @supports query');
  assert.ok(
    generatedCss.includes(`.${hash} .grid { display: grid; }`),
    'Should scope nested selectors inside @supports',
  );

  // Verify selector lists inside comma-separated media queries
  const mediaListCss = `
    @media screen and (min-width: 40rem), print {
        h1, h2 { color: navy; }
        &:is(.compact, .dense), [data-state="open,ready"] { display: block; }
    }
    `;
  const spMediaList = new StyleProcessor();
  const hashMediaList = spMediaList.getHash(mediaListCss, 'MediaListComponent');
  spMediaList.extractRules(mediaListCss, hashMediaList);
  const generatedMediaListCss = spMediaList.scopedStyles;

  assert.ok(
    generatedMediaListCss.includes('@media screen and (min-width: 40rem), print {'),
    'Should retain comma-separated media queries',
  );
  assert.ok(
    generatedMediaListCss.includes(`.${hashMediaList}h1, .${hashMediaList}h2 { color: navy; }`),
    'Should scope every selector inside media queries',
  );
  assert.ok(
    generatedMediaListCss.includes(
      `.${hashMediaList}:is(.compact, .dense), .${hashMediaList}[data-state="open,ready"] { display: block; }`,
    ),
    'Should preserve nested commas while scoping selector lists',
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

  // Verify CSS Custom Property (variables) encapsulation
  const varCssCompA = `
    --primary-color: #ff0000;
    --primary-color-hover: #cc0000;
    & button {
        color: var(--primary-color);
        background: var(--primary-color-hover);
        border: 1px solid var(--global-border, var(--primary-color));
        content: "--primary-color: inside string";
    }
  `;
  const spVarA = new StyleProcessor();
  const hashVarA = spVarA.getHash(varCssCompA, 'CompA');
  const hashIdA = hashVarA.replace(/^avenx-/, '');
  spVarA.extractRules(varCssCompA, hashVarA);
  const genVarCssA = spVarA.scopedStyles;

  assert.ok(
    genVarCssA.includes(`--ax-${hashIdA}-primary-color: #ff0000;`),
    'Should scope --primary-color declaration',
  );
  assert.ok(
    genVarCssA.includes(`--ax-${hashIdA}-primary-color-hover: #cc0000;`),
    'Should scope --primary-color-hover declaration without substring collision',
  );
  assert.ok(
    genVarCssA.includes(`color: var(--ax-${hashIdA}-primary-color);`),
    'Should scope var(--primary-color) usage',
  );
  assert.ok(
    genVarCssA.includes(`background: var(--ax-${hashIdA}-primary-color-hover);`),
    'Should scope var(--primary-color-hover) usage',
  );
  assert.ok(
    genVarCssA.includes(`var(--global-border, var(--ax-${hashIdA}-primary-color))`),
    'Should scope local var fallback while preserving global var',
  );
  assert.ok(
    genVarCssA.includes('content: "--primary-color: inside string";'),
    'Should not modify custom properties inside string literals',
  );

  // Test isolation between CompA and CompB with identical variable names
  const varCssCompB = `
    --primary-color: #0000ff;
    & button { color: var(--primary-color); }
  `;
  const spVarB = new StyleProcessor();
  const hashVarB = spVarB.getHash(varCssCompB, 'CompB');
  const hashIdB = hashVarB.replace(/^avenx-/, '');
  spVarB.extractRules(varCssCompB, hashVarB);
  const genVarCssB = spVarB.scopedStyles;

  assert.ok(
    genVarCssB.includes(`--ax-${hashIdB}-primary-color: #0000ff;`),
    'CompB should scope its own --primary-color',
  );
  assert.ok(
    !genVarCssB.includes(`--ax-${hashIdA}-primary-color`),
    'CompB should not contain CompA scoped variable hash',
  );

  // Test Deep Scoped CSS Selectors (:deep() / ::v-deep)
  const deepCss = `
    .parent-container :deep(.child-button) { background-color: red; }
    :deep(.standalone-child) { color: blue; }
    & :deep(.nested-child) { color: green; }
    .card ::v-deep .legacy-child { display: flex; }
    .card ::v-deep(.legacy-paren-child) { margin: 10px; }
    .list :deep(.item:nth-child(2)) { font-weight: bold; }
    .nav :deep(> .link + .active) { opacity: 1; }
    .foo :deep(.bar), .other ::v-deep .baz { border: 1px solid black; }
  `;
  const spDeep = new StyleProcessor();
  const hashDeep = spDeep.getHash(deepCss, 'DeepComp');
  spDeep.extractRules(deepCss, hashDeep);
  const genDeepCss = spDeep.scopedStyles;

  assert.ok(
    genDeepCss.includes(`.${hashDeep}.parent-container .child-button { background-color: red; }`),
    'Should support :deep(.child-button) selector',
  );
  assert.ok(
    genDeepCss.includes(`.${hashDeep} .standalone-child { color: blue; }`),
    'Should support top-level :deep() selector',
  );
  assert.ok(
    genDeepCss.includes(`.${hashDeep} .nested-child { color: green; }`),
    'Should support & :deep() selector',
  );
  assert.ok(
    genDeepCss.includes(`.${hashDeep}.card .legacy-child { display: flex; }`),
    'Should support legacy ::v-deep space selector syntax',
  );
  assert.ok(
    genDeepCss.includes(`.${hashDeep}.card .legacy-paren-child { margin: 10px; }`),
    'Should support legacy ::v-deep() parenthesis selector syntax',
  );
  assert.ok(
    genDeepCss.includes(`.${hashDeep}.list .item:nth-child(2) { font-weight: bold; }`),
    'Should support nested parens inside :deep()',
  );
  assert.ok(
    genDeepCss.includes(`.${hashDeep}.nav > .link + .active { opacity: 1; }`),
    'Should support combinators inside :deep()',
  );
  assert.ok(
    genDeepCss.includes(`.${hashDeep}.foo .bar, .${hashDeep}.other .baz { border: 1px solid black; }`),
    'Should support deep selectors in comma-separated selector lists',
  );

  // Test clean @media query scoping and duplicate class prevention
  const mediaCleanCss = `
    @media (min-width: 768px) {
        font-size: 16px;
        .container .card {
            padding: 20px;
        }
        &.active .header {
            color: purple;
        }
    }
  `;
  const spMediaClean = new StyleProcessor();
  const hashMediaClean = spMediaClean.getHash(mediaCleanCss, 'MediaCleanComp');
  spMediaClean.extractRules(mediaCleanCss, hashMediaClean);
  const genMediaCleanCss = spMediaClean.scopedStyles;

  assert.ok(
    genMediaCleanCss.includes(`@media (min-width: 768px) {`),
    'Should retain @media query header',
  );
  assert.ok(
    genMediaCleanCss.includes(`.${hashMediaClean} { font-size: 16px; }`),
    'Should scope base properties inside @media block',
  );
  assert.ok(
    genMediaCleanCss.includes(`.${hashMediaClean}.container .card { padding: 20px; }`),
    'Should inject scope class on root element selector inside @media without duplicating on sub-selectors',
  );
  assert.ok(
    genMediaCleanCss.includes(`.${hashMediaClean}.active .header { color: purple; }`),
    'Should replace & with scope hash class inside @media',
  );
  assert.ok(
    !genMediaCleanCss.includes(`.${hashMediaClean}.${hashMediaClean}`),
    'Should not create duplicate scope class hashes',
  );

  // Test @keyframes collision isolation between two separate components
  const spCollision = new StyleProcessor();
  const compACss = `
    animation: spin 1s infinite;
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  const compBCss = `
    animation: spin 2s ease-in-out;
    @keyframes spin {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  const hashCompA = spCollision.getHash(compACss, 'ComponentA');
  const hashCompB = spCollision.getHash(compBCss, 'ComponentB');
  const hashIdCompA = hashCompA.replace(/^avenx-/, '');
  const hashIdCompB = hashCompB.replace(/^avenx-/, '');

  spCollision.process('<div @css boxA></div>', { boxA: compACss }, 'ComponentA');
  spCollision.process('<div @css boxB></div>', { boxB: compBCss }, 'ComponentB');

  const collisionOutputCss = spCollision.getGlobalStyles();
  assert.notStrictEqual(hashIdCompA, hashIdCompB, 'Component hashes should be distinct');
  assert.ok(
    collisionOutputCss.includes(`@keyframes spin-${hashIdCompA} {`),
    'ComponentA should declare scoped keyframe spin-<hashA>',
  );
  assert.ok(
    collisionOutputCss.includes(`@keyframes spin-${hashIdCompB} {`),
    'ComponentB should declare scoped keyframe spin-<hashB>',
  );
  assert.ok(
    collisionOutputCss.includes(`animation: spin-${hashIdCompA} 1s infinite;`),
    'ComponentA animation should reference spin-<hashA>',
  );
  assert.ok(
    collisionOutputCss.includes(`animation: spin-${hashIdCompB} 2s ease-in-out;`),
    'ComponentB animation should reference spin-<hashB>',
  );

  // Test multiple blocks in the same component sharing the same scoped keyframe
  const spMultiBlock = new StyleProcessor();
  const multiBlocks = {
    header: 'animation: spin 1s infinite;',
    spinner: '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
  };
  spMultiBlock.process('<div @css header></div><div @css spinner></div>', multiBlocks, 'MultiBlockComp');
  const multiBlockCss = spMultiBlock.getGlobalStyles();
  const multiBlockMatch = multiBlockCss.match(/@keyframes (spin-[0-9a-f]+) {/);
  assert.ok(multiBlockMatch, 'Keyframe spin should be declared with hash in multi-block component');
  const scopedMultiSpin = multiBlockMatch[1];
  assert.ok(
    multiBlockCss.includes(`animation: ${scopedMultiSpin} 1s infinite;`),
    'Separate block in same component should resolve animation to the same scoped keyframe name',
  );

  // Test forward reference & nested @keyframes inside a block (Issue #1644)
  const spForward = new StyleProcessor();
  const forwardCss = `
    animation: spin 2s linear infinite;
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  const hashForward = spForward.getHash(forwardCss, 'ForwardComp');
  const hashIdForward = hashForward.replace(/^avenx-/, '');
  spForward.extractRules(forwardCss, hashForward);
  const genForwardCss = spForward.scopedStyles;

  assert.ok(
    genForwardCss.includes(`animation: spin-${hashIdForward} 2s linear infinite;`),
    'Forward referenced animation declaration should be rewritten with scoped name',
  );
  assert.ok(genForwardCss.includes(`@keyframes spin-${hashIdForward} {`), 'Nested @keyframes header should be scoped');
  assert.ok(
    genForwardCss.includes('from { transform: rotate(0deg); }'),
    'Nested @keyframes from frame should be preserved',
  );
  assert.ok(
    genForwardCss.includes('to { transform: rotate(360deg); }'),
    'Nested @keyframes to frame should be preserved',
  );

  // Test animation-name property (single, comma-separated, quoted, and undeclared passthrough)
  const spAnimName = new StyleProcessor();
  const animNameCss = `
    .single {
      animation-name: pulse;
    }
    .multi {
      animation-name: pulse, bounce, globalFade;
    }
    .quoted {
      animation-name: "pulse", 'bounce', globalFade !important;
    }
    @keyframes pulse {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes bounce {
      from { transform: translateY(0); }
      to { transform: translateY(-10px); }
    }
  `;
  const hashAnimName = spAnimName.getHash(animNameCss, 'AnimNameComp');
  const hashIdAnimName = hashAnimName.replace(/^avenx-/, '');
  spAnimName.extractRules(animNameCss, hashAnimName);
  const genAnimNameCss = spAnimName.scopedStyles;

  assert.ok(genAnimNameCss.includes(`animation-name: pulse-${hashIdAnimName};`), 'Should scope single animation-name');
  assert.ok(
    genAnimNameCss.includes(`animation-name: pulse-${hashIdAnimName}, bounce-${hashIdAnimName}, globalFade;`),
    'Should scope matching animation names in comma-separated list while preserving undeclared globalFade',
  );
  assert.ok(
    genAnimNameCss.includes(
      `animation-name: "pulse-${hashIdAnimName}", 'bounce-${hashIdAnimName}', globalFade !important;`,
    ),
    'Should preserve quotes and !important in animation-name declarations',
  );
  assert.ok(genAnimNameCss.includes(`@keyframes pulse-${hashIdAnimName} {`), 'Should scope pulse keyframe header');
  assert.ok(genAnimNameCss.includes(`@keyframes bounce-${hashIdAnimName} {`), 'Should scope bounce keyframe header');

  // Test animation shorthand edge cases: positions, keywords, parenthesized functions, and !important
  const spShorthand = new StyleProcessor();
  const shorthandCss = `
    .start-name {
      animation: zoom 1.5s ease-in-out infinite alternate both;
    }
    .middle-name {
      animation: 2s linear zoom forwards running;
    }
    .end-name {
      animation: 300ms cubic-bezier(0.4, 0, 0.2, 1) 100ms 2 reverse zoom !important;
    }
    .multi-layer {
      animation: zoom 1s steps(4, end), globalGlide 2.5s cubic-bezier(0.25, 0.1, 0.25, 1) infinite;
    }
    .keywords-only {
      animation: none;
    }
    @keyframes zoom {
      from { transform: scale(0.5); }
      to { transform: scale(1.5); }
    }
  `;
  const hashShorthand = spShorthand.getHash(shorthandCss, 'ShorthandComp');
  const hashIdShorthand = hashShorthand.replace(/^avenx-/, '');
  spShorthand.extractRules(shorthandCss, hashShorthand);
  const genShorthandCss = spShorthand.scopedStyles;

  assert.ok(
    genShorthandCss.includes(`animation: zoom-${hashIdShorthand} 1.5s ease-in-out infinite alternate both;`),
    'Should rewrite keyframe at beginning and preserve keywords (infinite, alternate, both, ease-in-out)',
  );
  assert.ok(
    genShorthandCss.includes(`animation: 2s linear zoom-${hashIdShorthand} forwards running;`),
    'Should rewrite keyframe in middle and preserve keywords (linear, forwards, running)',
  );
  assert.ok(
    genShorthandCss.includes(
      `animation: 300ms cubic-bezier(0.4, 0, 0.2, 1) 100ms 2 reverse zoom-${hashIdShorthand} !important;`,
    ),
    'Should rewrite keyframe at end, preserve cubic-bezier with commas, and preserve !important',
  );
  assert.ok(
    genShorthandCss.includes(
      `animation: zoom-${hashIdShorthand} 1s steps(4, end), globalGlide 2.5s cubic-bezier(0.25, 0.1, 0.25, 1) infinite;`,
    ),
    'Should rewrite local keyframe in multi-layer animation, preserve steps(4, end), and preserve globalGlide',
  );
  assert.ok(genShorthandCss.includes('animation: none;'), 'Should not rewrite keyword "none"');
  assert.ok(genShorthandCss.includes(`@keyframes zoom-${hashIdShorthand} {`), 'Should scope @keyframes zoom header');

  // Test vendor prefixes: @-webkit-keyframes and -webkit-animation / -webkit-animation-name
  const spPrefix = new StyleProcessor();
  const prefixCss = `
    .prefixed-shorthand {
      -webkit-animation: shimmer 1s ease-in infinite;
    }
    .prefixed-name {
      -webkit-animation-name: "shimmer";
    }
    @-webkit-keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @-webkit-keyframes "shimmer" {
      from { opacity: 0.5; }
      to { opacity: 1; }
    }
  `;
  const hashPrefix = spPrefix.getHash(prefixCss, 'PrefixComp');
  const hashIdPrefix = hashPrefix.replace(/^avenx-/, '');
  spPrefix.extractRules(prefixCss, hashPrefix);
  const genPrefixCss = spPrefix.scopedStyles;

  assert.ok(
    genPrefixCss.includes(`-webkit-animation: shimmer-${hashIdPrefix} 1s ease-in infinite;`),
    'Should rewrite -webkit-animation shorthand with scoped keyframe name',
  );
  assert.ok(
    genPrefixCss.includes(`-webkit-animation-name: "shimmer-${hashIdPrefix}";`),
    'Should rewrite -webkit-animation-name with quoted scoped keyframe name',
  );
  assert.ok(
    genPrefixCss.includes(`@-webkit-keyframes shimmer-${hashIdPrefix} {`),
    'Should scope unquoted @-webkit-keyframes header',
  );
  assert.ok(
    genPrefixCss.includes(`@-webkit-keyframes "shimmer-${hashIdPrefix}" {`),
    'Should scope quoted @-webkit-keyframes header preserving quotes',
  );

  // Test <@global> passthrough: @keyframes in <@global> kept exact and shareable from <@css>
  const spGlobal = new StyleProcessor();
  const globalCss = `
    @keyframes globalSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  spGlobal.addGlobalCSS(globalCss);

  const localCss = `
    animation: globalSpin 1s linear infinite, localPop 0.3s ease;
    @keyframes localPop {
      0% { transform: scale(0.8); }
      100% { transform: scale(1); }
    }
  `;
  const hashLocal = spGlobal.getHash(localCss, 'LocalComp');
  const hashIdLocal = hashLocal.replace(/^avenx-/, '');
  spGlobal.extractRules(localCss, hashLocal);

  const bundleCss = spGlobal.getGlobalStyles();
  assert.ok(bundleCss.includes('@keyframes globalSpin {'), '<@global> keyframes should retain exact unscoped header');
  assert.ok(bundleCss.includes(`@keyframes localPop-${hashIdLocal} {`), '<@css> local keyframes should be scoped');
  assert.ok(
    bundleCss.includes(`animation: globalSpin 1s linear infinite, localPop-${hashIdLocal} 0.3s ease;`),
    'Local block animation referencing global keyframe should keep globalSpin and scope localPop',
  );

  // Test undeclared keyframe passthrough (e.g. from dynamic data-ax-style)
  const spDynamic = new StyleProcessor();
  const dynamicCss = `
    animation-name: dynamicRuntimeKeyframe;
  `;
  const hashDynamic = spDynamic.getHash(dynamicCss, 'DynamicComp');
  spDynamic.extractRules(dynamicCss, hashDynamic);
  const genDynamicCss = spDynamic.scopedStyles;

  assert.ok(
    genDynamicCss.includes('animation-name: dynamicRuntimeKeyframe;'),
    'Undeclared/dynamic keyframe name should pass through unchanged without false-positive scoping',
  );

  console.log('  ✅ StyleProcessor tests passed!');
} catch (error) {
  console.error('❌ StyleProcessor tests failed!');
  console.error(error);
  process.exit(1);
}
