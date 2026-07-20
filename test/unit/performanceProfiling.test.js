import assert from 'assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { MockDOMElement, setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

async function testPerformanceProfiling() {
  console.log('🧪 Testing performance profiling...');
  setupDOMMock();

  // Create a clean mock for performance API
  const marks = [];
  const measures = [];
  
  const originalPerformance = globalThis.performance || (typeof window !== 'undefined' ? window.performance : null);
  globalThis.performance = {
    now() {
      return originalPerformance && typeof originalPerformance.now === 'function' 
        ? originalPerformance.now() 
        : Date.now();
    },
    mark(name) {
      marks.push(name);
    },
    measure(name, start, end) {
      measures.push({ name, start, end });
    },
    clearMarks() {
      // Mock clearing
    }
  };

  try {
    // 1. Define a dummy component
    class ProfiledComponent extends AvenxComponent {
      constructor() {
        super(
          { count: 0 },
          {},
          {},
          '<div>Count: {{count}}</div>',
          {
            onBeforeMount() {},
            onMount() {},
            onBeforeUpdate() {},
            onUpdate() {},
            onUnmount() {}
          }
        );
      }
    }

    // Set up mock root element
    const mockRoot = new MockDOMElement('div');
    document.querySelector = (sel) => {
      if (sel === '#app-root') return mockRoot;
      return new MockDOMElement('div');
    };

    // 2. Test with enableProfiling: true
    const app = new AvenxApp({
      target: '#app-root',
      enableProfiling: true
    });
    app.register('ProfiledComponent', ProfiledComponent);

    marks.length = 0;
    measures.length = 0;

    // Mount
    app.mount('ProfiledComponent');

    // Assert marks and measures were recorded
    assert.ok(marks.length > 0, 'Should record marks when profiling is enabled');
    assert.ok(measures.length > 0, 'Should record measures when profiling is enabled');

    // Check specific phases are measured
    const measuredPhases = measures.map(m => m.name);
    assert.ok(measuredPhases.includes('[Avenx] ProfiledComponent - onBeforeMount'), 'Should measure onBeforeMount');
    assert.ok(measuredPhases.includes('[Avenx] ProfiledComponent - onMount'), 'Should measure onMount');
    assert.ok(measuredPhases.includes('[Avenx] ProfiledComponent - render'), 'Should measure render');
    assert.ok(measuredPhases.includes('[Avenx] ProfiledComponent - patch'), 'Should measure patch');
    assert.ok(measuredPhases.includes('[Avenx] ProfiledComponent - mount'), 'Should measure mount');

    // Trigger update
    const activeComponent = mockRoot.__avenx_comp_instance;
    assert.ok(activeComponent, 'Component should be mounted on mockRoot');
    marks.length = 0;
    measures.length = 0;

    activeComponent.state.count = 1;
    // Wait for scheduleUpdate tick
    await new Promise(resolve => setTimeout(resolve, 20));

    // Check update phases are measured
    const updatedPhases = measures.map(m => m.name);
    assert.ok(updatedPhases.includes('[Avenx] ProfiledComponent - onBeforeUpdate'), 'Should measure onBeforeUpdate');
    assert.ok(updatedPhases.includes('[Avenx] ProfiledComponent - onUpdate'), 'Should measure onUpdate');
    assert.ok(updatedPhases.includes('[Avenx] ProfiledComponent - render'), 'Should measure render in update');
    assert.ok(updatedPhases.includes('[Avenx] ProfiledComponent - patch'), 'Should measure patch in update');

    // Unmount
    marks.length = 0;
    measures.length = 0;
    activeComponent.unmount();

    const unmountedPhases = measures.map(m => m.name);
    assert.ok(unmountedPhases.includes('[Avenx] ProfiledComponent - onUnmount'), 'Should measure onUnmount');

    // Clean up DOM and reset global flag
    delete window.__avenx_enable_profiling;

    // 3. Test with enableProfiling: false (or omitted)
    const appDisabled = new AvenxApp({
      target: '#app-root',
      enableProfiling: false
    });
    appDisabled.register('ProfiledComponent', ProfiledComponent);

    marks.length = 0;
    measures.length = 0;

    appDisabled.mount('ProfiledComponent');
    assert.strictEqual(marks.length, 0, 'Should NOT record marks when profiling is disabled');
    assert.strictEqual(measures.length, 0, 'Should NOT record measures when profiling is disabled');

    console.log('  ✅ Performance profiling tests passed successfully!');
  } finally {
    globalThis.performance = originalPerformance;
    teardownDOMMock();
  }
}

(async () => {
  try {
    await testPerformanceProfiling();
    process.exit(0);
  } catch (error) {
    console.error('❌ Performance profiling tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
