/**
 * Declarative Form Validation Engine for Avenx
 */

/**
 * Parses a data-ax-validate rule string (e.g. "required|email|min:8").
 * @param {string} ruleString - Raw directive value.
 * @returns {Array<{name: string, arg: string|null, customMsg: string|null}>}
 */
export function parseValidationRules(ruleString) {
  if (!ruleString || typeof ruleString !== 'string') return [];
  const rules = [];

  const parts = ruleString.split('|').map((r) => r.trim()).filter(Boolean);
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) {
      rules.push({ name: part.toLowerCase(), arg: null, customMsg: null });
    } else {
      const name = part.slice(0, colonIdx).trim().toLowerCase();
      const rest = part.slice(colonIdx + 1).trim();

      const secondColonIdx = rest.indexOf(':');
      if (secondColonIdx !== -1 && name !== 'pattern' && name !== 'regex') {
        const arg = rest.slice(0, secondColonIdx).trim();
        const customMsg = rest.slice(secondColonIdx + 1).trim();
        rules.push({ name, arg, customMsg });
      } else {
        rules.push({ name, arg: rest, customMsg: null });
      }
    }
  }

  return rules;
}

/**
 * Extracts field name from an HTML element.
 * @param {Element} el
 * @returns {string}
 */
export function getFieldName(el) {
  if (!el || typeof el.getAttribute !== 'function') return 'field';
  return (
    el.getAttribute('name') ||
    el.getAttribute('data-ax-bind') ||
    el.getAttribute('id') ||
    'field'
  );
}

/**
 * Evaluates a field value against parsed rules.
 * @param {any} value - The input value.
 * @param {Array<{name: string, arg: string|null, customMsg: string|null}>} rules - Parsed rules.
 * @param {object} [context] - Additional scope/context (state, customMessages).
 * @returns {string[]} Array of validation error messages.
 */
export function validateValue(value, rules, context = {}) {
  const errors = [];
  const customMessages = context.customMessages || {};

  const strVal = value === undefined || value === null ? '' : String(value);

  for (const rule of rules) {
    const { name, arg, customMsg } = rule;
    let isValid = true;
    let defaultMsg = '';

    switch (name) {
      case 'required': {
        if (typeof value === 'boolean') {
          isValid = value === true;
        } else if (Array.isArray(value)) {
          isValid = value.length > 0;
        } else {
          isValid = strVal.trim().length > 0;
        }
        defaultMsg = 'Field is required';
        break;
      }

      case 'email': {
        if (strVal.trim() === '') {
          isValid = true;
        } else {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          isValid = emailRegex.test(strVal);
        }
        defaultMsg = 'Invalid email address';
        break;
      }

      case 'min': {
        const minVal = parseFloat(arg);
        if (!isNaN(minVal)) {
          if (typeof value === 'number') {
            isValid = value >= minVal;
          } else if (Array.isArray(value)) {
            isValid = value.length >= minVal;
          } else if (strVal !== '') {
            isValid = strVal.length >= minVal;
          }
        }
        defaultMsg = `Minimum length/value is ${arg}`;
        break;
      }

      case 'max': {
        const maxVal = parseFloat(arg);
        if (!isNaN(maxVal)) {
          if (typeof value === 'number') {
            isValid = value <= maxVal;
          } else if (Array.isArray(value)) {
            isValid = value.length <= maxVal;
          } else if (strVal !== '') {
            isValid = strVal.length <= maxVal;
          }
        }
        defaultMsg = `Maximum length/value is ${arg}`;
        break;
      }

      case 'pattern':
      case 'regex': {
        if (strVal.trim() === '' || !arg) {
          isValid = true;
        } else {
          try {
            const re = new RegExp(arg);
            isValid = re.test(strVal);
          } catch {
            isValid = false;
          }
        }
        defaultMsg = 'Field format is invalid';
        break;
      }

      case 'numeric':
      case 'number': {
        if (strVal.trim() === '') {
          isValid = true;
        } else {
          isValid = /^-?\d+(\.\d+)?$/.test(strVal.trim());
        }
        defaultMsg = 'Must be a number';
        break;
      }

      case 'alpha': {
        if (strVal.trim() === '') {
          isValid = true;
        } else {
          isValid = /^[a-zA-Z]+$/.test(strVal);
        }
        defaultMsg = 'Must contain only letters';
        break;
      }

      case 'alphanumeric': {
        if (strVal.trim() === '') {
          isValid = true;
        } else {
          isValid = /^[a-zA-Z0-9]+$/.test(strVal);
        }
        defaultMsg = 'Must contain only letters and numbers';
        break;
      }

      case 'url': {
        if (strVal.trim() === '') {
          isValid = true;
        } else {
          try {
            const url = new URL(strVal);
            isValid = !!url;
          } catch {
            isValid = false;
          }
        }
        defaultMsg = 'Invalid URL format';
        break;
      }

      case 'same': {
        if (arg && context.state) {
          const targetValue = context.state[arg];
          isValid = value === targetValue;
        }
        defaultMsg = `Must match ${arg}`;
        break;
      }

      default:
        break;
    }

    if (!isValid) {
      const msg = customMsg || customMessages[name] || defaultMsg;
      errors.push(msg);
    }
  }

  return errors;
}

/**
 * Initializes or updates component state.$validation structure.
 * @param {object} state - Reactive component state.
 * @param {string} fieldName - Target field name.
 * @param {string[]} errors - List of validation errors for field.
 */
export function updateValidationState(state, fieldName, errors) {
  if (!state) return;

  if (!state.$validation) {
    state.$validation = {
      isValid: true,
      errors: {},
      fields: {},
    };
  }

  if (!state.$validation.errors) {
    state.$validation.errors = {};
  }
  if (!state.$validation.fields) {
    state.$validation.fields = {};
  }

  const isFieldValid = errors.length === 0;

  const previous = state.$validation.errors[fieldName];
  const sameErrors = Array.isArray(previous) && previous.length === errors.length &&
    previous.every((error, index) => error === errors[index]);
  if (!sameErrors || !state.$validation.fields[fieldName]) {
    state.$validation.errors[fieldName] = errors;
    state.$validation.fields[fieldName] = {
      isValid: isFieldValid,
      errors,
    };
  }

  let allValid = true;
  for (const fieldKey of Object.keys(state.$validation.fields)) {
    const f = state.$validation.fields[fieldKey];
    if (f && f.isValid === false) {
      allValid = false;
      break;
    }
  }
  state.$validation.isValid = allValid;
}
