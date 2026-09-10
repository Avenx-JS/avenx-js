/**
 * @file dom.js
 * @description Shared happy-dom bootstrap for benchmarks.
 *
 * Every renderer benchmark needs the same globals, and each one used to install
 * them itself. Duplicating the list meant a benchmark could silently measure a
 * different environment from its neighbour -- one with `requestAnimationFrame`
 * and one without changes which scheduling path the runtime takes.
 *
 * Import this module for its side effect before importing anything from
 * `lib/core`.
 * @module benches/support/dom
 */
import { Window } from 'happy-dom';
// Also installs the expression interpreter, for a benchmark run directly
// rather than through benches/run.js.
import './environment.js';

const window = new Window({ url: 'http://localhost' });

globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLTemplateElement = window.HTMLTemplateElement;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.SVGElement = window.SVGElement;
globalThis.DOMParser = window.DOMParser;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

export { window };
