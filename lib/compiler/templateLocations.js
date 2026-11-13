/**
 * @file templateLocations.js
 * @description Extracts precise original source line and column locations for all template expressions.
 * Used to emit expression location metadata (exprLocations) for runtime diagnostics (AVX_R08, AVX_W21-W23).
 */

import { maskDeclarations, lineIndex, positionAt } from './atlas/source.js';
import { tokenizeMarkup } from '../core/utils/markupLexer.js';
import { parseForHeader } from './ir/build.js';

/**
 * Extracts expression locations from the original component source content.
 * Since declarations are masked character-for-character with newlines preserved,
 * offsets map directly to the developer's original source file.
 * @param {string} content - Full component source code (.component.js, .page.js, .html, etc.).
 * @param {string} [filePath] - The component's file path.
 * @returns {{ locations: object[], byExpr: object, byType: object, findLocation: function }}
 */
export function extractTemplateLocations(content, filePath = null) {
  if (!content || typeof content !== 'string') {
    return {
      locations: [],
      byExpr: {},
      byType: {},
      findLocation() {
        return null;
      },
    };
  }

  const masked = maskDeclarations(content);
  const starts = lineIndex(content);
  const locations = [];

  // 1. Interpolations {{{ ... }}} and {{ ... }}
  const interpRegex = /\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g;
  let match;
  while ((match = interpRegex.exec(masked)) !== null) {
    const raw = match[1] !== undefined;
    const rawBody = raw ? match[1] : match[2];
    const expr = rawBody.trim();
    if (!expr) continue;
    const leadingSpaces = rawBody.length - rawBody.trimStart().length;
    const exprOffset = match.index + (raw ? 3 : 2) + leadingSpaces;
    const pos = positionAt(starts, exprOffset);
    locations.push({
      type: 'interpolation',
      expr,
      raw,
      offset: exprOffset,
      line: pos.line,
      column: pos.column,
      file: filePath || null,
    });
  }

  // 2. Tokenized markup: directives, loops, conditionals, dynamic attributes
  const tokens = tokenizeMarkup(masked);
  for (const token of tokens) {
    if (token.type !== 'open') continue;
    const lowerName = String(token.name || '').toLowerCase();

    // Directive tags: <@for>, <@if>, <@elseif>, <@defer>
    if (lowerName === '@for') {
      const header = masked.slice(token.nameEnd, token.attrEnd).trim();
      try {
        const parts = parseForHeader(header);
        if (parts.list) {
          const listExpr = parts.list.trim();
          const listOffsetInHeader = header.indexOf(parts.list);
          const listOffset =
            token.nameEnd +
            (masked.slice(token.nameEnd, token.attrEnd).length - masked.slice(token.nameEnd, token.attrEnd).trimStart().length) +
            (listOffsetInHeader >= 0 ? listOffsetInHeader : 0);
          const pos = positionAt(starts, listOffset);
          locations.push({
            type: 'for',
            expr: listExpr,
            item: parts.item,
            offset: listOffset,
            line: pos.line,
            column: pos.column,
            file: filePath || null,
          });
        }
      } catch {
        /* ignore parse error */
      }
    } else if (lowerName === '@if' || lowerName === '@elseif') {
      const header = masked.slice(token.nameEnd, token.attrEnd).trim();
      if (header) {
        const headerOffset =
          token.nameEnd +
          (masked.slice(token.nameEnd, token.attrEnd).length - masked.slice(token.nameEnd, token.attrEnd).trimStart().length);
        const pos = positionAt(starts, headerOffset);
        locations.push({
          type: 'if',
          expr: header,
          offset: headerOffset,
          line: pos.line,
          column: pos.column,
          file: filePath || null,
        });
      }
    }

    // Attributes on element
    for (const attr of token.attrs || []) {
      if (attr.value === null) continue;
      const attrName = attr.name;
      const trimmedVal = attr.value.trim();

      // Dynamic attribute name: :[attrName]="val"
      if (attrName.startsWith(':[') && attrName.endsWith(']')) {
        const nameExpr = attrName.slice(2, -1).trim();
        const nameOffset = attr.start + 2;
        const namePos = positionAt(starts, nameOffset);
        locations.push({
          type: 'attr_name',
          expr: nameExpr,
          offset: nameOffset,
          line: namePos.line,
          column: namePos.column,
          file: filePath || null,
        });

        // The value expression
        if (trimmedVal && !trimmedVal.includes('{{')) {
          const valOffset = attr.valueStart !== undefined ? attr.valueStart : attr.start + attrName.length + 1;
          const valPos = positionAt(starts, valOffset);
          locations.push({
            type: 'attr_value',
            expr: trimmedVal,
            offset: valOffset,
            line: valPos.line,
            column: valPos.column,
            file: filePath || null,
          });
        }
        continue;
      }

      // Bound attributes: :attr="expr" or data-ax-bind:attr="expr"
      if (
        (attrName.startsWith(':') && !attrName.startsWith(':[') && !attrName.startsWith('::')) ||
        attrName.startsWith('data-ax-bind:')
      ) {
        if (trimmedVal && !trimmedVal.includes('{{')) {
          const valOffset = attr.valueStart !== undefined ? attr.valueStart : attr.start + attrName.length + 1;
          const pos = positionAt(starts, valOffset);
          locations.push({
            type: 'attr',
            expr: trimmedVal,
            offset: valOffset,
            line: pos.line,
            column: pos.column,
            file: filePath || null,
          });
        }
        continue;
      }

      // data-ax-show
      if (attrName === 'data-ax-show') {
        const valOffset = attr.valueStart !== undefined ? attr.valueStart : attr.start + attrName.length + 1;
        const pos = positionAt(starts, valOffset);
        locations.push({
          type: 'show',
          expr: trimmedVal,
          offset: valOffset,
          line: pos.line,
          column: pos.column,
          file: filePath || null,
        });
        continue;
      }

      // data-ax-class
      if (attrName === 'data-ax-class') {
        const valOffset = attr.valueStart !== undefined ? attr.valueStart : attr.start + attrName.length + 1;
        const pos = positionAt(starts, valOffset);
        locations.push({
          type: 'class',
          expr: trimmedVal,
          offset: valOffset,
          line: pos.line,
          column: pos.column,
          file: filePath || null,
        });
        continue;
      }

      // data-ax-html
      if (attrName === 'data-ax-html') {
        const valOffset = attr.valueStart !== undefined ? attr.valueStart : attr.start + attrName.length + 1;
        const pos = positionAt(starts, valOffset);
        locations.push({
          type: 'html',
          expr: trimmedVal,
          offset: valOffset,
          line: pos.line,
          column: pos.column,
          file: filePath || null,
        });
        continue;
      }

      // <@defer when="expr">
      if (lowerName === '@defer' && (attrName === 'when' || attrName === ':when')) {
        const valOffset = attr.valueStart !== undefined ? attr.valueStart : attr.start + attrName.length + 1;
        const pos = positionAt(starts, valOffset);
        locations.push({
          type: 'defer',
          expr: trimmedVal,
          offset: valOffset,
          line: pos.line,
          column: pos.column,
          file: filePath || null,
        });
        continue;
      }
    }
  }

  // Sort locations by offset in document order
  locations.sort((a, b) => a.offset - b.offset);

  // Group by expression and by type
  const byExpr = {};
  const byType = {};
  for (const loc of locations) {
    if (!byExpr[loc.expr]) byExpr[loc.expr] = [];
    byExpr[loc.expr].push(loc);

    if (!byType[loc.type]) byType[loc.type] = [];
    byType[loc.type].push(loc);
  }

  return {
    locations,
    byExpr,
    byType,
    findLocation(expr, occurrence = 0, type = null) {
      if (type && byType[type]) {
        const matching = byType[type].filter((l) => l.expr === expr);
        if (matching.length > 0) {
          return matching[Math.min(occurrence, matching.length - 1)];
        }
      }
      if (byExpr[expr]) {
        return byExpr[expr][Math.min(occurrence, byExpr[expr].length - 1)];
      }
      return null;
    },
  };
}
