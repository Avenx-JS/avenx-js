/**
 * @file staticSubtrees.js
 * @description Marks static subtrees with `data-ax-static` so the patcher can skip them.
 *
 * An optimisation pass, not a directive: it never changes what a template
 * means, only how much of it the runtime has to revisit. It also lowers the
 * block-contract directives (`<@static>`, `<@isolated>`, `<@pure>`,
 * `<@deterministic>`) to the `div` wrappers the runtime understands.
 */
import { logger } from '../../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { CompilerError, TemplateValidationError } from '../errors/index.js';
import { parseHTML, serializeHTML } from './htmlTree.js';
import { getCustomVoidTags } from './projectConfig.js';

/**
 * The error raised when a pass over the template AST meets a node type it has
 * no branch for.
 *
 * Both static-subtree passes need this, and they need to raise the *same*
 * thing: `optimizeStaticSubtrees` degrades gracefully on any ordinary failure,
 * so the only way an exhaustiveness bug can reach a developer is if it is
 * distinguishable from the failures that pass is allowed to swallow.
 * @param {object} node - The node that has no branch.
 * @param {string} pass - The function that could not read it, for the message.
 * @returns {CompilerError} The error to throw.
 */
function unhandledNodeType(node, pass) {
  const type = node && node.type !== undefined ? String(node.type) : String(node);
  const hasLocation = node && node.line !== null && node.line !== undefined;
  const where = hasLocation ? ` at line ${node.line}, column ${node.column}` : '';
  const error = new CompilerError(AvenxErrorCodes.COMPILER_UNHANDLED_AST_NODE, type, where, pass);
  /**
   * Marks the error as an invariant violation rather than a template problem,
   * so `optimizeStaticSubtrees` rethrows it instead of warning and carrying on.
   * @type {boolean}
   */
  error.isExhaustivenessFailure = true;
  if (hasLocation) {
    error.setLocation({ line: node.line, column: node.column });
  }
  return error;
}

/**
 * Identifies static elements/subtrees and marks them with data-ax-static="true".
 * @param {string} template - The compiled HTML template.
 * @param {string} [filePath] - The component file path, used to resolve project-specific
 *   void tags from `avenx.config.json`.
 * @param {object} [options] - Parser state the pass reads.
 * @param {string[]} [options.customVoidTags] - Void tags configured on the parser itself.
 * @param {function(HTMLNode[], boolean): void} [options.markStaticNodes] - The marking
 *   walk to run. Defaults to {@link markStaticNodes}; the parser passes its own
 *   method so an instance override still takes effect.
 * @returns {string} The optimized template.
 */
export function optimizeStaticSubtrees(template, filePath, { customVoidTags = [], markStaticNodes: mark } = {}) {
  const walk = mark || markStaticNodes;
  try {
    const voidTags = [...(customVoidTags || []), ...getCustomVoidTags(filePath)];
    const nodes = parseHTML(template, voidTags);
    walk(nodes, false);
    return serializeHTML(nodes, voidTags);
  } catch (err) {
    // Marking static subtrees is an optimization, so an ordinary failure
    // degrades to the unoptimized template rather than failing the build.
    // An unhandled node type is not an ordinary failure: it means a pass
    // cannot read what the parser now produces, and swallowing it here is
    // exactly the silent mis-handling the check exists to prevent.
    if (err && err.isExhaustivenessFailure) {
      throw err;
    }
    logger.warn(new TemplateValidationError(AvenxErrorCodes.COMPILER_STATIC_SUBTREE_OPTIMIZATION_FAILED, err).message);
    return template;
  }
}

/**
 * Recursively traverses nodes to find and mark the root of static subtrees.
 * @param {HTMLNode[]} nodes - The nodes to mark, in place.
 * @param {boolean} [parentIsStatic] - Whether the parent is already marked static.
 * @param {boolean} [inSlot] - Indicates if the current node is inside a slot or component transclusion boundary.
 * @param {function(HTMLNode[], boolean, boolean): void} [visitChildren] - How to descend
 *   into an element's children. Defaults to this function; the parser passes its
 *   own method so an instance override sees every level of the walk.
 * @returns {void}
 */
export function markStaticNodes(nodes, parentIsStatic = false, inSlot = false, visitChildren = markStaticNodes) {
  for (const node of nodes) {
    switch (node.type) {
      case 'element': {
        const lowerTag = node.tagName.toLowerCase();
        const isSlot = lowerTag === 'slot';
        const isComponent = Boolean(
          node.attrs['data-avenx-comp'] || node.attrs['data-ax-comp'] || /^[A-Z]/.test(node.tagName),
        );
        const currentInSlot = inSlot || isSlot || isComponent;
        const hasStaticContract = node.contracts && node.contracts.has('static');
        const nodeStatic = !currentInSlot && (hasStaticContract || isStaticNode(node));
        node.isStatic = nodeStatic;

        // Convert contract block directives to div wrappers with respective data attributes
        if (lowerTag === '@static') {
          node.tagName = 'div';
          node.attrs['data-ax-static'] = 'true';
        } else if (lowerTag === '@isolated') {
          node.tagName = 'div';
          node.attrs['data-ax-isolated'] = 'true';
        } else if (lowerTag === '@pure') {
          node.tagName = 'div';
          node.attrs['data-ax-pure'] = 'true';
        } else if (lowerTag === '@deterministic') {
          node.tagName = 'div';
          node.attrs['data-ax-deterministic'] = 'true';
        }

        // Clean up raw contract attributes from DOM element output
        if (node.attrs) {
          if (node.attrs['static'] !== undefined) delete node.attrs['static'];
          if (node.attrs['pure'] !== undefined) delete node.attrs['pure'];
          if (node.attrs['deterministic'] !== undefined) delete node.attrs['deterministic'];
          if (node.attrs['isolated'] !== undefined) delete node.attrs['isolated'];
        }

        if (node.contracts && node.contracts.has('pure') && node.contracts.has('deterministic') && !nodeStatic) {
          node.attrs['data-ax-memo'] = 'true';
        }

        if (nodeStatic && !parentIsStatic) {
          node.attrs['data-ax-static'] = 'true';
        }
        visitChildren(node.children, nodeStatic, currentInSlot);
        break;
      }
      case 'text':
      case 'comment':
        break;
      default:
        throw unhandledNodeType(node, 'markStaticNodes');
    }
  }
}

/**
 * Recursively checks whether a node is a <slot> tag, or has a <slot>
 * anywhere among its descendants. Used to disqualify a subtree from the
 * static-optimization pass, since slots are dynamic transclusion points
 * that DomPatcher must always be able to patch (see issue #200).
 * @param {HTMLNode} node - The node to inspect.
 * @returns {boolean} True when the node is or contains a slot.
 */
export function containsSlot(node) {
  if (node.type !== 'element') {
    return false;
  }
  if (node.tagName.toLowerCase() === 'slot') {
    return true;
  }
  return node.children.some((child) => containsSlot(child));
}

/**
 * Recursively determines if a node (and all its descendants) are completely static.
 * @param {HTMLNode} node - The node to inspect.
 * @returns {boolean} True when nothing in the subtree can change after the first render.
 */
export function isStaticNode(node) {
  switch (node.type) {
    case 'text': {
      if (node.content && (node.content.includes('{{') || node.content.includes('{%'))) {
        return false;
      }
      return true;
    }
    case 'comment': {
      return true;
    }
    case 'element': {
      const lowerTag = node.tagName.toLowerCase();
      if (lowerTag === 'template' || lowerTag === 'slot') {
        return false;
      }

      if (lowerTag.startsWith('@')) {
        return false;
      }

      if (containsSlot(node)) {
        return false;
      }

      if (/^[A-Z]/.test(node.tagName)) {
        return false;
      }

      for (const [name, val] of Object.entries(node.attrs)) {
        if (name.startsWith('@') || name.startsWith(':')) {
          return false;
        }
        if ((name.startsWith('data-ax-') && name !== 'data-ax-static') || name.startsWith('data-avenx-')) {
          return false;
        }
        if (val && (val.includes('{{') || val.includes('{%'))) {
          return false;
        }
      }

      for (const child of node.children) {
        if (!isStaticNode(child)) {
          return false;
        }
      }

      return true;
    }
    default:
      throw unhandledNodeType(node, 'isStaticNode');
  }
}
