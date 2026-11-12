/**
 * @file componentTags.js
 * @description Rewrites PascalCase component tags into `data-avenx-comp` host elements.
 */
import { parseAttributes } from '../htmlTree.js';
import { processSlotProps } from './slotProps.js';
import { escapeScopedSlots } from './scopedSlots.js';

/**
 * Processes component tags recursively to handle transclusion slots.
 * Maps `<CompName ...>...</CompName>` to `<div data-avenx-comp="CompName">...</div>`.
 *
 * Slot props and scoped slots are rewritten first, on every level of the
 * recursion: `:prop` on a `<slot>` must already be `data-props-*`, and a scoped
 * slot's interpolations must already be escaped, before the component tag that
 * contains them is turned into markup the parent renders.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
export function processComponentTags(template) {
  let currentTemplate = template;
  currentTemplate = processSlotProps(currentTemplate);
  currentTemplate = escapeScopedSlots(currentTemplate);

  while (true) {
    // Find the first occurrence of < followed by an uppercase letter
    const match = currentTemplate.match(/<([A-Z][a-zA-Z0-9]*)\b/);
    if (!match) {
      break;
    }

    const compName = match[1];
    const startIndex = match.index;

    // Find the end of this opening/self-closing tag
    let i = startIndex + 1 + compName.length;
    let inQuote = null;
    let isSelfClosing = false;
    let tagEndIndex = -1;

    while (i < currentTemplate.length) {
      const char = currentTemplate[i];
      if (inQuote) {
        if (char === inQuote) {
          inQuote = null;
        }
      } else if (char === '"' || char === "'") {
        inQuote = char;
      } else if (char === '>') {
        const trimmedBefore = currentTemplate.substring(startIndex + 1 + compName.length, i).trim();
        if (trimmedBefore.endsWith('/')) {
          isSelfClosing = true;
        }
        tagEndIndex = i + 1;
        break;
      }
      i++;
    }

    if (tagEndIndex === -1) {
      break; // Malformed tag, stop parsing to prevent infinite loops
    }

    // Extract the attributes string
    let attrsStr = currentTemplate.substring(startIndex + 1 + compName.length, tagEndIndex - 1).trim();
    if (isSelfClosing && attrsStr.endsWith('/')) {
      attrsStr = attrsStr.slice(0, -1).trim();
    }

    let isExpr = '';
    const isDynamic = compName === 'Component';

    // Parse attributes
    const props = [];
    const others = [];
    let userStyle = null;
    const attrs = parseAttributes(attrsStr);
    for (const [attrName, attrVal] of Object.entries(attrs)) {
      if (isDynamic && (attrName === 'is' || attrName === ':is')) {
        if (attrVal.startsWith('{{') && attrVal.endsWith('}}')) {
          isExpr = attrVal.slice(2, -2).trim();
        } else {
          isExpr = attrVal.trim();
        }
      } else if (attrName.startsWith('@')) {
        others.push(`${attrName}="${attrVal.replace(/"/g, '&quot;')}"`);
      } else if (
        attrName === 'class' ||
        attrName === 'id' ||
        (attrName.startsWith('data-') && !attrName.startsWith('data-props-'))
      ) {
        others.push(`${attrName}="${attrVal.replace(/"/g, '&quot;')}"`);
      } else if (attrName === 'style') {
        userStyle = attrVal;
      } else {
        let propName = attrName;
        let propExpr;
        if (attrName.startsWith(':')) {
          propName = attrName.slice(1);
          propExpr = attrVal.trim();
          if (propExpr.startsWith('{{') && propExpr.endsWith('}}')) {
            propExpr = propExpr.slice(2, -2).trim();
          }
        } else if (attrName.startsWith('data-props-')) {
          propName = attrName.slice('data-props-'.length);
          propExpr = attrVal.trim();
          if (propExpr.startsWith('{{') && propExpr.endsWith('}}')) {
            propExpr = propExpr.slice(2, -2).trim();
          }
        } else {
          if (attrVal.startsWith('{{') && attrVal.endsWith('}}')) {
            propExpr = attrVal.slice(2, -2).trim();
          } else {
            const trimmed = attrVal.trim();
            if (
              trimmed === 'true' ||
              trimmed === 'false' ||
              trimmed === 'null' ||
              (trimmed !== '' && !isNaN(trimmed))
            ) {
              propExpr = trimmed;
            } else {
              propExpr = `'${trimmed.replace(/'/g, "\\'")}'`;
            }
          }
        }
        props.push(`data-props-${propName}="${propExpr}"`);
      }
    }

    if (compName === 'VirtualList') {
      if (userStyle === null) {
        userStyle = 'height: 100%;';
      } else if (!/\bheight\s*:/i.test(userStyle)) {
        userStyle = userStyle.trim().endsWith(';') ? `${userStyle} height: 100%;` : `${userStyle}; height: 100%;`;
      }
    }

    if (userStyle !== null) {
      others.push(`style="${userStyle.replace(/"/g, '&quot;')}"`);
    }

    const propsAttr = props.length > 0 ? ` ${props.join(' ')}` : '';
    const othersAttr = others.length > 0 ? ` ${others.join(' ')}` : '';

    const replacementTag = isDynamic ? `data-avenx-comp-dynamic="${isExpr}"` : `data-avenx-comp="${compName}"`;

    if (isSelfClosing) {
      const replacement = `<div ${replacementTag}${propsAttr}${othersAttr}></div>`;
      currentTemplate = currentTemplate.substring(0, startIndex) + replacement + currentTemplate.substring(tagEndIndex);
    } else {
      // Find matching closing tag </CompName>
      let searchIndex = tagEndIndex;
      let depth = 1;
      let closingTagIndex = -1;
      let closingTagLength = 0;

      while (searchIndex < currentTemplate.length) {
        const nextOpen = currentTemplate.substring(searchIndex).match(new RegExp(`^<${compName}\\b`));
        const nextClose = currentTemplate.substring(searchIndex).match(new RegExp(`^</\\s*${compName}\\s*>`));

        if (nextClose) {
          depth--;
          if (depth === 0) {
            closingTagIndex = searchIndex;
            closingTagLength = nextClose[0].length;
            break;
          }
          searchIndex += nextClose[0].length;
        } else if (nextOpen) {
          // Scan to end of this open tag to see if it is self-closing
          let tempIdx = searchIndex + nextOpen[0].length;
          let tempInQuote = null;
          let tempIsSelfClosing = false;
          while (tempIdx < currentTemplate.length) {
            const tc = currentTemplate[tempIdx];
            if (tempInQuote) {
              if (tc === tempInQuote) tempInQuote = null;
            } else if (tc === '"' || tc === "'") {
              tempInQuote = tc;
            } else if (tc === '>') {
              const trimmedBefore = currentTemplate.substring(searchIndex + nextOpen[0].length, tempIdx).trim();
              if (trimmedBefore.endsWith('/')) {
                tempIsSelfClosing = true;
              }
              tempIdx++;
              break;
            }
            tempIdx++;
          }
          if (!tempIsSelfClosing) {
            depth++;
          }
          searchIndex = tempIdx;
        } else {
          searchIndex++;
        }
      }

      if (closingTagIndex === -1) {
        // No matching closing tag, treat as self-closing
        const replacement = `<div ${replacementTag}${propsAttr}${othersAttr}></div>`;
        currentTemplate =
          currentTemplate.substring(0, startIndex) + replacement + currentTemplate.substring(tagEndIndex);
      } else {
        const innerContent = currentTemplate.substring(tagEndIndex, closingTagIndex);
        // Recursively process tags inside innerContent
        const processedInner = processComponentTags(innerContent);
        const replacement = `<div ${replacementTag}${propsAttr}${othersAttr}>${processedInner}</div>`;
        currentTemplate =
          currentTemplate.substring(0, startIndex) +
          replacement +
          currentTemplate.substring(closingTagIndex + closingTagLength);
      }
    }
  }
  return currentTemplate;
}
