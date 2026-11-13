import { tokenizeMarkup, applyEdits, quoteAttributeValue } from './markupLexer.js';
import { unescapeHtml } from '../security/escapeHtml.js';

/**
 * Restores scoped-slot interpolations after one level of HTML serialization.
 * @param {string} template - Markup containing escaped scoped-slot expressions.
 * @returns {string} Markup with expressions restored and literal HTML untouched.
 */
export function restoreScopedSlotInterpolations(template) {
  return template.replace(/_AX_LBRACE(3?)_([\s\S]*?)_AX_RBRACE\1_/g, (match, raw, expression) => {
    const decoded = expression.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => unescapeHtml(entity));
    return raw ? `{{{${decoded}}}}` : `{{${decoded}}}`;
  });
}

/**
 * Creates a fresh regex matching template interpolations — both the raw
 * triple-brace form and the escaped double-brace form.
 *
 * Expressions may span multiple lines (a long ternary or object literal wraps
 * naturally, and formatters will wrap them), so the pattern must not stop at a
 * newline. The compiler and the runtime share this single definition: when the
 * two sides used different patterns, a wrapped expression passed compile-time
 * validation and then rendered as literal braces at runtime with no diagnostic.
 *
 * A new instance is returned on every call because the regex is global and
 * callers rely on their own `lastIndex`.
 * @returns {RegExp} A fresh global interpolation regex.
 */
export function createInterpolationRegex() {
  return /\{\{\{\s*([\s\S]*?)\s*\}\}\}|\{\{\s*([\s\S]*?)\s*\}\}/g;
}

/**
 * Expands `data-ax-bind` on `<input>`, `<textarea>` and `<select>` elements.
 *
 * `data-ax-bind="expr"` becomes a value binding plus a write-back handler:
 *
 * - text inputs, textareas: `value="{{ expr }}" @input="expr = event.target.value"`
 * - number and range inputs: `value` as above, and an `@input` that writes
 *   `event.target.valueAsNumber`, or `null` when the field is empty
 * - selects: `value="{{ expr }}" @change="expr = event.target.value"`
 * - multiple selects: `value` as above, and an `@change` that writes the
 *   selected option values as an array
 * - checkboxes: `checked` bound to the value (or membership, for an array) and
 *   an `@change` that writes or toggles membership
 * - radios: `checked` bound to equality with the radio's value, and `@change`
 *
 * The template is read with the shared markup lexer, so an attribute value
 * containing `>` no longer ends the tag early, and only the tag being expanded
 * changes. Attributes are rejoined with single spaces, as before, but a value's
 * own whitespace is kept. Generated attributes use whichever quote the
 * expression does not contain, so `data-ax-bind='user["name"]'` expands to a
 * binding the expression compiler can read.
 * @param {string} template - The template string.
 * @returns {string} The processed template.
 * @throws {Error} When a bound expression contains both quote characters and
 *   cannot be written into an attribute verbatim.
 */
export function processBindDirectives(template) {
  if (typeof template !== 'string' || !/data-ax-bind/i.test(template)) return template;

  const edits = [];
  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open' || token.unterminated || token.directive) continue;
    const tagName = token.name.toLowerCase();
    if (tagName !== 'input' && tagName !== 'textarea' && tagName !== 'select') continue;

    const bind = token.attrs.find((attr) => attr.name.toLowerCase() === 'data-ax-bind' && attr.value !== null);
    if (!bind) continue;

    edits.push({ start: token.start, end: token.end, text: expandBoundTag(template, token, bind) });
  }
  return applyEdits(template, edits);
}

/**
 * Writes one generated attribute, choosing a quote the value does not contain.
 * @param {string} name - The attribute name.
 * @param {string} value - The attribute value.
 * @returns {string} `name="value"` or `name='value'`.
 * @throws {Error} When the value contains both quote characters.
 */
function generatedAttribute(name, value) {
  const quoted = quoteAttributeValue(value);
  if (quoted === null) {
    throw new Error(
      `data-ax-bind cannot write ${name} for an expression containing both " and ': ${value}\n` +
        'Move the expression into a computed value or an action and bind that name instead.',
    );
  }
  return `${name}=${quoted}`;
}

/**
 * Rebuilds one bound tag.
 * @param {string} template - The template source.
 * @param {object} token - The open-tag token.
 * @param {object} bind - The `data-ax-bind` attribute token.
 * @returns {string} The expanded tag.
 */
function expandBoundTag(template, token, bind) {
  const tagName = token.name;
  const lowerTag = tagName.toLowerCase();
  const bindExpr = bind.value.trim();
  const suffix = token.selfClosing ? ' />' : '>';
  const findAttr = (name) => token.attrs.find((attr) => attr.name.toLowerCase() === name);
  const attrValue = (name) => {
    const found = findAttr(name);
    return found ? found.value : undefined;
  };

  const kept = (exclude) =>
    token.attrs
      .filter((attr) => attr !== bind && !exclude(attr))
      .map((attr) => template.slice(attr.start, attr.end));

  const assemble = (attrs) => `<${[tagName, ...attrs].join(' ')}${suffix}`;

  if (lowerTag === 'input') {
    const type = (attrValue('type') || 'text').toLowerCase();

    if (type === 'number' || type === 'range') {
      // `event.target.value` is a string for every input type; writing it back
      // turned numeric state into a string on the first keystroke. The element
      // already parses its own value, and reads NaN for an empty or partially
      // typed field, which becomes null so that neither NaN nor "" reaches
      // state. `valueAsNumber` is only read once the field is known numeric,
      // so no quote characters are needed and the attribute quoting stays as
      // permissive as for a text input.
      return assemble([
        ...kept(() => false),
        generatedAttribute('value', `{{ ${bindExpr} }}`),
        generatedAttribute(
          '@input',
          `${bindExpr} = (Number.isNaN(event.target.valueAsNumber) ? null : event.target.valueAsNumber)`,
        ),
      ]);
    }

    if (type === 'checkbox' || type === 'radio') {
      const rawValue = attrValue('value');
      let jsValue;
      if (rawValue === undefined || rawValue === null) {
        jsValue = "'on'";
      } else if (rawValue.trim().includes('{{')) {
        jsValue = rawValue.trim().replace(/\{\{\s*|\s*\}\}/g, '');
      } else {
        jsValue = `'${rawValue.trim().replace(/'/g, "\\'")}'`;
      }

      // `checked` is owned by the binding; an authored one would fight it.
      const others = kept((attr) => attr.name.toLowerCase() === 'checked');

      if (type === 'checkbox') {
        return assemble([
          ...others,
          generatedAttribute(
            'checked',
            `{{ Array.isArray(${bindExpr}) ? (${bindExpr}).includes(${jsValue}) : !!(${bindExpr}) }}`,
          ),
          generatedAttribute(
            '@change',
            `Array.isArray(${bindExpr}) ? (event.target.checked ? (!(${bindExpr}).includes(${jsValue}) ? (${bindExpr}).push(${jsValue}) : null) : ((${bindExpr}).includes(${jsValue}) ? (${bindExpr}).splice((${bindExpr}).indexOf(${jsValue}), 1) : null)) : (${bindExpr} = event.target.checked)`,
          ),
        ]);
      }

      return assemble([
        ...others,
        generatedAttribute('checked', `{{ (${bindExpr}) === ${jsValue} }}`),
        generatedAttribute('@change', `${bindExpr} = event.target.value`),
      ]);
    }
  }

  // `multiple` is a boolean attribute: present in any form it is on, except the
  // literal "false", which the renderer's boolean coercion treats as off.
  const multiple = lowerTag === 'select' ? findAttr('multiple') : undefined;
  if (multiple && multiple.value !== 'false') {
    // `event.target.value` on a multiple select is only the first selected
    // option, so writing it back replaced the bound array with one string and
    // lost every other selection. The selected options, in document order, are
    // the mirror of the array-bound checkbox group.
    return assemble([
      ...kept(() => false),
      generatedAttribute('value', `{{ ${bindExpr} }}`),
      generatedAttribute('@change', `${bindExpr} = Array.from(event.target.selectedOptions, (option) => option.value)`),
    ]);
  }

  const eventName = lowerTag === 'select' ? 'change' : 'input';
  return assemble([
    ...kept(() => false),
    generatedAttribute('value', `{{ ${bindExpr} }}`),
    generatedAttribute(`@${eventName}`, `${bindExpr} = event.target.value`),
  ]);
}

/**
 * Hides one level of interpolation markers from the current render pass.
 *
 * A `<@for>` body is rendered once per item, so its `{{ }}` must survive the
 * component's own render untouched and be resolved later, per row. The compiler
 * therefore rewrites the body's markers to `{% %}` and the list manager restores
 * them when it renders each row.
 *
 * The depth matters. A list nested inside a list is rendered twice, once as
 * part of the outer row and once per inner item, so its markers have to survive
 * two passes. Escaping deepens an existing marker rather than leaving it alone,
 * so each nesting level adds one `%` and each render removes one. Before this,
 * the inner body was escaped once and unescaped by the outer row, which meant
 * `{{ row.id }}` was evaluated in the group's scope, where `row` does not
 * exist, and every nested list rendered empty.
 * @param {string} text - Template text to escape one level.
 * @returns {string} The escaped text.
 */
export function escapeTemplateMarkers(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\{\{|\{(%+)/g, (match, percents) => (percents ? `{${percents}%` : '{%'))
    .replace(/\}\}|(%+)\}/g, (match, percents) => (percents ? `${percents}%}` : '%}'));
}

/**
 * Restores one level of interpolation markers before rendering.
 *
 * The inverse of {@link escapeTemplateMarkers}: `{%` becomes `{{` and `{%%`
 * becomes `{%`, so a nested body keeps exactly the levels its own nesting
 * requires.
 * @param {string} text - Template text to unescape one level.
 * @returns {string} The unescaped text.
 */
export function unescapeTemplateMarkers(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\{(%+)/g, (match, percents) => (percents.length === 1 ? '{{' : `{${percents.slice(1)}`))
    .replace(/(%+)\}/g, (match, percents) => (percents.length === 1 ? '}}' : `${percents.slice(1)}}`));
}
