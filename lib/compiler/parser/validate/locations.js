/**
 * @file locations.js
 * @description Source-location mapping helpers for template validation.
 */
import { parseDeclarations } from '../declarations.js';

/**
 * Maps a template offset back to the component file where possible.
 *
 * Declarations are removed from the source before the template is processed,
 * so a template offset is not a file offset. The tag's own text is searched
 * for in the file first; when a rewrite has already changed it, the location
 * falls back to the template itself.
 * @param {string} content - The component source.
 * @param {string} template - The template the offset refers to.
 * @param {number} offset - Offset into the template.
 * @param {string} snippet - The text at that offset.
 * @param {string} filePath - The component path.
 * @returns {{source: string, index: number, filename: string}} A location.
 */
export function frontEndLocation(content, template, offset, snippet, filePath) {
  const index = typeof content === 'string' && snippet ? content.indexOf(snippet) : -1;
  return index >= 0
    ? { source: content, index, filename: filePath }
    : { source: template, index: offset, filename: filePath };
}

/**
 * Maps an offset in a template string (which has declaration ranges stripped) back
 * to the original component source text offset.
 * @param {number} tOffset - Offset within template.
 * @param {string} source - Component source content.
 * @param {Array<{start: number, end: number}>} ranges - Stripped declaration ranges.
 * @returns {number} Offset within source.
 */
export function templateOffsetToContentOffset(tOffset, source, ranges) {
  if (!ranges || ranges.length === 0) return tOffset;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let tCursor = 0;
  for (const range of sorted) {
    if (range.start < cursor) continue;
    const chunkLen = range.start - cursor;
    if (tOffset <= tCursor + chunkLen) {
      return cursor + (tOffset - tCursor);
    }
    tCursor += chunkLen;
    cursor = range.end;
  }
  return cursor + (tOffset - tCursor);
}

/**
 * Locates the exact position of an identifier within template or component source.
 * @param {string|null} content - Component source code.
 * @param {string} template - Template string.
 * @param {number} eventIndex - Template offset where expression begins.
 * @param {string} expr - Expression source.
 * @param {string} id - Identifier to locate.
 * @param {string} filePath - File path for location.
 * @returns {{source: string, index: number, filename: string}}
 */
export function locateTemplateIdentifier(content, template, eventIndex, expr, id, filePath) {
  if (typeof content === 'string') {
    const decls = parseDeclarations(content);
    if (eventIndex >= 0) {
      const cOffset = templateOffsetToContentOffset(eventIndex, content, decls.ranges);
      const exactIndex = content.indexOf(id, cOffset);
      if (exactIndex >= 0 && exactIndex <= cOffset + (expr ? expr.length + 30 : 50)) {
        return { source: content, index: exactIndex, filename: filePath };
      }
    }
    const headerEnd = decls.ranges.length > 0 ? Math.max(...decls.ranges.map((r) => r.end)) : 0;
    const contentIdx = content.indexOf(expr, headerEnd);
    if (contentIdx >= 0) {
      const idOffset = expr.indexOf(id);
      return { source: content, index: contentIdx + (idOffset >= 0 ? idOffset : 0), filename: filePath };
    }
    const fallbackIdx = content.indexOf(id, headerEnd);
    if (fallbackIdx >= 0) {
      return { source: content, index: fallbackIdx, filename: filePath };
    }
  }

  let targetIndex = eventIndex >= 0 ? eventIndex : template ? template.indexOf(expr) : -1;
  if (targetIndex >= 0 && expr && id) {
    const idOffset = expr.indexOf(id);
    if (idOffset >= 0) targetIndex += idOffset;
  } else if (targetIndex < 0 && template && id) {
    targetIndex = template.indexOf(id);
  }
  return { source: template, index: Math.max(0, targetIndex), filename: filePath };
}

