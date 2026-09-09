import assert from 'node:assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

try {
  console.log('🧪 Testing ComponentParser...');
  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  const content = `
    <state count="0" />
    <action name="inc">count++</action>
    <div @css root>Hello</div>
    `;

  const multilineState = `
  <state
    count="0"
    name="'Nikita'"
  />
  <div>Hello</div>
`;

  const parsedState = cp.extractState(multilineState);

  assert.strictEqual(parsedState.count, 0);
  assert.strictEqual(parsedState.name, "Nikita");

  // Existing test continues below
  const state = cp.extractState(content);
  assert.strictEqual(state.count, 0);
  
  const methods = cp.extractMethods(content);
  assert.strictEqual(methods.inc, 'count++');

  console.log('  ✅ ComponentParser tests passed!');

  console.log('🧪 Testing List Rendering Compiler...');
  const contentList = `
    <ul>
        <@for item in list key="item.id">
            <li>{{ item.name }}</li>
        </@for>
    </ul>
    `;

  const template = cp.extractTemplate(contentList, {}, 'TestComp');
  assert.ok(template.includes('template data-ax-for="list"'));
  assert.ok(template.includes('data-ax-as="item"'));
  assert.ok(template.includes('data-ax-key="item.id"'));
  assert.ok(template.includes('<li>{% item.name %}</li>'));

  console.log('  ✅ List Rendering Compiler tests passed!');

  console.log('🧪 Testing Nested List Rendering Compiler...');
  const contentNested = `
    <div>
        <@for category in categories>
            <h2>{{ category.name }}</h2>
            <ul>
                <@for item in category.items key="item.id">
                    <li>{{ item.name }}</li>
                </@for>
            </ul>
        </@for>
    </div>
    `;

  const templateNested = cp.extractTemplate(contentNested, {}, 'TestComp');

  // Outer loop checks
  assert.ok(templateNested.includes('template data-ax-for="categories"'));
  assert.ok(templateNested.includes('data-ax-as="category"'));
  assert.ok(templateNested.includes('<h2>{% category.name %}</h2>'));

  // Inner loop checks
  assert.ok(templateNested.includes('template data-ax-for="category.items"'));
  assert.ok(templateNested.includes('data-ax-as="item"'));
  assert.ok(templateNested.includes('data-ax-key="item.id"'));
  assert.ok(templateNested.includes('<li>{% item.name %}</li>'));

  console.log('  ✅ Nested List Rendering Compiler tests passed!');

  console.log('🧪 Testing Style block matching with/without spaces...');
  const cssNoSpaces = `
    <@global>
        @def primary #ff0000;
    </@global>
    <@css>
        title { color: @primary; }
    </@css>
    `;
  const blocks1 = {};
  cp.extractStylesAndVars(cssNoSpaces, blocks1);
  assert.strictEqual(blocks1['title'], 'color: @primary;');

  const cssWithSpaces = `
    <@global>
        @def secondary #00ff00;
    </ @global>
    <@css>
        container { padding: 10px; }
    </ @css>
    `;
  const blocks2 = {};
  cp.extractStylesAndVars(cssWithSpaces, blocks2);
  assert.strictEqual(blocks2['container'], 'padding: 10px;');

  console.log('  ✅ Style block matching tests passed!');

  console.log('🧪 Testing CSS block depth parsing with comments/string literals containing curly braces...');
  const cssWithCurlyBraces = `
    <@css>
        container {
            /* comment containing { and } braces */
            content: "}";
            color: red;
        }
        nested {
            & sub {
                /* block { */
                content: '{';
            }
        }
    </@css>
    `;
  const blocksCurly = {};
  cp.extractStylesAndVars(cssWithCurlyBraces, blocksCurly);
  assert.strictEqual(blocksCurly['container'], 'content: "}";\n            color: red;');
  assert.strictEqual(blocksCurly['nested'], "& sub {\n                \n                content: '{';\n            }");
  console.log('  ✅ CSS block depth parsing with comments/braces tests passed!');

  console.log('🧪 Testing support for self-closing and non-self-closing component tags...');
  // Test 1: Self-closing tag
  assert.strictEqual(cp.processComponentTags('<MyComponent />'), '<div data-avenx-comp="MyComponent"></div>');
  // Test 2: Non-self-closing empty tag
  assert.strictEqual(
    cp.processComponentTags('<MyComponent></MyComponent>'),
    '<div data-avenx-comp="MyComponent"></div>',
  );
  // Test 3: Non-self-closing tag with text content
  assert.strictEqual(
    cp.processComponentTags('<MyComponent>Hello</MyComponent>'),
    '<div data-avenx-comp="MyComponent">Hello</div>',
  );
  // Test 4: Non-self-closing tag with attributes
  assert.strictEqual(
    cp.processComponentTags('<MyComponent title="Test" active=\'true\'></MyComponent>'),
    '<div data-avenx-comp="MyComponent" data-props-title="\'Test\'" data-props-active="true"></div>',
  );
  // Test 5: Tag with spaces in closing tag
  assert.strictEqual(
    cp.processComponentTags('<MyComponent></ MyComponent >'),
    '<div data-avenx-comp="MyComponent"></div>',
  );
  // Test 6: Nested components
  assert.strictEqual(
    cp.processComponentTags('<MyComponent><ChildComponent /></MyComponent>'),
    '<div data-avenx-comp="MyComponent"><div data-avenx-comp="ChildComponent"></div></div>',
  );
  // Test 7: Multiple components sequentially
  assert.strictEqual(
    cp.processComponentTags('<MyComponent></MyComponent> <AnotherComponent />'),
    '<div data-avenx-comp="MyComponent"></div> <div data-avenx-comp="AnotherComponent"></div>',
  );
  console.log('  ✅ Self-closing and non-self-closing component tags tests passed!');

  // Test 8: Strip standard HTML comments
  console.log('🧪 Testing HTML Comments Stripping...');
  const contentWithComments = `
    <!-- This is a single line comment -->
    <div class="test">
      <!--
        This is a multi-line
        comment
      -->
      <p>Hello <!-- inline comment --> World</p>
    </div>
  `;

  const templateWithComments = cp.extractTemplate(
    contentWithComments,
    {},
    'TestComp',
  );

  assert.ok(!templateWithComments.includes('comment'));
  assert.ok(!templateWithComments.includes('<!--'));
  assert.ok(!templateWithComments.includes('-->'));
  assert.ok(templateWithComments.includes('<div class="test">'));
  assert.ok(templateWithComments.includes('<p>Hello  World</p>'));

  console.log('  ✅ HTML Comments Stripping tests passed!');

  // Test 9: Backticks inside template interpolations
  console.log('🧪 Testing backticks inside template interpolations...');

  const contentWithBackticks = `
    <div class="{{ state.active ? \`active\` : \`\` }}">
      {{ state.active ? \`active\` : \`\` }}
    </div>
  `;

  const templateWithBackticks = cp.extractTemplate(
    contentWithBackticks,
    {},
    'TestComp',
  );

  // Templates are emitted as JSON string literals, so backticks no longer need
  // escaping to survive code generation and must be preserved verbatim.
  assert.ok(
    templateWithBackticks.includes('`active`'),
    'Backticks inside interpolations should be preserved verbatim',
  );

  assert.ok(
    !templateWithBackticks.includes('\\`'),
    'Backticks inside interpolations should not be escaped',
  );

  console.log('  ✅ Backticks inside template interpolations tests passed!');
  console.log('🧪 Testing custom void tags from config...');
  const cpWithVoidTags = new ComponentParser(sp, ['my-video', 'custom-icon']);

  // Test: custom void tag without self-closing slash is treated as void
  const templateCustomVoid = cpWithVoidTags.extractTemplate(
    '<div><my-video src="a.mp4"><p>Trailing text</p></div>',
    {},
    'TestComp',
  );
  assert.ok(templateCustomVoid.includes('<my-video src="a.mp4" />'));
  assert.ok(templateCustomVoid.includes('<p>Trailing text</p>'));

  // Test: explicit self-closing slash still works without any config
  const templateSelfClosing = cp.extractTemplate('<div><my-video src="a.mp4" /></div>', {}, 'TestComp');
  assert.ok(templateSelfClosing.includes('<my-video src="a.mp4" />'));

  // Test: unknown custom tags without the config entry are NOT treated as void
  const templateUnknownTag = cp.extractTemplate('<div><my-video src="a.mp4"><p>Inside</p></my-video></div>', {}, 'TestComp');
  assert.ok(templateUnknownTag.includes('<p>Inside</p>'));
  assert.ok(!templateUnknownTag.includes('<my-video src="a.mp4" />'));

  console.log('  ✅ Custom void tags tests passed!');

  console.log('🧪 Testing text nodes splitting and adjacent static text node merging...');
  const nodes = ComponentParser.parseHTML('<div>Static Part {{ state.value }} Another Static</div>');
  assert.strictEqual(nodes[0].children.length, 3, 'div should have exactly 3 text node children');
  assert.strictEqual(nodes[0].children[0].content, 'Static Part ');
  assert.strictEqual(nodes[0].children[1].content, '{{ state.value }}');
  assert.strictEqual(nodes[0].children[2].content, ' Another Static');

  const nodesAdjacent = ComponentParser.parseHTML('<div>Static1 {{ val }} Static2 Static3</div>');
  assert.strictEqual(nodesAdjacent[0].children.length, 3, 'div should have 3 children after merging adjacent static text segments');
  assert.strictEqual(nodesAdjacent[0].children[2].content, ' Static2 Static3');
  console.log('  ✅ Text node splitting and merging tests passed!');

  console.log('🧪 Testing ComponentParser line and column tracking (#810)...');
  const htmlTracking = `<div>\n  <span>Hello</span>\n</div>`;
  const nodesTracking = ComponentParser.parseHTML(htmlTracking);

  assert.strictEqual(nodesTracking[0].tagName, 'div', 'Root tag should be div');
  assert.strictEqual(nodesTracking[0].line, 1, 'Root <div> should be on line 1');
  assert.strictEqual(nodesTracking[0].column, 1, 'Root <div> should be at column 1');

  const spanNode = nodesTracking[0].children.find((c) => c.tagName === 'span');
  assert.ok(spanNode, 'span child node should exist');
  assert.strictEqual(spanNode.line, 2, 'Nested <span> should be on line 2');
  assert.strictEqual(spanNode.column, 3, 'Nested <span> should be at column 3');

  console.log('  ✅ Line and column tracking unit tests passed!');
} catch (error) {
  console.error('❌ ComponentParser tests failed!');
  console.error(error);
  process.exit(1);
}