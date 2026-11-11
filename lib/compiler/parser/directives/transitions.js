/**
 * @file transitions.js
 * @description Desugars `<transition>` wrappers into `data-ax-transition` attributes on their children.
 */
import { logger } from '../../../core/runtime/AvenxLogger.js';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { TemplateValidationError } from '../../errors/index.js';
import { parseHTML, serializeHTML } from '../htmlTree.js';
import { getCustomVoidTags } from '../projectConfig.js';

/**
 * Processes transition tags in the template, converting them to data-ax-transition attributes.
 *
 * A template the tree parser cannot read is reported as a warning and returned
 * unchanged rather than failing the build.
 * @param {string} template - The HTML template string.
 * @param {string} [filePath] - The component file path, used to resolve project-specific
 *   void tags from `avenx.config.json`.
 * @param {object} [options] - Parser state the pass reads.
 * @param {string[]} [options.customVoidTags] - Void tags configured on the parser itself.
 * @returns {string} The processed template.
 */
export function processTransitionTags(template, filePath, { customVoidTags = [] } = {}) {
  try {
    const voidTags = [...(customVoidTags || []), ...getCustomVoidTags(filePath)];
    const nodes = parseHTML(template, voidTags);
    const processed = processTransitionTagsInTree(nodes);
    return serializeHTML(processed, voidTags);
  } catch (err) {
    logger.warn(new TemplateValidationError(AvenxErrorCodes.COMPILER_TRANSITION_PARSE_FAILED, err).message);
    return template;
  }
}

/**
 * Recursively processes transition tags in the node tree.
 * @param {HTMLNode[]} nodes - The nodes to rewrite.
 * @returns {HTMLNode[]} The rewritten nodes, with each `<transition>` replaced by its children.
 */
export function processTransitionTagsInTree(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.type === 'element') {
      if (node.tagName.toLowerCase() === 'transition') {
        const nameAttr = node.attrs['name'];
        let transitionValue = "'ax'";
        if (nameAttr) {
          if (nameAttr.startsWith('{{') && nameAttr.endsWith('}}')) {
            transitionValue = nameAttr.slice(2, -2).trim();
          } else {
            transitionValue = `'${nameAttr.replace(/'/g, "\\'")}'`;
          }
        }
        const processedChildren = processTransitionTagsInTree(node.children);
        for (const child of processedChildren) {
          if (child.type === 'element') {
            child.attrs['data-ax-transition'] = transitionValue;
          }
          result.push(child);
        }
      } else {
        node.children = processTransitionTagsInTree(node.children);
        result.push(node);
      }
    } else {
      result.push(node);
    }
  }
  return result;
}
