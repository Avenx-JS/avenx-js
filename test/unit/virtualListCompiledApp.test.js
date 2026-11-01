import assert from 'assert';
import '../helpers/register-happy-dom.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { VirtualList } from '../../lib/core/runtime/VirtualList.js';

// Setup Mock ResizeObserver if not natively present in happy-dom environment
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observedTargets = new Set();
      MockResizeObserver.instances.push(this);
    }
    observe(target) {
      this.observedTargets.add(target);
    }
    unobserve(target) {
      this.observedTargets.delete(target);
    }
    disconnect() {
      this.observedTargets.clear();
      this.isDisconnected = true;
    }
    trigger(entry) {
      this.callback(Array.isArray(entry) ? entry : [entry]);
    }
  };
  global.ResizeObserver.instances = [];
}

async function runTests() {
  try {
    console.log('🧪 Testing VirtualList in a compiled app (#1583)...');

    const parser = new ComponentParser(new StyleProcessor());

    // 1. Test compilation of :prop syntax on <VirtualList>
    console.log('  1. Testing :prop="expr" compiles to data-props-name="expr"...');
    const inputTemplate = `
      <div style="height: 300px;">
        <VirtualList :item-height="40" :items="rows">
          <template data-ax-as="row">
            <div style="box-sizing: border-box; height: 40px;">#{{ index }} {{ row.label }}</div>
          </template>
        </VirtualList>
      </div>
    `;

    const compiledTemplate = parser.processComponentTags(inputTemplate);

    // Verify :items does NOT become data-props-:items="'rows'"
    assert.ok(
      !compiledTemplate.includes('data-props-:items'),
      'Must not emit data-props-:items'
    );
    assert.ok(
      compiledTemplate.includes('data-props-items="rows"'),
      'Must emit data-props-items="rows"'
    );
    assert.ok(
      compiledTemplate.includes('data-props-item-height="40"'),
      'Must emit data-props-item-height="40"'
    );

    // 2. Test style on <VirtualList>
    console.log('  2. Testing host style and attributes handling...');
    // Default VirtualList gets style="height: 100%;"
    assert.ok(
      compiledTemplate.includes('style="height: 100%;"'),
      'VirtualList wrapper must default to style="height: 100%;"'
    );

    // Explicit style on VirtualList survives and is NOT converted to data-props-style
    const styledTemplate = parser.processComponentTags(
      '<VirtualList :item-height="40" :items="rows" style="height: 450px;" class="custom-list" id="my-list"></VirtualList>'
    );
    assert.ok(
      !styledTemplate.includes('data-props-style'),
      'Explicit style must not become data-props-style'
    );
    assert.ok(
      styledTemplate.includes('style="height: 450px;"'),
      'Explicit style must be set on the wrapper div'
    );
    assert.ok(
      styledTemplate.includes('class="custom-list"'),
      'class attribute must be set on the wrapper div'
    );
    assert.ok(
      styledTemplate.includes('id="my-list"'),
      'id attribute must be set on the wrapper div'
    );

    // 3. Test row template escaping in <template data-ax-as="...">
    console.log('  3. Testing row template escaping to prevent host page AVX_R33 evaluation...');
    assert.ok(
      compiledTemplate.includes('{% row.label %}'),
      'Row template {{ row.label }} must be escaped to {% row.label %}'
    );
    assert.ok(
      compiledTemplate.includes('{% index %}'),
      'Row template {{ index }} must be escaped to {% index %}'
    );
    assert.ok(
      !compiledTemplate.includes('{{ row.label }}'),
      'Compiled template must not leave {{ row.label }} unescaped'
    );

    // 4. Test mounting compiled template in an AvenxPage with 5000 rows
    console.log('  4. Testing full page mount with 5000 rows...');
    const rows = [];
    for (let i = 0; i < 5000; i++) {
      rows.push({ label: 'item-' + i });
    }

    class CompiledPage extends AvenxPage {
      constructor() {
        super(
          { rows },
          {},
          {},
          compiledTemplate,
          {},
          new Map([['VirtualList', VirtualList]])
        );
      }
    }

    const testRoot = document.createElement('div');
    document.body.appendChild(testRoot);

    const page = new CompiledPage();
    // This must mount WITHOUT throwing AVX_R33 ("Cannot read property 'label' of undefined")
    page.mount(testRoot);
    page.update();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const virtualListEl = testRoot.querySelector('[data-avenx-comp="VirtualList"]');
    assert.ok(virtualListEl, 'VirtualList element should be mounted in DOM.');

    const virtualListInstance = virtualListEl.__avenx_comp_instance;
    assert.ok(virtualListInstance, 'VirtualList instance should be attached.');

    // Verify props were received correctly
    assert.strictEqual(
      virtualListInstance.props.items.length,
      5000,
      'VirtualList should receive items prop with 5000 items.'
    );
    assert.strictEqual(
      virtualListInstance.props['item-height'],
      40,
      'VirtualList should receive item-height prop.'
    );

    // 5. Test windowing: DOM count must be small (not all 5000 rows)
    const spacer = virtualListInstance.$refs.spacer;
    const initialChildrenCount = spacer.childNodes.length;
    console.log(`     Rendered visible rows count: ${initialChildrenCount} (total: 5000)`);

    assert.ok(
      initialChildrenCount > 0 && initialChildrenCount < 50,
      `Should render small windowed count (got ${initialChildrenCount}), not all 5000 items.`
    );

    // Verify first row content is rendered correctly with row.label
    assert.strictEqual(
      spacer.childNodes[0].textContent.trim(),
      '#0 item-0',
      'First visible row should render evaluated #0 item-0'
    );

    // 6. Test scrolling updates the window
    console.log('  5. Testing scrolling and node recycling...');
    const viewport = virtualListInstance.$refs.viewport;
    // Scroll past 50 items (50 * 40 = 2000px)
    viewport.scrollTop = 2000;
    virtualListInstance.onScroll();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const scrolledChildrenCount = spacer.childNodes.length;
    assert.ok(
      scrolledChildrenCount < 50,
      'Scrolled DOM count must remain windowed under 50 elements.'
    );

    const firstIndex = parseInt(spacer.childNodes[0].getAttribute('data-index'), 10);
    console.log(`     First visible element index after scroll: ${firstIndex}`);
    assert.ok(
      firstIndex >= 40 && firstIndex <= 55,
      `First visible index should be near scroll target (got ${firstIndex}).`
    );
    assert.strictEqual(
      spacer.childNodes[0].textContent.trim(),
      `#${firstIndex} item-${firstIndex}`,
      `First visible element text should match item-${firstIndex}`
    );

    // Teardown
    page.unmount();
    document.body.removeChild(testRoot);

    console.log('  ✅ VirtualList in compiled app unit tests passed successfully!');
  } catch (error) {
    console.error('❌ VirtualList in compiled app unit tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runTests();
