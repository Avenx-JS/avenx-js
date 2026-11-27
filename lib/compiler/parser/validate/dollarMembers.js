/**
 * @file dollarMembers.js
 * @description Bare `$` member reference validation for actions and templates.
 */
import path from 'path';
import { getClosestKey } from '../../../config.js';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { getLineAndColumn } from '../../../core/utils/codeFrame.js';
import {
  BARE_DOLLAR_HELPERS_SET,
  THIS_ONLY_DOLLAR_MEMBERS_SET,
  ALL_COMPONENT_DOLLAR_MEMBERS,
} from '../../../core/runtime/componentHelpers.js';
import { TemplateValidationError } from '../../errors/index.js';
import { collectLocals, scanReferences } from '../../atlas/resolve.js';
import { reportWarning } from '../../utils/warningReporter.js';
import { collectTemplateEvents } from '../../templateEvents.js';
import { parseDeclarations } from '../declarations.js';
import { extractRootIdentifiers } from '../identifiers.js';
import { locateTemplateIdentifier } from './locations.js';

/**
 * Generates an actionable suggestion for an undeclared bare `$` identifier (AVX_W71).
 * @param {string} id - The bare `$` identifier.
 * @returns {string} Suggestion string (starting with a space) or empty string.
 */
export function formatDollarMemberSuggestion(id) {
  if (THIS_ONLY_DOLLAR_MEMBERS_SET.has(id)) {
    return ` Use "this.${id}" instead.`;
  }
  const closest = getClosestKey(id, ALL_COMPONENT_DOLLAR_MEMBERS);
  if (closest) {
    if (THIS_ONLY_DOLLAR_MEMBERS_SET.has(closest)) {
      return ` Did you mean "this.${closest}"?`;
    }
    return ` Did you mean "${closest}"?`;
  }
  return '';
}

/**
 * Validates bare dollar identifiers in <action> tags (AVX_W71).
 *
 * Actions are statement JavaScript. Identifiers starting with `$` that are not
 * bare-injected helpers, not local declarations or parameters, and not accessed
 * via `this.` or another receiver are reported.
 * @param {string} content - Full component source.
 * @param {string} [filePath] - Component file path.
 * @param {string} [name] - Component name.
 * @param {object|null} [config] - Project configuration.
 * @returns {TemplateValidationError[]} Warnings emitted.
 */
export function validateActionBareDollarMembers(content, filePath = '', name = '', config = null) {
  if (typeof content !== 'string' || !content.includes('$')) return [];

  const parsed = parseDeclarations(content);
  if (!parsed.actions || parsed.actions.length === 0) return [];

  const templateGlobals = new Set(Array.isArray(config?.templateGlobals) ? config.templateGlobals : []);

  const warnings = [];

  for (const action of parsed.actions) {
    if (!action.body || typeof action.body !== 'string' || !action.body.includes('$')) continue;

    const rawBody = content.slice(action.bodyOffset);
    const leadingWsMatch = rawBody.match(/^\s*/);
    const leadingWs = leadingWsMatch ? leadingWsMatch[0].length : 0;
    const exactBodyStart = action.bodyOffset + leadingWs;

    const locals = collectLocals(action.body);
    const scanned = scanReferences(action.body, { locals, base: exactBodyStart });
    const seenIndices = new Set();

    for (const ref of scanned.references) {
      if (!ref.root || !ref.root.startsWith('$')) continue;
      if (BARE_DOLLAR_HELPERS_SET.has(ref.root) || templateGlobals.has(ref.root)) continue;
      if (locals.has(ref.root)) continue;
      if (seenIndices.has(ref.index)) continue;
      seenIndices.add(ref.index);

      const pos = getLineAndColumn(content, ref.index);
      const suggestion = formatDollarMemberSuggestion(ref.root);
      const err = new TemplateValidationError(
        AvenxErrorCodes.COMPILER_BARE_DOLLAR_MEMBER,
        ref.root,
        `action "${action.name || name || 'anonymous'}"`,
        pos.line,
        suggestion,
      );
      err.setLocation({
        source: content,
        index: ref.index,
        filename: filePath,
        length: ref.root.length,
      });
      reportWarning(AvenxErrorCodes.COMPILER_BARE_DOLLAR_MEMBER, err, config);
      warnings.push(err);
    }
  }

  return warnings;
}

/**
 * Validates bare dollar identifiers across both action bodies and template expressions (AVX_W71).
 * @param {string} content - Full component source.
 * @param {string} [template] - Template string (if omitted, extracted from content).
 * @param {string} [filePath] - Component file path.
 * @param {string} [name] - Component name.
 * @param {object|null} [config] - Project configuration.
 * @returns {TemplateValidationError[]} Warnings emitted.
 */
export function validateBareDollarMembers(content, template = '', filePath = '', name = '', config = null) {
  const warnings = [];
  if (content) {
    warnings.push(...validateActionBareDollarMembers(content, filePath, name, config));
  }
  const tmpl = template || (content ? parseDeclarations(content).template : '');
  if (tmpl && tmpl.includes('$')) {
    const filename = filePath ? path.basename(filePath) : name || 'Component';
    const events = collectTemplateEvents(tmpl);
    const seenExprIndices = new Set();
    for (const ev of events) {
      const expr =
        ev.type === 'interpolation' || ev.type === 'event' || ev.type === 'directive' || ev.type === 'condition'
          ? ev.expr
          : ev.type === 'loop_start'
            ? ev.list
            : null;
      if (!expr || !expr.includes('$')) continue;
      const ids = extractRootIdentifiers(expr);
      for (const id of ids) {
        if (!id.startsWith('$')) continue;
        if (BARE_DOLLAR_HELPERS_SET.has(id)) continue;
        const loc = locateTemplateIdentifier(content, tmpl, ev.index, expr, id, filePath);
        if (loc.index >= 0 && seenExprIndices.has(loc.index)) continue;
        if (loc.index >= 0) seenExprIndices.add(loc.index);

        const pos = getLineAndColumn(loc.source, loc.index);
        const suggestion = formatDollarMemberSuggestion(id);
        const templateContext = filename ? `template of ${filename}` : 'template';
        const err = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_BARE_DOLLAR_MEMBER,
          id,
          templateContext,
          pos.line,
          suggestion,
        );
        if (loc.index >= 0) {
          err.setLocation({
            source: loc.source,
            index: loc.index,
            filename: loc.filename,
            length: id.length,
          });
        }
        reportWarning(AvenxErrorCodes.COMPILER_BARE_DOLLAR_MEMBER, err, config);
        warnings.push(err);
      }
    }
  }
  return warnings;
}

