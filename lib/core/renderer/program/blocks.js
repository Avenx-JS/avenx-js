/**
 * @file blocks.js
 * @description The runtime half of control flow: conditionals, lists and slots.
 *
 * ## What these replace
 *
 * Control flow used to live in the runtime as a search. `ListManager` ran
 * `root.querySelectorAll('template[data-ax-for]')` on every update, read the
 * list expression out of an attribute, unescaped the body markup, rendered it
 * to a string per item and diffed the result into the document. The runtime was
 * doing the compiler's job, once per update, with a string as the only record
 * of what the author had written.
 *
 * A compiled block arrives already understood. `{ k: 'for', x: 4, as: 'row',
 * key: 7, b: 2 }` says: evaluate expression 4, bind each element to `row`,
 * identify rows by expression 7, and render block 2 for each. Block 2 is a
 * skeleton parsed once for the life of the page and cloned per row, with its
 * own ops writing to its own nodes.
 *
 * ## Anchors, and why each binding owns a range
 *
 * Every construct here occupies a *range* of sibling nodes rather than one
 * node, and the range is empty for a false condition or an empty list. So the
 * compiler reserves a text anchor at the position, and the binding inserts
 * after it and remembers exactly what it inserted.
 *
 * Remembering matters: clearing by emptying the parent would take the siblings
 * that belong to other bindings, which is the bug that makes two adjacent
 * `<@if>` blocks erase each other.
 *
 * ## Reconciliation
 *
 * The list binding is keyed. Entries are matched by key, reused in place, moved
 * with the cursor as the new order is walked, and torn down when their key
 * disappears. An unkeyed list falls back to the item's position, which is the
 * documented behaviour and is why keys matter for a list that reorders.
 *
 * ## Why the instance factory is injected
 *
 * A block is rendered by a `TemplateInstance`, and a `TemplateInstance` creates
 * these bindings for its range ops. Importing the class here would make that
 * mutual, and the bundler refuses a cycle rather than relying on which half
 * happens to initialise first. The owner passes a factory instead, so the
 * dependency runs one way.
 * @module lib/core/renderer/program/blocks
 */

/**
 * Merges a parent block's local bindings with a child's.
 *
 * A loop inside a loop reads both bindings, so locals chain rather than
 * replace. The merge is a copy because a reused entry's values are written in
 * place, and sharing one object between entries would make every row show the
 * last row's values.
 * @param {object|null} parent - The enclosing block's locals.
 * @param {object|null} own - This block's own bindings.
 * @returns {object|null} The merged locals.
 */
function mergeLocals(parent, own) {
  if (!own) return parent;
  if (!parent) return own;
  return { ...parent, ...own };
}

/**
 * Collects the top-level nodes of a fragment before it is inserted.
 *
 * Read before insertion because a fragment is emptied by `insertBefore`, and
 * the binding needs the list to remove exactly these nodes later.
 * @param {DocumentFragment} fragment - The fragment about to be inserted.
 * @returns {Node[]} Its top-level nodes, in order.
 */
function fragmentNodes(fragment) {
  const nodes = [];
  for (let child = fragment.firstChild; child; child = child.nextSibling) {
    nodes.push(child);
  }
  return nodes;
}

/**
 * One rendered block: its instance and the nodes it put in the document.
 */
class BlockRange {
  /**
   * @param {object} block - The block program.
   * @param {function(object, object|null): object} createInstance - Builds a
   *   template instance for a block.
   * @param {object|null} locals - Local bindings for this block's expressions.
   */
  constructor(block, createInstance, locals) {
    /** @type {object} */
    this.instance = createInstance(block, locals);
    /** @type {Node[]} */
    this.nodes = [];
    /** @type {object|null} */
    this.locals = locals;
  }

  /**
   * Whether the block could be prepared in this host environment.
   * @returns {boolean} True when it can be mounted.
   */
  get usable() {
    return this.instance.usable;
  }

  /**
   * Creates the block's DOM and inserts it after `after`.
   * @param {Node} parent - The parent node.
   * @param {Node} after - The node to insert after.
   * @returns {Node} The last node inserted, for chaining.
   */
  mount(parent, after) {
    const fragment = this.instance.create();
    if (!fragment) return after;
    this.nodes = fragmentNodes(fragment);
    parent.insertBefore(fragment, after.nextSibling);
    return this.nodes.length > 0 ? this.nodes[this.nodes.length - 1] : after;
  }

  /**
   * Moves this block's nodes so they follow `after`, preserving their order.
   * @param {Node} parent - The parent node.
   * @param {Node} after - The node to follow.
   * @returns {Node} The last node of this range.
   */
  moveAfter(parent, after) {
    let cursor = after;
    for (const node of this.nodes) {
      if (node.previousSibling !== cursor) {
        parent.insertBefore(node, cursor.nextSibling);
      }
      cursor = node;
    }
    return cursor;
  }

  /**
   * Removes this block's nodes and releases its effects.
   */
  dispose() {
    for (const node of this.nodes) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    this.nodes = [];
    this.instance.dispose();
  }
}

/**
 * The state one range op keeps between evaluations.
 *
 * Held on the binding rather than in a map keyed by op, so it is released with
 * the instance and cannot outlive the DOM it refers to.
 */
export class RangeBinding {
  /**
   * @param {Text} anchor - The text node the compiler reserved for this op.
   * @param {function(object, object|null): object} createInstance - Builds a
   *   template instance for a block.
   * @param {object[]} blocks - The program's block table.
   * @param {object|null} locals - The enclosing block's local bindings.
   * @param {function(): void|null} [onBlockMounted] - Announces a mounted block.
   */
  constructor(anchor, createInstance, blocks, locals, onBlockMounted = null) {
    this.anchor = anchor;
    this.createInstance = createInstance;
    this.blocks = blocks;
    this.locals = locals;
    /**
     * Called after a block's nodes enter the document.
     *
     * A block can contain a child-component mount point, and the pass that
     * instantiates those scans the subtree -- so it has to be told that the
     * subtree grew. Without this a component inside `<@for>`, `<@if>` or
     * `<@defer>` renders its placeholder and never mounts, which is exactly
     * the defect the E2E suite pinned for `<@defer>`.
     * @type {function(): void|null}
     */
    this.onBlockMounted = onBlockMounted;
  }

  /**
   * Mounts a range and announces it.
   * @param {BlockRange} range - The range to mount.
   * @param {Node} parent - The parent node.
   * @param {Node} after - The node to insert after.
   * @returns {Node} The last node inserted.
   */
  mountRange(range, parent, after) {
    const last = range.mount(parent, after);
    if (this.onBlockMounted) this.onBlockMounted();
    return last;
  }

  /**
   * The node new content is inserted into.
   * @returns {Node|null} The anchor's parent.
   */
  get parent() {
    return this.anchor ? this.anchor.parentNode : null;
  }

  /**
   * Builds a range for one block index.
   * @param {number} index - The block index.
   * @param {object|null} extra - Local bindings this block adds.
   * @returns {BlockRange|null} The range, or null when the index is absent.
   */
  createRange(index, extra = null) {
    const block = this.blocks[index];
    if (!block) return null;
    const range = new BlockRange(block, this.createInstance, mergeLocals(this.locals, extra));
    return range.usable ? range : null;
  }
}

/**
 * Renders the first arm whose test is truthy.
 */
export class IfBinding extends RangeBinding {
  /**
   * @param {Text} anchor - The op's anchor.
   * @param {function(object, object|null): object} createInstance - Builds a
   *   template instance for a block.
   * @param {object[]} blocks - The program's block table.
   * @param {object|null} locals - The enclosing block's local bindings.
   * @param {function(): void|null} [onBlockMounted] - Announces a mounted block.
   */
  constructor(anchor, createInstance, blocks, locals, onBlockMounted) {
    super(anchor, createInstance, blocks, locals, onBlockMounted);
    /** @type {number} */
    this.activeArm = -1;
    /** @type {BlockRange|null} */
    this.range = null;
  }

  /**
   * Selects and renders the matching arm.
   * @param {Array<{x: number|null, b: number}>} arms - The op's arms, in order.
   * @param {function(number): any} evaluate - Evaluates an expression index.
   */
  update(arms, evaluate) {
    let selected = -1;
    for (let i = 0; i < arms.length; i++) {
      // A null test is the `<@else>`, which the compiler guarantees is last.
      if (arms[i].x === null || evaluate(arms[i].x)) {
        selected = i;
        break;
      }
    }

    // Re-rendering an arm that is already showing would tear down live DOM --
    // losing focus, selection and scroll position -- for a condition that did
    // not change. The arm index is the whole comparison: within an arm the
    // block's own bindings keep themselves current.
    if (selected === this.activeArm) return;

    this.activeArm = selected;
    if (this.range) {
      this.range.dispose();
      this.range = null;
    }
    if (selected === -1) return;

    const parent = this.parent;
    if (!parent) return;

    this.range = this.createRange(arms[selected].b);
    if (this.range) {
      this.mountRange(this.range, parent, this.anchor);
    }
  }

  /**
   * Releases the rendered arm.
   */
  dispose() {
    if (this.range) {
      this.range.dispose();
      this.range = null;
    }
    this.activeArm = -1;
  }
}

/**
 * Renders one copy of a block per list element, reconciled by key.
 */
export class ForBinding extends RangeBinding {
  /**
   * @param {Text} anchor - The op's anchor.
   * @param {function(object, object|null): object} createInstance - Builds a
   *   template instance for a block.
   * @param {object[]} blocks - The program's block table.
   * @param {object|null} locals - The enclosing block's local bindings.
   * @param {function(): void|null} [onBlockMounted] - Announces a mounted block.
   */
  constructor(anchor, createInstance, blocks, locals, onBlockMounted) {
    super(anchor, createInstance, blocks, locals, onBlockMounted);
    /** @type {Array<{key: any, range: BlockRange}>} */
    this.entries = [];
    /** @type {BlockRange|null} */
    this.emptyRange = null;
  }

  /**
   * Renders the list.
   * @param {object} op - The `for` op.
   * @param {function(number, object|null): any} evaluate - Evaluates an
   *   expression index against optional local bindings.
   */
  update(op, evaluate) {
    const parent = this.parent;
    if (!parent) return;

    const raw = evaluate(op.x, this.locals);
    const items = normaliseList(raw);

    if (items.length === 0) {
      this.#clearEntries();
      this.#showEmpty(op, parent);
      return;
    }

    this.#hideEmpty();

    /** @type {Map<any, {key: any, range: BlockRange}>} */
    const previous = new Map();
    for (const entry of this.entries) {
      // A duplicate key means two rows claim one identity. The first wins and
      // the second is rebuilt, which is what keeps the DOM consistent with the
      // list; the compiler reports duplicate keys separately.
      if (!previous.has(entry.key)) previous.set(entry.key, entry);
    }

    /** @type {Array<{key: any, range: BlockRange}>} */
    const next = [];
    let cursor = this.anchor;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // `index` is bound for every loop, named or not, because that is how the
      // loop index has always been reached and applications depend on it.
      const locals = { index: i };
      if (op.ds) {
        // `[a, b] in pairs` destructures the element itself. An element that is
        // not indexable binds undefined rather than throwing: a list that has
        // not loaded its shape yet is a normal state of a list.
        for (let slot = 0; slot < op.ds.length; slot++) {
          locals[op.ds[slot]] = item ? item[slot] : undefined;
        }
      } else {
        locals[op.as] = item;
      }

      const key = op.key === undefined ? i : evaluate(op.key, mergeLocals(this.locals, locals));

      const reused = previous.get(key);
      if (reused) {
        previous.delete(key);
        // The row kept its identity but may have a new value or a new position,
        // so the locals are written before the nodes move and the instance is
        // refreshed only when something it reads actually changed.
        const changed = applyLocals(reused.range.instance, locals);
        cursor = reused.range.moveAfter(parent, cursor);
        if (changed) reused.range.instance.refresh();
        next.push(reused);
        continue;
      }

      const range = this.createRange(op.b, locals);
      if (!range) continue;
      cursor = this.mountRange(range, parent, cursor);
      next.push({ key, range });
    }

    for (const stale of previous.values()) {
      stale.range.dispose();
    }
    this.entries = next;
  }

  /**
   * Renders the `<@empty>` block, if the loop declared one.
   * @param {object} op - The `for` op.
   * @param {Node} parent - The anchor's parent.
   * @private
   */
  #showEmpty(op, parent) {
    if (op.emp === undefined || this.emptyRange) return;
    this.emptyRange = this.createRange(op.emp);
    if (this.emptyRange) {
      this.mountRange(this.emptyRange, parent, this.anchor);
    }
  }

  /**
   * Removes the `<@empty>` block.
   * @private
   */
  #hideEmpty() {
    if (!this.emptyRange) return;
    this.emptyRange.dispose();
    this.emptyRange = null;
  }

  /**
   * Removes every rendered row.
   * @private
   */
  #clearEntries() {
    for (const entry of this.entries) {
      entry.range.dispose();
    }
    this.entries = [];
  }

  /**
   * Releases every row and the empty block.
   */
  dispose() {
    this.#clearEntries();
    this.#hideEmpty();
  }
}

/**
 * Renders transcluded content, or the slot's fallback block.
 *
 * Transclusion itself is still owned by the component mounter, which knows what
 * the parent passed down. This binding owns the position and the fallback, and
 * reports the anchor so the mounter can place content at it.
 */
export class SlotBinding extends RangeBinding {
  /**
   * @param {Text} anchor - The op's anchor.
   * @param {function(object, object|null): object} createInstance - Builds a
   *   template instance for a block.
   * @param {object[]} blocks - The program's block table.
   * @param {object|null} locals - The enclosing block's local bindings.
   * @param {function(): void|null} [onBlockMounted] - Announces a mounted block.
   */
  constructor(anchor, createInstance, blocks, locals, onBlockMounted) {
    super(anchor, createInstance, blocks, locals, onBlockMounted);
    /** @type {BlockRange|null} */
    this.fallbackRange = null;
    /** @type {boolean} */
    this.filled = false;
  }

  /**
   * Renders the fallback when nothing has been transcluded into this slot.
   * @param {object} op - The `slot` op.
   */
  update(op) {
    const parent = this.parent;
    if (!parent) return;

    if (this.filled || op.b === undefined) {
      if (this.fallbackRange) {
        this.fallbackRange.dispose();
        this.fallbackRange = null;
      }
      return;
    }

    if (this.fallbackRange) return;
    this.fallbackRange = this.createRange(op.b);
    if (this.fallbackRange) {
      this.mountRange(this.fallbackRange, parent, this.anchor);
    }
  }

  /**
   * Releases the fallback.
   */
  dispose() {
    if (this.fallbackRange) {
      this.fallbackRange.dispose();
      this.fallbackRange = null;
    }
  }
}

/**
 * Writes new local bindings into a mounted instance.
 * @param {object} instance - The instance to update.
 * @param {object} locals - The new bindings.
 * @returns {boolean} True when any bound value changed.
 */
function applyLocals(instance, locals) {
  const target = instance.locals;
  if (!target) return false;

  let changed = false;
  for (const [name, value] of Object.entries(locals)) {
    if (target[name] !== value) {
      target[name] = value;
      changed = true;
    }
  }
  return changed;
}

/**
 * Coerces whatever a list expression returned into an array of elements.
 *
 * Arrays pass through. A `Map` or `Set` iterates. A plain object iterates its
 * own values, which is what `<@for value in someObject>` has always meant.
 * Anything else -- null, a number, a string that was not meant to be iterated
 * -- renders nothing rather than throwing, because a list that has not loaded
 * yet is the normal state of a list, not an error.
 * @param {any} value - The evaluated list expression.
 * @returns {any[]} The elements to render.
 */
function normaliseList(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  if (value instanceof Set) return Array.from(value);
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

/**
 * Renders a block once its trigger fires.
 *
 * `<@defer>` had two pinned defects, and both were consequences of it living in
 * markup. The deferred content was a `<div data-ax-defer>` the runtime searched
 * for on every update: a component inside it rendered a placeholder that
 * nothing ever mounted, because the mounting pass ran before the content
 * existed and was never told it appeared; and any unrelated state change
 * re-rendered the enclosing template, which replaced the container and threw
 * away the trigger that had been attached to it.
 *
 * A block has neither problem by construction. It is owned by its binding
 * rather than by a diff, so an unrelated update cannot touch it, and mounting
 * is announced through the same hook every other block uses.
 */
export class DeferBinding extends RangeBinding {
  /**
   * @param {Text} anchor - The op's anchor.
   * @param {function(object, object|null): object} createInstance - Builds a
   *   template instance for a block.
   * @param {object[]} blocks - The program's block table.
   * @param {object|null} locals - The enclosing block's local bindings.
   * @param {function(): void|null} [onBlockMounted] - Announces a mounted block.
   */
  constructor(anchor, createInstance, blocks, locals, onBlockMounted) {
    super(anchor, createInstance, blocks, locals, onBlockMounted);
    /** @type {BlockRange|null} */
    this.range = null;
    /** @type {BlockRange|null} */
    this.placeholderRange = null;
    /** @type {boolean} */
    this.armed = false;
    /** @type {Array<function(): void>} */
    this.teardowns = [];
  }

  /**
   * Arms the trigger, or renders immediately when an expression trigger is true.
   * @param {object} op - The `defer` op.
   * @param {function(number, object|null): any} evaluate - Evaluates an expression index.
   */
  update(op, evaluate) {
    // An expression trigger is the one kind that is reactive: it is evaluated
    // here, inside the op's own effect, so it re-runs when what it reads
    // changes. Every other trigger is a one-time subscription to something
    // outside the reactive graph and is armed exactly once.
    this.#showPlaceholder(op);

    if (op.x !== undefined) {
      if (!this.range && evaluate(op.x, this.locals)) {
        this.#reveal(op);
      }
      return;
    }

    if (this.armed) return;
    this.armed = true;
    this.#arm(op);
  }

  /**
   * Subscribes to the declared trigger.
   * @param {object} op - The `defer` op.
   * @private
   */
  #arm(op) {
    const when = String(op.when || 'idle').toLowerCase();
    const reveal = () => this.#reveal(op);

    // `timer(1500)` and `1500ms` are both documented spellings of the same
    // trigger, and both read their delay from the first number in the value.
    if (when.startsWith('timer(') || when.endsWith('ms')) {
      const digits = when.match(/(\d+)/);
      const handle = setTimeout(reveal, digits ? Number(digits[1]) : 1000);
      this.teardowns.push(() => clearTimeout(handle));
      return;
    }

    if (when === 'visible') {
      this.#armVisible(reveal);
      return;
    }

    if (when === 'interaction' || when === 'hover' || when === 'click') {
      this.#armInteraction(when, reveal);
      return;
    }

    // `idle`, and anything unrecognised. Falling back to idle rather than
    // refusing keeps a typo from leaving content that never appears at all.
    // Read off globalThis rather than named directly: requestIdleCallback is
    // absent in Node, in happy-dom and in Safari before 17, and a bare
    // reference to a missing global is a ReferenceError rather than undefined.
    const idle = globalThis.requestIdleCallback;
    if (typeof idle === 'function') {
      const handle = idle(reveal);
      this.teardowns.push(() => {
        const cancel = globalThis.cancelIdleCallback;
        if (typeof cancel === 'function') cancel(handle);
      });
      return;
    }
    const handle = setTimeout(reveal, 0);
    this.teardowns.push(() => clearTimeout(handle));
  }

  /**
   * Reveals when the anchor's position scrolls into view.
   * @param {function(): void} reveal - Renders the block.
   * @private
   */
  #armVisible(reveal) {
    // The placeholder marks where the content will be, so that is what is
    // watched. Watching the anchor's parent would watch whatever element
    // happens to enclose the directive -- often the page root, which is
    // intersecting from the first frame, and the content would appear
    // immediately however far down the page it sat.
    const target = this.#observableTarget();
    if (!target || typeof IntersectionObserver !== 'function') {
      // Without an observer the honest choice is to show the content rather
      // than hide it behind a capability the host does not have.
      reveal();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        reveal();
      }
    });
    observer.observe(target);
    this.teardowns.push(() => observer.disconnect());
  }

  /**
   * The element whose position stands for the deferred content's position.
   * @returns {Element|null} The placeholder's first element, or the anchor's parent.
   * @private
   */
  #observableTarget() {
    if (this.placeholderRange) {
      const element = this.placeholderRange.nodes.find((node) => node.nodeType === 1);
      if (element) return element;
    }
    return this.parent;
  }

  /**
   * Reveals on the first pointer interaction with the surrounding element.
   * @param {string} when - The trigger name.
   * @param {function(): void} reveal - Renders the block.
   * @private
   */
  #armInteraction(when, reveal) {
    // The placeholder is what the user sees and therefore what they interact
    // with; the anchor's parent is only the fallback when none was declared.
    const parent = this.#observableTarget();
    if (!parent || typeof parent.addEventListener !== 'function') {
      reveal();
      return;
    }
    const events = when === 'hover' ? ['mouseenter'] : when === 'click' ? ['click'] : ['click', 'mouseenter'];
    const listener = () => {
      for (const name of events) parent.removeEventListener(name, listener);
      reveal();
    };
    for (const name of events) parent.addEventListener(name, listener);
    this.teardowns.push(() => {
      for (const name of events) parent.removeEventListener(name, listener);
    });
  }

  /**
   * Renders the deferred block, once.
   * @param {object} op - The `defer` op.
   * @private
   */
  #reveal(op) {
    if (this.range) return;
    const parent = this.parent;
    if (!parent) return;

    // The placeholder goes first, so the deferred content lands at the anchor
    // rather than after whatever the placeholder left behind.
    if (this.placeholderRange) {
      this.placeholderRange.dispose();
      this.placeholderRange = null;
    }

    this.range = this.createRange(op.b);
    if (this.range) {
      this.mountRange(this.range, parent, this.anchor);
    }
  }

  /**
   * Renders the `<@placeholder>` block, if the directive declared one.
   * @param {object} op - The `defer` op.
   * @private
   */
  #showPlaceholder(op) {
    if (this.range || this.placeholderRange || op.ph === undefined) return;
    const parent = this.parent;
    if (!parent) return;
    this.placeholderRange = this.createRange(op.ph);
    if (this.placeholderRange) {
      this.mountRange(this.placeholderRange, parent, this.anchor);
    }
  }

  /**
   * Releases the trigger and the rendered block.
   */
  dispose() {
    for (const teardown of this.teardowns) teardown();
    this.teardowns = [];
    if (this.placeholderRange) {
      this.placeholderRange.dispose();
      this.placeholderRange = null;
    }
    if (this.range) {
      this.range.dispose();
      this.range = null;
    }
  }
}
