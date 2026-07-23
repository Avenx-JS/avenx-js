import assert from 'assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { DomPatcher } from '../../lib/core/renderer/domPatch.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

/**
 *
 */
function testCompilerOptimization() {
  console.log('🧪 Testing compiler static subtree detection...');

  const sp = new StyleProcessor();
  const cp = new ComponentParser(sp);

  // 1. Fully static template
  const staticTemplate = `
    <div>
        <header>
            <h1>Static Title</h1>
            <p>Welcome to our app</p>
        </header>
    </div>
  `;
  const opt1 = cp.optimizeStaticSubtrees(staticTemplate);
  // Root div should be marked static (highest possible subtree)
  assert.ok(opt1.includes('div data-ax-static="true"'), 'Root div should be static');
  // Nested h1, p should not be marked since parent header/div is already marked
  assert.ok(!opt1.includes('h1 data-ax-static'), 'Nested h1 should not have data-ax-static');
  assert.ok(!opt1.includes('p data-ax-static'), 'Nested p should not have data-ax-static');

  // 2. Semi-static template with dynamic content
  const dynamicTemplate = `
    <div class="container">
        <nav class="static-nav">
            <a href="/home">Home</a>
            <a href="/about">About</a>
        </nav>
        <main>
            <h1>{{ pageTitle }}</h1>
            <p @click="handleClick">Click me</p>
            <div data-ax-bind="name"></div>
        </main>
        <footer class="static-footer">
            <p>© 2026 Avenx-JS</p>
        </footer>
    </div>
  `;
  const opt2 = cp.optimizeStaticSubtrees(dynamicTemplate);
  // Root div should NOT be static because it contains dynamic main
  assert.ok(!opt2.includes('<div class="container" data-ax-static'), 'Root div should not be static');
  // nav should be static
  assert.ok(opt2.includes('nav class="static-nav" data-ax-static="true"'), 'nav should be static');
  // footer should be static
  assert.ok(opt2.includes('footer class="static-footer" data-ax-static="true"'), 'footer should be static');
  // main should NOT be static
  assert.ok(!opt2.includes('main data-ax-static'), 'main should not be static');
  // elements inside main should NOT be static if they are dynamic
  assert.ok(!opt2.includes('h1 data-ax-static'), 'dynamic h1 should not be static');
  assert.ok(!opt2.includes('p data-ax-static'), 'dynamic p should not be static');

  // 3. Components should not be marked static
  const compTemplate = `
    <div>
        <div data-avenx-comp="MyComponent"></div>
    </div>
  `;
  const opt3 = cp.optimizeStaticSubtrees(compTemplate);
  assert.ok(!opt3.includes('data-ax-static'), 'Custom component or its parent should not be static');

  // 5. Slots, slot parent chains, and slot contents should not be marked static
  const slotTemplate = `
    <div class="card">
        <header class="static-header">
            <h1>Card Title</h1>
        </header>
        <div class="card-body">
            <slot>
                <div class="default-slot-wrapper">
                    <span>Default Content</span>
                </div>
            </slot>
        </div>
    </div>
  `;
  const opt5 = cp.optimizeStaticSubtrees(slotTemplate);
  assert.ok(opt5.includes('header class="static-header" data-ax-static="true"'), 'Static header outside slot should be static');
  assert.ok(!opt5.includes('div class="card" data-ax-static'), 'Card wrapper containing slot should not be static');
  assert.ok(!opt5.includes('div class="card-body" data-ax-static'), 'Card body parent chain of slot should not be static');
  assert.ok(!opt5.includes('slot data-ax-static'), 'Slot element itself should not be static');
  assert.ok(!opt5.includes('default-slot-wrapper" data-ax-static'), 'Wrapper inside slot should not be static');

  console.log('  ✅ Compiler static subtree tests passed!');
}

/**
 *
 */
function testDomPatcherSkip() {
  console.log('🧪 Testing DomPatcher static subtree skipping...');
  setupDOMMock();

  try {
    const patcher = new DomPatcher();

    // Create target element representing old DOM
    const target = new MockDOMElement('div');
    const header = new MockDOMElement('header');
    header.setAttribute('data-ax-static', 'true');
    const h1 = new MockDOMElement('h1');
    const text = { nodeType: 3, nodeName: '#text', textContent: 'Old Title', parentNode: h1 };
    h1.appendChild(text);
    header.appendChild(h1);
    target.appendChild(header);

    // Patch with new HTML where static section content is theoretically changed
    // In practice, since it's static, the compiler generated template has the same content,
    // but we simulate a change to test that it is skipped.
    const newHtml = `
      <header data-ax-static="true">
        <h1>New Title (Should be skipped)</h1>
      </header>
    `;

    patcher.patch(target, newHtml);

    // Verify h1 text content did NOT change because the patcher returned early
    assert.strictEqual(h1.childNodes[0].textContent, 'Old Title', 'Header children patching should be skipped');
    console.log('  ✅ DomPatcher static subtree skipping tests passed!');
  } finally {
    teardownDOMMock();
  }
}

try {
  testCompilerOptimization();
  testDomPatcherSkip();
  console.log('✅ All Static Subtrees tests successfully completed!');
  process.exit(0);
} catch (e) {
  console.error('❌ Static Subtrees tests failed!');
  console.error(e);
  process.exit(1);
}
