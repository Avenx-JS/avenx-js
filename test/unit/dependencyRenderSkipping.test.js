import assert from 'assert';
import { Window } from 'happy-dom';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { setDebugReactivity } from '../../lib/core/reactive/watcher.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.CustomEvent = window.CustomEvent;

async function nextTick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runTests() {
  console.log('🧪 Testing dependency-based render skipping (Issue #1167)...');

  // 1. Mutating a state key that no template expression depends on does NOT trigger a render or DOM patch
  {
    console.log('  Testing mutating non-template key skips render and DOM patch...');
    let renderCount = 0;

    class TestComponent extends AvenxComponent {
      constructor() {
        super(
          { count: 0, scrollOffset: 100 },
          {},
          {},
          '<div><span>Count: {{ count }}</span></div>'
        );
      }
      render() {
        renderCount++;
        return super.render();
      }
    }

    const root = document.createElement('div');
    document.body.appendChild(root);

    const comp = new TestComponent();
    comp.mount(root);
    await nextTick();

    const initialRenderCount = renderCount;
    assert.strictEqual(root.innerHTML.includes('Count: 0'), true);

    // Mutate unreferenced bookkeeping key
    comp.state.scrollOffset = 250;
    await nextTick();

    assert.strictEqual(
      renderCount,
      initialRenderCount,
      'Mutating scrollOffset should not trigger a re-render'
    );
    assert.strictEqual(comp.state.scrollOffset, 250);

    // Mutate referenced key
    comp.state.count = 1;
    await nextTick();

    assert.strictEqual(
      renderCount,
      initialRenderCount + 1,
      'Mutating count should trigger a re-render'
    );
    assert.strictEqual(root.innerHTML.includes('Count: 1'), true);

    comp.destroy();
    document.body.removeChild(root);
  }

  // 2. A key consumed indirectly via a computed property used in template triggers a render
  {
    console.log('  Testing indirect dependency through computed property triggers render...');
    let renderCount = 0;

    class ComputedComponent extends AvenxComponent {
      constructor() {
        super(
          { price: 10, tax: 2, unused: 0 },
          { total: 'price + tax', ignoredComputed: 'unused * 2' },
          {},
          '<div><span>Total: {{ total }}</span></div>'
        );
      }
      render() {
        renderCount++;
        return super.render();
      }
    }

    const root = document.createElement('div');
    document.body.appendChild(root);

    const comp = new ComputedComponent();
    comp.mount(root);
    await nextTick();

    const initialRenderCount = renderCount;
    assert.strictEqual(root.innerHTML.includes('Total: 12'), true);

    // Mutate unused key
    comp.state.unused = 5;
    await nextTick();
    assert.strictEqual(renderCount, initialRenderCount, 'Mutating unused state should skip render');

    // Mutate price (which flows into rendered computed total)
    comp.state.price = 20;
    await nextTick();
    assert.strictEqual(
      renderCount,
      initialRenderCount + 1,
      'Mutating price should trigger render via computed total'
    );
    assert.strictEqual(root.innerHTML.includes('Total: 22'), true);

    comp.destroy();
    document.body.removeChild(root);
  }

  // 3. Deep mutations (nested objects, array methods, Map/Set operations) resolve to correct root key
  {
    console.log('  Testing deep mutations resolve to root keys correctly...');
    let renderCount = 0;

    class DeepComponent extends AvenxComponent {
      constructor() {
        super(
          {
            user: { profile: { name: 'Alice' } },
            items: [1, 2],
            settings: new Map([['theme', 'dark']]),
            bookkeeping: { cache: new Map(), offset: { x: 0 } },
          },
          {},
          {},
          '<div><span>{{ user.profile.name }}</span><p>{{ items.length }}</p><b>{{ settings.get("theme") }}</b></div>'
        );
      }
      render() {
        renderCount++;
        return super.render();
      }
    }

    const root = document.createElement('div');
    document.body.appendChild(root);

    const comp = new DeepComponent();
    comp.mount(root);
    await nextTick();

    const initialRenderCount = renderCount;

    // Mutate deep bookkeeping key
    comp.state.bookkeeping.offset.x = 42;
    await nextTick();
    assert.strictEqual(renderCount, initialRenderCount, 'Deep mutation to bookkeeping.offset.x must skip render');

    // Mutate deep user.profile.name (referenced in template)
    comp.state.user.profile.name = 'Bob';
    await nextTick();
    assert.strictEqual(renderCount, initialRenderCount + 1, 'Deep mutation to user.profile.name must render');
    assert.strictEqual(root.innerHTML.includes('Bob'), true);

    // Mutate array items (referenced in template)
    comp.state.items.push(3);
    await nextTick();
    assert.strictEqual(renderCount, initialRenderCount + 2, 'Array mutation on items must render');

    // Mutate Map settings (referenced in template)
    comp.state.settings.set('theme', 'light');
    await nextTick();
    assert.strictEqual(renderCount, initialRenderCount + 3, 'Map mutation on settings must render');

    comp.destroy();
    document.body.removeChild(root);
  }

  // 4. $watch, watchEffect, resources still fire for keys whose render was skipped
  {
    console.log('  Testing $watch and watchEffect fire for keys whose render was skipped...');
    let renderCount = 0;
    let watchFired = 0;
    let watchEffectFired = 0;

    class WatchComponent extends AvenxComponent {
      constructor() {
        super(
          { count: 0, internalFlag: false },
          {},
          {},
          '<div><span>{{ count }}</span></div>'
        );
      }
      render() {
        renderCount++;
        return super.render();
      }
    }

    const root = document.createElement('div');
    document.body.appendChild(root);

    const comp = new WatchComponent();
    comp.mount(root);
    await nextTick();

    comp.$watch(
      () => comp.state.internalFlag,
      () => {
        watchFired++;
      }
    );

    comp.$watchEffect(() => {
      if (comp.state.internalFlag) {
        watchEffectFired++;
      }
    });

    const initialRenderCount = renderCount;

    // Mutate internalFlag (not in template)
    comp.state.internalFlag = true;
    await nextTick();

    assert.strictEqual(watchFired, 1, '$watch must fire for internalFlag');
    assert.strictEqual(watchEffectFired, 1, 'watchEffect must fire for internalFlag');
    assert.strictEqual(renderCount, initialRenderCount, 'Component render must be skipped');

    comp.destroy();
    document.body.removeChild(root);
  }

  // 5. Constructs that defeat static analysis fall back to always rendering
  {
    console.log('  Testing defeating constructs fall back to unconditional rendering...');

    // A: dynamic attribute name :[attr]="val"
    {
      let renderCount = 0;
      class DefeatAttrComponent extends AvenxComponent {
        constructor() {
          super(
            { attrName: 'title', count: 0, unused: 10 },
            {},
            {},
            '<div :[attrName]="\'test\'"><span>{{ count }}</span></div>'
          );
        }
        render() {
          renderCount++;
          return super.render();
        }
      }

      const root = document.createElement('div');
      document.body.appendChild(root);
      const comp = new DefeatAttrComponent();
      comp.mount(root);
      await nextTick();

      const initialRenderCount = renderCount;
      comp.state.unused = 99;
      await nextTick();
      assert.strictEqual(
        renderCount,
        initialRenderCount + 1,
        'Component with :[attr] must unconditionally re-render on any mutation'
      );
      comp.destroy();
      document.body.removeChild(root);
    }

    // B: data-ax-html with expression
    {
      let renderCount = 0;
      class DefeatHtmlComponent extends AvenxComponent {
        constructor() {
          super(
            { htmlContent: '<b>Hello</b>', unused: 10 },
            {},
            {},
            '<div data-ax-html="htmlContent"></div>'
          );
        }
        render() {
          renderCount++;
          return super.render();
        }
      }

      const root = document.createElement('div');
      document.body.appendChild(root);
      const comp = new DefeatHtmlComponent();
      comp.mount(root);
      await nextTick();

      const initialRenderCount = renderCount;
      comp.state.unused = 99;
      await nextTick();
      assert.strictEqual(
        renderCount,
        initialRenderCount + 1,
        'Component with dynamic data-ax-html must unconditionally re-render'
      );
      comp.destroy();
      document.body.removeChild(root);
    }

    // C: spread-like / dynamic state indexing
    {
      let renderCount = 0;
      class DefeatSpreadComponent extends AvenxComponent {
        constructor() {
          super(
            { key: 'a', a: 1, unused: 10 },
            {},
            {},
            '<div>{{ state[key] }}</div>'
          );
        }
        render() {
          renderCount++;
          return super.render();
        }
      }

      const root = document.createElement('div');
      document.body.appendChild(root);
      const comp = new DefeatSpreadComponent();
      comp.mount(root);
      await nextTick();

      const initialRenderCount = renderCount;
      comp.state.unused = 99;
      await nextTick();
      assert.strictEqual(
        renderCount,
        initialRenderCount + 1,
        'Component with state[...] bracket access must unconditionally re-render'
      );
      comp.destroy();
      document.body.removeChild(root);
    }
  }

  // 6. Documented opt-out restores unconditional behaviour
  {
    console.log('  Testing documented opt-out restores unconditional rendering...');

    // A: options.unconditional = true
    {
      let renderCount = 0;
      class OptOutComponent extends AvenxComponent {
        constructor() {
          super(
            { count: 0, unused: 10 },
            {},
            {},
            '<div>{{ count }}</div>',
            {},
            {},
            {},
            {},
            { unconditional: true }
          );
        }
        render() {
          renderCount++;
          return super.render();
        }
      }

      const root = document.createElement('div');
      document.body.appendChild(root);
      const comp = new OptOutComponent();
      comp.mount(root);
      await nextTick();

      const initialRenderCount = renderCount;
      comp.state.unused = 42;
      await nextTick();
      assert.strictEqual(
        renderCount,
        initialRenderCount + 1,
        'options.unconditional = true must restore unconditional re-rendering'
      );
      comp.destroy();
      document.body.removeChild(root);
    }

    // B: contracts: ['unconditional']
    {
      let renderCount = 0;
      class ContractOptOutComponent extends AvenxComponent {
        constructor() {
          super(
            { count: 0, unused: 10 },
            {},
            {},
            '<div>{{ count }}</div>',
            {},
            {},
            {},
            {},
            { contracts: ['unconditional'] }
          );
        }
        render() {
          renderCount++;
          return super.render();
        }
      }

      const root = document.createElement('div');
      document.body.appendChild(root);
      const comp = new ContractOptOutComponent();
      comp.mount(root);
      await nextTick();

      const initialRenderCount = renderCount;
      comp.state.unused = 42;
      await nextTick();
      assert.strictEqual(
        renderCount,
        initialRenderCount + 1,
        'contracts: [\'unconditional\'] must restore unconditional re-rendering'
      );
      comp.destroy();
      document.body.removeChild(root);
    }
  }

  // 7. With debug.debugReactivity enabled, skipped updates are logged with component name and key
  {
    console.log('  Testing debug.debugReactivity logs skipped updates with component name and key...');
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
    };

    setDebugReactivity(true);

    class DebugLoggedComponent extends AvenxComponent {
      constructor() {
        super(
          { count: 0, secretOffset: 123 },
          {},
          {},
          '<div><span>{{ count }}</span></div>'
        );
      }
    }

    const root = document.createElement('div');
    document.body.appendChild(root);
    const comp = new DebugLoggedComponent();
    comp.mount(root);
    await nextTick();

    logs.length = 0;
    comp.state.secretOffset = 456;
    await nextTick();

    setDebugReactivity(false);
    console.log = origLog;

    const skippedLog = logs.find((l) => l.includes('[Avenx Debug]') && l.includes('Skipped render') && l.includes('secretOffset'));
    assert.ok(skippedLog, `Must log skipped render with component name and key (got: ${JSON.stringify(logs)})`);
    assert.ok(skippedLog.includes('DebugLoggedComponent'), `Log must name the component (got: ${skippedLog})`);

    comp.destroy();
    document.body.removeChild(root);
  }

  // 8. Compiler ComponentParser extracts and emits templateDeps
  {
    console.log('  Testing ComponentParser extracts and emits templateDeps...');
    const parser = new ComponentParser(null);

    // Normal template: returns array with count
    const normalDeps = parser.extractTemplateDependencies('<div>Count: {{ count }}</div>');
    assert.deepStrictEqual(normalDeps, ['count'], 'Should extract templateDeps containing count');

    // Defeating template with dynamic attribute name: returns null
    const defeatingAttrDeps = parser.extractTemplateDependencies('<div :[key]="\'bar\'">Hello</div>');
    assert.strictEqual(defeatingAttrDeps, null, 'Should return null for dynamic attribute name :[key]');

    // Defeating template with data-ax-html: returns null
    const defeatingHtmlDeps = parser.extractTemplateDependencies('<div data-ax-html="htmlContent"></div>');
    assert.strictEqual(defeatingHtmlDeps, null, 'Should return null for dynamic data-ax-html');

    // Defeating template with state[...] indexing: returns null
    const defeatingSpreadDeps = parser.extractTemplateDependencies('<div>{{ state[prop] }}</div>');
    assert.strictEqual(defeatingSpreadDeps, null, 'Should return null for state[...] bracket access');
  }

  console.log('🎉 All dependency render skipping tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
