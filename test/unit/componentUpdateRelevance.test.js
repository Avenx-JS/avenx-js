import assert from 'node:assert/strict';
import {
  extractTemplateDeps, extractIdentifiers, isUnconditional, shouldSkipUpdate,
  computedDependsOn, isKeyTemplateRelevant, isComputedObservedByTemplate,
} from '../../lib/core/runtime/component/updateRelevance.js';

const rawState = {};
const nestedItem = {};
const renderWatcher = {};
const bindingWatcher = {};
const context = {
  hasRenderedOnce: true,
  contracts: new Set(), options: {}, rawState,
  templateDeps: new Set(['title', 'summary']),
  computed: new Map([['summary', 'details'], ['details', 'items.length']]),
  computedWatchers: new Map(), renderWatcher, bindings: [], observedComputed: new Map(),
  getPropertyPath: (target, key) => target === nestedItem ? `items.0.${String(key)}` : String(key),
};

assert.deepEqual(extractTemplateDeps('<p :if="show">{{ state.title }}</p>'), new Set(['title', 'show']));
assert.deepEqual(extractTemplateDeps(''), new Set());
assert.deepEqual(extractTemplateDeps(null), new Set());
assert.deepEqual(extractIdentifiers('state.title + count'), new Set(['title', 'count']));
for (const template of ['<p :[attr]="value">', '<p data-ax-html="content">', '{{ state[key] }}']) {
  assert.equal(extractTemplateDeps(template), null);
}

assert.equal(shouldSkipUpdate(context, 'unrelated', rawState), true);
assert.equal(shouldSkipUpdate(context, 'title', rawState), false);
assert.equal(shouldSkipUpdate(context, 'items', rawState), false);
assert.equal(shouldSkipUpdate(context, 'name', nestedItem), false);
assert.equal(shouldSkipUpdate(context, ['unrelated', 'title'], rawState), false);
assert.equal(shouldSkipUpdate(context, ['unrelated', 'unused'], rawState), true);
for (const key of [null, undefined, Symbol('unknown')]) {
  assert.equal(shouldSkipUpdate(context, key, rawState), false);
}
assert.equal(shouldSkipUpdate({ ...context, hasRenderedOnce: false }, 'unused', rawState), false);
assert.equal(shouldSkipUpdate({ ...context, templateDeps: new Set(['state']) }, 'anything', rawState), false);

for (const contract of ['unconditional', 'always-render']) {
  const contracts = new Set([contract]);
  assert.equal(isUnconditional(contracts, {}, new Set()), true);
  assert.equal(shouldSkipUpdate({ ...context, contracts }, 'unused', rawState), false);
}
for (const options of [{ unconditional: true }, { alwaysRender: true }]) {
  assert.equal(shouldSkipUpdate({ ...context, options }, 'unused', rawState), false);
}
assert.equal(isUnconditional(new Set(), {}, new Set()), false);
assert.equal(shouldSkipUpdate({ ...context, templateDeps: null }, 'unused', rawState), false);

// A function-defined computed value contributes the dependencies observed by
// its watcher; string-defined values can be followed before first evaluation.
context.computed.set('summary', () => 'value');
context.computedWatchers.set('summary', { deps: new Set([{ target: nestedItem, key: 'name' }]) });
assert.equal(computedDependsOn(context, 'summary', 'items'), true);
assert.equal(computedDependsOn(context, 'summary', 'unused'), false);
context.computed.set('a', 'b');
context.computed.set('b', 'a + items.length');
assert.equal(computedDependsOn(context, 'a', 'items'), true);
assert.equal(computedDependsOn(context, 'a', 'unused'), false);

const dynamic = { ...context, templateDeps: null };
dynamic.renderWatcher = { deps: new Set([{ target: rawState, key: 'title' }]) };
assert.equal(isKeyTemplateRelevant(dynamic, 'title'), true);
assert.equal(isKeyTemplateRelevant(dynamic, 'unused'), false);
dynamic.bindings = [{ watcher: { deps: new Set([{ target: nestedItem, key: 'name' }]) } }];
assert.equal(isKeyTemplateRelevant(dynamic, 'items'), true);
dynamic.bindings = [{ watcher: bindingWatcher }];
dynamic.observedComputed = new Map([['summary', new Set([bindingWatcher])]]);
assert.equal(isComputedObservedByTemplate(dynamic, 'summary'), true);
assert.equal(isKeyTemplateRelevant(dynamic, 'items'), true);
dynamic.observedComputed.set('summary', new Set([dynamic.renderWatcher]));
assert.equal(isComputedObservedByTemplate(dynamic, 'summary'), true);
dynamic.observedComputed.set('summary', new Set([{}]));
assert.equal(isComputedObservedByTemplate(dynamic, 'summary'), false);
assert.equal(isKeyTemplateRelevant(dynamic, 'items'), false);
console.log('Direct component update relevance tests passed');
