/**
 * @file accessibility.js
 * @description Static accessibility (a11y) lint rules for Avenx templates.
 *
 * Implements statically decidable, high-confidence accessibility checks
 * over the parsed template node tree.
 * @module lib/compiler/rules/accessibility
 */

import { parseHTML } from '../parser/htmlTree.js';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { TemplateValidationError } from '../errors/TemplateValidationError.js';
import { reportWarning } from '../utils/warningReporter.js';

/**
 * Built-in accessibility warning codes and rule identifiers.
 */
export const ACCESSIBILITY_RULES = {
  IMAGE_ALT: {
    code: AvenxErrorCodes.COMPILER_A11Y_IMAGE_ALT,
    name: 'img-alt',
  },
  INTERACTIVE_ROLE: {
    code: AvenxErrorCodes.COMPILER_A11Y_INTERACTIVE_ROLE,
    name: 'interactive-role',
  },
  ANCHOR_HREF: {
    code: AvenxErrorCodes.COMPILER_A11Y_ANCHOR_HREF,
    name: 'anchor-href',
  },
  FORM_LABEL: {
    code: AvenxErrorCodes.COMPILER_A11Y_FORM_LABEL,
    name: 'form-control-label',
  },
  BUTTON_NAME: {
    code: AvenxErrorCodes.COMPILER_A11Y_BUTTON_NAME,
    name: 'button-name',
  },
  POSITIVE_TABINDEX: {
    code: AvenxErrorCodes.COMPILER_A11Y_POSITIVE_TABINDEX,
    name: 'positive-tabindex',
  },
};

/**
 * All warning codes belonging to the static accessibility rules pass.
 * @type {Set<string>}
 */
export const A11Y_WARNING_CODES = new Set(
  Object.values(ACCESSIBILITY_RULES).map((rule) => rule.code)
);

/**
 * Elements that are naturally interactive in HTML.
 * @type {Set<string>}
 */
const NATURALLY_INTERACTIVE_ELEMENTS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
  'dialog',
  'option',
]);

/**
 * Form control element tag names.
 * @type {Set<string>}
 */
const FORM_CONTROL_TAGS = new Set(['input', 'select', 'textarea']);

/**
 * Input types that do not require an associated text label.
 * @type {Set<string>}
 */
const UNLABELED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

/**
 * Checks whether a tag name denotes a custom component or framework element.
 * Custom components are:
 * - PascalCase tags (e.g. `<UserProfileCard />`)
 * - Web components containing a hyphen (e.g. `<custom-widget />`)
 * - Directives and built-in control tags (e.g. `@for`, `slot`, `Component`)
 * @param {string} tag
 * @returns {boolean}
 */
export function isCustomComponent(tag) {
  if (!tag || typeof tag !== 'string') return false;
  if (tag.startsWith('@')) return true;
  if (tag === 'Component' || tag === 'slot') return true;
  if (/^[A-Z]/.test(tag)) return true;
  if (tag.includes('-')) return true;
  return false;
}

/**
 * Normalizes element attributes from either an object map, AST attributes array, or node object.
 * @param {any} attrs
 * @returns {Object<string, string>}
 */
function normalizeAttrs(attrs) {
  if (!attrs) return {};
  if (Array.isArray(attrs)) {
    const map = {};
    for (const item of attrs) {
      if (item && typeof item === 'object') {
        const k = item.name || item.key;
        if (k) map[k] = item.value !== undefined ? item.value : '';
      }
    }
    return map;
  }
  if (attrs.attributes && Array.isArray(attrs.attributes)) {
    return normalizeAttrs(attrs.attributes);
  }
  if (attrs.attrs && typeof attrs.attrs === 'object') {
    return normalizeAttrs(attrs.attrs);
  }
  return attrs;
}

/**
 * Checks whether an attribute (static or dynamic) is present on an element.
 * Matches:
 *  - exact name (e.g. 'alt')
 *  - bound directive (e.g. ':alt')
 *  - dynamic modifier (e.g. 'alt.lazy')
 * @param {any} attrs
 * @param {string} name
 * @returns {boolean}
 */
export function hasAttribute(attrs, name) {
  const map = normalizeAttrs(attrs);
  if (!map || typeof map !== 'object') return false;
  if (map[name] !== undefined) return true;
  if (map[`:${name}`] !== undefined) return true;
  const boundPrefix = `:${name}`;
  for (const key of Object.keys(map)) {
    if (key === name || key === boundPrefix) return true;
    if (key.startsWith(`${name}.`) || key.startsWith(`${boundPrefix}.`)) return true;
    if (key.startsWith(`:[${name}]`)) return true;
  }
  return false;
}

/**
 * Returns attribute value if present, considering static and dynamic bindings.
 * @param {any} attrs
 * @param {string} name
 * @returns {string|undefined}
 */
export function getAttributeValue(attrs, name) {
  const map = normalizeAttrs(attrs);
  if (!map || typeof map !== 'object') return undefined;
  if (map[name] !== undefined) return map[name];
  if (map[`:${name}`] !== undefined) return map[`:${name}`];
  return undefined;
}

/**
 * Checks whether a node or its subtree contains accessible content.
 * Used for <button> accessible name validation.
 * @param {object} node
 * @returns {boolean}
 */
function hasAccessibleContent(node) {
  if (!node) return false;

  // Text nodes with content or interpolation
  if (node.type === 'text') {
    const text = typeof node.content === 'string' ? node.content.trim() : '';
    return text.length > 0;
  }

  if (node.type === 'interpolation') {
    return true;
  }

  if (node.type === 'element') {
    const tag = (node.tagName || '').toLowerCase();

    // Slots project dynamic caller content
    if (tag === 'slot') {
      return true;
    }

    // Custom components render their own content
    if (isCustomComponent(node.tagName)) {
      return true;
    }

    // Accessible attributes on child
    if (
      hasAttribute(node.attrs, 'aria-label') ||
      hasAttribute(node.attrs, 'aria-labelledby') ||
      hasAttribute(node.attrs, 'title')
    ) {
      return true;
    }

    // <img> with alt attribute
    if (tag === 'img' && hasAttribute(node.attrs, 'alt')) {
      return true;
    }

    // <svg> with aria-label or child <title>
    if (tag === 'svg') {
      if (hasAttribute(node.attrs, 'aria-label') || hasAttribute(node.attrs, 'aria-labelledby')) {
        return true;
      }
      if (Array.isArray(node.children) && node.children.some((c) => c.tagName && c.tagName.toLowerCase() === 'title')) {
        return true;
      }
    }

    // Check children recursively
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (hasAccessibleContent(child)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks whether a node has keyboard event handlers.
 * @param {Object<string, string>} attrs
 * @returns {boolean}
 */
function hasKeyboardHandler(attrs) {
  if (!attrs) return false;
  for (const key of Object.keys(attrs)) {
    const clean = key.startsWith(':') ? key.slice(1) : key;
    if (
      clean.startsWith('@keydown') ||
      clean.startsWith('@keyup') ||
      clean.startsWith('@keypress') ||
      clean === 'onkeydown' ||
      clean === 'onkeyup' ||
      clean === 'onkeypress'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a node has click handlers.
 * @param {Object<string, string>} attrs
 * @returns {boolean}
 */
function hasClickHandler(attrs) {
  if (!attrs) return false;
  for (const key of Object.keys(attrs)) {
    const clean = key.startsWith(':') ? key.slice(1) : key;
    if (clean.startsWith('@click') || clean.startsWith('@dblclick') || clean === 'onclick') {
      return true;
    }
  }
  return false;
}

/**
 * Scans a template node tree and returns all static accessibility issues found.
 * @param {string|object[]} templateOrNodes - Template HTML string or pre-parsed HTMLNode array.
 * @param {object} [options]
 * @param {string} [options.componentName] - Target component or page name.
 * @param {string} [options.filePath] - Source file path.
 * @param {string[]} [options.customVoidTags] - Custom void tags.
 * @returns {Array<object>} Array of structured issue objects.
 */
export function findAccessibilityIssues(templateOrNodes, options = {}) {
  const opts = typeof options === 'string' ? { componentName: options } : (options || {});
  const customVoidTags = opts.customVoidTags || [];
  let nodes;

  if (typeof templateOrNodes === 'string') {
    try {
      nodes = parseHTML(templateOrNodes, customVoidTags);
    } catch {
      return [];
    }
  } else if (Array.isArray(templateOrNodes)) {
    nodes = templateOrNodes;
  } else {
    return [];
  }

  const componentName = opts.componentName || 'Component';
  const issues = [];

  // Pass 1: Collect label `for` targets across template to match with control IDs
  const labelForIds = new Set();
  const collectLabelFor = (nodeList) => {
    for (const node of nodeList) {
      if (node && node.type === 'element') {
        const tag = (node.tagName || '').toLowerCase();
        if (tag === 'label') {
          const forVal = getAttributeValue(node.attrs, 'for') || getAttributeValue(node.attrs, 'htmlFor');
          if (forVal) {
            labelForIds.add(forVal.trim());
          }
        }
        if (Array.isArray(node.children) && node.children.length > 0) {
          collectLabelFor(node.children);
        }
      }
    }
  };
  collectLabelFor(nodes);

  // Pass 2: Traverse elements and apply accessibility rules
  const walk = (nodeList, insideLabel = false) => {
    for (const node of nodeList) {
      if (!node || node.type !== 'element') {
        continue;
      }

      const rawTag = node.tagName || '';
      const tag = rawTag.toLowerCase();
      const isCustom = isCustomComponent(rawTag);
      const isLabelElement = tag === 'label';
      const currentInsideLabel = insideLabel || isLabelElement;

      // Skip custom components from native HTML checks
      if (!isCustom) {
        const attrs = node.attrs || {};
        const line = node.line || 1;
        const column = node.column || 1;
        const length = rawTag.length;

        // Rule 1: <img> without alt attribute (AVX_W65)
        if (tag === 'img') {
          if (!hasAttribute(attrs, 'alt')) {
            issues.push({
              code: ACCESSIBILITY_RULES.IMAGE_ALT.code,
              ruleId: ACCESSIBILITY_RULES.IMAGE_ALT.name,
              element: '<img>',
              component: componentName,
              componentName,
              remedy: 'Provide an alt attribute describing the image, or alt="" if the image is decorative.',
              message: `<img> element is missing an alt attribute (in component <${componentName}>). Provide alt="..." or alt="" for decorative images.`,
              line,
              column,
              length,
              node,
            });
          }
        }

        // Rule 2: Interactive handlers on non-interactive elements without role and keyboard access (AVX_W66)
        if (!NATURALLY_INTERACTIVE_ELEMENTS.has(tag) && hasClickHandler(attrs)) {
          const hasRole = hasAttribute(attrs, 'role');
          const hasKeyboard = hasKeyboardHandler(attrs);
          if (!hasRole && !hasKeyboard) {
            issues.push({
              code: ACCESSIBILITY_RULES.INTERACTIVE_ROLE.code,
              ruleId: ACCESSIBILITY_RULES.INTERACTIVE_ROLE.name,
              element: `<${rawTag}>`,
              component: componentName,
              componentName,
              remedy: 'Use a native <button>, or add role="button" and a keyboard event handler (@keydown).',
              message: `Interactive handler on non-interactive element <${rawTag}> without role or keyboard access (in component <${componentName}>). Use a native <button> or add role="button" and a keyboard event handler (@keydown).`,
              line,
              column,
              length,
              node,
            });
          }
        }

        // Rule 3: <a> without href used as a button (AVX_W67)
        if (tag === 'a') {
          if (!hasAttribute(attrs, 'href')) {
            issues.push({
              code: ACCESSIBILITY_RULES.ANCHOR_HREF.code,
              ruleId: ACCESSIBILITY_RULES.ANCHOR_HREF.name,
              element: '<a>',
              component: componentName,
              componentName,
              remedy: 'Provide an href attribute, or use a <button> element if triggering an in-page action.',
              message: `<a> element is missing an href attribute (in component <${componentName}>). Anchors require an href to be accessible; use <button> if triggering an in-page action.`,
              line,
              column,
              length,
              node,
            });
          }
        }

        // Rule 4: Form controls with no associated label, aria-label or aria-labelledby (AVX_W68)
        if (FORM_CONTROL_TAGS.has(tag)) {
          let skipControl = false;
          if (tag === 'input') {
            const inputType = (getAttributeValue(attrs, 'type') || 'text').toLowerCase().trim();
            if (UNLABELED_INPUT_TYPES.has(inputType)) {
              skipControl = true;
            }
          }

          if (!skipControl) {
            const hasAriaLabel = hasAttribute(attrs, 'aria-label');
            const hasAriaLabelledby = hasAttribute(attrs, 'aria-labelledby');
            const hasTitle = hasAttribute(attrs, 'title');
            const idVal = getAttributeValue(attrs, 'id');
            const hasMatchingLabel = idVal && labelForIds.has(idVal.trim());

            if (!currentInsideLabel && !hasAriaLabel && !hasAriaLabelledby && !hasTitle && !hasMatchingLabel) {
              issues.push({
                code: ACCESSIBILITY_RULES.FORM_LABEL.code,
                ruleId: ACCESSIBILITY_RULES.FORM_LABEL.name,
                element: `<${rawTag}>`,
                component: componentName,
                componentName,
                remedy: 'Associate a <label for="..."> with the form control, wrap it in a <label>, or provide an aria-label or aria-labelledby attribute.',
                message: `Form control <${rawTag}> has no associated <label>, aria-label, or aria-labelledby (in component <${componentName}>). Associate a <label for="...">, wrap in a <label>, or provide an aria-label.`,
                line,
                column,
                length,
                node,
              });
            }
          }
        }

        // Rule 5: <button> with no accessible name (AVX_W69)
        if (tag === 'button') {
          const hasAriaLabel = hasAttribute(attrs, 'aria-label');
          const hasAriaLabelledby = hasAttribute(attrs, 'aria-labelledby');
          const hasTitle = hasAttribute(attrs, 'title');
          const hasContent = hasAccessibleContent(node);

          if (!hasAriaLabel && !hasAriaLabelledby && !hasTitle && !hasContent) {
            issues.push({
              code: ACCESSIBILITY_RULES.BUTTON_NAME.code,
              ruleId: ACCESSIBILITY_RULES.BUTTON_NAME.name,
              element: '<button>',
              component: componentName,
              componentName,
              remedy: 'Provide text content within the <button>, or add an aria-label or aria-labelledby attribute.',
              message: `<button> has no accessible name (in component <${componentName}>). Provide button text content or an aria-label.`,
              line,
              column,
              length,
              node,
            });
          }
        }

        // Rule 6: Positive tabindex greater than zero (AVX_W70)
        const tabIndexVal = getAttributeValue(attrs, 'tabindex') ?? getAttributeValue(attrs, 'tabIndex');
        if (tabIndexVal !== undefined && typeof tabIndexVal === 'string') {
          const trimmed = tabIndexVal.trim();
          if (/^\+?[1-9]\d*$/.test(trimmed)) {
            issues.push({
              code: ACCESSIBILITY_RULES.POSITIVE_TABINDEX.code,
              ruleId: ACCESSIBILITY_RULES.POSITIVE_TABINDEX.name,
              element: `<${rawTag}>`,
              component: componentName,
              componentName,
              value: trimmed,
              remedy: 'Avoid positive tabindex values which disrupt document tab order; use tabindex="0" or tabindex="-1".',
              message: `Positive tabindex "${trimmed}" disrupts document navigation order (in component <${componentName}>). Use tabindex="0" or "-1".`,
              line,
              column,
              length,
              node,
            });
          }
        }
      }

      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, currentInsideLabel);
      }
    }
  };

  walk(nodes, false);
  return issues;
}

/**
 * Validates accessibility rules over a template and reports warnings.
 * @param {string|object[]} templateOrNodes - Template source string or parsed node array.
 * @param {string} filePath - Path to component file.
 * @param {string} componentName - Name of component.
 * @param {object} [config] - Project configuration with warning severity overrides.
 * @param {string} [sourceText] - Full authored template string for caret formatting.
 * @returns {Array<object>} Found issues.
 */
export function validateAccessibility(templateOrNodes, filePath, componentName, config = {}, sourceText = '') {
  const customVoidTags = (config && config.customVoidTags) || [];
  const issues = findAccessibilityIssues(templateOrNodes, {
    filePath,
    componentName,
    customVoidTags,
  });

  const source = typeof templateOrNodes === 'string' ? templateOrNodes : sourceText;

  for (const issue of issues) {
    let err;
    switch (issue.code) {
      case AvenxErrorCodes.COMPILER_A11Y_IMAGE_ALT:
      case AvenxErrorCodes.COMPILER_A11Y_ANCHOR_HREF:
      case AvenxErrorCodes.COMPILER_A11Y_BUTTON_NAME:
        err = new TemplateValidationError(issue.code, componentName);
        break;
      case AvenxErrorCodes.COMPILER_A11Y_INTERACTIVE_ROLE:
      case AvenxErrorCodes.COMPILER_A11Y_FORM_LABEL:
        err = new TemplateValidationError(issue.code, issue.element, componentName);
        break;
      case AvenxErrorCodes.COMPILER_A11Y_POSITIVE_TABINDEX:
        err = new TemplateValidationError(issue.code, issue.value || '1', componentName);
        break;
      default:
        err = new TemplateValidationError(issue.code, componentName);
    }

    if (filePath) {
      err.filePath = filePath;
      err.filename = filePath;
    }

    if (source && issue.line) {
      err.setLocation({
        source,
        line: issue.line,
        column: issue.column || 1,
        filename: filePath,
        length: issue.length || 1,
      });
    }

    reportWarning(issue.code, err, config);
  }

  return issues;
}
