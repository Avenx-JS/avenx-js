import { Window } from 'happy-dom';

const window = new Window({
  url: 'http://localhost',
  settings: {
    disableJavaScriptFileLoading: true,
    disableJavaScriptEvaluation: false,
    disableCSSFileLoading: true,
    disableIframePageLoading: true
  }
});

// Bind window self-references
window.window = window;
window.self = window;
window.top = window;
window.parent = window;

const keys = [
  'window',
  'document',
  'DOMParser',
  'Node',
  'HTMLElement',
  'HTMLTemplateElement',
  'SVGElement',
  'DocumentFragment',
  'CustomEvent',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'FocusEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'location'
];

for (const key of keys) {
  if (window[key] !== undefined) {
    if (typeof window[key] === 'function' && window[key].prototype === undefined) {
      global[key] = window[key].bind(window);
    } else {
      global[key] = window[key];
    }
  }
}

// Explicit fallback check for event listeners on the global scope if needed
global.addEventListener = window.addEventListener.bind(window);
global.removeEventListener = window.removeEventListener.bind(window);
global.dispatchEvent = window.dispatchEvent.bind(window);
