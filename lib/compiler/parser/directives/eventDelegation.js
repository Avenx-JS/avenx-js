/**
 * @file eventDelegation.js
 * @description Folds common `@event` handlers into one `data-ax-event` attribute for delegation.
 */
import { parseHTML, serializeHTML } from '../htmlTree.js';
import { getCustomVoidTags } from '../projectConfig.js';

/**
 * The events the runtime delegates from the component root. Any other `@event`
 * attribute is left on its element and bound directly.
 * @type {string[]}
 */
const COMMON_EVENTS = ['click', 'input', 'change', 'keydown'];

/**
 * Translates common event handler attributes (@click, @input, etc.)
 * to a single data-ax-event JSON-encoded attribute for centralized delegation.
 * @param {string} template - The HTML template string.
 * @param {string} filePath - The component file path.
 * @param {object} [options] - Parser state the pass reads.
 * @param {string[]} [options.customVoidTags] - Void tags configured on the parser itself.
 * @returns {string} The transformed template string.
 */
export function processEventDelegation(template, filePath, { customVoidTags = [] } = {}) {
  if (!template) return template;
  const voidTags = [...(customVoidTags || []), ...getCustomVoidTags(filePath)];
  const nodes = parseHTML(template, voidTags);

  const transformNode = (node) => {
    if (node.type === 'element') {
      const eventMap = {};
      for (const [name, val] of Object.entries(node.attrs)) {
        if (name.startsWith('@')) {
          const fullEventName = name.substring(1);
          const baseEventName = fullEventName.split('.')[0];
          if (COMMON_EVENTS.includes(baseEventName)) {
            delete node.attrs[name];
            eventMap[fullEventName] = val;
          }
        }
      }
      if (Object.keys(eventMap).length > 0) {
        node.attrs['data-ax-event'] = JSON.stringify(eventMap);
      }
      if (node.children) {
        node.children.forEach(transformNode);
      }
    }
  };

  nodes.forEach(transformNode);
  return serializeHTML(nodes, voidTags);
}
