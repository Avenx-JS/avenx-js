import assert from 'assert';
import { EventBinder } from '../../lib/core/events/bindEvents.js';

try {
  console.log('🧪 Testing @click.capture ordering...');

  // Minimal element mock: enough DOM surface for EventBinder's delegation.
  function createElement(nodeName, attributes = {}) {
    const el = {
      nodeType: 1,
      nodeName,
      attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
      childNodes: [],
      parentNode: null,
      listeners: {},
      hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attributes, name);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
      },
      appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
      },
      addEventListener(type, callback, options) {
        this.listeners[type] = { callback, options };
      },
      removeEventListener(type) {
        delete this.listeners[type];
      },
    };
    return el;
  }

  // Native-like click. Capture listeners run root-downward, the target runs
  // both kinds, then bubble listeners run target-upward. A listener fires only
  // in the phase its `capture` option selects.
  function click(target) {
    const path = [];
    for (let node = target; node; node = node.parentNode) path.push(node);
    // path[0] is the target, path[path.length - 1] is the root.
    const event = { type: 'click', target, cancelBubble: false, stopPropagation() {} };
    const fire = (node, capturePhase) => {
      const listener = node.listeners.click;
      if (listener && Boolean(listener.options && listener.options.capture) === capturePhase) {
        listener.callback(event);
      }
    };
    for (let i = path.length - 1; i > 0; i--) fire(path[i], true);
    fire(path[0], true);
    fire(path[0], false);
    for (let i = 1; i < path.length; i++) fire(path[i], false);
  }

  // Build a tree with `build(root)` (which returns the click target), bind a
  // delegated EventBinder on the root, click the target, and return the order
  // in which the handler sources ran.
  function dispatchOrder(build) {
    const root = createElement('DIV');
    const target = build(root);

    const order = [];
    const dispatcher = {
      execute(source) {
        order.push(source);
      },
    };

    const binder = new EventBinder();
    binder.bind(root, dispatcher);

    // The delegated listener must be registered in capture phase, since a
    // `.capture` handler exists below the root.
    assert.strictEqual(root.listeners.click.options.capture, true);

    click(target);
    return order.join(',');
  }

  // Same structure as the issue #2024 reproduction: `.capture` ancestor,
  // bubble ancestor, and target. Native order is cap, child, bubble.
  assert.strictEqual(
    dispatchOrder((root) => {
      const cap = createElement('DIV', { '@click.capture': 'capHit' });
      const bub = createElement('DIV', { '@click': 'bubbleHit' });
      const inner = createElement('BUTTON', { '@click': 'childHit' });
      root.appendChild(cap);
      cap.appendChild(bub);
      bub.appendChild(inner);
      return inner;
    }),
    'capHit,childHit,bubbleHit',
  );

  // Several `.capture` ancestors run outermost-first, before the target.
  assert.strictEqual(
    dispatchOrder((root) => {
      const outer = createElement('DIV', { '@click.capture': 'outerCap' });
      const middle = createElement('DIV', { '@click.capture': 'middleCap' });
      const inner = createElement('BUTTON', { '@click': 'childHit' });
      root.appendChild(outer);
      outer.appendChild(middle);
      middle.appendChild(inner);
      return inner;
    }),
    'outerCap,middleCap,childHit',
  );

  console.log('✅ @click.capture ordering tests passed');
} catch (err) {
  console.error('❌ @click.capture ordering tests failed:', err);
  process.exitCode = 1;
}
