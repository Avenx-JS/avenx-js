/**
 * @file virtualListNestedProps.test.js
 * @description `<VirtualList>` inside a child component of a page (#1749).
 *
 * The test builds the issue's project with the real compiler, so the template
 * syntax, `<state>` declaration and row-template escaping match what `avenx
 * build` emits, then runs the built bundle in a DOM. A nested mount point's
 * `data-props-*` expressions belong to the child component's template, so they
 * must resolve in the child's scope, not the page's.
 */

import assert from 'assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import '../helpers/register-happy-dom.js';
import AvenxCompiler from '../../lib/compiler.js';

if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * Builds a Demo component as an array literal of `count` named items.
 * @param {number} count - How many items to generate.
 * @returns {string} The literal, in the single-quoted form the issue uses.
 */
function itemsLiteral(count) {
  const items = Array.from({ length: count }, (_, i) => `{ id: ${i}, name: 'Item ${i}' }`);
  return `[${items.join(', ')}]`;
}

/**
 * Writes the issue's project into a temporary directory and runs `avenx build`
 * on it. The Demo component has two lists: the issue's ten-item list, and a
 * 1,000-item list for the windowing check.
 * @returns {Promise<{root: string, bundle: string}>} The project root and bundle source.
 */
async function buildIssueProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avx-1749-'));
  const write = (rel, content) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  write('avenx.config.json', JSON.stringify({ srcDir: 'src', distDir: 'dist', warnings: { AVX_W56: 'off' } }));
  write(
    'src/main.app.js',
    "import { AvenxApp } from 'avenx-core/runtime';\n" +
      "import Demo from './components/demo/demo.component.js';\n" +
      "const app = new AvenxApp({ target: '#app' });\n" +
      "app.register('Demo', Demo);\n" +
      "app.initRouter({ '': 'Home' });\n"
  );
  write('src/pages/home.page.js', '<div><Demo /></div>\n');
  write(
    'src/components/demo/demo.component.js',
    `<state lists="{ small: ${itemsLiteral(10)}, big: ${itemsLiteral(1000)} }" />

<div>
  <p id="cnt">count={{ lists.small.length }}</p>
  <div class="vl-host" style="height: 300px;">
    <VirtualList :item-height="40" :items="lists.small">
      <template data-ax-as="row">
        <div class="row">{{ row.name }}</div>
      </template>
    </VirtualList>
  </div>
  <p id="big-cnt">count={{ lists.big.length }}</p>
  <div class="vl-host-big" style="height: 300px;">
    <VirtualList :item-height="40" :items="lists.big">
      <template data-ax-as="row">
        <div class="big-row">{{ row.name }}</div>
      </template>
    </VirtualList>
  </div>
</div>
`
  );

  const compiler = new AvenxCompiler({ rootDir: root });
  compiler.init();
  await compiler.build();
  return { root, bundle: fs.readFileSync(path.join(root, 'dist', 'bundle.js'), 'utf8') };
}

async function runTests() {
  console.log('🧪 Testing VirtualList inside a child component (#1749)...');

  const { root, bundle } = await buildIssueProject();
  const appRoot = document.createElement('div');
  appRoot.id = 'app';
  document.body.appendChild(appRoot);

  try {
    vm.runInThisContext(bundle, { filename: 'bundle.js' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rows = document.querySelectorAll('.row');
    assert.strictEqual(rows.length, 10, `expected 10 rendered rows, got ${rows.length}`);
    assert.strictEqual(
      rows[0].textContent.trim(),
      'Item 0',
      `expected first row "Item 0", got "${rows[0].textContent.trim()}"`
    );

    const count = document.querySelector('#cnt').textContent.trim();
    assert.strictEqual(count, 'count=10', `expected "count=10", got "${count}"`);

    // The spacer is what gives the scroll area its height. For ten 40px rows it
    // must be 400px tall, and the list's refs must resolve to the same elements.
    const spacers = document.querySelectorAll('.virtual-list-spacer');
    assert.strictEqual(spacers.length, 2, `expected 2 spacers, got ${spacers.length}`);
    assert.ok(
      /min-height:\s*400px/.test(spacers[0].getAttribute('style') || ''),
      `expected the ten-item spacer to be 400px tall, got "${spacers[0].getAttribute('style')}"`
    );
    const listEl = document.querySelector('[data-props-items="lists.small"]');
    const listInstance = listEl && listEl.__avenx_comp_instance;
    assert.ok(listInstance, 'VirtualList instance should be attached to its mount point.');
    assert.strictEqual(listInstance.$refs.spacer, spacers[0], 'spacer ref should resolve to the rendered spacer.');
    assert.ok(listInstance.$refs.viewport, 'viewport ref should resolve to the rendered viewport.');

    // A 1,000-item list renders only the rows that fit the viewport plus overscan.
    const bigRows = document.querySelectorAll('.big-row').length;
    assert.ok(
      bigRows > 0 && bigRows < 50,
      `expected a windowed count of big-list rows (0 < n < 50), got ${bigRows} for 1000 items`
    );
    assert.ok(
      /min-height:\s*40000px/.test(spacers[1].getAttribute('style') || ''),
      `expected the 1,000-item spacer to be 40000px tall, got "${spacers[1].getAttribute('style')}"`
    );

    console.log('✅ VirtualList inside a child component renders its rows');
  } finally {
    document.body.removeChild(appRoot);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTests().catch((error) => {
  console.error('❌ VirtualList inside a child component failed:');
  console.error(error);
  process.exit(1);
});
