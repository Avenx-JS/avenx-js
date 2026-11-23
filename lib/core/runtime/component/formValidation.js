import { parseValidationRules, validateValue, getFieldName, updateValidationState } from '../../validation/validator.js';
import { syncControlValue } from '../../renderer/controlValue.js';

/**
 * Evaluates validation rules for an element and updates state.$validation.
 * @param {Element} el - The element to validate.
 * @param {object} state - Reactive validation state.
 * @returns {string[]} Validation errors for the field.
 */
export function validateElement(el, state) {
  if (!el || typeof el.getAttribute !== 'function' || !el.hasAttribute('data-ax-validate')) {
    return [];
  }
  const ruleStr = el.getAttribute('data-ax-validate');
  const rules = parseValidationRules(ruleStr);
  const fieldName = getFieldName(el);
  let value = el.value;
  if (el.type === 'checkbox') {
    value = el.checked;
  }
  let customMessages = {};
  if (el.hasAttribute('data-ax-validate-messages')) {
    try {
      customMessages = JSON.parse(el.getAttribute('data-ax-validate-messages'));
    } catch {
      // Ignored
    }
  }
  const errors = validateValue(value, rules, { state: state, customMessages });
  updateValidationState(state, fieldName, errors);
  return errors;
}

/**
 * Validates all form input elements in the component that have data-ax-validate.
 * @param {Element|null} element - Component host.
 * @param {Function} validate - Public per-field validation callback.
 */
export function validateFormElements(element, validate) {
  if (!element || typeof element.querySelectorAll !== 'function') return;
  const elements = Array.from(element.querySelectorAll('[data-ax-validate]'));
  if (element.hasAttribute && element.hasAttribute('data-ax-validate')) {
    elements.unshift(element);
  }
  for (const el of elements) {
    validate(el);
  }
}

/**
 * Syncs the value property of select elements to match their value attribute
 * after child nodes and lists are fully patched/rendered.
 * @param {Element|null} element - Component host.
 */
export function syncSelectElements(element) {
  if (!element || typeof element.querySelectorAll !== 'function') return;
  const selects = element.querySelectorAll('select') || [];
  const isSelect = typeof element.getAttribute === 'function' && element.tagName === 'SELECT';
  const allSelects = isSelect ? [element, ...selects] : selects;
  for (const select of allSelects) {
    if (typeof select.getAttribute === 'function') {
      const valueAttr = select.getAttribute('value');
      if (valueAttr !== null) {
        syncControlValue(select, valueAttr);
      }
    }
  }
}
