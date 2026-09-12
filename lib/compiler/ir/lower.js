/**
 * @file lower.js
 * @description Lowers the template IR to a render program.
 *
 * ## What a program is now
 *
 * A skeleton, a list of ops, and a list of **blocks**. A block has the same
 * shape as the root -- skeleton, ops, marker counts -- and control flow refers
 * to blocks by index. `<@if>` becomes one op naming its arms; `<@for>` becomes
 * one op naming its body block, its list expression and its key.
 *
 * That is the whole difference from the previous design, and it is what lets a
 * list compile at all. Before, a loop body had no representation: the compiler
 * rewrote it into a `<template data-ax-for>` element and the runtime parsed the
 * body's markup again on every pass. A block is that body, parsed once and
 * cloned per item, with its own ops addressing its own nodes.
 *
 * ## Expressions are indices, not source
 *
 * An op carries `x: 3`, not `x: "cart.total"`. The sources are interned into an
 * array this function returns *beside* the program, the caller compiles them
 * positionally into the component's expression table, and the array itself
 * never reaches the bundle.
 *
 * The previous design keyed the compiled table by the expression's source text,
 * so every expression shipped twice -- once as a key and once as compiled code
 * -- and the contract between compiler and runtime was string identity, which
 * nothing could check. An index is checkable, smaller, and means a program is
 * self-contained: the runtime never needs the template source to work out what
 * a binding meant.
 *
 * ## Scope inside a block
 *
 * A loop body reads names the enclosing component does not declare. The op
 * records the binding names (`as`, `ix`); the runtime derives a scope holding
 * them and evaluates the block's expressions against it. The compiler does not
 * rewrite `item.qty` into anything else, because the name is what the author
 * wrote and what every diagnostic, Atlas edge and trace entry has to keep
 * calling it.
 * @module lib/compiler/ir/lower
 */

import { serializeHTML } from '../parser/htmlTree.js';
import { IRKind, IRRefusal, RefusalReason } from './nodes.js';
import { OpKind, PROGRAM_VERSION } from '../render/program.js';

/**
 * Attribute the runtime resolves bound elements by, before it is stripped.
 * @type {string}
 */
const ELEMENT_MARKER = 'data-axb';

/**
 * Interns strings, returning a stable index per distinct value.
 *
 * Two bindings that read `cart.total` share one compiled closure and one entry,
 * which is the same de-duplication the source-keyed table got for free from
 * being an object. Nothing depends on the de-duplication for correctness; it
 * exists so a template that reads one value in ten places costs one closure.
 */
class Interner {
  constructor() {
    /** @type {Map<string, number>} */
    this.index = new Map();
    /** @type {string[]} */
    this.values = [];
  }

  /**
   * Returns the index for a source string, adding it when new.
   * @param {string} source - The expression or statement source.
   * @returns {number} Its index.
   */
  intern(source) {
    const key = String(source);
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.index.set(key, id);
    this.values.push(key);
    return id;
  }
}

/**
 * Builds one block: a skeleton, its ops, and its marker counts.
 *
 * A block is created for the root fragment and for every fragment control flow
 * owns. Markers are numbered per block because each block is parsed and cloned
 * independently, so ids only have to be unique within one skeleton.
 */
class BlockBuilder {
  /**
   * @param {object} context - The shared lowering context.
   */
  constructor(context) {
    this.context = context;
    /** @type {object[]} */
    this.ops = [];
    this.elements = 0;
    this.texts = 0;
  }

  /**
   * Allocates an element marker on a skeleton node.
   * @param {object} node - The skeleton node being built.
   * @returns {number} The marker id.
   */
  markElement(node) {
    if (node.attrs[ELEMENT_MARKER] === undefined) {
      node.attrs[ELEMENT_MARKER] = String(this.elements++);
    }
    return Number(node.attrs[ELEMENT_MARKER]);
  }

  /**
   * Allocates a text marker and returns the skeleton comment that holds it.
   * @returns {{id: number, node: object}} The marker id and its skeleton node.
   */
  markText() {
    const id = this.texts++;
    return { id, node: { type: 'comment', content: `axt:${id}`, attrs: {}, children: [] } };
  }
}

/**
 * Lowers an IR tree to a render program.
 * @param {object} ir - The root fragment from {@link module:lib/compiler/ir/build}.
 * @param {object} [options] - Lowering options.
 * @param {string[]} [options.voidTags] - Project-specific void tag names.
 * @returns {{program: object|null, expressions: string[], statements: string[],
 *   refusal: {reason: string, detail: string}|null}}
 *   The program plus the sources its indices refer to, or the refusal.
 */
export function lowerToProgram(ir, options = {}) {
  const voidTags = options.voidTags || [];
  const expressions = new Interner();
  const statements = new Interner();
  /** @type {object[]} */
  const blocks = [];

  const context = { expressions, statements, blocks, voidTags };

  /**
   * Lowers a fragment into a new block and returns its index.
   * @param {object} irFragment - The fragment to lower.
   * @returns {number} The block's index in `blocks`.
   */
  function lowerBlock(irFragment) {
    // Reserved before the body is lowered, so a block nested inside this one
    // gets a later index and the array stays append-only. Without the
    // placeholder a nested block would take this block's slot.
    const slotIndex = blocks.length;
    blocks.push(null);

    const builder = new BlockBuilder(context);
    const skeleton = lowerNodes(irFragment.children, builder);

    blocks[slotIndex] = {
      html: serializeHTML(skeleton, voidTags),
      ops: builder.ops,
      elements: builder.elements,
      texts: builder.texts,
    };
    return slotIndex;
  }

  /**
   * Lowers a list of IR nodes into skeleton nodes, emitting ops into `builder`.
   * @param {object[]} nodes - IR nodes.
   * @param {BlockBuilder} builder - The block being built.
   * @returns {object[]} Skeleton nodes.
   */
  function lowerNodes(nodes, builder) {
    const out = [];

    for (const node of nodes) {
      switch (node.kind) {
        case IRKind.TEXT:
          out.push({ type: 'text', content: node.value, attrs: {}, children: [] });
          break;

        case IRKind.COMMENT:
          out.push({ type: 'comment', content: node.value, attrs: {}, children: [] });
          break;

        case IRKind.INTERPOLATION: {
          const marker = builder.markText();
          builder.ops.push({
            k: node.raw ? OpKind.RAW : OpKind.TEXT,
            t: marker.id,
            x: expressions.intern(node.expr),
          });
          out.push(marker.node);
          break;
        }

        case IRKind.ELEMENT:
          out.push(lowerElement(node, builder));
          break;

        case IRKind.COMPONENT:
          out.push(lowerComponent(node, builder));
          break;

        case IRKind.IF:
          out.push(lowerConditional(node, builder));
          break;

        case IRKind.FOR:
          out.push(lowerIteration(node, builder));
          break;

        case IRKind.SLOT:
          out.push(lowerSlot(node, builder));
          break;

        default:
          throw new IRRefusal(RefusalReason.UNKNOWN_DIRECTIVE, `IR node "${node.kind}"`);
      }
    }

    return out;
  }

  /**
   * Emits the ops for one element's bindings and events.
   * @param {object} node - The IR element.
   * @param {object} skeleton - Its skeleton node.
   * @param {BlockBuilder} builder - The block being built.
   */
  function lowerBindings(node, skeleton, builder) {
    for (const binding of node.bindings) {
      const element = builder.markElement(skeleton);

      if (binding.type === 'attrParts') {
        builder.ops.push({
          k: OpKind.ATTR_PARTS,
          e: element,
          a: binding.name,
          p: binding.parts.map((part) =>
            typeof part === 'string' ? part : { x: expressions.intern(part.expr) },
          ),
        });
        continue;
      }

      const kind = {
        attr: OpKind.ATTR,
        bool: OpKind.BOOL,
        show: OpKind.SHOW,
        class: OpKind.CLASS,
        html: OpKind.HTML,
        style: OpKind.STYLE,
      }[binding.type];

      if (!kind) {
        throw new IRRefusal(RefusalReason.UNKNOWN_DIRECTIVE, `binding "${binding.type}"`);
      }

      const op = { k: kind, e: element, x: expressions.intern(binding.expr) };
      if (kind === OpKind.ATTR || kind === OpKind.BOOL) {
        op.a = binding.name;
      }
      builder.ops.push(op);
    }

    for (const event of node.events) {
      builder.ops.push({
        k: OpKind.EVENT,
        e: builder.markElement(skeleton),
        n: event.event,
        m: event.modifiers.length > 0 ? event.modifiers : undefined,
        x: statements.intern(event.expr),
      });
    }
  }

  /**
   * Lowers an element.
   * @param {object} node - The IR element.
   * @param {BlockBuilder} builder - The block being built.
   * @returns {object} The skeleton node.
   */
  function lowerElement(node, builder) {
    const skeleton = {
      type: 'element',
      tagName: node.tag,
      attrs: { ...node.attrs },
      isSelfClosing: node.selfClosing,
      children: [],
      content: '',
    };

    // A subtree the compiler proved static can never produce an op, so it is
    // emitted whole and never descended into. This is where a large static
    // template stops costing anything: no ops, no markers, no walk.
    if (node.isStatic && node.bindings.length === 0 && node.events.length === 0) {
      skeleton.children = lowerStatic(node.children);
      return skeleton;
    }

    lowerBindings(node, skeleton, builder);
    skeleton.children = lowerNodes(node.children, builder);
    return skeleton;
  }

  /**
   * Emits a provably static subtree verbatim.
   * @param {object[]} nodes - IR nodes known to contain nothing dynamic.
   * @returns {object[]} Skeleton nodes.
   */
  function lowerStatic(nodes) {
    return nodes.map((node) => {
      if (node.kind === IRKind.TEXT) {
        return { type: 'text', content: node.value, attrs: {}, children: [] };
      }
      if (node.kind === IRKind.COMMENT) {
        return { type: 'comment', content: node.value, attrs: {}, children: [] };
      }
      if (node.kind === IRKind.ELEMENT) {
        return {
          type: 'element',
          tagName: node.tag,
          attrs: { ...node.attrs },
          isSelfClosing: node.selfClosing,
          children: lowerStatic(node.children),
          content: '',
        };
      }
      // A static mark that turns out to contain something dynamic is a bug in
      // whatever applied the mark, not something to render around.
      throw new IRRefusal(RefusalReason.MALFORMED, `"${node.kind}" inside a subtree marked static`);
    });
  }

  /**
   * Lowers a child component to its mount placeholder plus prop ops.
   *
   * The placeholder keeps the `data-avenx-comp` shape the component mounter
   * already looks for, so composition works through one mechanism rather than
   * two during the migration.
   * @param {object} node - The IR component.
   * @param {BlockBuilder} builder - The block being built.
   * @returns {object} The skeleton node.
   */
  function lowerComponent(node, builder) {
    const skeleton = {
      type: 'element',
      tagName: 'div',
      attrs: { 'data-avenx-comp': node.name },
      isSelfClosing: false,
      children: [],
      content: '',
    };

    for (const prop of node.props) {
      if (prop.kind === 'event') {
        const { event, modifiers } = {
          event: prop.name.slice(1).split('.')[0],
          modifiers: prop.name.slice(1).split('.').slice(1),
        };
        builder.ops.push({
          k: OpKind.EVENT,
          e: builder.markElement(skeleton),
          n: event,
          m: modifiers.length > 0 ? modifiers : undefined,
          x: statements.intern(prop.expr),
        });
        continue;
      }

      if (prop.kind === 'static') {
        // A literal prop never changes, so it is written into the skeleton as
        // the quoted expression the mounter already expects rather than costing
        // an op and an effect per instance.
        skeleton.attrs[`data-props-${prop.name}`] = literalPropExpression(prop.value);
        continue;
      }

      const expr =
        prop.kind === 'parts'
          ? prop.parts
            .map((part) => (typeof part === 'string' ? JSON.stringify(part) : `(${part.expr})`))
            .join(' + ')
          : prop.expr;

      builder.ops.push({
        k: OpKind.PROP,
        e: builder.markElement(skeleton),
        n: prop.name,
        x: expressions.intern(expr),
      });
    }

    skeleton.children = lowerNodes(node.children, builder);
    return skeleton;
  }

  /**
   * Lowers a conditional to an anchor and one op naming its arms.
   * @param {object} node - The IR conditional.
   * @param {BlockBuilder} builder - The block being built.
   * @returns {object} The anchor skeleton node.
   */
  function lowerConditional(node, builder) {
    const marker = builder.markText();
    const arms = node.branches.map((branch) => ({
      x: branch.test === null ? null : expressions.intern(branch.test),
      b: lowerBlock(branch.body),
    }));

    builder.ops.push({ k: OpKind.IF, t: marker.id, arms });
    return marker.node;
  }

  /**
   * Lowers an iteration to an anchor and one op naming its body block.
   * @param {object} node - The IR iteration.
   * @param {BlockBuilder} builder - The block being built.
   * @returns {object} The anchor skeleton node.
   */
  function lowerIteration(node, builder) {
    const marker = builder.markText();
    const op = {
      k: OpKind.FOR,
      t: marker.id,
      x: expressions.intern(node.list),
      as: node.item,
      b: lowerBlock(node.body),
    };
    if (node.index) op.ix = node.index;
    if (node.key) op.key = expressions.intern(node.key);
    if (node.empty) op.emp = lowerBlock(node.empty);

    builder.ops.push(op);
    return marker.node;
  }

  /**
   * Lowers a slot outlet to an anchor and one op.
   * @param {object} node - The IR slot.
   * @param {BlockBuilder} builder - The block being built.
   * @returns {object} The anchor skeleton node.
   */
  function lowerSlot(node, builder) {
    const marker = builder.markText();
    const op = { k: OpKind.SLOT, t: marker.id, n: node.name };
    if (node.fallback) op.b = lowerBlock(node.fallback);

    builder.ops.push(op);
    return marker.node;
  }

  try {
    const rootBuilder = new BlockBuilder(context);
    const skeleton = lowerNodes(ir.children, rootBuilder);

    const program = {
      v: PROGRAM_VERSION,
      html: serializeHTML(skeleton, voidTags),
      ops: rootBuilder.ops,
      elements: rootBuilder.elements,
      texts: rootBuilder.texts,
    };
    // Omitted when empty rather than emitted as `[]`. A template with no
    // control flow is the common case, and `programBlocks` already treats an
    // absent array as none.
    if (blocks.length > 0) {
      program.blocks = blocks;
    }

    return {
      program,
      expressions: expressions.values,
      statements: statements.values,
      refusal: null,
    };
  } catch (error) {
    if (error instanceof IRRefusal) {
      return { program: null, expressions: [], statements: [], refusal: { reason: error.reason, detail: error.detail } };
    }
    throw error;
  }
}

/**
 * Renders a literal prop value as the expression source the mounter expects.
 *
 * The component mounter evaluates `data-props-*` as an expression, so a literal
 * has to arrive quoted -- except for the four literals that mean themselves.
 * @param {string} value - The attribute value as written.
 * @returns {string} An expression source.
 */
function literalPropExpression(value) {
  const trimmed = String(value).trim();
  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    (trimmed !== '' && !Number.isNaN(Number(trimmed)))
  ) {
    return trimmed;
  }
  return `'${trimmed.replace(/'/g, "\\'")}'`;
}
