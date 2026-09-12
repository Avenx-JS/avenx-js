/**
 * @file build.js
 * @description Builds the template IR from template source.
 *
 * This runs on the template as the developer wrote it -- after declarations and
 * imports are removed and scoped-CSS classes are applied, but *before* any
 * directive rewriting. That ordering is the whole point: reading `<@for item in
 * items>` directly is what lets the compiler record that it is a loop over
 * `items` binding `item`, instead of rewriting it into a `<template>` element
 * and asking the runtime to work that out again.
 *
 * ## What it refuses
 *
 * A construct the IR does not model yet aborts the build of that template with
 * a {@link IRRefusal} naming the construct. The caller keeps the legacy path
 * for that component and the build reports it. There is no partial IR, for the
 * same reason there is no partial render program: two descriptions of one
 * template disagree eventually, and the disagreement is unattributable.
 * @module lib/compiler/ir/build
 */

import { parseHTML } from '../parser/htmlTree.js';
import { createInterpolationRegex } from '../../core/utils/templateUtils.js';
import { isBooleanAttribute } from '../../core/renderer/constants.js';
import {
  BindingKind,
  IRRefusal,
  RefusalReason,
  comment,
  component,
  conditional,
  element,
  fragment,
  interpolation,
  iteration,
  slot,
  text,
} from './nodes.js';

/**
 * Directive tags the IR does not model yet, mapped to the reason reported.
 * @type {Map<string, string>}
 */
const UNMODELLED_TAGS = new Map([
  ['@suspense', RefusalReason.SUSPENSE],
  ['@fallback', RefusalReason.SUSPENSE],
  ['@errorboundary', RefusalReason.ERROR_BOUNDARY],
  ['@deadlock', RefusalReason.DEADLOCK],
  ['@defer', RefusalReason.DEFER],
  ['transition', RefusalReason.TRANSITION],
  ['resource', RefusalReason.RESOURCE],
  ['virtuallist', RefusalReason.VIRTUAL_LIST],
  ['routerview', RefusalReason.ROUTER_VIEW],
]);

/**
 * Attributes whose presence means the element needs machinery the IR does not
 * model, mapped to the reason reported.
 * @type {Array<string[]>}
 */
const UNMODELLED_ATTRS = [
  ['data-ax-ref', RefusalReason.REF],
  ['data-ax-validate', RefusalReason.VALIDATION],
  ['data-ax-router-view', RefusalReason.ROUTER_VIEW],
  ['data-ax-dyn-attrs', RefusalReason.DYNAMIC_ATTR],
  ['data-avenx-comp-dynamic', RefusalReason.DYNAMIC_COMPONENT],
  ['data-ax-transition', RefusalReason.TRANSITION],
];

/**
 * Directive attributes that become bindings rather than markup.
 * @type {Map<string, string>}
 */
const DIRECTIVE_BINDINGS = new Map([
  ['data-ax-show', BindingKind.SHOW],
  ['data-ax-class', BindingKind.CLASS],
  ['data-ax-html', BindingKind.HTML],
  ['data-ax-style', BindingKind.STYLE],
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
 * Splits text into literal and expression segments, in order.
 * @param {string} source - The source text.
 * @returns {Array<{expr: string|null, raw: boolean, value: string}>} The segments.
 */
export function splitInterpolations(source) {
  const segments = [];
  const regex = createInterpolationRegex();
  let last = 0;
  let match;

  while ((match = regex.exec(source)) !== null) {
    if (match.index > last) {
      segments.push({ expr: null, raw: false, value: source.slice(last, match.index) });
    }
    const raw = match[1] !== undefined;
    segments.push({ expr: (raw ? match[1] : match[2]).trim(), raw, value: '' });
    last = regex.lastIndex;
  }

  if (last < source.length) {
    segments.push({ expr: null, raw: false, value: source.slice(last) });
  }
  return segments;
}

/**
 * Finds the offset of a top-level occurrence of a keyword in an expression.
 *
 * "Top level" means outside quotes and outside every bracket pair, so the `in`
 * of `<@for k in Object.keys(map)>` is found and the `in` of an `x in y`
 * written inside a call's arguments is not.
 * @param {string} source - The text to scan.
 * @param {string} word - The keyword to find.
 * @returns {number} The offset, or -1.
 */
function findTopLevelWord(source, word) {
  let quote = null;
  let depth = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth !== 0) continue;

    if (source.startsWith(word, i)) {
      const before = i === 0 ? ' ' : source[i - 1];
      const after = source[i + word.length] === undefined ? ' ' : source[i + word.length];
      if (/\s/.test(before) && /\s/.test(after)) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Strips a trailing `key="..."` clause from a `<@for>` header.
 * @param {string} header - The header text after the list expression.
 * @returns {{list: string, key: string|null}} The list source and the key source.
 */
function splitListAndKey(header) {
  const match = header.match(/\skey\s*=\s*("([^"]*)"|'([^']*)')\s*$/);
  if (!match) {
    return { list: header.trim(), key: null };
  }
  const key = match[2] !== undefined ? match[2] : match[3];
  return { list: header.slice(0, match.index).trim(), key: key.trim() || null };
}

/**
 * Parses a `<@for>` header into its parts.
 *
 * Accepts `item in list` and `[item, index] in list`, each optionally followed
 * by `key="expr"`.
 * @param {string} header - The raw header text.
 * @returns {{item: string, index: string|null, list: string, key: string|null}} The parts.
 * @throws {IRRefusal} When the header is not a loop header.
 */
export function parseForHeader(header) {
  const source = (header || '').trim();
  const inAt = findTopLevelWord(source, 'in');
  if (inAt === -1) {
    throw new IRRefusal(RefusalReason.MALFORMED, `<@for ${source}> has no "in" clause`);
  }

  const binding = source.slice(0, inAt).trim();
  const { list, key } = splitListAndKey(source.slice(inAt + 2));

  if (list === '') {
    throw new IRRefusal(RefusalReason.MALFORMED, `<@for ${source}> iterates nothing`);
  }

  const destructured = binding.match(/^\[\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\]$/);
  if (destructured) {
    return { item: destructured[1], index: destructured[2] || null, list, key };
  }

  if (!/^[A-Za-z_$][\w$]*$/.test(binding)) {
    throw new IRRefusal(RefusalReason.MALFORMED, `<@for ${source}> does not bind a name`);
  }
  return { item: binding, index: null, list, key };
}

/**
 * Parses an event attribute name into its event and modifiers.
 * @param {string} name - The attribute name, including the leading `@`.
 * @returns {{event: string, modifiers: string[]}} The parsed parts.
 */
function parseEventName(name) {
  const [event, ...modifiers] = name.slice(1).split('.');
  return { event, modifiers };
}

/**
 * Builds an element's bindings and events from its attribute map.
 * @param {object} node - The parsed HTML node.
 * @returns {{attrs: object, bindings: object[], events: object[]}} The element parts.
 * @throws {IRRefusal} When an attribute needs machinery the IR does not model.
 */
function buildAttributes(node) {
  const source = node.attrs || {};
  const attrs = {};
  const bindings = [];
  const events = [];

  for (const [name, reason] of UNMODELLED_ATTRS) {
    if (source[name] !== undefined) {
      throw new IRRefusal(reason, `<${node.tagName} ${name}>`);
    }
  }

  for (const [name, value] of Object.entries(source)) {
    if (name === 'data-ax-static') continue;

    if (name.startsWith('@')) {
      const { event, modifiers } = parseEventName(name);
      events.push({ event, modifiers, expr: value });
      continue;
    }

    // `:prop="expr"` binds a value; `:[expr]="v"` binds an attribute *name*,
    // which has no fixed attribute for a program to address.
    if (name.startsWith(':')) {
      if (name.includes('[')) {
        throw new IRRefusal(RefusalReason.DYNAMIC_ATTR, `<${node.tagName} ${name}>`);
      }
      bindings.push({ type: BindingKind.ATTR, name: name.slice(1), expr: value });
      continue;
    }

    if (hasInterpolation(name)) {
      throw new IRRefusal(RefusalReason.DYNAMIC_ATTR, `<${node.tagName}> interpolated attribute name`);
    }

    const directive = DIRECTIVE_BINDINGS.get(name);
    if (directive) {
      bindings.push({ type: directive, name, expr: value });
      continue;
    }

    if (!hasInterpolation(value)) {
      attrs[name] = value;
      continue;
    }

    const segments = splitInterpolations(value);
    if (segments.length === 1 && segments[0].expr !== null) {
      // One whole expression, so the value keeps its type: a boolean attribute
      // can be toggled and null can remove the attribute, neither of which
      // survives concatenation into a string.
      bindings.push({
        type: isBooleanAttribute(name) ? BindingKind.BOOL : BindingKind.ATTR,
        name,
        expr: segments[0].expr,
      });
    } else {
      bindings.push({
        type: BindingKind.ATTR_PARTS,
        name,
        parts: segments.map((segment) => (segment.expr === null ? segment.value : { expr: segment.expr })),
      });
    }
  }

  return { attrs, bindings, events };
}

/**
 * Builds the props of a child component from its attribute map.
 * @param {object} node - The parsed HTML node.
 * @returns {object[]} Prop descriptors.
 */
function buildProps(node) {
  const props = [];
  for (const [name, value] of Object.entries(node.attrs || {})) {
    if (name.startsWith('@')) {
      props.push({ name, kind: 'event', expr: value });
      continue;
    }
    const bound = name.startsWith(':');
    const propName = bound ? name.slice(1) : name;
    if (bound) {
      props.push({ name: propName, kind: 'bound', expr: value });
    } else if (hasInterpolation(value)) {
      const segments = splitInterpolations(value);
      if (segments.length === 1 && segments[0].expr !== null) {
        props.push({ name: propName, kind: 'bound', expr: segments[0].expr });
      } else {
        props.push({
          name: propName,
          kind: 'parts',
          parts: segments.map((s) => (s.expr === null ? s.value : { expr: s.expr })),
        });
      }
    } else {
      props.push({ name: propName, kind: 'static', value });
    }
  }
  return props;
}

/**
 * Whether a tag name refers to a child component rather than an element.
 * @param {string} tag - The tag name as written.
 * @returns {boolean} True for a PascalCase reference.
 */
function isComponentTag(tag) {
  return /^[A-Z][A-Za-z0-9_]*$/.test(tag);
}

/**
 * Rejects a conditional header that the tag scan cut in half.
 *
 * `<@if count > 3>` cannot be read unambiguously: the `>` that means "greater
 * than" and the `>` that means "end of tag" are the same character, and nothing
 * in the surrounding text distinguishes them. Bracket depth rescues
 * `<@for x in xs.filter(a => a.n > 1)>` because the comparison is inside a call;
 * a bare comparison has nothing to hide behind.
 *
 * So the compiler does not guess. A header that was truncated leaves the rest
 * of the expression as the first text node of the branch body -- `" 3>"` above
 * -- and that shape is what this detects. The author gets the parenthesised
 * form, which the scanner reads correctly, rather than a condition that
 * silently tests the wrong thing.
 * @param {object} node - The parsed directive node.
 * @param {string} test - The header text as scanned.
 * @throws {IRRefusal} When the header was cut at a comparison.
 */
function assertHeaderNotTruncated(node, test) {
  const first = (node.children || [])[0];
  if (!first || first.type !== 'text') return;

  // A leftover fragment reaches the next `>` without opening an element first.
  const leftover = first.content.match(/^([^<]*?)>/);
  if (!leftover) return;

  const tail = leftover[1].trim();
  if (tail === '') return;

  throw new IRRefusal(
    RefusalReason.MALFORMED,
    `<${node.tagName} ${test}> was cut at a ">" -- write it as ` +
      `<${node.tagName} (${test} > ${tail})> so the comparison is inside brackets`,
  );
}

/**
 * Collects an `<@if>` chain starting at `index`, consuming its continuations.
 * @param {object[]} siblings - The sibling list being walked.
 * @param {number} index - Index of the `<@if>` node.
 * @param {function(object[]): object[]} buildChildren - Recursive child builder.
 * @returns {{node: object, next: number}} The conditional node and the index to resume at.
 */
function buildConditional(siblings, index, buildChildren) {
  const branches = [];
  let i = index;
  let sawElse = false;

  while (i < siblings.length) {
    const node = siblings[i];

    // Whitespace between `</@if>` and `<@elseif>` is formatting, not content.
    // Breaking the chain on it would make an author's indentation decide
    // whether their `<@else>` belongs to the `<@if>` above it.
    if (node && node.type === 'text' && node.content.trim() === '' && branches.length > 0) {
      const following = siblings[i + 1];
      const followingTag = following && following.type === 'element' ? (following.tagName || '').toLowerCase() : '';
      if (followingTag === '@elseif' || followingTag === '@elif' || followingTag === '@else') {
        i++;
        continue;
      }
      break;
    }

    if (!node || node.type !== 'element') break;
    const tag = (node.tagName || '').toLowerCase();

    if (tag === '@if' && i !== index) break;

    if (tag === '@if' || tag === '@elseif' || tag === '@elif') {
      if (sawElse) {
        throw new IRRefusal(RefusalReason.MALFORMED, `<${node.tagName}> follows <@else>`);
      }
      const test = (node.rawAttrs || '').trim();
      if (test === '') {
        throw new IRRefusal(RefusalReason.MALFORMED, `<${node.tagName}> has no condition`);
      }
      assertHeaderNotTruncated(node, test);
      branches.push({ test, body: fragment(buildChildren(node.children || [])) });
      i++;
      continue;
    }

    if (tag === '@else') {
      if (sawElse) {
        throw new IRRefusal(RefusalReason.MALFORMED, 'two <@else> branches in one chain');
      }
      sawElse = true;
      branches.push({ test: null, body: fragment(buildChildren(node.children || [])) });
      i++;
      continue;
    }

    break;
  }

  return { node: conditional(branches), next: i };
}

/**
 * Builds an iteration node from a `<@for>` element.
 * @param {object} node - The parsed `<@for>` node.
 * @param {function(object[]): object[]} buildChildren - Recursive child builder.
 * @returns {object} The iteration node.
 */
function buildIteration(node, buildChildren) {
  const parts = parseForHeader(node.rawAttrs);

  const body = [];
  let empty = null;
  for (const child of node.children || []) {
    if (child.type === 'element' && (child.tagName || '').toLowerCase() === '@empty') {
      if (empty) {
        throw new IRRefusal(RefusalReason.MALFORMED, 'two <@empty> blocks in one <@for>');
      }
      empty = fragment(buildChildren(child.children || []));
      continue;
    }
    body.push(child);
  }

  return iteration({
    list: parts.list,
    item: parts.item,
    index: parts.index,
    key: parts.key,
    body: fragment(buildChildren(body)),
    empty,
  });
}

/**
 * Builds the IR for a template.
 * @param {string} template - The template source, before directive rewriting.
 * @param {object} [options] - Build options.
 * @param {string[]} [options.voidTags] - Project-specific void tag names.
 * @returns {{ir: object|null, refusal: {reason: string, detail: string}|null}}
 *   The root fragment, or the reason the template could not be represented.
 */
export function buildTemplateIR(template, options = {}) {
  if (typeof template !== 'string' || template.trim() === '') {
    return { ir: null, refusal: { reason: RefusalReason.MALFORMED, detail: 'empty template' } };
  }

  const voidTags = options.voidTags || [];
  let parsed;
  try {
    parsed = parseHTML(template, voidTags);
  } catch (error) {
    return { ir: null, refusal: { reason: RefusalReason.MALFORMED, detail: `template did not parse: ${error.message}` } };
  }

  /**
   * Builds IR for a sibling list.
   * @param {object[]} siblings - Parsed sibling nodes.
   * @returns {object[]} IR nodes.
   */
  function buildChildren(siblings) {
    const out = [];

    for (let i = 0; i < siblings.length; i++) {
      const node = siblings[i];

      if (node.type === 'text') {
        for (const segment of splitInterpolations(node.content)) {
          if (segment.expr === null) {
            if (segment.value !== '') out.push(text(segment.value));
          } else {
            out.push(interpolation(segment.expr, segment.raw));
          }
        }
        continue;
      }

      if (node.type === 'comment') {
        if (hasInterpolation(node.content)) {
          throw new IRRefusal(RefusalReason.UNKNOWN_DIRECTIVE, 'an interpolation inside an HTML comment');
        }
        out.push(comment(node.content));
        continue;
      }

      const tag = (node.tagName || '').toLowerCase();

      const unmodelled = UNMODELLED_TAGS.get(tag);
      if (unmodelled) {
        throw new IRRefusal(unmodelled, `<${node.tagName}>`);
      }

      if (tag === '@if') {
        const built = buildConditional(siblings, i, buildChildren);
        out.push(built.node);
        i = built.next - 1;
        continue;
      }

      if (tag === '@elseif' || tag === '@elif' || tag === '@else') {
        throw new IRRefusal(RefusalReason.MALFORMED, `<${node.tagName}> without a preceding <@if>`);
      }

      if (tag === '@for') {
        out.push(buildIteration(node, buildChildren));
        continue;
      }

      if (tag === '@empty') {
        throw new IRRefusal(RefusalReason.MALFORMED, '<@empty> outside a <@for>');
      }

      if (tag.startsWith('@')) {
        throw new IRRefusal(RefusalReason.UNKNOWN_DIRECTIVE, `<${node.tagName}>`);
      }

      if (tag === 'slot') {
        const name = (node.attrs && node.attrs.name) || 'default';
        const fallbackChildren = buildChildren(node.children || []);
        out.push(slot(name, fallbackChildren.length > 0 ? fragment(fallbackChildren) : null));
        continue;
      }

      if (isComponentTag(node.tagName)) {
        out.push(
          component(node.tagName, {
            props: buildProps(node),
            children: buildChildren(node.children || []),
          }),
        );
        continue;
      }

      const { attrs, bindings, events } = buildAttributes(node);
      out.push(
        element(node.tagName, {
          attrs,
          bindings,
          events,
          children: buildChildren(node.children || []),
          selfClosing: node.isSelfClosing === true,
          isStatic: node.attrs && node.attrs['data-ax-static'] !== undefined,
        }),
      );
    }

    return out;
  }

  try {
    return { ir: fragment(buildChildren(parsed)), refusal: null };
  } catch (error) {
    if (error instanceof IRRefusal) {
      return { ir: null, refusal: { reason: error.reason, detail: error.detail } };
    }
    throw error;
  }
}
