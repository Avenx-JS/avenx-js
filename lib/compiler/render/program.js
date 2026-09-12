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
 * A program is a **skeleton**, a list of **ops**, and a list of **blocks**.
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
 *
 * The refusal reasons themselves live with the layer that decides them, in
 * {@link module:lib/compiler/ir/nodes}. They used to live here, next to a
 * second template compiler that read already-rewritten markup; that compiler
 * has been replaced by the IR and its lowering pass, so this module is now the
 * format and the vocabulary and nothing else.
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
export const PROGRAM_VERSION = 2;

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
  /** Set or update an inline style from a string or object (`data-ax-style`). */
  STYLE: 'style',
  /** Render the first arm whose test is truthy, at a text anchor. */
  IF: 'if',
  /** Render one copy of a block per list element, at a text anchor. */
  FOR: 'for',
  /** Render transcluded content, or a fallback block, at a text anchor. */
  SLOT: 'slot',
  /** Render a block once its trigger fires, at a text anchor. */
  DEFER: 'defer',
};

/**
 * Op kinds that own one or more blocks and therefore a DOM range.
 *
 * Everything else writes to a single node the skeleton already contains. A
 * range op inserts and removes nodes, so it needs an anchor and a teardown
 * path, and the runtime dispatches on this rather than re-listing the kinds.
 * @type {Set<string>}
 */
export const RANGE_OPS = new Set([OpKind.IF, OpKind.FOR, OpKind.SLOT, OpKind.DEFER]);

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

/**
 * Returns a program's blocks, tolerating a program that declares none.
 *
 * A template with no control flow lowers to a root block and nothing else, and
 * omitting the empty array keeps that program byte-identical to what the
 * previous format produced for the same template.
 * @param {object} program - A render program.
 * @returns {object[]} The blocks.
 */
export function programBlocks(program) {
  return Array.isArray(program && program.blocks) ? program.blocks : [];
}
