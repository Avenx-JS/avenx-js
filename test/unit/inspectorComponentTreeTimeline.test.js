import assert from 'node:assert';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import {
  getInspectorData,
  recordTimelineEntry,
  getTimeline,
  clearTimeline,
  buildComponentTree,
  highlightComponent,
  clearComponentHighlight,
} from '../../lib/core/tooling/inspect.js';

console.log('🧪 Testing Component Tree and Bounded Update Timeline in Dev Server Inspector (#1181)...');

// Mock browser globals if running in node unit environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    __avenx_inspect_enabled: true,
    addEventListener: () => { },
    removeEventListener: () => { },
  };
} else {
  globalThis.window.__avenx_inspect_enabled = true;
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      style: {},
      parentNode: null,
      appendChild() { },
      removeChild() { },
      getBoundingClientRect: () => ({ top: 10, left: 10, width: 100, height: 50 }),
    }),
    body: {
      appendChild(el) {
        el.parentNode = this;
      },
      removeChild(el) {
        el.parentNode = null;
      },
    },
    querySelectorAll: () => [],
    querySelector: () => ({
      tagName: 'DIV',
      style: {},
      parentNode: null,
      appendChild() { },
      removeChild() { },
      childNodes: [],
      querySelectorAll: () => [],
    }),
  };
} else if (globalThis.document.body && !globalThis.document.querySelector('#app')) {
  const mountEl = globalThis.document.createElement('div');
  mountEl.id = 'app';
  globalThis.document.body.appendChild(mountEl);
}

if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = class {
    constructor(name) {
      this.name = name;
    }
    postMessage() { }
    close() { }
  };
}

class ChildCard extends AvenxComponent {
  static template = '<div>Child Card</div>';
}

class ParentContainer extends AvenxComponent {
  static template = '<div>Parent Container</div>';
}

function testComponentInstanceIdsAndParentLink() {
  console.log('  Testing component stable instance IDs and parent link exposure...');
  const parent = new ParentContainer();
  const child1 = new ChildCard({}, { key: 'card-1' });
  const child2 = new ChildCard({}, { key: 'card-2' });

  assert.ok(parent.$id, 'parent has a stable $id');
  assert.ok(child1.$id, 'child1 has a stable $id');
  assert.ok(child2.$id, 'child2 has a stable $id');
  assert.notStrictEqual(child1.$id, child2.$id, 'sibling instances have unique IDs');
  assert.strictEqual(child1.$instanceId, child1.$id, '$instanceId alias matches $id');

  // Simulated parent link
  child1.$parent = parent;
  child2.$parent = parent;

  assert.strictEqual(child1.$parentComponent, parent, 'child exposes parent via $parentComponent');
  assert.strictEqual(parent.$parentComponent, null, 'root parent has null $parentComponent');
}

function testComponentTreeConstruction() {
  console.log('  Testing buildComponentTree and sibling identity...');
  const flatNodes = [
    { id: 'comp-1', name: 'ParentContainer', parentId: null, key: null, index: 0, state: { count: 0 }, props: {} },
    {
      id: 'comp-2',
      name: 'ChildCard',
      parentId: 'comp-1',
      key: 'user-a',
      index: 0,
      state: {},
      props: { user: 'Alice' },
    },
    { id: 'comp-3', name: 'ChildCard', parentId: 'comp-1', key: 'user-b', index: 1, state: {}, props: { user: 'Bob' } },
    { id: 'comp-4', name: 'Badge', parentId: 'comp-2', key: null, index: 0, state: {}, props: { text: 'New' } },
  ];

  const tree = buildComponentTree(flatNodes);

  assert.strictEqual(tree.length, 1, 'tree has 1 root node');
  assert.strictEqual(tree[0].id, 'comp-1');
  assert.strictEqual(tree[0].children.length, 2, 'ParentContainer has 2 children');
  assert.strictEqual(tree[0].children[0].id, 'comp-2');
  assert.strictEqual(tree[0].children[0].key, 'user-a');
  assert.strictEqual(tree[0].children[0].children.length, 1, 'ChildCard #1 has 1 child (Badge)');
  assert.strictEqual(tree[0].children[0].children[0].id, 'comp-4');
  assert.strictEqual(tree[0].children[1].id, 'comp-3');
  assert.strictEqual(tree[0].children[1].key, 'user-b');
  assert.strictEqual(tree[0].children[1].index, 1, 'second sibling has index 1');
}

function testTimelineRecordingAndSnapshotIntegrity() {
  console.log('  Testing bounded update timeline and historical snapshot integrity...');
  clearTimeline();

  const comp = new ChildCard();
  comp.state.counter = 1;

  // Record mount event
  const mountEntry = recordTimelineEntry('mount', comp);
  assert.strictEqual(mountEntry.type, 'mount');
  assert.strictEqual(mountEntry.componentId, comp.$id);
  assert.strictEqual(mountEntry.componentName, 'ChildCard');
  assert.strictEqual(mountEntry.state.counter, 1);

  // Mutate state and record update with causation trace
  comp.state.counter = 2;
  const updateEntry = recordTimelineEntry('update', comp, {
    key: 'counter',
    causationTrace: ['state.counter', '[ChildCard#render]'],
  });

  assert.strictEqual(updateEntry.type, 'update');
  assert.strictEqual(updateEntry.key, 'counter');
  assert.deepStrictEqual(updateEntry.causationTrace, ['state.counter', '[ChildCard#render]']);
  assert.strictEqual(updateEntry.state.counter, 2);

  // Mutate state again - historical snapshot must remain unchanged!
  comp.state.counter = 99;
  assert.strictEqual(mountEntry.state.counter, 1, 'mount historical snapshot is unaffected by later mutations');
  assert.strictEqual(updateEntry.state.counter, 2, 'update historical snapshot is unaffected by later mutations');

  const history = getTimeline();
  assert.strictEqual(history.length, 2);
}

function testTimelineBoundingAndMemoryStability() {
  console.log('  Testing timeline bounding (ring buffer) and zero retention...');
  clearTimeline();
  window.__avenx_inspect_max_timeline = 5;

  const comp = new ChildCard();

  for (let i = 1; i <= 25; i++) {
    comp.state.step = i;
    recordTimelineEntry('update', comp, { key: 'step' });
  }

  const timeline = getTimeline();
  assert.strictEqual(timeline.length, 5, 'timeline size is strictly bounded by maxTimelineSize');
  assert.strictEqual(timeline[timeline.length - 1].state.step, 25, 'latest entry is preserved');
  assert.strictEqual(timeline[0].state.step, 21, 'oldest entries were evicted (FIFO)');

  // Verify entries hold no live references to component
  for (const entry of timeline) {
    assert.strictEqual(typeof entry.componentId, 'string');
    assert.strictEqual(typeof entry.state, 'object');
    assert.strictEqual(entry.component, undefined, 'no live component reference stored on timeline entry');
  }

  // Reset max timeline config
  delete window.__avenx_inspect_max_timeline;
}

function testInspectorDataPayloadShapeAndCloneability() {
  console.log('  Testing getInspectorData payload shape and structured cloneability...');
  clearTimeline();

  const app = new AvenxApp({ target: '#app' });
  const comp = new ParentContainer();
  comp.state.title = 'Hello';
  recordTimelineEntry('mount', comp);

  const payload = getInspectorData(app);

  assert.strictEqual(payload.version, 2, 'payload specifies version 2');
  assert.ok(Array.isArray(payload.componentTree), 'componentTree is an array');
  assert.ok(Array.isArray(payload.activeComponents), 'activeComponents is an array for backward compatibility');
  assert.ok(Array.isArray(payload.timeline), 'timeline is an array');
  assert.ok(payload.registeredBridges !== undefined);
  assert.ok(payload.registeredComponents !== undefined);

  // Must be structured-cloneable (transport across BroadcastChannel)
  if (typeof structuredClone === 'function') {
    const cloned = structuredClone(payload);
    assert.strictEqual(cloned.version, 2);
    assert.strictEqual(cloned.timeline.length, 1);
  }
}

function testDomHighlighting() {
  console.log('  Testing DOM element highlight overlay...');
  const comp = new ParentContainer();
  highlightComponent(comp.$id);
  assert.doesNotThrow(() => clearComponentHighlight());
}

function runAll() {
  try {
    testComponentInstanceIdsAndParentLink();
    testComponentTreeConstruction();
    testTimelineRecordingAndSnapshotIntegrity();
    testTimelineBoundingAndMemoryStability();
    testInspectorDataPayloadShapeAndCloneability();
    testDomHighlighting();
    console.log('🎉 All inspector component tree and bounded update timeline tests passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Tests failed:', err);
    process.exit(1);
  }
}

runAll();
