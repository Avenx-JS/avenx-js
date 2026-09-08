/**
 * @file program.js
 * @description The shape of a compiled render program, and the vocabulary the
 * compiler and the runtime agree on.
 *
 * ## Why a program at all
 *
 * The previous rendering contract between the compiler and the runtime was a
 * single string: the compiler handed over a template with `{{ }}` still in it,
 * and the runtime worked out what that meant on every update. Working it out
 * meant interpolating the whole template into HTML, handing that HTML to
 * `DOMParser`, and diffing the resulting tree against the live DOM — so the
 * cost of changing one value was proportional to the size of the template, and
 * the runtime had to carry a template engine to pay it.
 *
 * None of that work depends on runtime values. Which text nodes are dynamic,
 * which attributes are bound, which elements carry an event handler, and which
 * subtrees can never change are all properties of the template, and the
 * compiler already has the template. A render program is the compiler writing
 * those answers down once, so the runtime can stop rediscovering them.
 *
 * ## The two halves
 *
 * A program is a **skeleton** and a list of **ops**.
 *
 * The skeleton is the template with every dynamic part removed: interpolations
 * become comment markers, bound attributes are dropped. It is valid HTML that
 * is parsed exactly once per component *class* and then cloned per instance,
 * so a 2000-node template is parsed once for the life of the page rather than
 * once per update.
 *
 * An op says what to do and where. `{ k: 'text', t: 3, x: 'count' }` reads
 * "evaluate `count`, write it to text marker 3". Each op becomes one reactive
 * effect at mount, so a write to `count` wakes that op and nothing else.
 *
 * ## Addressing, and why markers rather than paths
 *
 * The compiler cannot number nodes by walking its own AST and assume the
 * browser will produce the same tree: HTML parsing inserts implied elements
 * (`<tbody>`), relocates misplaced content, and closes tags the author left
 * open. A path computed from the compiler's tree can therefore address a
 * different node than the one the compiler meant.
 *
 * So the compiler emits *markers* — `data-axb="n"` on a dynamic element,
 * `<!--axt:n-->` where dynamic text goes — and the runtime resolves them
 * against the tree the browser actually built. That resolution happens once per
 * component class ({@link module:lib/core/renderer/program/CompiledTemplate}),
 * is cached as index paths, and every later instance resolves by path with no
 * search.
 *
 * ## What the compiler refuses to compile
 *
 * A program is emitted only when every construct in the template is one the
 * program runtime implements. Anything else and the component keeps the string
 * renderer, with the reason recorded. Partial compilation is not offered: a
 * template that is half compiled and half diffed has two sources of truth for
 * the same DOM, and they will disagree.
 *
 * That fallback is visible rather than silent — `avenx build` reports which
 * components did not compile and why, which is the same house rule Atlas
 * follows when its analysis is incomplete.
 * @module lib/compiler/render/program
 */

/**
 * The program format version.
 *
 * A bundle carries programs produced by the compiler that built it, and the
 * runtime is concatenated into that same bundle, so the two can never be
 * mismatched in a deployed application. The version exists for the case that
 * can happen: a stored or transported program (a trace fixture, a cached
 * build) read back by a newer runtime. A runtime that does not recognise the
 * version falls back to the string renderer rather than guessing.
 * @type {number}
 */
export const PROGRAM_VERSION = 1;

/**
 * Op kinds a program may contain.
 *
 * Kept as short string constants rather than numbers: a program is JSON in a
 * bundle a developer may well end up reading, and `'text'` costs three bytes
 * more than `0` while costing nothing to understand.
 * @enum {string}
 */
export const OpKind = {
  /** Write an expression's value into a text marker. */
  TEXT: 'text',
  /** Write an expression's value into a text marker without escaping. */
  RAW: 'raw',
  /** Set an attribute to an expression's value. */
  ATTR: 'attr',
  /** Set an attribute from a mix of literal parts and expressions. */
  ATTR_PARTS: 'attrp',
  /** Set or remove a boolean attribute from an expression's truthiness. */
  BOOL: 'bool',
  /** Bind a DOM event handler declared in the template. */
  EVENT: 'event',
  /** Toggle `display` from an expression's truthiness (`data-ax-show`). */
  SHOW: 'show',
  /** Apply a string or object class binding (`data-ax-class`). */
  CLASS: 'class',
  /** Replace an element's inner HTML (`data-ax-html`). */
  HTML: 'html',
  /** Evaluate a prop for a child component mounted at this element. */
  PROP: 'prop',
};

/**
 * Reasons a template could not be compiled to a program.
 *
 * Each is a template construct the program runtime does not implement yet.
 * They are enumerated rather than free text so `avenx build` can group them
 * and so a reader can tell "not supported" from "gave up".
 * @enum {string}
 */
export const FallbackReason = {
  LIST: 'a <@for> block',
  COMPONENT: 'a dynamic component tag',
  SLOT: 'a <slot>',
  SUSPENSE: 'a <@suspense> boundary',
  ERROR_BOUNDARY: 'an <@errorBoundary>',
  DEADLOCK: 'a <@deadlock> boundary',
  DEFER: 'a <@defer> block',
  TRANSITION: 'a transition',
  DYNAMIC_ATTR: 'a dynamic attribute name',
  ROUTER_VIEW: 'a router view',
  VALIDATION: 'declarative form validation',
  REF: 'a template ref',
  UNKNOWN_DIRECTIVE: 'an unrecognised directive',
};

/**
 * Builds an empty program.
 * @returns {{v: number, html: string, ops: object[], elements: number, texts: number}}
 *   A program with no ops.
 */
export function emptyProgram() {
  return { v: PROGRAM_VERSION, html: '', ops: [], elements: 0, texts: 0 };
}

/**
 * Whether a value looks like a render program this runtime can execute.
 * @param {any} value - The candidate.
 * @returns {boolean} True when it is a program of a known version.
 */
export function isProgram(value) {
  return !!(
    value &&
    typeof value === 'object' &&
    value.v === PROGRAM_VERSION &&
    typeof value.html === 'string' &&
    Array.isArray(value.ops)
  );
}
