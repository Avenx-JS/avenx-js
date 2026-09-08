/**
 * @file CompiledTemplate.js
 * @description The parsed, reusable form of a render program's skeleton.
 *
 * ## The cost this removes
 *
 * The string renderer parsed HTML on every update of every component. A
 * skeleton is parsed **once per component class, for the life of the page**,
 * and every instance after the first is a `cloneNode(true)` of that parse.
 * Cloning a tree is a native operation with no tokeniser, no attribute parsing
 * and no error recovery; parsing the same markup a second time is all three.
 *
 * ## Resolving markers, once
 *
 * The compiler emits markers rather than index paths because it cannot predict
 * what the HTML parser will do with a template (implied `<tbody>`, relocated
 * content, tags closed for the author). So the first thing this class does is
 * find the markers in the tree the parser *actually* built, and record where
 * they ended up as index paths.
 *
 * After that first walk the markers are gone -- `data-axb` is removed from the
 * prototype tree and each `<!--axt:n-->` comment is replaced by the empty text
 * node that will hold the value. Every clone therefore comes out already
 * shaped, and every instance resolves its binding targets by walking a handful
 * of child indices rather than searching the tree.
 *
 * The result is that a 2000-node component costs one parse and one marker walk
 * ever, plus one clone and `ops.length` short index walks per instance.
 * @module lib/core/renderer/program/CompiledTemplate
 */

/**
 * Prefix identifying a text marker comment.
 * @type {string}
 */
const TEXT_MARKER = 'axt:';

/**
 * Attribute identifying a bound element in a freshly parsed skeleton.
 * @type {string}
 */
const ELEMENT_MARKER = 'data-axb';

/**
 * Parses a skeleton into a reusable prototype fragment.
 *
 * `<template>` is used rather than `DOMParser` because template parsing is
 * fragment parsing: content that a document parser would relocate or discard
 * (a bare `<td>`, a `<tr>` outside a table) survives inside a template. The
 * string renderer's use of `DOMParser` and `document.body` is the reason
 * table fragments have historically needed care.
 * @param {string} html - The skeleton markup.
 * @returns {DocumentFragment|null} The parsed content, or null when the host
 *   provides no usable DOM.
 */
function parseSkeleton(html) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }

  const host = document.createElement('template');
  if (host && 'content' in host) {
    host.innerHTML = html;
    return host.content;
  }

  // A host without <template> support (a minimal DOM mock, an old engine).
  // A detached div loses table fragments, which is why it is the fallback and
  // not the default.
  const fragment = document.createDocumentFragment();
  const holder = document.createElement('div');
  holder.innerHTML = html;
  while (holder.firstChild) {
    fragment.appendChild(holder.firstChild);
  }
  return fragment;
}

/**
 * A render program's skeleton, parsed once and cloned thereafter.
 */
export class CompiledTemplate {
  /**
   * @param {object} program - A render program.
   */
  constructor(program) {
    /** @type {object} */
    this.program = program;

    /**
     * Index paths to each bound element, by marker id.
     * @type {number[][]}
     */
    this.elementPaths = new Array(program.elements || 0);

    /**
     * Index paths to each dynamic text node, by marker id.
     * @type {number[][]}
     */
    this.textPaths = new Array(program.texts || 0);

    /**
     * The prototype tree every instance is cloned from.
     * @type {DocumentFragment|null}
     */
    this.prototype = null;

    /**
     * Set when the skeleton could not be prepared, so callers fall back rather
     * than retrying a parse that will fail the same way.
     * @type {boolean}
     */
    this.failed = false;

    this.#prepare();
  }

  /**
   * Parses the skeleton and resolves every marker to an index path.
   * @private
   */
  #prepare() {
    const fragment = parseSkeleton(this.program.html);
    if (!fragment) {
      this.failed = true;
      return;
    }

    const path = [];
    let seenElements = 0;
    let seenTexts = 0;

    /**
     * Walks a node's children, recording marker positions.
     * @param {Node} node - The subtree root.
     */
    const walk = (node) => {
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        path.push(i);

        if (child.nodeType === 8 && typeof child.data === 'string' && child.data.startsWith(TEXT_MARKER)) {
          const id = Number(child.data.slice(TEXT_MARKER.length));
          if (Number.isInteger(id) && id >= 0) {
            this.textPaths[id] = path.slice();
            seenTexts++;
          }
          // The comment becomes the text node that will carry the value, at
          // the same index, so the path just recorded stays valid and no clone
          // has to do this substitution again.
          const text = node.ownerDocument
            ? node.ownerDocument.createTextNode('')
            : document.createTextNode('');
          node.replaceChild(text, child);
        } else if (child.nodeType === 1) {
          if (typeof child.getAttribute === 'function') {
            const marker = child.getAttribute(ELEMENT_MARKER);
            if (marker !== null && marker !== undefined) {
              const id = Number(marker);
              if (Number.isInteger(id) && id >= 0) {
                this.elementPaths[id] = path.slice();
                seenElements++;
              }
              child.removeAttribute(ELEMENT_MARKER);
            }
          }
          walk(child);
        }

        path.pop();
      }
    };

    walk(fragment);

    // Every marker the compiler numbered must have been found. A miss means the
    // parser reshaped the tree in a way the compiler did not anticipate, and
    // binding against a partially resolved template would write values into the
    // wrong nodes. Refusing here sends the component back to the string
    // renderer, which is slower and correct.
    if (seenElements !== (this.program.elements || 0) || seenTexts !== (this.program.texts || 0)) {
      this.failed = true;
      return;
    }

    this.prototype = fragment;
  }

  /**
   * Clones the prototype and resolves every binding target in the clone.
   * @returns {{fragment: DocumentFragment, elements: Element[], texts: Text[]}|null}
   *   The instance's nodes, or null when the template could not be prepared.
   */
  instantiate() {
    if (this.failed || !this.prototype) {
      return null;
    }

    const fragment = this.prototype.cloneNode(true);
    const elements = new Array(this.elementPaths.length);
    const texts = new Array(this.textPaths.length);

    for (let i = 0; i < this.elementPaths.length; i++) {
      elements[i] = resolvePath(fragment, this.elementPaths[i]);
    }
    for (let i = 0; i < this.textPaths.length; i++) {
      texts[i] = resolvePath(fragment, this.textPaths[i]);
    }

    return { fragment, elements, texts };
  }
}

/**
 * Follows an index path from a root node.
 * @param {Node} root - The starting node.
 * @param {number[]} path - Child indices to follow.
 * @returns {Node|null} The addressed node.
 */
function resolvePath(root, path) {
  if (!path) return null;
  let node = root;
  for (let i = 0; i < path.length; i++) {
    node = node.childNodes[path[i]];
    if (!node) return null;
  }
  return node;
}

/**
 * Caches one {@link CompiledTemplate} per program.
 *
 * Keyed by the program object itself, which the compiler emits once per
 * component class into the bundle, so every instance of a class shares one
 * parse without the cache needing to hash the markup.
 * @type {WeakMap<object, CompiledTemplate>}
 */
const cache = new WeakMap();

/**
 * Returns the prepared template for a program, preparing it on first use.
 * @param {object} program - A render program.
 * @returns {CompiledTemplate} The prepared template.
 */
export function getCompiledTemplate(program) {
  let compiled = cache.get(program);
  if (!compiled) {
    compiled = new CompiledTemplate(program);
    cache.set(program, compiled);
  }
  return compiled;
}
