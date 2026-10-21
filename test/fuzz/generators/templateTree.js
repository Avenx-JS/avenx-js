/**
 * @file templateTree.js
 * @description Fast-check property-based generator for randomized-but-valid Avenx template structures.
 *
 * Produces combinations of elements, void tags, text interpolations, event handlers,
 * dynamic attribute bindings, slots (default, named, and scoped with fallbacks),
 * conditionals (<@if>, <@elseif>, <@else>), and iteration loops (<@for>, <@empty>)
 * with controlled nesting depth and structural metadata for invariant assertions.
 */

import fc from 'fast-check';

/**
 * Valid standard HTML tag names for container and leaf elements.
 */
export const CONTAINER_TAGS = ['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'ul', 'li'];

export const INLINE_TAGS = ['p', 'span', 'button', 'h1', 'h2', 'h3', 'label', 'b', 'i', 'strong', 'em'];

export const VOID_TAGS = ['img', 'input', 'br', 'hr'];

export const STATIC_CLASS_NAMES = [
  'container',
  'card',
  'card-body',
  'static-header',
  'item-row',
  'btn',
  'btn-primary',
  'active',
  'wrapper',
];

export const STATIC_IDS = ['main-content', 'sidebar', 'title', 'nav-bar', 'summary'];

export const IDENTIFIERS = ['item', 'state', 'user', 'count', 'idx', 'data', 'current', 'row'];

export const EXPRESSIONS = [
  '(state.count > 0)',
  'state.visible',
  'user.isAdmin',
  '(items.length > 0)',
  'item.isActive',
  'count === 0',
  'isValid',
  'hasPermission',
];

export const HANDLERS = ['handleClick', 'handleClick(item)', 'onSave()', 'count++', 'toggle()', 'handleSubmit'];

export const SLOT_NAMES = ['header', 'footer', 'sidebar', 'actions', 'item', 'fallback'];

/**
 * Renders an AST node or array of AST nodes into valid HTML template markup.
 * @param {object|object[]} node
 * @returns {string}
 */
export function renderToTemplate(node) {
  if (Array.isArray(node)) {
    return node.map(renderToTemplate).join('');
  }
  if (!node) return '';

  switch (node.type) {
    case 'text':
      return node.content;

    case 'comment':
      return `<!-- ${node.content} -->`;

    case 'element': {
      const attrsStr = formatAttrs(node.attrs);
      if (node.isVoid) {
        return `<${node.tagName}${attrsStr} />`;
      }
      return `<${node.tagName}${attrsStr}>${renderToTemplate(node.children)}</${node.tagName}>`;
    }

    case 'slot': {
      const attrs = { ...node.attrs };
      if (node.name) {
        attrs.name = node.name;
      }
      const attrsStr = formatAttrs(attrs);
      if (!node.children || node.children.length === 0) {
        return `<slot${attrsStr}></slot>`;
      }
      return `<slot${attrsStr}>${renderToTemplate(node.children)}</slot>`;
    }

    case 'for': {
      const emptyMarkup = node.empty && node.empty.length > 0 ? `<@empty>${renderToTemplate(node.empty)}</@empty>` : '';
      return `<@for ${node.header}>${renderToTemplate(node.body)}${emptyMarkup}</@for>`;
    }

    case 'if': {
      let res = '';
      node.branches.forEach((branch, idx) => {
        if (idx === 0) {
          res += `<@if ${branch.test}>${renderToTemplate(branch.children)}`;
        } else if (branch.tag === '@else') {
          res += `<@else>${renderToTemplate(branch.children)}`;
        } else {
          res += `<${branch.tag} ${branch.test}>${renderToTemplate(branch.children)}`;
        }
      });
      res += '</@if>';
      return res;
    }

    default:
      return '';
  }
}

/**
 * Formats an attribute dictionary into an attribute string.
 * @param {Record<string, string>} attrs
 * @returns {string}
 */
function formatAttrs(attrs = {}) {
  const parts = [];
  for (const [key, val] of Object.entries(attrs)) {
    if (val === true || val === 'true') {
      parts.push(` ${key}="true"`);
    } else if (val === false || val === null || val === undefined) {
      continue;
    } else {
      parts.push(` ${key}="${String(val).replace(/"/g, '&quot;')}"`);
    }
  }
  return parts.join('');
}

/**
 * Inspects whether a node or any of its descendants is a slot.
 * @param {object} node
 * @returns {boolean}
 */
export function nodeContainsSlot(node) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(nodeContainsSlot);
  if (node.type === 'slot') return true;
  if (node.children && node.children.some(nodeContainsSlot)) return true;
  if (node.type === 'for') {
    if (node.body && node.body.some(nodeContainsSlot)) return true;
    if (node.empty && node.empty.some(nodeContainsSlot)) return true;
  }
  if (node.type === 'if' && node.branches) {
    return node.branches.some((b) => b.children && b.children.some(nodeContainsSlot));
  }
  return false;
}

/**
 * Inspects whether a node or any of its descendants contains dynamic bindings.
 * @param {object} node
 * @returns {boolean}
 */
export function nodeContainsDynamic(node) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(nodeContainsDynamic);

  if (node.type === 'slot') return true;
  if (node.type === 'for') return true;
  if (node.type === 'if') return true;

  if (node.type === 'text') {
    return Boolean(node.isDynamic || node.content.includes('{{') || node.content.includes('{%'));
  }

  if (node.type === 'element') {
    if (node.attrs) {
      for (const [key, val] of Object.entries(node.attrs)) {
        if (key.startsWith(':') || key.startsWith('@')) return true;
        if (key.startsWith('data-ax-') && key !== 'data-ax-static') return true;
        if (typeof val === 'string' && (val.includes('{{') || val.includes('{%'))) return true;
      }
    }
    if (node.children && node.children.some(nodeContainsDynamic)) return true;
  }

  return false;
}

/**
 * Counts all slot nodes in a tree.
 * @param {object|object[]} node
 * @returns {number}
 */
export function countSlots(node) {
  if (!node) return 0;
  if (Array.isArray(node)) return node.reduce((acc, c) => acc + countSlots(c), 0);
  let count = node.type === 'slot' ? 1 : 0;
  if (node.children) count += countSlots(node.children);
  if (node.type === 'for') {
    count += countSlots(node.body);
    count += countSlots(node.empty);
  }
  if (node.type === 'if' && node.branches) {
    count += node.branches.reduce((acc, b) => acc + countSlots(b.children), 0);
  }
  return count;
}

/**
 * Counts all loop nodes in a tree.
 * @param {object|object[]} node
 * @returns {number}
 */
export function countLoops(node) {
  if (!node) return 0;
  if (Array.isArray(node)) return node.reduce((acc, c) => acc + countLoops(c), 0);
  let count = node.type === 'for' ? 1 : 0;
  if (node.children) count += countLoops(node.children);
  if (node.type === 'for') {
    count += countLoops(node.body);
    count += countLoops(node.empty);
  }
  if (node.type === 'if' && node.branches) {
    count += node.branches.reduce((acc, b) => acc + countLoops(b.children), 0);
  }
  return count;
}

/**
 * Counts all conditional nodes in a tree.
 * @param {object|object[]} node
 * @returns {number}
 */
export function countConditionals(node) {
  if (!node) return 0;
  if (Array.isArray(node)) return node.reduce((acc, c) => acc + countConditionals(c), 0);
  let count = node.type === 'if' ? 1 : 0;
  if (node.children) count += countConditionals(node.children);
  if (node.type === 'for') {
    count += countConditionals(node.body);
    count += countConditionals(node.empty);
  }
  if (node.type === 'if' && node.branches) {
    count += node.branches.reduce((acc, b) => acc + countConditionals(b.children), 0);
  }
  return count;
}

/**
 * Collects all slot names in document order.
 * @param {object|object[]} node
 * @returns {string[]}
 */
export function collectSlotNames(node) {
  const result = [];
  function traverse(n) {
    if (!n) return;
    if (Array.isArray(n)) {
      n.forEach(traverse);
      return;
    }
    if (n.type === 'slot') {
      result.push(n.name || 'default');
    }
    if (n.children) traverse(n.children);
    if (n.type === 'for') {
      traverse(n.body);
      traverse(n.empty);
    }
    if (n.type === 'if' && n.branches) {
      n.branches.forEach((b) => traverse(b.children));
    }
  }
  traverse(node);
  return result;
}

/**
 * Creates the fast-check Arbitrary for valid template trees and their markup.
 * @param {object} [options]
 * @param {number} [options.maxDepth]
 * @param {number} [options.maxChildren]
 * @returns {fc.Arbitrary<{root: object, template: string, meta: object}>}
 */
export function templateTreeArbitrary(options = {}) {
  const maxDepth = options.maxDepth ?? 3;
  const maxChildren = options.maxChildren ?? 3;

  // Arbitrary generators for leaves
  const staticTextArb = fc
    .constantFrom(
      'Static content',
      'Welcome to Avenx',
      'Click here to proceed',
      'Summary item',
      'Overview description',
      'Active status',
    )
    .map((content) => ({ type: 'text', content, isDynamic: false }));

  const interpolationTextArb = fc
    .record({
      expr: fc.constantFrom('user.name', 'state.count', 'item.label', 'index + 1'),
      raw: fc.boolean(),
    })
    .map(({ expr, raw }) => ({
      type: 'text',
      content: raw ? `{{{ ${expr} }}}` : `{{ ${expr} }}`,
      isDynamic: true,
    }));

  const commentArb = fc
    .constantFrom('header comment', 'navigation section', 'todo item', 'transclusion outlet')
    .map((content) => ({ type: 'comment', content }));

  const voidElementArb = fc
    .record({
      tagName: fc.constantFrom(...VOID_TAGS),
      attrs: fc.record({
        class: fc.option(fc.constantFrom(...STATIC_CLASS_NAMES), { nil: undefined }),
        id: fc.option(fc.constantFrom(...STATIC_IDS), { nil: undefined }),
      }),
    })
    .map(({ tagName, attrs }) => ({
      type: 'element',
      tagName,
      attrs: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined)),
      isVoid: true,
      children: [],
    }));

  const leafArb = fc.oneof(staticTextArb, interpolationTextArb, commentArb, voidElementArb);

  // Recursive tree definition
  const { nodeTree } = fc.letrec((tie) => {
    const childListArb = fc.array(tie('nodeTree'), { minLength: 0, maxLength: maxChildren });
    const nonEmptyChildListArb = fc.array(tie('nodeTree'), { minLength: 1, maxLength: maxChildren });

    // Container / inline element generator
    const standardElementArb = fc
      .record({
        tagName: fc.constantFrom(...CONTAINER_TAGS, ...INLINE_TAGS),
        hasDynamicAttr: fc.boolean(),
        hasEvent: fc.boolean(),
        hasDirective: fc.boolean(),
        className: fc.option(fc.constantFrom(...STATIC_CLASS_NAMES), { nil: undefined }),
        idName: fc.option(fc.constantFrom(...STATIC_IDS), { nil: undefined }),
        children: childListArb,
      })
      .map(({ tagName, hasDynamicAttr, hasEvent, hasDirective, className, idName, children }) => {
        const attrs = {};
        if (className) attrs.class = className;
        if (idName) attrs.id = idName;
        if (hasDynamicAttr) {
          attrs[':title'] = 'state.title';
        }
        if (hasEvent) {
          attrs['@click'] = 'handleClick';
        }
        if (hasDirective) {
          attrs['data-ax-show'] = 'state.visible';
        }
        return {
          type: 'element',
          tagName,
          attrs,
          isVoid: false,
          children,
        };
      });

    // Slot element generator (default, named, or with props)
    const slotElementArb = fc
      .record({
        name: fc.option(fc.constantFrom(...SLOT_NAMES), { nil: null }),
        hasProps: fc.boolean(),
        fallback: fc.option(nonEmptyChildListArb, { nil: [] }),
      })
      .map(({ name, hasProps, fallback }) => {
        const attrs = {};
        if (hasProps) {
          attrs[':item'] = 'item';
        }
        return {
          type: 'slot',
          name,
          attrs,
          children: fallback,
        };
      });

    // Loop (<@for>) generator with optional <@empty>
    const forLoopArb = fc
      .record({
        header: fc.constantFrom(
          'item in items',
          'row in rows key="row.id"',
          '[key, val] in entries',
          'user in users key="user.id"',
          'item="user" in="users" key="user.id"',
        ),
        body: nonEmptyChildListArb,
        hasEmpty: fc.boolean(),
        emptyChildren: childListArb,
      })
      .map(({ header, body, hasEmpty, emptyChildren }) => ({
        type: 'for',
        header,
        body,
        empty: hasEmpty ? emptyChildren : null,
      }));

    // Conditional (<@if>, <@elseif>, <@else>) generator
    const conditionalArb = fc
      .record({
        numBranches: fc.integer({ min: 1, max: 3 }),
        test1: fc.constantFrom(...EXPRESSIONS),
        test2: fc.constantFrom(...EXPRESSIONS),
        children1: nonEmptyChildListArb,
        children2: nonEmptyChildListArb,
        childrenElse: nonEmptyChildListArb,
      })
      .map(({ numBranches, test1, test2, children1, children2, childrenElse }) => {
        const branches = [{ tag: '@if', test: test1, children: children1 }];
        if (numBranches >= 2) {
          branches.push({ tag: '@elseif', test: test2, children: children2 });
        }
        if (numBranches === 3) {
          branches.push({ tag: '@else', test: null, children: childrenElse });
        }
        return {
          type: 'if',
          branches,
        };
      });

    return {
      nodeTree: fc.oneof(
        { depthSize: 'small', maxDepth },
        leafArb,
        standardElementArb,
        slotElementArb,
        forLoopArb,
        conditionalArb,
      ),
    };
  });

  // Root container generator: ensures a top-level HTML structure
  return fc
    .record({
      rootTag: fc.constantFrom('div', 'section', 'main', 'article'),
      rootClass: fc.option(fc.constantFrom(...STATIC_CLASS_NAMES), { nil: undefined }),
      children: fc.array(nodeTree, { minLength: 1, maxLength: maxChildren }),
    })
    .map(({ rootTag, rootClass, children }) => {
      const attrs = {};
      if (rootClass) attrs.class = rootClass;
      const root = {
        type: 'element',
        tagName: rootTag,
        attrs,
        isVoid: false,
        children,
      };
      const template = renderToTemplate(root);
      const meta = {
        hasSlot: nodeContainsSlot(root),
        hasDynamic: nodeContainsDynamic(root),
        slotsCount: countSlots(root),
        loopsCount: countLoops(root),
        conditionalsCount: countConditionals(root),
        slotNames: collectSlotNames(root),
      };
      return { root, template, meta };
    });
}
