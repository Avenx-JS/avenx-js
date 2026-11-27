/**
 * @file attributes.js
 * @description Event handler and dynamic attribute binding validation.
 */
import path from 'path';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { isEventHandlerAttribute } from '../../../core/security/eventAttributes.js';
import { tokenizeMarkup } from '../../../core/utils/markupLexer.js';
import { TemplateValidationError } from '../../errors/index.js';
import { reportWarning } from '../../utils/warningReporter.js';
import { loadAvenxConfig } from '../projectConfig.js';
import { frontEndLocation } from './locations.js';

/**
 * Refuses a bound inline event handler, and warns on a static one.
 *
 * An `on*` attribute on an HTML element runs its value as JavaScript. Bound to
 * an interpolation (`onclick="{{ handler }}"`), that executes application state
 * as code, so it is a build error (AVX_C28) with the `@event` form as the
 * fix. Written as a literal (`onclick="doThing()"`), it is the developer's own
 * code -- kept, but warned (AVX_W52), because it bypasses the event system and
 * a strict CSP.
 *
 * Only lowercase HTML element tags are checked. An `on*` attribute on a
 * PascalCase component tag is a prop passed to the child, never set as a DOM
 * handler, so it is left alone.
 * @param {string} template - The semantic template (component tags intact).
 * @param {string} content - The component source, for locations.
 * @param {string} filePath - The component path.
 * @param {string} name - The component class name.
 * @param {object} [options] - Parser state the check reads.
 * @param {object|null} [options.config] - The parser's explicit project configuration. When
 *   absent, the configuration is resolved from `filePath`.
 * @throws {TemplateValidationError} AVX_C28 for a bound handler.
 */
export function validateEventHandlerAttributes(
  template,
  content,
  filePath,
  name,
  { config: parserConfig = null } = {},
) {
  if (typeof template !== 'string' || !/\bon/i.test(template)) return;
  const config = parserConfig || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open' || token.unterminated || token.directive) continue;
    // A component reference is PascalCase; its attributes are props.
    if (/^[A-Z]/.test(token.name)) continue;
    for (const attr of token.attrs) {
      if (!isEventHandlerAttribute(attr.name)) continue;
      const value = attr.value || '';
      const eventName = attr.name.toLowerCase().slice(2);
      const snippet = template.slice(token.start, Math.min(token.end, token.start + 100)).split('\n')[0];
      if (value.includes('{{') || value.includes('{%')) {
        const error = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_BOUND_EVENT_ATTRIBUTE,
          name,
          attr.name,
          snippet,
          eventName,
        );
        error.setLocation(frontEndLocation(content, template, attr.start, `${attr.name}=`, filePath));
        throw error;
      }
      const warning = new TemplateValidationError(
        AvenxErrorCodes.COMPILER_INLINE_EVENT_ATTRIBUTE,
        name,
        attr.name,
        eventName,
        filePath ? path.basename(filePath) : 'this component',
      );
      warning.setLocation(frontEndLocation(content, template, attr.start, `${attr.name}=`, filePath));
      reportWarning(AvenxErrorCodes.COMPILER_INLINE_EVENT_ATTRIBUTE, warning, config);
    }
  }
}

/**
 * Refuses a dynamic attribute binding whose slots are written as
 * interpolations.
 *
 * Both slots of `:[name]="value"` are expressions -- that is what the API
 * reference documents, and it is how the string renderer resolves them. Write
 * either one as `{{ ... }}` and the braces become part of the expression:
 * `{{ v }}` is not valid JavaScript, so it resolves to nothing.
 *
 * The two halves failed differently and neither failed usefully. A braced
 * name surfaced only as a production expression error (AVX_C27, "Expected a
 * property name"), which names the symptom rather than the construct. A
 * braced value did not fail at all: the name still resolved, so the element
 * was tagged `data-ax-dyn-attrs` -- claiming the attribute was being managed
 * -- while the attribute itself was never set, in development and production
 * alike, with nothing reported.
 *
 * Refused here so both halves say the same thing, at build time, and name the
 * unbraced form as the fix. Nothing that worked before stops working: the
 * construct has never produced an attribute.
 * @param {string} template - The semantic template.
 * @param {string} content - The component source, for locations.
 * @param {string} filePath - The component path.
 * @param {string} name - The component class name.
 * @throws {TemplateValidationError} AVX_C29 for an interpolated slot.
 */
export function validateDynamicAttributeBindings(template, content, filePath, name) {
  if (typeof template !== 'string' || !template.includes(':[')) return;

  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open' || token.unterminated || token.directive) continue;
    for (const attr of token.attrs) {
      if (!attr.name.startsWith(':[') || !attr.name.endsWith(']')) continue;

      const nameExpr = attr.name.slice(2, -1);
      const value = attr.value || '';
      const nameBraced = nameExpr.includes('{{') || nameExpr.includes('{%');
      const valueBraced = value.includes('{{') || value.includes('{%');
      if (!nameBraced && !valueBraced) continue;

      const snippet = template.slice(token.start, Math.min(token.end, token.start + 100)).split('\n')[0];
      const strip = (text) => text.replace(/\{\{\{?|\}\}\}?|\{%|%\}/g, '').trim();
      const error = new TemplateValidationError(
        AvenxErrorCodes.COMPILER_INTERPOLATED_DYNAMIC_ATTRIBUTE,
        name,
        nameBraced ? 'attribute name' : 'value',
        snippet,
        strip(nameExpr),
        strip(value),
      );
      error.setLocation(frontEndLocation(content, template, attr.start, attr.name, filePath));
      throw error;
    }
  }
}

