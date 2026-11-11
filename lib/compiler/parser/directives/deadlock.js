/**
 * @file deadlock.js
 * @description Desugars `<@deadlock>` boundaries into DOM markers.
 */
import path from 'path';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { escapeTemplateMarkers } from '../../../core/utils/templateUtils.js';
import { TemplateValidationError } from '../../errors/index.js';
import { reportWarning } from '../../utils/warningReporter.js';
import { getLineAndColumn } from '../htmlTree.js';
import { loadAvenxConfig } from '../projectConfig.js';

/**
 * Processes <@deadlock> tags, converting them to DOM boundary markers.
 * Supports attributes: name="...", maxDepth="...", action="abort|fallback|throw", isolated="true|false",
 * and optional inner <@fallback as="..."> tags for error recovery.
 *
 * Invalid attribute values are reported as AVX_W35 and dropped; the boundary
 * itself is still emitted.
 * @param {string} template - The template string.
 * @param {string} [filePath] - The component file path for source location tracking.
 * @param {string} [componentName] - The component name for diagnostics.
 * @param {object} [options] - Parser state the pass reads.
 * @param {object|null} [options.config] - The parser's explicit project configuration. When
 *   absent, the configuration is resolved from `filePath`.
 * @returns {string} The processed template.
 */
export function processDeadlock(template, filePath = '', componentName = '', { config = null } = {}) {
  let currentTemplate = template;
  const deadlockRegex = /<@deadlock\b([^>]*)>((?:(?!<@deadlock\b)[\s\S])*?)<\/ ?@deadlock>/i;
  const activeConfig = config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);

  while (true) {
    const match = currentTemplate.match(deadlockRegex);
    if (!match) break;

    const fullMatch = match[0];
    const attrsStr = match[1] || '';
    const inner = match[2];

    const nameMatch = attrsStr.match(/\bname=["']([^"']*)["']/i);
    const name = nameMatch ? nameMatch[1].trim() : 'anonymous';

    const depthMatch = attrsStr.match(/\bmaxDepth=["']([^"']*)["']/i);
    let depthAttr = '';
    if (depthMatch) {
      const rawDepth = depthMatch[1].trim();
      const parsedDepth = Number(rawDepth);
      if (!/^\d+$/.test(rawDepth) || !Number.isInteger(parsedDepth) || parsedDepth <= 0) {
        reportWarning(
          AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED,
          new TemplateValidationError(
            AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED,
            componentName || (filePath ? path.basename(filePath) : 'Component'),
            `invalid maxDepth "${rawDepth}". Expected a positive integer.`,
          ),
          activeConfig,
        );
      } else {
        depthAttr = ` data-ax-deadlock-depth="${parsedDepth}"`;
      }
    }

    const actionMatch = attrsStr.match(/\baction=["']([^"']*)["']/i);
    let actionAttr = '';
    if (actionMatch) {
      const rawAction = actionMatch[1].trim().toLowerCase();
      if (!['abort', 'fallback', 'throw'].includes(rawAction)) {
        reportWarning(
          AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED,
          new TemplateValidationError(
            AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED,
            componentName || (filePath ? path.basename(filePath) : 'Component'),
            `invalid action "${rawAction}". Expected "abort", "fallback", or "throw".`,
          ),
          activeConfig,
        );
      } else {
        actionAttr = ` data-ax-deadlock-action="${rawAction}"`;
      }
    }

    const isolatedMatch = attrsStr.match(/\bisolated=["']([^"']*)["']/i);
    let isolatedAttr = '';
    if (isolatedMatch) {
      const rawIsolated = isolatedMatch[1].trim().toLowerCase();
      if (rawIsolated !== 'true' && rawIsolated !== 'false') {
        reportWarning(
          AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED,
          new TemplateValidationError(
            AvenxErrorCodes.COMPILER_DEADLOCK_PARSE_FAILED,
            componentName || (filePath ? path.basename(filePath) : 'Component'),
            `invalid isolated "${rawIsolated}". Expected "true" or "false".`,
          ),
          activeConfig,
        );
      } else {
        isolatedAttr = ` data-ax-deadlock-isolated="${rawIsolated}"`;
      }
    }

    // Compute location if possible
    let locAttr = '';
    if (filePath) {
      const matchIdx = currentTemplate.indexOf(fullMatch);
      if (matchIdx !== -1) {
        const pos = getLineAndColumn(currentTemplate, matchIdx);
        locAttr = ` data-ax-deadlock-loc="${filePath}:${pos.line}:${pos.column}"`;
      }
    }

    // Extract <@fallback as="...">
    let fallbackContent = '';
    let errorAs = 'error';
    let boundaryContent = inner;
    const fallbackMatch = inner.match(/<@fallback(?:\s+as="([^"]*)")?>([\s\S]*?)<\/ ?@fallback>/i);
    if (fallbackMatch) {
      errorAs = fallbackMatch[1] || 'error';
      fallbackContent = escapeTemplateMarkers(fallbackMatch[2]);
      boundaryContent = inner.replace(fallbackMatch[0], '');
    }

    const fallbackTpl = fallbackMatch
      ? `<template data-ax-deadlock-fallback="true" data-ax-error-as="${errorAs}"><div class="ax-deadlock-fallback">${fallbackContent}</div></template>`
      : '';

    const replacement = `<div data-ax-deadlock="true" data-ax-deadlock-name="${name}"${depthAttr}${actionAttr}${isolatedAttr}${locAttr}>${fallbackTpl}${boundaryContent}</div>`;
    currentTemplate = currentTemplate.replace(fullMatch, replacement);
  }
  return currentTemplate;
}
