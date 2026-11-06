/**
 * @file appMountNestedComponents.test.js
 * @description A component nested inside a component mounted with `app.mount()`.
 *
 * `AvenxPage` runs a child-component pass over the tree it renders, so a
 * component nested inside a page's component is instantiated. `app.mount()`
 * constructs its root component and stops, so the nested host was left as an
 * empty mount point with no error and no log.
 */

import assert from 'assert';
import { Window } from 'happy-dom';

const win = new Window();
globalThis.window = win;
globalThis.document = win.document;
globalThis.DOMParser = win.DOMParser;
globalThis.Node = win.Node;
globalThis.HTMLElement = win.HTMLElement;

const { AvenxApp } = await import('../../lib/core/runtime/AvenxApp.js');
const { AvenxComponent } = await import('../../lib/core/runtime/AvenxComponent.js');

console.log('🧪 Testing nested components under an app.mount() root...');

document.body.innerHTML = '<div id="app"></div>';

class Inner extends AvenxComponent {
  constructor(bridges, props) {
    super({}, {}, bridges, '', {}, props, {}, {}, {});
  }

  render() {
    return '<span data-testid="inner">INNER</span>';
  }
}

class Outer extends AvenxComponent {
  constructor(bridges, props) {
    super({}, {}, bridges, '', {}, props, {}, {}, {});
  }

  render() {
    return '<div data-testid="outer"><div data-avenx-comp="Inner"></div></div>';
  }
}

const app = new AvenxApp({ target: '#app' });
app.register('Outer', Outer);
app.register('Inner', Inner);
app.mount('Outer');

const innerCount = document.querySelectorAll('[data-testid="inner"]').length;
assert.strictEqual(innerCount, 1, `nested Inner was not mounted under the app.mount() root (found ${innerCount})`);

console.log('✅ Nested component under app.mount() root is mounted');
