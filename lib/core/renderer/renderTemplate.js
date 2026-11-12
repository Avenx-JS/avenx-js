import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { HtmlEscaper, SafeHtml } from '../security/escapeHtml.js';
import { logger } from '../runtime/AvenxLogger.js';
import { LruCache } from '../utils/LruCache.js';
import { createInterpolationRegex } from '../utils/templateUtils.js';
import { findTagEnd } from '../utils/markupLexer.js';
import { isEventHandlerAttribute } from '../security/eventAttributes.js';
import { formatRenderDiagnostic } from '../diagnostics/renderDiagnostics.js';

const templateEscaper = new HtmlEscaper();
const DEFAULT_TEMPLATE_CACHE_CAPACITY = 500;

/**
 * Segment structure for parsed template AST:
 * @typedef {object} TemplateSegment
 * @property {boolean} isExpression - True if this segment is an interpolation expression.
 * @property {string} [value] - Static text content when isExpression is false.
 * @property {string} [expression] - Expression source code when isExpression is true.
 * @property {boolean} [isRaw] - True if raw interpolation {{{ ... }}} was used.
 */

/**
 * Handles the rendering of HTML templates by resolving interpolation expressions.
 * Uses an LruCache to cache parsed template AST segments with bounded capacity.
 */
export class TemplateRenderer {
  /**
   * Constructs the TemplateRenderer with a configurable LRU cache capacity.
   * @param {number|object} [capacityOrConfig] - Maximum LRU cache capacity or configuration object.
   */
  constructor(capacityOrConfig = DEFAULT_TEMPLATE_CACHE_CAPACITY) {
    let capacity = DEFAULT_TEMPLATE_CACHE_CAPACITY;
    let logContext = null;
    if (typeof capacityOrConfig === 'number' && capacityOrConfig > 0) {
      capacity = capacityOrConfig;
    } else if (capacityOrConfig && typeof capacityOrConfig === 'object') {
      if (typeof capacityOrConfig.templateCacheCapacity === 'number' && capacityOrConfig.templateCacheCapacity > 0) {
        capacity = capacityOrConfig.templateCacheCapacity;
      } else if (typeof capacityOrConfig.capacity === 'number' && capacityOrConfig.capacity > 0) {
        capacity = capacityOrConfig.capacity;
      }
      if (capacityOrConfig.logContext) {
        logContext = capacityOrConfig.logContext;
      }
    }

    /**
     * @type {object}
     */
    this.options = typeof capacityOrConfig === 'object' ? capacityOrConfig : {};

    /**
     * @type {object|null}
     */
    this.logContext = logContext;

    /**
     * Maximum capacity of the LRU cache.
     * @type {number}
     */
    this.capacity = capacity;

    /**
     * LRU Cache storing parsed template AST segments.
     * @type {LruCache}
     */
    this.cache = new LruCache(capacity);
  }

  /**
   * Parses a raw HTML template string into tokenized AST segments.
   * @param {string} template - The HTML template string.
   * @returns {TemplateSegment[]} Array of template segments.
   */
  parseTemplate(template) {
    const segments = [];
    const regex = createInterpolationRegex();
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(template)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          isExpression: false,
          value: template.substring(lastIndex, match.index),
        });
      }
      const isRaw = match[1] !== undefined;
      const expression = isRaw ? match[1] : match[2];
      segments.push({
        isExpression: true,
        expression,
        isRaw,
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < template.length) {
      segments.push({
        isExpression: false,
        value: template.substring(lastIndex),
      });
    }

    return segments;
  }

  /**
   * Clears the template LRU cache.
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Renders the template by replacing {{ expression }} and {{{ expression }}} with evaluated values.
   * @param {string} template - The HTML template string.
   * @param {function(string): any} resolveExpression - Function to evaluate expressions.
   * @param {object|null} [logContext=null] - Optional logging/diagnostic context.
   * @returns {string} The rendered HTML string.
   */
  render(template, resolveExpression, logContext = null) {
    if (!template) return '';

    const context = logContext || this.logContext || this.options?.logContext || {};

    let segments = this.cache.get(template);
    if (!segments) {
      segments = this.parseTemplate(template);
      this.cache.set(template, segments);
    }

    const occurrences = Object.create(null);
    let result = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg.isExpression) {
        result += seg.value;
      } else {
        const expression = seg.expression;
        const isRaw = seg.isRaw;
        const trimmed = typeof expression === 'string' ? expression.trim() : String(expression || '');
        const occ = (occurrences[trimmed] = (occurrences[trimmed] || 0) + 1) - 1;
        try {
          const value = resolveExpression(expression);
          if (value == null) {
            continue;
          }
          if (isRaw || value instanceof SafeHtml) {
            result += String(value);
          } else {
            result += templateEscaper.escape(value);
          }
        } catch (error) {
          if (error instanceof Promise) {
            throw error; // Suspense: bubble up the promise without logging
          }
          if (error && error.code === AvenxErrorCodes.STATE_MUTATION_IN_UPDATE) {
            throw error;
          }
          const formatted = formatRenderDiagnostic(
            AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
            expression,
            error,
            context,
            { occurrenceIndex: occ, type: 'interpolation' },
          );
          logger.warn(formatted, context);
          throw error;
        }
      }
    }

    return this.resolveDynamicAttributes(result, resolveExpression, context);
  }

  /**
   * Resolves dynamic attribute name binding syntax (:[attrName]="attrValue") in HTML string.
   * @param {string} html - The HTML string.
   * @param {function(string): any} resolveExpression - Function to evaluate expressions.
   * @param {object|null} [logContext=null] - Optional logging/diagnostic context.
   * @returns {string} The HTML string with dynamic attributes resolved.
   */
  resolveDynamicAttributes(html, resolveExpression, logContext = null) {
    if (!html || typeof html !== 'string' || !html.includes(':[')) {
      return html;
    }

    const context = logContext || this.logContext || this.options?.logContext || {};

    // Tags are located with the shared lexer's scanner rather than with
    // `/<([a-zA-Z0-9@/!-][^>]*?)>/g`, which ends a tag at the first `>` wherever
    // it appears. On `<div title="a > b" :[name]="val">` that regex matched only
    // `<div title="a >`, so the dynamic attribute fell outside the tag, was
    // never resolved, and `:[name]="val"` was left on the element as literal
    // markup -- silently, with the intended attribute simply absent.
    //
    // This runs after interpolation, so the `>` need not even be in the
    // template: any rendered value containing one, in any attribute before the
    // dynamic one, was enough.
    const rewritten = [];
    let cursor = 0;
    for (let i = 0; i < html.length; i++) {
      if (html[i] !== '<') continue;
      const end = findTagEnd(html, i);
      if (end === -1) continue;

      const fullTag = html.slice(i, end + 1);
      const tagInner = html.slice(i + 1, end);
      const replaced = rewriteTag(fullTag, tagInner);
      if (replaced !== fullTag) {
        rewritten.push(html.slice(cursor, i), replaced);
        cursor = end + 1;
      }
      i = end;
    }
    rewritten.push(html.slice(cursor));
    return rewritten.join('');

    /**
     * Resolves the dynamic attributes of one tag.
     * @param {string} fullTag - The tag as written, including its angle brackets.
     * @param {string} tagInner - The tag's contents, without the angle brackets.
     * @returns {string} The rewritten tag, or `fullTag` when nothing changed.
     */
    function rewriteTag(fullTag, tagInner) {
      if (tagInner.startsWith('/') || tagInner.startsWith('!') || tagInner.startsWith('?')) {
        return fullTag;
      }

      const dynAttrRegex = /:\[(.*?)\]\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
      if (!dynAttrRegex.test(tagInner)) {
        return fullTag;
      }
      dynAttrRegex.lastIndex = 0;

      const activeDynAttrs = [];
      const parts = [];
      let lastIdx = 0;
      let match;

      while ((match = dynAttrRegex.exec(tagInner)) !== null) {
        parts.push(tagInner.substring(lastIdx, match.index));
        const nameExpr = match[1];
        const valExpr = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);

        let resolvedName = null;
        try {
          resolvedName = resolveExpression(nameExpr);
        } catch (error) {
          const formatted = formatRenderDiagnostic(
            AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
            nameExpr,
            error,
            context,
            { type: 'attr_name' },
          );
          logger.warn(formatted, context);
        }

        if (resolvedName != null && String(resolvedName).trim() !== '') {
          const attrName = String(resolvedName).trim();

          // A dynamic name that resolves to an on* handler would write an
          // inline handler built from a value, which is the one on* path the
          // build cannot see: a literal `onclick="{{ x }}"` is refused as
          // AVX_C28, but `:[name]` is only known at run time.
          //
          // The compiled renderer and the DOM patcher have both refused this
          // for a while. This renderer did not -- and it is the one that
          // actually runs here, because a dynamic attribute name is itself a
          // reason the template cannot be compiled (AVX_W47). The name was
          // written straight into the markup, so by the time the patcher saw
          // the element the handler was already a parsed inline handler rather
          // than a dynamic attribute it would police.
          //
          // Measured in a browser: `:[handlerName]="handlerBody"` with
          // handlerName = 'onclick' produced onclick="window.__xss=1" and ran
          // it on the next click. A strict CSP stopped the execution but not
          // the attribute; without one, nothing did.
          if (isEventHandlerAttribute(attrName)) {
            logger.warn(formatMessage(AvenxErrorCodes.SECURITY_BLOCKED_EVENT_ATTRIBUTE, attrName));
            lastIdx = dynAttrRegex.lastIndex;
            continue;
          }

          let resolvedVal = null;
          if (valExpr !== undefined && valExpr !== null) {
            try {
              resolvedVal = resolveExpression(valExpr);
            } catch (error) {
              const formatted = formatRenderDiagnostic(
                AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
                valExpr,
                error,
                context,
                { type: 'attr_value' },
              );
              logger.warn(formatted, context);
            }
          }

          if (resolvedVal !== false && resolvedVal != null) {
            activeDynAttrs.push(attrName);
            if (resolvedVal === true) {
              parts.push(`${attrName}="true"`);
            } else {
              const escapedVal = templateEscaper.escape(String(resolvedVal));
              parts.push(`${attrName}="${escapedVal}"`);
            }
          } else {
            activeDynAttrs.push(attrName);
          }
        }

        lastIdx = dynAttrRegex.lastIndex;
      }

      parts.push(tagInner.substring(lastIdx));
      let newTagInner = parts.join('');

      if (activeDynAttrs.length > 0) {
        newTagInner += ` data-ax-dyn-attrs="${activeDynAttrs.join(',')}"`;
      }

      return `<${newTagInner}>`;
    }
  }
}
