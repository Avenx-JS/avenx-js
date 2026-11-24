import assert from 'assert';
import '../helpers/register-happy-dom.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

/**
 * Tests the compiler transformations of `<Component :is="...">` tags.
 */
function testCompilerDynamicComponent() {
  console.log('🧪 Testing Compiler support for Dynamic Components...');
  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  // 1. Double curly brace syntax
  const template1 = cp.processComponentTags('<Component :is="{{ state.currentView }}" />');
  assert.strictEqual(template1, '<div data-avenx-comp-dynamic="state.currentView"></div>');

  // 2. Bare syntax
  const template2 = cp.processComponentTags('<Component :is="state.currentView" />');
  assert.strictEqual(template2, '<div data-avenx-comp-dynamic="state.currentView"></div>');

  // 3. With props and events
  const template3 = cp.processComponentTags(
    '<Component :is="{{ state.currentView }}" title="Hello" @click="handleClick" />',
  );
  assert.strictEqual(
    template3,
    '<div data-avenx-comp-dynamic="state.currentView" data-props-title="&quot;Hello&quot;" @click="handleClick"></div>',
  );

  // 4. Non-self-closing tag
  const template4 = cp.processComponentTags('<Component :is="state.currentView">Inner Content</Component>');
  assert.strictEqual(template4, '<div data-avenx-comp-dynamic="state.currentView">Inner Content</div>');

  console.log('  ✅ Compiler dynamic component tests passed!');
}

/**
 * Tests mounting, props updating, and dynamic swapping at runtime.
 */
async function testRuntimeDynamicComponent() {
  console.log('🧪 Testing Runtime support for Dynamic Components...');

  const delay = () => new Promise((resolve) => setTimeout(resolve, 10));

  class ComponentA extends AvenxComponent {
    constructor(bridges, props) {
      super({}, {}, bridges, '<div class="comp-a">Component A (message: {{ props.message }})</div>', {}, props);
    }
  }

  class ComponentB extends AvenxComponent {
    constructor(bridges, props) {
      super({}, {}, bridges, '<div class="comp-b">Component B (val: {{ props.val }})</div>', {}, props);
    }
  }

  const componentRegistry = new Map();
  componentRegistry.set('ComponentA', ComponentA);
  componentRegistry.set('ComponentB', ComponentB);

  // Compile the parent template simulating the compiler's output
  const parentTemplate = `
    <div>
      <h1>Parent</h1>
      <div data-avenx-comp-dynamic="state.view" data-props-message="state.msg" data-props-val="state.count"></div>
    </div>
  `;

  class ParentPage extends AvenxPage {
    constructor(bridges, registry) {
      super(
        { view: 'ComponentA', msg: 'Hello from Parent', count: 42 },
        {},
        bridges,
        parentTemplate,
        {},
        registry,
      );
    }
  }

  const parent = new ParentPage({}, componentRegistry);
  const root = document.createElement('div');
  parent.mount(root);
  parent.runUpdate();

  // 1. Verify ComponentA is mounted initially
  const dynamicEl = root.querySelector('[data-avenx-comp-dynamic="state.view"]');
  assert.ok(dynamicEl, 'Placeholder element should exist');
  assert.ok(dynamicEl.querySelector('.comp-a'), 'Component A should be mounted inside placeholder');
  assert.strictEqual(
    dynamicEl.querySelector('.comp-a').textContent.trim(),
    'Component A (message: Hello from Parent)',
    'Props should be passed correctly',
  );

  const instanceA = dynamicEl.__avenx_comp_instance;
  assert.ok(instanceA instanceof ComponentA, 'Instance should be ComponentA');

  // 2. Update props and verify ComponentA updates reactively
  parent.state.msg = 'Updated Message';
  await delay();
  assert.strictEqual(
    dynamicEl.querySelector('.comp-a').textContent.trim(),
    'Component A (message: Updated Message)',
    'Reactive updates should propagate props',
  );

  // 3. Swap component class to ComponentB
  parent.state.view = 'ComponentB';
  await delay();

  assert.ok(!dynamicEl.querySelector('.comp-a'), 'Component A should be unmounted');
  assert.ok(dynamicEl.querySelector('.comp-b'), 'Component B should be mounted');
  assert.strictEqual(
    dynamicEl.querySelector('.comp-b').textContent.trim(),
    'Component B (val: 42)',
    'Dynamic swap should instantiate and pass props correctly',
  );

  const instanceB = dynamicEl.__avenx_comp_instance;
  assert.ok(instanceB instanceof ComponentB, 'Instance should be ComponentB');
  assert.ok(instanceA !== instanceB, 'Instances must be different');

  // 4. Resolve directly to class constructor
  parent.state.view = ComponentA;
  await delay();

  assert.ok(dynamicEl.querySelector('.comp-a'), 'Component A should be mounted back via direct constructor');
  const instanceA2 = dynamicEl.__avenx_comp_instance;
  assert.ok(instanceA2 instanceof ComponentA, 'Direct constructor should resolve correctly');

  // 5. Swap to null/undefined (removes component)
  parent.state.view = null;
  await delay();

  assert.strictEqual(dynamicEl.innerHTML, '', 'Container should be empty after setting view to null');
  assert.strictEqual(dynamicEl.__avenx_comp_instance, undefined, 'Instance reference should be cleared');

  console.log('  ✅ Runtime dynamic component tests passed!');
}

async function runAll() {
  try {
    testCompilerDynamicComponent();
    await testRuntimeDynamicComponent();
    console.log('✅ All dynamic component tests passed successfully!');
  } catch (error) {
    console.error('❌ Dynamic component tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runAll();
