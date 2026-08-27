import assert from 'assert';
import { Window } from 'happy-dom';
import { ListManager } from '../../lib/core/renderer/listManager.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

(async function runTests() {
  console.log('🏃 Running List Sources Tests (using happy-dom)...');

  const window = new Window();
  const document = window.document;
  global.document = document;
  global.window = window;
  global.Node = window.Node;

  let warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (msg) => warnings.push(msg);

  const mockEvaluator = {
    evaluateExpression: (expr, scope, state) => {
      if (expr === 'state.obj') return state.obj;
      if (expr === 'state.map') return state.map;
      if (expr === 'state.set') return state.set;
      if (expr === 'state.num') return state.num;
      if (expr === 'state.invalid') return state.invalid;
      if (expr === 'state.empty') return state.empty;
      if (expr === 'item.k' || expr === 'item.id') return scope.item ? (scope.item.k || scope.item.id) : null;
      if (expr === 'k') return scope.k;
      if (expr === 'v') return scope.v;
      return expr;
    }
  };

  const mockRenderer = {
    render: (template, resolver) => {
      return template.replace(/\{\{(.*?)\}\}/g, (match, expr) => resolver(expr.trim()));
    }
  };

  try {
    const listManager = new ListManager(mockEvaluator, mockRenderer, undefined, 'TestComponent');
    listManager.parserDiv = document.createElement('div');

    // TEST 1: Object destructuring
    let listContainer = document.createElement('div');
    let template = document.createElement('template');
    template.setAttribute('data-ax-for', 'state.obj');
    template.setAttribute('data-ax-as', '[k, v]');
    template.innerHTML = '<li>{%k%}: {%v%}</li>';
    listContainer.appendChild(template);

    listManager.process(listContainer, {}, { obj: { a: 1, b: 2 } });
    let listItems = Array.from(listContainer.querySelectorAll('li'));
    assert.strictEqual(listItems.length, 2);
    assert.ok(listItems[0].outerHTML.includes('a: 1'));
    assert.ok(listItems[1].outerHTML.includes('b: 2'));

    // TEST 2: Numeric Range
    listContainer = document.createElement('div');
    template = document.createElement('template');
    template.setAttribute('data-ax-for', 'state.num');
    template.setAttribute('data-ax-as', 'item');
    template.innerHTML = '<li>{%item%}</li>';
    listContainer.appendChild(template);

    listManager.process(listContainer, {}, { num: 3 });
    listItems = Array.from(listContainer.querySelectorAll('li'));
    assert.strictEqual(listItems.length, 3);
    assert.ok(listItems[0].outerHTML.includes('0'));
    assert.ok(listItems[2].outerHTML.includes('2'));

    // TEST 3: Invalid Source Warning
    warnings = [];
    listContainer = document.createElement('div');
    template = document.createElement('template');
    template.setAttribute('data-ax-for', 'state.invalid');
    template.setAttribute('data-ax-as', 'item');
    template.innerHTML = '<li></li>';
    listContainer.appendChild(template);

    listManager.process(listContainer, {}, { invalid: true });
    assert.ok(warnings.some(w => w.includes('[AVX_W39]')), 'Should emit warning for invalid source');

    // TEST 4: Empty Block Rendering
    listContainer = document.createElement('div');
    template = document.createElement('template');
    template.setAttribute('data-ax-for', 'state.empty');
    template.setAttribute('data-ax-as', 'item');
    template.innerHTML = '<li>{%item%}</li>';
    listContainer.appendChild(template);

    const emptyTemplate = document.createElement('template');
    emptyTemplate.setAttribute('data-ax-empty', '');
    emptyTemplate.innerHTML = '<li class="empty">Empty</li>';
    listContainer.appendChild(emptyTemplate);

    // Initial Empty
    listManager.process(listContainer, {}, { empty: [] });
    listItems = Array.from(listContainer.querySelectorAll('li'));
    assert.strictEqual(listItems.length, 1);
    assert.ok(listItems[0].outerHTML.includes('Empty'));

    // Update to non-empty
    listManager.process(listContainer, {}, { empty: [1] });
    listItems = Array.from(listContainer.querySelectorAll('li'));
    assert.strictEqual(listItems.length, 1);
    assert.ok(!listItems[0].outerHTML.includes('Empty'));

    // Update back to empty
    listManager.process(listContainer, {}, { empty: [] });
    listItems = Array.from(listContainer.querySelectorAll('li'));
    assert.strictEqual(listItems.length, 1);
    assert.ok(listItems[0].outerHTML.includes('Empty'));

    logger.warn = originalWarn;
    console.log('  ✅ List Sources tests passed!');
    process.exit(0);
  } catch (err) {
    logger.warn = originalWarn;
    console.error('❌ List Sources tests failed!');
    console.error(err);
    process.exit(1);
  }
})();
