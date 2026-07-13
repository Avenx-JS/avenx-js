import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { VirtualList } from '../../lib/core/runtime/VirtualList.js';

// Setup Mock ResizeObserver if not natively present in happy-dom environment
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
      MockResizeObserver.instances.push(this);
    }
    observe(target) {
      this.target = target;
    }
    unobserve() {}
    disconnect() {}
    trigger(entry) {
      this.callback([entry]);
    }
  };
  global.ResizeObserver.instances = [];
}

async function runTests() {
  try {
    console.log('🧪 Testing VirtualList built-in component...');

    // 1. Setup host component (AvenxPage) and compile-simulate template
    class TestPage extends AvenxPage {
      constructor() {
        super(
          {
            items: Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `Item ${i}` })),
            height: 30,
          },
          {},
          {},
          `
          <div class="host">
            <div data-avenx-comp="VirtualList" data-props-items="state.items" data-props-item-height="state.height">
              <template data-ax-as="item">
                <div class="row">Item: {% item.name %}</div>
              </template>
            </div>
          </div>
          `,
          {},
          new Map([['VirtualList', VirtualList]])
        );
      }
    }

    const testRoot = document.createElement('div');
    document.body.appendChild(testRoot);

    const page = new TestPage();
    page.mount(testRoot);
    page.update();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify mount successfully
    const virtualListEl = testRoot.querySelector('[data-avenx-comp="VirtualList"]');
    assert.ok(virtualListEl, 'VirtualList component should mount to DOM.');

    const virtualListInstance = virtualListEl.__avenx_comp_instance;
    assert.ok(virtualListInstance, 'VirtualList instance should be attached to element.');

    const spacer = virtualListInstance.$refs.spacer;
    assert.ok(spacer, 'Spacer ref should exist.');



    // 2. Validate initial render with DOM footprint constraints
    const initialChildrenCount = spacer.childNodes.length;
    console.log(`  Initial visible elements count: ${initialChildrenCount}`);
    
    // Default viewportHeight falls back to 400px.
    // 400px client height / 30px height = ~14 visible elements.
    // Plus buffer (5 above + 5 below = 10 buffer).
    // Total should be around 24-25.
    assert.ok(initialChildrenCount > 0, 'Should render some visible elements.');
    assert.ok(initialChildrenCount < 50, 'Should render under 50 elements for DOM footprint constraints.');

    // Verify content of first item
    assert.strictEqual(
      spacer.childNodes[0].textContent.trim(),
      'Item: Item 0',
      'First visible element should render Item 0 content.'
    );

    // 3. Test Scroll and recycled node updates
    console.log('  Simulating scroll to index 100...');
    const viewport = virtualListInstance.$refs.viewport;
    
    // Scroll past 100 items (100 * 30px = 3000px)
    viewport.scrollTop = 3000;
    virtualListInstance.onScroll();

    const scrolledChildrenCount = spacer.childNodes.length;
    console.log(`  Scrolled visible elements count: ${scrolledChildrenCount}`);
    assert.ok(scrolledChildrenCount < 50, 'Scrolled DOM footprint must remain under 50 elements.');

    // Index 100 items scroll, minus 5 items buffer.
    // So the first rendered item should be around index 95.
    const firstChildIndex = parseInt(spacer.childNodes[0].getAttribute('data-index'), 10);
    console.log(`  First visible element index after scroll: ${firstChildIndex}`);
    assert.ok(firstChildIndex > 90 && firstChildIndex < 100, 'First visible index should align with scroll offset and buffer.');

    assert.strictEqual(
      spacer.childNodes[0].textContent.trim(),
      `Item: Item ${firstChildIndex}`,
      `First visible element should render Item ${firstChildIndex} after scroll.`
    );

    // 4. Verify spacer paddings update correctly to maintain scroll position
    const spacerPaddingTop = parseFloat(spacer.style.paddingTop);
    const spacerPaddingBottom = parseFloat(spacer.style.paddingBottom);
    assert.ok(spacerPaddingTop > 0, 'padding-top should represent scrolled-out content height.');
    assert.ok(spacerPaddingBottom > 0, 'padding-bottom should represent remaining bottom content height.');
    assert.strictEqual(
      spacerPaddingTop + spacerPaddingBottom + (scrolledChildrenCount * 30),
      300000,
      'Total height represented by padding + elements height should match 10,000 items * 30px.'
    );

    // 5. Test dynamic resizing
    console.log('  Testing dynamic item resizing via ResizeObserver...');
    if (global.ResizeObserver.instances.length > 0) {
      const firstRow = spacer.childNodes[0];
      const observerInstance = global.ResizeObserver.instances[0];

      // Simulate first row height resizing to 100px
      // Mock setting offsetHeight directly if possible, or trigger manually
      Object.defineProperty(firstRow, 'offsetHeight', {
        value: 100,
        configurable: true
      });

      observerInstance.trigger({
        target: firstRow
      });

      // Wait for layout update requestAnimationFrame
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updatedTotalHeight = parseFloat(spacer.style.minHeight);
      
      console.log(`  Total height after resizing one item: ${updatedTotalHeight}`);
      assert.strictEqual(
        updatedTotalHeight,
        300070, // original 300,000 + 70px difference (100px - 30px)
        'Total spacer height should reactively update to account for resized item.'
      );
    } else {
      console.log('  ⚠️ ResizeObserver mock not registered or observed.');
    }

    // Clean up DOM
    document.body.removeChild(testRoot);

    console.log('  ✅ VirtualList unit tests passed successfully!');
  } catch (error) {
    console.error('❌ VirtualList unit tests failed!');
    console.error(error);
    process.exit(1);
  }
}

runTests();
