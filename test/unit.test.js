const assert = require('assert');
const path = require('path');
const StyleProcessor = require('../lib/compiler/StyleProcessor');
const ComponentParser = require('../lib/compiler/ComponentParser');

function testStyleProcessor() {
    console.log('🧪 Testing StyleProcessor...');
    const sp = new StyleProcessor();
    
    sp.addVariable('primary-color', '#ff0000');
    assert.strictEqual(sp.cssVariables['primary-color'], '#ff0000');
    
    sp.addGlobalCSS('body { background: white; }');
    assert.ok(sp.rawGlobalCSS.has('body { background: white; }'));
    
    const processed = sp.process('<div @css my-class></div>', { 'my-class': 'color: red;' }, 'MyComp');
    assert.ok(processed.includes('class="avenx-'));
    
    console.log('  ✅ StyleProcessor tests passed!');
}

function testComponentParser() {
    console.log('🧪 Testing ComponentParser...');
    const sp = new StyleProcessor();
    const cp = new ComponentParser(sp);
    
    // We would need actual files to test cp.parse properly, 
    // or mock fs. But let's at least test the extraction methods.
    
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
}

function testListRenderingCompiler() {
    console.log('🧪 Testing List Rendering Compiler...');
    const sp = new StyleProcessor();
    const cp = new ComponentParser(sp);
    
    const content = `
    <ul>
        <@for item in list key="item.id">
            <li>{{ item.name }}</li>
        </@for>
    </ul>
    `;
    
    const template = cp.extractTemplate(content, {}, 'TestComp');
    assert.ok(template.includes('template data-ax-for="list"'));
    assert.ok(template.includes('data-ax-as="item"'));
    assert.ok(template.includes('data-ax-key="item.id"'));
    assert.ok(template.includes('<li>{% item.name %}</li>'));
    
    console.log('  ✅ List Rendering Compiler tests passed!');
}

try {
    testStyleProcessor();
    testComponentParser();
    testListRenderingCompiler();
    console.log('✅ All unit tests passed!');
} catch (error) {
    console.error('❌ Unit tests failed!');
    console.error(error);
    process.exit(1);
}
