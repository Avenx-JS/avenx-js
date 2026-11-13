/**
 * @file htmlDirective.js
 * @description What `data-ax-html` writes into an element, shared by the
 * string renderer and the render-program runtime so the two cannot drift.
 * @module lib/core/renderer/htmlDirective
 */

import { SafeHtml } from '../security/escapeHtml.js';
import { Sanitizer } from '../security/sanitize.js';

/**
 * The default policy, which reports what it strips as AVX_W16 / AVX_W17, minus
 * `id` and `name`: an injected element carrying either becomes a property of
 * `window`, which would let a plain string clobber framework globals such as
 * `window.__avenx_routers`.
 */
const sanitizer = new Sanitizer({ disallowedAttributes: ['id', 'name'] });

/**
 * Replaces an element's inner HTML from a `data-ax-html` value.
 *
 * A `SafeHtml` value is trusted and written as is. Any other value is run
 * through the default `Sanitizer`, so allowed markup renders and anything
 * dangerous is stripped with a warning. Never write a plain value unsanitized:
 * that turns every `data-ax-html` in every application into an injection point.
 *
 * The sanitized result is cached on the element against its source, so a
 * re-render with an unchanged value neither re-parses it, repeats the warnings,
 * nor replaces the nodes it already wrote.
 * @param {Element} element - The bound element.
 * @param {any} value - The evaluated value.
 */
export function applyHtmlDirective(element, value) {
  let markup;
  if (value instanceof SafeHtml) {
    markup = String(value);
  } else if (value === null || value === undefined) {
    markup = '';
  } else {
    const source = String(value);
    if (element.__axHtmlSource !== source) {
      element.__axHtmlMarkup = sanitizer.sanitize(source);
      element.__axHtmlSource = source;
    }
    markup = element.__axHtmlMarkup;
  }

  // The browser re-serializes what it parsed (`<br />` reads back as `<br>`,
  // `&#39;` as `'`), so compare against what was read back after the last
  // write, not the markup itself, or every re-render would rebuild the subtree.
  if (element.__axHtmlWrote === markup && element.innerHTML === element.__axHtmlWritten) {
    return;
  }
  if (element.innerHTML !== markup) {
    element.innerHTML = markup;
  }
  element.__axHtmlWrote = markup;
  element.__axHtmlWritten = element.innerHTML;
}
