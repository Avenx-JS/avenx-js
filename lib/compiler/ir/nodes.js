/**
 * @file nodes.js
 * @description The template intermediate representation, and the vocabulary the
 * front and back halves of the compiler agree on.
 *
 * ## Why an IR exists
 *
 * Avenx used to compile a template by rewriting it into different markup.
 * `<@for item in items>` became `<template data-ax-for="items"
 * data-ax-as="item">`, `<@suspense>` became `<div data-ax-suspense>`, and the
 * runtime rediscovered what each of them meant by reading those attributes back
 * off the live DOM with `querySelectorAll`.
 *
 * That is a compiler that throws its own analysis away. Every consequence
 * followed from it: the render-program backend could not compile a list,
 * because by the time it ran the list was an anonymous `<template>` element
 * carrying strings; the runtime had to ship a second renderer to interpret
 * those attributes; and a `>` inside a header expression broke the rewrite
 * because a regex was the only thing left that could read it.
 *
 * The IR is where a construct's meaning is written down instead. A `<@for>`
 * becomes a {@link ForNode} with a list expression, a binding name, an optional
 * key and two child fragments. Nothing downstream has to guess, and nothing has
 * to parse markup a second time.
 *
 * ## The shape, and why fragments are explicit
 *
 * A {@link FragmentNode} is a compile boundary: each one becomes its own
 * skeleton and its own op list in the emitted program, and its own DOM range at
 * run time. Control flow owns fragments rather than containing raw children,
 * because "the body of this loop" is exactly the unit that gets cloned per item
 * and torn down per removal. Making that unit implicit is how a list renderer
 * ends up re-deriving its own boundaries.
 *
 * ## Extension
 *
 * Adding a construct means adding a kind here, a builder case in
 * {@link module:lib/compiler/ir/build}, and a lowering case in
 * {@link module:lib/compiler/ir/lower}. A construct with no lowering case is
 * refused with its own reason rather than silently mis-emitted, which is the
 * same compile-or-refuse rule the render program has always followed -- moved
 * one layer earlier, where the reason is still specific enough to be useful.
 * @module lib/compiler/ir/nodes
 */

/**
 * IR node kinds.
 * @enum {string}
 */
export const IRKind = {
  /** An ordered list of children forming one compile and DOM boundary. */
  FRAGMENT: 'fragment',
  /** A literal element. */
  ELEMENT: 'element',
  /** Literal character data. */
  TEXT: 'text',
  /** A `{{ }}` or `{{{ }}}` interpolation. */
  INTERPOLATION: 'interpolation',
  /** An HTML comment preserved in the output. */
  COMMENT: 'comment',
  /** Conditional rendering: `<@if>` / `<@elseif>` / `<@else>`. */
  IF: 'if',
  /** Iteration: `<@for>` / `<@empty>`. */
  FOR: 'for',
  /** A child component instantiation. */
  COMPONENT: 'component',
  /** A `<slot>` outlet. */
  SLOT: 'slot',
};

/**
 * Kinds of value binding an element can carry.
 * @enum {string}
 */
export const BindingKind = {
  /** `attr="{{ expr }}"` -- the whole value is one expression. */
  ATTR: 'attr',
  /** `attr="a {{ b }} c"` -- literal and expression parts. */
  ATTR_PARTS: 'attrParts',
  /** A boolean attribute driven by an expression's truthiness. */
  BOOL: 'bool',
  /** `data-ax-show` -- toggles `display`. */
  SHOW: 'show',
  /** `data-ax-class` -- string or object class binding. */
  CLASS: 'class',
  /** `data-ax-html` -- replaces inner HTML. */
  HTML: 'html',
  /** `data-ax-style` -- string or object inline style binding. */
  STYLE: 'style',
  /** A prop passed to a child component. */
  PROP: 'prop',
};

/**
 * Why a template, or part of one, could not be represented in the IR.
 *
 * These are the constructs the IR does not model yet. They are enumerated
 * rather than free text so a build can group them, and so a reader can tell
 * "not implemented" from "gave up".
 * @enum {string}
 */
export const RefusalReason = {
  SUSPENSE: 'a <@suspense> boundary',
  ERROR_BOUNDARY: 'an <@errorBoundary>',
  DEADLOCK: 'a <@deadlock> boundary',
  DEFER: 'a <@defer> block',
  TRANSITION: 'a transition',
  RESOURCE: 'a <resource> declaration in the template',
  DYNAMIC_COMPONENT: 'a dynamic component tag',
  DYNAMIC_ATTR: 'a dynamic attribute name',
  ROUTER_VIEW: 'a router view',
  VALIDATION: 'declarative form validation',
  REF: 'a template ref',
  VIRTUAL_LIST: 'a virtualised list',
  MALFORMED: 'a malformed template',
  UNKNOWN_DIRECTIVE: 'an unrecognised directive',
};

/**
 * A construct the IR builder declined to represent.
 *
 * Thrown rather than returned because a refusal aborts the whole template --
 * there is no partial IR. A half-built IR would describe a template that does
 * not exist.
 */
export class IRRefusal extends Error {
  /**
   * @param {string} reason - A {@link RefusalReason}.
   * @param {string} detail - What in the template caused it.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.name = 'IRRefusal';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Creates a fragment.
 * @param {object[]} [children] - Child IR nodes.
 * @returns {object} The fragment node.
 */
export function fragment(children = []) {
  return { kind: IRKind.FRAGMENT, children };
}

/**
 * Creates a literal text node.
 * @param {string} value - The character data.
 * @returns {object} The text node.
 */
export function text(value) {
  return { kind: IRKind.TEXT, value };
}

/**
 * Creates an interpolation node.
 * @param {string} expr - The expression source.
 * @param {boolean} [raw] - True for `{{{ }}}`, which inserts markup.
 * @returns {object} The interpolation node.
 */
export function interpolation(expr, raw = false) {
  return { kind: IRKind.INTERPOLATION, expr, raw };
}

/**
 * Creates a comment node.
 * @param {string} value - The comment body.
 * @returns {object} The comment node.
 */
export function comment(value) {
  return { kind: IRKind.COMMENT, value };
}

/**
 * Creates an element node.
 * @param {string} tag - The tag name.
 * @param {object} [options] - Element parts.
 * @param {Object<string,string>} [options.attrs] - Static attributes.
 * @param {object[]} [options.bindings] - Value bindings.
 * @param {object[]} [options.events] - Event bindings.
 * @param {object[]} [options.children] - Child nodes.
 * @param {boolean} [options.selfClosing] - Whether the tag is void or self-closed.
 * @param {boolean} [options.isStatic] - Whether the subtree provably never changes.
 * @returns {object} The element node.
 */
export function element(tag, options = {}) {
  return {
    kind: IRKind.ELEMENT,
    tag,
    attrs: options.attrs || {},
    bindings: options.bindings || [],
    events: options.events || [],
    children: options.children || [],
    selfClosing: options.selfClosing === true,
    isStatic: options.isStatic === true,
  };
}

/**
 * Creates a conditional node.
 *
 * Branches are ordered and the first whose test is truthy renders. A branch
 * with a null test is the `<@else>` and may only appear last; the builder
 * enforces that, so nothing downstream has to re-check it.
 * @param {Array<{test: string|null, body: object}>} branches - Ordered branches.
 * @returns {object} The conditional node.
 */
export function conditional(branches) {
  return { kind: IRKind.IF, branches };
}

/**
 * Creates an iteration node.
 *
 * Exactly one of `item` and `destructure` is set: the first for `x in xs`, the
 * second for `[a, b] in pairs`, which destructures each element rather than
 * binding an index. The index is bound implicitly under the name `index` by
 * the runtime and is therefore not part of the node.
 * @param {object} parts - Loop parts.
 * @param {string} parts.list - The list expression source.
 * @param {string|null} parts.item - The name bound to each element.
 * @param {string[]|null} parts.destructure - Names each element is destructured into.
 * @param {string|null} parts.key - The key expression source, when declared.
 * @param {object} parts.body - The per-item fragment.
 * @param {object|null} parts.empty - The fragment rendered for an empty list.
 * @returns {object} The iteration node.
 */
export function iteration(parts) {
  return {
    kind: IRKind.FOR,
    list: parts.list,
    item: parts.item || null,
    destructure: parts.destructure || null,
    key: parts.key || null,
    body: parts.body,
    empty: parts.empty || null,
  };
}

/**
 * Creates a child-component node.
 * @param {string} name - The component's registered PascalCase name.
 * @param {object} [options] - Component parts.
 * @param {object[]} [options.props] - Static and bound props.
 * @param {object[]} [options.children] - Transcluded content.
 * @returns {object} The component node.
 */
export function component(name, options = {}) {
  return {
    kind: IRKind.COMPONENT,
    name,
    props: options.props || [],
    children: options.children || [],
  };
}

/**
 * Creates a slot outlet.
 * @param {string} name - The slot name; `default` when unnamed.
 * @param {object} [fallbackFragment] - Content rendered when nothing is transcluded.
 * @returns {object} The slot node.
 */
export function slot(name, fallbackFragment = null) {
  return { kind: IRKind.SLOT, name, fallback: fallbackFragment };
}

/**
 * Whether a node introduces its own compile and DOM boundary.
 *
 * Control flow does; an element does not. Used by the lowering pass to decide
 * where one skeleton ends and the next begins.
 * @param {object} node - An IR node.
 * @returns {boolean} True when the node owns fragments.
 */
export function isBlockNode(node) {
  return node && (node.kind === IRKind.IF || node.kind === IRKind.FOR || node.kind === IRKind.SLOT);
}

/**
 * Walks every node in an IR tree, depth first, including fragment bodies.
 * @param {object} node - The root node.
 * @param {function(object, object|null): void} visit - Called with each node and its parent.
 * @param {object|null} [parent] - The parent, for recursive calls.
 */
export function walkIR(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent);

  if (Array.isArray(node.children)) {
    for (const child of node.children) walkIR(child, visit, node);
  }
  if (node.kind === IRKind.IF) {
    for (const branch of node.branches) walkIR(branch.body, visit, node);
  }
  if (node.kind === IRKind.FOR) {
    walkIR(node.body, visit, node);
    if (node.empty) walkIR(node.empty, visit, node);
  }
  if (node.kind === IRKind.SLOT && node.fallback) {
    walkIR(node.fallback, visit, node);
  }
}
