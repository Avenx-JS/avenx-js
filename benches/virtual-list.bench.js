import { performance } from 'perf_hooks';
import '../test/helpers/register-happy-dom.js';
import { AvenxPage } from '../lib/core/runtime/AvenxPage.js';
import { VirtualList } from '../lib/core/runtime/VirtualList.js';

// Setup Mock ResizeObserver if not natively present in happy-dom environment
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * Page component wrapper to host the VirtualList for benchmarking.
 */
class BenchPage extends AvenxPage {
  constructor(items) {
    super(
      {
        items: items,
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

/**
 * Runs benchmarks on the VirtualList layout, offset resolution, and recycling engine.
 */
function benchmark() {
  const iterations = 500;
  const itemCount = 10000;
  const items = Array.from({ length: itemCount }, (_, i) => ({ id: i, name: `Item ${i}` }));

  console.log(`Running VirtualList benchmark with dataset of ${itemCount} items...`);

  // 1. Measure Mount / Layout time
  const testRoot = document.createElement('div');
  document.body.appendChild(testRoot);

  const startMount = performance.now();
  const page = new BenchPage(items);
  page.mount(testRoot);
  page.update();
  const endMount = performance.now();
  const mountTime = endMount - startMount;

  // Retrieve VirtualList instance
  const virtualListEl = testRoot.querySelector('[data-avenx-comp="VirtualList"]');
  const virtualListInstance = virtualListEl.__avenx_comp_instance;
  const viewport = virtualListInstance.$refs.viewport;

  // 2. Measure Scrolling & Recycling time
  const startScroll = performance.now();
  for (let i = 0; i < iterations; i++) {
    const scrollStep = (i * 120) % (itemCount * 30 - 400);
    viewport.scrollTop = scrollStep;
    virtualListInstance.onScroll();
  }
  const endScroll = performance.now();
  const scrollTime = endScroll - startScroll;

  // Cleanup
  page.unmount();
  document.body.removeChild(testRoot);

  const totalTime = mountTime + scrollTime;
  const totalOps = 1 + iterations;
  const avgTime = totalTime / totalOps;

  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per operation: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
  console.log(`  - Mount & Init layout: ${mountTime.toFixed(2)}ms`);
  console.log(`  - Scrolling cycles: ${scrollTime.toFixed(2)}ms`);
}

benchmark();
