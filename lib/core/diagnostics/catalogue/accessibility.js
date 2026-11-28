/**
 * Accessibility diagnostic catalogue entries.
 */
export default {
  AVX_W65: {
    code: 'AVX_W65',
    name: 'CompilerA11yImageAlt',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An <img> element is missing an alt attribute.',
    causes: [
      'An <img> tag was written without an alt attribute.'
    ],
    remedies: [
      'Provide an alt attribute describing the image, or alt="" if the image is decorative.',
      'Silence with "warnings": { "AVX_W65": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w65-compiler-a11y-image-alt'
  },
  AVX_W66: {
    code: 'AVX_W66',
    name: 'CompilerA11yInteractiveRole',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An interactive event handler was placed on a non-interactive element without an accessible role or keyboard listener.',
    causes: [
      'A non-interactive element (such as <div> or <span>) defines @click but lacks an accessible role and keyboard access.'
    ],
    remedies: [
      'Use a native <button> element, or add role="button" and a keyboard event handler (@keydown).',
      'Silence with "warnings": { "AVX_W66": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w66-compiler-a11y-interactive-role'
  },
  AVX_W67: {
    code: 'AVX_W67',
    name: 'CompilerA11yAnchorHref',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An <a> element is missing an href attribute.',
    causes: [
      'An <a> tag is used without an href attribute (typically to trigger an action rather than navigate).'
    ],
    remedies: [
      'Provide a valid href attribute, or replace the anchor with a <button> element.',
      'Silence with "warnings": { "AVX_W67": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w67-compiler-a11y-anchor-href'
  },
  AVX_W68: {
    code: 'AVX_W68',
    name: 'CompilerA11yFormLabel',
    severity: 'warning',
    category: 'accessibility',
    summary: 'A form control element has no associated label or accessible name.',
    causes: [
      'An <input>, <select>, or <textarea> element lacks an associated <label>, aria-label, or aria-labelledby attribute.'
    ],
    remedies: [
      'Associate a <label for="..."> with the control, wrap it in a <label>, or provide an aria-label attribute.',
      'Silence with "warnings": { "AVX_W68": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w68-compiler-a11y-form-label'
  },
  AVX_W69: {
    code: 'AVX_W69',
    name: 'CompilerA11yButtonName',
    severity: 'warning',
    category: 'accessibility',
    summary: 'A <button> element has no accessible name.',
    causes: [
      'A <button> element contains no text content or descriptive child elements, and lacks an aria-label or aria-labelledby attribute.'
    ],
    remedies: [
      'Add visible text content inside the <button>, or provide an aria-label or aria-labelledby attribute.',
      'Silence with "warnings": { "AVX_W69": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w69-compiler-a11y-button-name'
  },
  AVX_W70: {
    code: 'AVX_W70',
    name: 'CompilerA11yPositiveTabindex',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An element specifies a positive tabindex value.',
    causes: [
      'An element has a tabindex greater than zero, which disrupts the natural keyboard tab navigation sequence.'
    ],
    remedies: [
      'Use tabindex="0" to place the element in natural tab order, or tabindex="-1" for programmatic focus.',
      'Silence with "warnings": { "AVX_W70": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w70-compiler-a11y-positive-tabindex'
  },
  AVX_W72: {
    code: 'AVX_W72',
    name: 'CompilerA11yAriaUnknownRole',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An element specifies an unknown or invalid WAI-ARIA role.',
    causes: [
      'An element has a role attribute with a value that is not recognized in the WAI-ARIA 1.2 specification.',
      'An element uses an abstract WAI-ARIA role, which is not permitted for authoring.'
    ],
    remedies: [
      'Use a valid non-abstract WAI-ARIA role (such as role="button", role="dialog", role="status").',
      'Silence with "warnings": { "AVX_W72": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w72-compiler-a11y-aria-unknown-role'
  },
  AVX_W73: {
    code: 'AVX_W73',
    name: 'CompilerA11yAriaUnknownAttribute',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An element specifies an unknown or invalid aria-* attribute.',
    causes: [
      'An element has an aria-* attribute that is not defined in the WAI-ARIA 1.2 specification.',
      'A typographical error in an ARIA property or state name (such as "aria-labeledby" instead of "aria-labelledby").'
    ],
    remedies: [
      'Verify the spelling of the aria-* attribute against the WAI-ARIA 1.2 specification.',
      'Silence with "warnings": { "AVX_W73": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w73-compiler-a11y-aria-unknown-attribute'
  },
  AVX_W74: {
    code: 'AVX_W74',
    name: 'CompilerA11yAriaInvalidValue',
    severity: 'warning',
    category: 'accessibility',
    summary: 'An aria-* attribute received an invalid value for its expected data type.',
    causes: [
      'A boolean or tristate ARIA attribute was given a value other than "true", "false", or "mixed".',
      'An ARIA attribute requiring a predefined token received an unrecognized token string.',
      'A numeric ARIA attribute was assigned a non-numeric string.'
    ],
    remedies: [
      'Provide a valid value matching the ARIA specification type requirements (e.g. aria-hidden="true" or "false").',
      'Silence with "warnings": { "AVX_W74": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w74-compiler-a11y-aria-invalid-value'
  },
  AVX_W75: {
    code: 'AVX_W75',
    name: 'CompilerA11yAriaHiddenFocusable',
    severity: 'warning',
    category: 'accessibility',
    summary: 'A focusable element is hidden from assistive technologies via aria-hidden="true".',
    causes: [
      'An interactive element (such as <button>, <input>, <a> with href, or element with tabindex >= 0) has aria-hidden="true" or is a descendant of an element with aria-hidden="true".'
    ],
    remedies: [
      'Remove aria-hidden="true" or remove the element from the keyboard navigation flow using tabindex="-1" or inert.',
      'Silence with "warnings": { "AVX_W75": "off" } in avenx.config.json if intentional.'
    ],
    docsUrl: 'https://avenx-js.com/troubleshooting/errors#avx-w75-compiler-a11y-aria-hidden-focusable'
  }
};
