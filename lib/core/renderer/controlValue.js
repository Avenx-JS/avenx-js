/**
 * @file controlValue.js
 * @description Mirrors a bound `value` attribute onto a form control's property.
 *
 * For a form control the `value` attribute is the *default* value: once the
 * user has typed, the property and the attribute are independent, and setting
 * the attribute alone leaves what the user sees unchanged. Two-way binding
 * depends on this -- a state change made in code has to reach the control the
 * user has already touched. Both render paths call this after writing the
 * attribute, so the rule for turning the attribute into a property is stated
 * once.
 */

/**
 * Elements whose `value` attribute stops driving their value once a user has
 * typed into them.
 * @type {Set<string>}
 */
export const VALUE_PROPERTY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Input types whose binding writes a number rather than the typed string.
 * @type {Set<string>}
 */
const NUMERIC_INPUT_TYPES = new Set(['number', 'range']);

/**
 * Writes a rendered `value` attribute onto the control's `value` property.
 *
 * A `<select multiple>` is the exception. Its `value` property addresses one
 * option, so assigning the rendered array to it selected nothing -- an array
 * bound through `data-ax-bind` renders as `String(array)`, a comma-separated
 * list, and no option has that value. The list is split and each option's
 * `selected` follows membership, the mirror of the array-bound checkbox group.
 *
 * A number or range input is left alone while it already reads as the number
 * the attribute holds. Its binding writes a number, which renders back as that
 * number's canonical string: a typed "1.0" becomes 1 in state and "1" in the
 * attribute. Writing "1" over the control would discard the "0" the user is
 * about to follow with a digit, and "1e3" would turn into "1000" under their
 * cursor. A single select, a textarea and every other input assign the string
 * as before.
 * @param {Element} element - An `<input>`, `<textarea>` or `<select>`.
 * @param {string} value - The attribute value just rendered.
 * @returns {void}
 */
export function syncControlValue(element, value) {
  if (element.nodeName === 'SELECT' && element.multiple) {
    const selected = value === '' ? [] : value.split(',');
    for (const option of Array.from(element.options)) {
      const shouldSelect = selected.includes(option.value);
      if (option.selected !== shouldSelect) {
        option.selected = shouldSelect;
      }
    }
    return;
  }
  if (element.value === value) {
    return;
  }
  if (value !== '' && NUMERIC_INPUT_TYPES.has(element.type) && element.valueAsNumber === Number(value)) {
    return;
  }
  element.value = value;
}
