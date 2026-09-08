/**
 * @file compileTemplate.js
 * @description Turns a transformed template into a render program.
 *
 * This runs at the very end of the component pipeline, after every directive
 * has been rewritten into ordinary markup and static subtrees have been marked.
 * By that point the template is plain HTML plus `{{ }}` interpolations plus
 * `data-ax-*` attributes, which is a small enough language to compile
 * exhaustively.
 *
 * The output is a {@link module:lib/compiler/render/program} — a skeleton and a
 * list of ops. See that module for why the format looks the way it does.
 *
 * ## The compile-or-refuse rule
 *
 * Every node is either understood completely or the whole template falls back
 * to the string renderer. There is no partial mode. A template rendered half by
 * a program and half by the diff engine would have two owners for the same DOM
 * subtree, and the first time they disagreed the bug would be unattributable.
 *
 * Refusing is recorded, not swallowed: the caller gets the reason and the tag
 * that caused it, and the build reports them.
 * @module lib/compiler/render/compileTemplate
 */

import { parseHTML, serializeHTML } from '../parser/htmlTree.js';
import { createInterpolationRegex } from '../../core/utils/templateUtils.js';
import { isBooleanAttribute } from '../../core/renderer/constants.js';
import { FallbackReason, OpKind, PROGRAM_VERSION } from './program.js';

/**
 * Attributes whose presence means the node needs machinery the program runtime
 * does not implement, mapped to the reason reported for them.
 * @type {Array<[string, string]>}
 */
const BLOCKING_ATTRIBUTES = [
  ['data-avenx-comp', FallbackReason.COMPONENT],
  ['data-avenx-comp-dynamic', FallbackReason.COMPONENT],
  ['data-ax-for', FallbackReason.LIST],
  ['data-ax-empty', FallbackReason.LIST],
  ['data-ax-list-item', FallbackReason.LIST],
  ['data-ax-suspense', FallbackReason.SUSPENSE],
  ['data-ax-fallback', FallbackReason.SUSPENSE],
  ['data-ax-error-boundary', FallbackReason.ERROR_BOUNDARY],
  ['data-ax-error-fallback', FallbackReason.ERROR_BOUNDARY],
  ['data-ax-deadlock', FallbackReason.DEADLOCK],
  ['data-ax-defer', FallbackReason.DEFER],
  ['data-ax-transition', FallbackReason.TRANSITION],
  ['data-ax-ref', FallbackReason.REF],
  ['data-ax-validate', FallbackReason.VALIDATION],
  ['data-ax-router-view', FallbackReason.ROUTER_VIEW],
  ['data-ax-dyn-attrs', FallbackReason.DYNAMIC_ATTR],
  ['data-ax-style', FallbackReason.UNKNOWN_DIRECTIVE],
  ['data-avenx-style', FallbackReason.UNKNOWN_DIRECTIVE],
];

/**
 * Tag names the program runtime does not own.
 * @type {Map<string, string>}
 */
const BLOCKING_TAGS = new Map([
  ['slot', FallbackReason.SLOT],
  ['template', FallbackReason.LIST],
  ['transition', FallbackReason.TRANSITION],
]);

/**
 * Attributes the program consumes and therefore removes from the skeleton.
 *
 * `data-ax-static` is dropped outright: it exists to tell the tree diff which
 * subtrees to skip, and a program never diffs. Keeping it would ship a hint to
 * an engine that is no longer running.
 * @type {Set<string>}
 */
const CONSUMED_ATTRIBUTES = new Set([
  'data-ax-show',
  'data-ax-class',
  'data-ax-html',
  'data-ax-static',
]);

/**
 * Whether a string contains a template interpolation.
 * @param {string} value - The text to test.
 * @returns {boolean} True when it contains `{{ }}` or `{{{ }}}`.
 */
function hasInterpolation(value) {
  return typeof value === 'string' && value.includes('{{');
}

/**
 * Splits text into literal and expression segments.
 * @param {string} text - The source text.
 * @returns {Array<{expr: string|null, raw: boolean, value: string}>} Segments in order.
 */
function splitInterpolations(text) {
  const segments = [];
  const regex = createInterpolationRegex();
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ expr: null, raw: false, value: text.slice(last, match.index) });
    }
    const raw = match[1] !== undefined;
    segments.push({ expr: raw ? match[1] : match[2], raw, value: '' });
    last = regex.lastIndex;
  }

  if (last < text.length) {
    segments.push({ expr: null, raw: false, value: text.slice(last) });
  }
  return segments;
}

/**
 * Compiles a transformed template into a render program.
 * @param {string} template - The template, after every directive rewrite.
 * @param {object} [options] - Compilation options.
 * @param {string[]} [options.voidTags] - Project-specific void tag names.
 * @returns {{program: object|null, fallback: {reason: string, detail: string}|null}}
 *   The program, or the reason the template could not be compiled.
 */
export function compileTemplateProgram(template, options = {}) {
  if (typeof template !== 'string' || template.trim() === '') {
    return { program: null, fallback: { reason: FallbackReason.UNKNOWN_DIRECTIVE, detail: 'empty template' } };
  }

  const voidTags = options.voidTags || [];
  let nodes;
  try {
    nodes = parseHTML(template, voidTags);
  } catch (error) {
    return {
      program: null,
      fallback: { reason: FallbackReason.UNKNOWN_DIRECTIVE, detail: `template did not parse: ${error.message}` },
    };
  }

  /** @type {object[]} */
  const ops = [];
  let elementCount = 0;
  let textCount = 0;
  /** @type {{reason: string, detail: string}|null} */
  let fallback = null;

  /**
   * Records the first refusal and stops further work.
   * @param {string} reason - A {@link FallbackReason}.
   * @param {string} detail - What in the template caused it.
   */
  function refuse(reason, detail) {
    if (!fallback) {
      fallback = { reason, detail };
    }
  }

  /**
   * Allocates the next element marker id for a node, tagging it in place.
   * @param {object} node - The AST element node.
   * @returns {number} The marker id.
   */
  function markElement(node) {
    if (node.attrs['data-axb'] === undefined) {
      node.attrs['data-axb'] = String(elementCount++);
    }
    return Number(node.attrs['data-axb']);
  }

  /**
   * Rewrites one text node into literal text plus markers, emitting ops.
   * @param {object} node - The AST text node.
   * @returns {object[]} The nodes that replace it.
   */
  function compileText(node) {
    if (!hasInterpolation(node.content)) {
      return [node];
    }

    const out = [];
    for (const segment of splitInterpolations(node.content)) {
      if (segment.expr === null) {
        if (segment.value !== '') {
          out.push({ type: 'text', content: segment.value, children: [] });
        }
        continue;
      }
      const id = textCount++;
      ops.push({ k: segment.raw ? OpKind.RAW : OpKind.TEXT, t: id, x: segment.expr });
      out.push({ type: 'comment', content: `axt:${id}`, children: [] });
    }
    return out;
  }

  /**
   * Compiles one element's attributes into ops, mutating its attribute map.
   * @param {object} node - The AST element node.
   */
  function compileAttributes(node) {
    const attrs = node.attrs || {};

    for (const [name, reason] of BLOCKING_ATTRIBUTES) {
      if (attrs[name] !== undefined) {
        refuse(reason, `<${node.tagName} ${name}>`);
        return;
      }
    }

    for (const name of Object.keys(attrs)) {
      // A dynamic attribute *name* (`:[expr]="..."`) is resolved at runtime, so
      // there is no attribute for the program to address.
      if (name.startsWith(':') || name.startsWith('@')) {
        refuse(FallbackReason.DYNAMIC_ATTR, `<${node.tagName} ${name}>`);
        return;
      }
      if (hasInterpolation(name)) {
        refuse(FallbackReason.DYNAMIC_ATTR, `<${node.tagName}> interpolated attribute name`);
        return;
      }
    }

    // Directive attributes first: each becomes one op and leaves the skeleton.
    if (attrs['data-ax-show'] !== undefined) {
      ops.push({ k: OpKind.SHOW, e: markElement(node), x: attrs['data-ax-show'] });
    }
    if (attrs['data-ax-class'] !== undefined) {
      ops.push({ k: OpKind.CLASS, e: markElement(node), x: attrs['data-ax-class'] });
    }
    if (attrs['data-ax-html'] !== undefined) {
      ops.push({ k: OpKind.HTML, e: markElement(node), x: attrs['data-ax-html'] });
    }

    // Then ordinary attributes carrying interpolations.
    for (const [name, value] of Object.entries(attrs)) {
      if (CONSUMED_ATTRIBUTES.has(name) || name === 'data-axb') continue;
      if (!hasInterpolation(value)) continue;

      const segments = splitInterpolations(value);
      const element = markElement(node);

      if (segments.length === 1 && segments[0].expr !== null) {
        // The whole value is one expression, so its type survives: a boolean
        // attribute can be toggled and a null value can remove the attribute,
        // neither of which is possible once the value has been concatenated
        // into a string.
        if (isBooleanAttribute(name)) {
          ops.push({ k: OpKind.BOOL, e: element, a: name, x: segments[0].expr });
        } else {
          ops.push({ k: OpKind.ATTR, e: element, a: name, x: segments[0].expr });
        }
      } else {
        const parts = segments.map((segment) => (segment.expr === null ? segment.value : { x: segment.expr }));
        ops.push({ k: OpKind.ATTR_PARTS, e: element, a: name, p: parts });
      }

      delete attrs[name];
    }

    for (const name of CONSUMED_ATTRIBUTES) {
      delete attrs[name];
    }
  }

  /**
   * Walks a node list, compiling each node and returning its replacements.
   * @param {object[]} list - AST nodes.
   * @returns {object[]} The rewritten list.
   */
  function walk(list) {
    const out = [];
    for (const node of list) {
      if (fallback) return out;

      if (node.type === 'text') {
        out.push(...compileText(node));
        continue;
      }

      if (node.type === 'comment') {
        if (hasInterpolation(node.content)) {
          refuse(FallbackReason.UNKNOWN_DIRECTIVE, 'an interpolation inside an HTML comment');
          return out;
        }
        out.push(node);
        continue;
      }

      const tag = (node.tagName || '').toLowerCase();
      if (tag.startsWith('@') || BLOCKING_TAGS.has(tag)) {
        refuse(BLOCKING_TAGS.get(tag) || FallbackReason.UNKNOWN_DIRECTIVE, `<${node.tagName}>`);
        return out;
      }
      // A capitalised tag that survived `processComponentTags` is a component
      // reference the program runtime cannot instantiate.
      if (node.tagName && /^[A-Z]/.test(node.tagName)) {
        refuse(FallbackReason.COMPONENT, `<${node.tagName}>`);
        return out;
      }

      // A subtree the compiler proved static can never produce an op, so it is
      // emitted whole and never descended into. This is where a large static
      // template stops costing anything: no ops, no markers, no walk.
      if (node.attrs && node.attrs['data-ax-static'] !== undefined) {
        delete node.attrs['data-ax-static'];
        out.push(node);
        continue;
      }

      compileAttributes(node);
      if (fallback) return out;

      node.children = walk(node.children || []);
      out.push(node);
    }
    return out;
  }

  const rewritten = walk(nodes);
  if (fallback) {
    return { program: null, fallback };
  }

  return {
    program: {
      v: PROGRAM_VERSION,
      html: serializeHTML(rewritten, voidTags),
      ops,
      elements: elementCount,
      texts: textCount,
    },
    fallback: null,
  };
}
