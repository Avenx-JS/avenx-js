/**
 * @file slotStaticDynamicClassification.test.js
 * @description Dedicated test coverage for slot static/dynamic classification in ComponentParser.
 * Verifies that <slot> tags, their descendant fallback contents, and any ancestor elements
 * containing slots are correctly classified as dynamic, preventing regression of issue #200.
 */
import assert from 'node:assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

/**
 * Finds a node in the parsed AST matching the predicate.
 * @param {import('../../lib/compiler/parser/htmlTree.js').HTMLNode[]} nodes
 * @param {(node: import('../../lib/compiler/parser/htmlTree.js').HTMLNode) => boolean} predicate
 * @returns {import('../../lib/compiler/parser/htmlTree.js').HTMLNode|null}
 */
function findNode(nodes, predicate) {
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }
    if (node.children && node.children.length > 0) {
      const found = findNode(node.children, predicate);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Collects all nodes matching the predicate in pre-order traversal.
 * @param {import('../../lib/compiler/parser/htmlTree.js').HTMLNode[]} nodes
 * @param {(node: import('../../lib/compiler/parser/htmlTree.js').HTMLNode) => boolean} predicate
 * @returns {import('../../lib/compiler/parser/htmlTree.js').HTMLNode[]}
 */
function findAllNodes(nodes, predicate) {
  const result = [];
  function walk(list) {
    for (const node of list) {
      if (predicate(node)) {
        result.push(node);
      }
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

const sp = new StyleProcessor();
const cp = new ComponentParser(sp);

console.log('🧪 Testing Slot Static/Dynamic Classification in ComponentParser (#1315)...');

try {
  // -------------------------------------------------------------------------
  // 1. Static slot with no dynamic bindings
  // -------------------------------------------------------------------------
  console.log('  1. Static slot with no dynamic bindings...');
  {
    const template = `
      <div class="card">
        <header class="static-header">
          <h1>Card Title</h1>
          <p>Static subtitle</p>
        </header>
        <div class="card-body">
          <slot>
            <div class="default-slot-wrapper">
              <span>Default Slot Content</span>
            </div>
          </slot>
        </div>
      </div>
    `;

    const nodes = ComponentParser.parseHTML(template);
    cp.markStaticNodes(nodes);

    // Slot tag itself must NOT be static
    const slotNode = findNode(nodes, (n) => n.tagName === 'slot');
    assert.ok(slotNode, 'slot node must exist in AST');
    assert.strictEqual(slotNode.isStatic, false, 'slot node must be classified as dynamic');
    assert.strictEqual(slotNode.attrs['data-ax-static'], undefined, 'slot must not carry data-ax-static');

    // Slot fallback children must NOT be static
    const slotWrapper = findNode(nodes, (n) => n.attrs?.class === 'default-slot-wrapper');
    assert.ok(slotWrapper, 'fallback wrapper inside slot must exist');
    assert.strictEqual(slotWrapper.isStatic, false, 'slot fallback child must be dynamic');
    assert.strictEqual(slotWrapper.attrs['data-ax-static'], undefined, 'fallback child must not have data-ax-static');

    // Parent container enclosing the slot must NOT be static
    const cardBody = findNode(nodes, (n) => n.attrs?.class === 'card-body');
    assert.ok(cardBody, 'card-body ancestor must exist');
    assert.strictEqual(cardBody.isStatic, false, 'card-body enclosing slot must be dynamic');
    assert.strictEqual(cardBody.attrs['data-ax-static'], undefined, 'card-body must not have data-ax-static');

    // Root wrapper containing slot must NOT be static
    const cardRoot = findNode(nodes, (n) => n.attrs?.class === 'card');
    assert.ok(cardRoot, 'card root must exist');
    assert.strictEqual(cardRoot.isStatic, false, 'card root enclosing slot must be dynamic');
    assert.strictEqual(cardRoot.attrs['data-ax-static'], undefined, 'card root must not have data-ax-static');

    // Independent static header outside slot MUST be marked static
    const headerNode = findNode(nodes, (n) => n.attrs?.class === 'static-header');
    assert.ok(headerNode, 'static header must exist');
    assert.strictEqual(headerNode.isStatic, true, 'independent static header must be classified as static');
    assert.strictEqual(
      headerNode.attrs['data-ax-static'],
      'true',
      'independent static header must have data-ax-static="true"',
    );
  }

  // -------------------------------------------------------------------------
  // 2. Slot with a dynamic attribute
  // -------------------------------------------------------------------------
  console.log('  2. Slot with a dynamic attribute...');
  {
    const template = `
      <div class="slot-container">
        <slot :name="activeSlot" :prop="currentValue">
          <span>Fallback</span>
        </slot>
      </div>
    `;

    const nodes = ComponentParser.parseHTML(template);
    cp.markStaticNodes(nodes);

    const slotNode = findNode(nodes, (n) => n.tagName === 'slot');
    assert.ok(slotNode, 'slot with dynamic attribute must exist');
    assert.strictEqual(slotNode.isStatic, false, 'dynamic-attribute slot must be classified as dynamic');
    assert.strictEqual(
      slotNode.attrs['data-ax-static'],
      undefined,
      'dynamic-attribute slot must not have data-ax-static',
    );

    const container = findNode(nodes, (n) => n.attrs?.class === 'slot-container');
    assert.strictEqual(container.isStatic, false, 'container wrapping dynamic-attribute slot must be dynamic');
    assert.strictEqual(container.attrs['data-ax-static'], undefined);
  }

  // -------------------------------------------------------------------------
  // 3. Slot with dynamic children
  // -------------------------------------------------------------------------
  console.log('  3. Slot with dynamic children...');
  {
    const template = `
      <div class="wrapper">
        <slot name="custom">
          <p class="dynamic-fallback">{{ fallbackText }}</p>
          <button @click="handleAction">Retry</button>
        </slot>
      </div>
    `;

    const nodes = ComponentParser.parseHTML(template);
    cp.markStaticNodes(nodes);

    const slotNode = findNode(nodes, (n) => n.tagName === 'slot');
    assert.ok(slotNode, 'slot must exist');
    assert.strictEqual(slotNode.isStatic, false, 'slot with dynamic children must be dynamic');

    const pNode = findNode(nodes, (n) => n.attrs?.class === 'dynamic-fallback');
    assert.ok(pNode, 'interpolated p must exist');
    assert.strictEqual(pNode.isStatic, false, 'dynamic child inside slot must be dynamic');

    const buttonNode = findNode(nodes, (n) => n.tagName === 'button');
    assert.ok(buttonNode, 'button with @click must exist');
    assert.strictEqual(buttonNode.isStatic, false, 'event-handling child must be dynamic');

    const wrapper = findNode(nodes, (n) => n.attrs?.class === 'wrapper');
    assert.strictEqual(wrapper.isStatic, false, 'wrapper of slot with dynamic children must be dynamic');
  }

  // -------------------------------------------------------------------------
  // 4. Nested slots (static wrapping dynamic, and vice versa)
  // -------------------------------------------------------------------------
  console.log('  4. Nested slots...');
  {
    const template = `
      <div class="nested-container">
        <aside class="sidebar-static">
          <span>Sidebar</span>
        </aside>
        <section class="slot-hierarchy">
          <slot name="outer">
            <div class="nested-wrapper">
              <slot name="inner">
                <span class="deep-fallback">Deep default</span>
              </slot>
            </div>
          </slot>
        </section>
      </div>
    `;

    const nodes = ComponentParser.parseHTML(template);
    cp.markStaticNodes(nodes);

    const slots = findAllNodes(nodes, (n) => n.tagName === 'slot');
    assert.strictEqual(slots.length, 2, 'both outer and inner slots must exist');
    for (const s of slots) {
      assert.strictEqual(s.isStatic, false, `slot "${s.attrs?.name}" must be dynamic`);
      assert.strictEqual(s.attrs['data-ax-static'], undefined);
    }

    const nestedWrapper = findNode(nodes, (n) => n.attrs?.class === 'nested-wrapper');
    assert.strictEqual(nestedWrapper.isStatic, false, 'wrapper between nested slots must be dynamic');

    const deepFallback = findNode(nodes, (n) => n.attrs?.class === 'deep-fallback');
    assert.strictEqual(deepFallback.isStatic, false, 'deepest slot fallback must be dynamic');

    const section = findNode(nodes, (n) => n.attrs?.class === 'slot-hierarchy');
    assert.strictEqual(section.isStatic, false, 'section enclosing nested slots must be dynamic');

    const root = findNode(nodes, (n) => n.attrs?.class === 'nested-container');
    assert.strictEqual(root.isStatic, false, 'root enclosing nested slots must be dynamic');

    // Sibling sidebar has no slots and is static
    const sidebar = findNode(nodes, (n) => n.attrs?.class === 'sidebar-static');
    assert.strictEqual(sidebar.isStatic, true, 'sidebar without slots must be static');
    assert.strictEqual(sidebar.attrs['data-ax-static'], 'true');
  }

  // -------------------------------------------------------------------------
  // 5. Conditional and loop-wrapped slots
  // -------------------------------------------------------------------------
  console.log('  5. Conditional and loop-wrapped slots...');
  {
    const template = `
      <div>
        <template data-ax-if="hasHeader">
          <div class="conditional-slot-container">
            <slot name="header">
              <span>Default Header</span>
            </slot>
          </div>
        </template>
        <template data-ax-for="items" data-ax-as="item">
          <div class="loop-slot-container">
            <slot name="item" :row="item">
              <span>Item: {{ item }}</span>
            </slot>
          </div>
        </template>
      </div>
    `;

    const nodes = ComponentParser.parseHTML(template);
    cp.markStaticNodes(nodes);

    const condWrapper = findNode(nodes, (n) => n.attrs?.class === 'conditional-slot-container');
    assert.ok(condWrapper, 'conditional container must exist');
    assert.strictEqual(condWrapper.isStatic, false, 'conditional container must be dynamic');
    assert.strictEqual(condWrapper.attrs['data-ax-static'], undefined);

    const loopWrapper = findNode(nodes, (n) => n.attrs?.class === 'loop-slot-container');
    assert.ok(loopWrapper, 'loop container must exist');
    assert.strictEqual(loopWrapper.isStatic, false, 'loop container must be dynamic');
    assert.strictEqual(loopWrapper.attrs['data-ax-static'], undefined);

    const allSlots = findAllNodes(nodes, (n) => n.tagName === 'slot');
    assert.strictEqual(allSlots.length, 2, 'both conditional and loop slots must exist');
    for (const s of allSlots) {
      assert.strictEqual(s.isStatic, false, 'directive-wrapped slots must be dynamic');
      assert.strictEqual(s.attrs['data-ax-static'], undefined);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Pre-#200 regression behavior verification
  // -------------------------------------------------------------------------
  console.log('  6. Pre-#200 regression behavior verification...');
  {
    // Under pre-#200 logic:
    // A wrapper <div> containing only a static <slot> would have been marked static,
    // freezing transcluded updates in DomPatcher.
    const sample = `
      <div id="ancestor">
        <div id="parent">
          <slot></slot>
        </div>
      </div>
    `;

    const nodes = ComponentParser.parseHTML(sample);
    cp.markStaticNodes(nodes);

    const ancestor = findNode(nodes, (n) => n.attrs?.id === 'ancestor');
    const parent = findNode(nodes, (n) => n.attrs?.id === 'parent');
    const slot = findNode(nodes, (n) => n.tagName === 'slot');

    // Assert that current fix prevents either from being marked static
    assert.strictEqual(slot.isStatic, false, 'slot must never be static');
    assert.strictEqual(parent.isStatic, false, 'parent of slot must never be static (pre-#200 bug)');
    assert.strictEqual(ancestor.isStatic, false, 'ancestor of slot must never be static (pre-#200 bug)');
    assert.strictEqual(parent.attrs['data-ax-static'], undefined);
    assert.strictEqual(ancestor.attrs['data-ax-static'], undefined);
  }

  console.log('  ✅ All slot static/dynamic classification tests passed successfully!');
} catch (err) {
  console.error('  ❌ Slot static/dynamic classification tests failed:');
  console.error(err);
  process.exit(1);
}
