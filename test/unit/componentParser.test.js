const assert = require('assert');
const StyleProcessor = require('../../lib/compiler/StyleProcessor');
const ComponentParser = require('../../lib/compiler/ComponentParser');

try {
  console.log('🧪 Testing ComponentParser...');
  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  const content = `
    <state count="0" />
    <action name="inc">count++</action>
    <div @css root>Hello</div>
    `;

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
  const templateWithComments = cp.extractTemplate(contentWithComments, {}, 'TestComp');
  assert.ok(!templateWithComments.includes('comment'));
  assert.ok(!templateWithComments.includes('<!--'));
  assert.ok(!templateWithComments.includes('-->'));
  assert.ok(templateWithComments.includes('<div class="test">'));
  assert.ok(templateWithComments.includes('<p>Hello  World</p>'));
  console.log('  ✅ HTML Comments Stripping tests passed!');
} catch (error) {
  console.error('❌ ComponentParser tests failed!');
  console.error(error);
  process.exit(1);
}
