/**
 * @file slotProps.js
 * @description Rewrites `:prop` bindings on `<slot>` tags into `data-props-*` attributes.
 */
import { scanTagEnd } from '../htmlTree.js';

/**
 * Processes slot elements in the template, converting dynamic props starting
 * with `:` to `data-props-` attributes.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 */
export function processSlotProps(template) {
  if (!template) return template;

  // The tag is bounded by the shared lexer rather than by `/<slot\b([^>]*?)>/`,
  // which ends a tag at the first `>` wherever it appears. Two shapes failed
  // silently: `<slot name="a > b" :item="row">`, and -- the one that matters --
  // `<slot :label="a > b ? x : y">`, a conditional passed to a scoped slot.
  // In both, the `:prop` was never rewritten to `data-props-*`, so the slot
  // received nothing and the raw directive was left in the markup.
  const out = [];
  let cursor = 0;

  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '<') continue;
    if (!/^<slot\b/i.test(template.slice(i, i + 6))) continue;

    const end = scanTagEnd(template, i);
    if (end === -1) continue;

    const attrsStr = template.slice(i + '<slot'.length, end);
    const replacedAttrs = attrsStr.replace(
      /\s+:([\w\d.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      (m, name, dquote, squote) => ` data-props-${name}="${dquote !== undefined ? dquote : squote}"`,
    );

    if (replacedAttrs !== attrsStr) {
      out.push(template.slice(cursor, i), `<slot${replacedAttrs}>`);
      cursor = end + 1;
    }
    i = end;
  }

  out.push(template.slice(cursor));
  return out.join('');
}
