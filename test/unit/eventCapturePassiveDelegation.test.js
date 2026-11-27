/**
 * @file eventCapturePassiveDelegation.test.js
 * @description Verifies that under event delegation:
 * 1. `.capture` handlers run root-downward (outermost-first) before bubble handlers.
 * 2. `.passive` on one element does not leak to other handlers of the same event,
 *    preserving `preventDefault()` on unrelated `@click.prevent` handlers.
 * 3. `stopPropagation()` inside a capture handler stops subsequent capture and bubble handlers.
 * 4. `unbind` removes all bucket listeners with their matching options.
 */

import assert from 'assert';
import { EventBinder } from '../../lib/core/events/bindEvents.js';
import { AvenxMock } from '../../lib/core/runtime/AvenxMock.js';

/**
 * Minimal multi-listener DOM node supporting capture and bubble phases on dispatch.
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 */
function createDomNode(tag, attrs = {}) {
  const attrMap = new Map(Object.entries(attrs));
  const captureListeners = new Map();
  const bubbleListeners = new Map();
  const registeredCalls = [];
  const removedCalls = [];

  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    parentNode: null,
    childNodes: [],
    _captureListeners: captureListeners,
    _bubbleListeners: bubbleListeners,
    registeredCalls,
    removedCalls,
    attributes: Array.from(attrMap.entries()).map(([name, value]) => ({ name, value })),
    hasAttribute(name) {
      return attrMap.has(name);
    },
    getAttribute(name) {
      return attrMap.get(name) ?? null;
    },
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
    addEventListener(type, fn, options = {}) {
      registeredCalls.push({ type, fn, options });
      const bucket = options && options.capture ? captureListeners : bubbleListeners;
      if (!bucket.has(type)) bucket.set(type, []);
      bucket.get(type).push(fn);
    },
    removeEventListener(type, fn, options = {}) {
      removedCalls.push({ type, fn, options });
      const bucket = options && options.capture ? captureListeners : bubbleListeners;
      const list = bucket.get(type);
      if (list) {
        const idx = list.indexOf(fn);
        if (idx !== -1) list.splice(idx, 1);
      }
    },
    dispatchEvent(event) {
      const path = [];
      let cur = this;
      while (cur) {
        path.push(cur);
        cur = cur.parentNode;
      }
      event.target = this;
      event.cancelBubble = false;
      event.defaultPrevented = false;
      event.stopPropagation = () => {
        event.cancelBubble = true;
      };
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };

      // Capture phase: root -> target
      for (let i = path.length - 1; i >= 0 && !event.cancelBubble; i--) {
        const fns = path[i]._captureListeners.get(event.type) || [];
        for (const fn of [...fns]) fn(event);
      }
      // Bubble phase: target -> root
      for (let i = 0; i < path.length && !event.cancelBubble; i++) {
        const fns = path[i]._bubbleListeners.get(event.type) || [];
        for (const fn of [...fns]) fn(event);
      }
    },
  };
}

// 1. Capture runs before child and bubble: cap,child,bubble
{
  const root = createDomNode('div');
  const cap = createDomNode('div', { '@click.capture': 'capHit()' });
  const bub = createDomNode('div', { '@click': 'bubbleHit()' });
  const inner = createDomNode('button', { '@click': 'childHit()' });
  root.appendChild(cap);
  cap.appendChild(bub);
  bub.appendChild(inner);

  const order = [];
  const binder = new EventBinder();
  binder.bind(root, { execute: (expr) => order.push(expr) });

  inner.dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(
    order,
    ['capHit()', 'childHit()', 'bubbleHit()'],
    'capture handler on ancestor must run before child and bubble handlers',
  );
  binder.unbind(root);
  assert.ok(root.removedCalls.length >= root.registeredCalls.length, 'unbind must remove every listener');
}

// 2. Nested .capture on multiple ancestors runs outermost-first, then bubble target-upward
{
  const root = createDomNode('div');
  const outer = createDomNode('div', { '@click.capture': 'outerCap()', '@click': 'outerBub()' });
  const innerWrap = createDomNode('div', { '@click.capture': 'innerCap()', '@click': 'innerBub()' });
  const btn = createDomNode('button', { '@click': 'btnClick()' });
  root.appendChild(outer);
  outer.appendChild(innerWrap);
  innerWrap.appendChild(btn);

  const order = [];
  const binder = new EventBinder();
  binder.bind(root, { execute: (expr) => order.push(expr) });

  btn.dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(
    order,
    ['outerCap()', 'innerCap()', 'btnClick()', 'innerBub()', 'outerBub()'],
    'nested .capture handlers must run outermost-first before bubble handlers',
  );
  binder.unbind(root);
}

// 3. .passive on one element must not make @click.prevent on another element passive
{
  const root = createDomNode('div');
  const scroller = createDomNode('div', { '@click.passive': 'onPassive()' });
  const link = createDomNode('a', { '@click.prevent': 'onPrevent()' });
  root.appendChild(scroller);
  root.appendChild(link);

  const executed = [];
  const binder = new EventBinder();
  binder.bind(root, { execute: (expr) => executed.push(expr) });

  const clickCalls = root.registeredCalls.filter((c) => c.type === 'click');
  assert.ok(
    clickCalls.some((c) => c.options && c.options.passive === true),
    'passive bucket must register with { passive: true }',
  );
  assert.ok(
    clickCalls.some((c) => !c.options || !c.options.passive),
    'non-passive bucket must register without passive: true',
  );

  const event = { type: 'click' };
  link.dispatchEvent(event);
  assert.strictEqual(event.defaultPrevented, true, '@click.prevent must call preventDefault() despite sibling .passive');
  assert.deepStrictEqual(executed, ['onPrevent()']);
  binder.unbind(root);
}

// 4. .stop in a capture handler stops both remaining capture handlers and bubble handlers
{
  const root = createDomNode('div');
  const outer = createDomNode('div', { '@click.capture.stop': 'outerStop()' });
  const mid = createDomNode('div', { '@click.capture': 'midCap()' });
  const btn = createDomNode('button', { '@click': 'btnClick()' });
  root.appendChild(outer);
  outer.appendChild(mid);
  mid.appendChild(btn);

  const order = [];
  const binder = new EventBinder();
  binder.bind(root, { execute: (expr) => order.push(expr) });

  btn.dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(order, ['outerStop()'], '.stop in capture must halt further capture and bubble handlers');
  binder.unbind(root);
}

// 5. AvenxMock.trigger also respects capture-first ordering for delegated listeners
{
  const root = createDomNode('div');
  const cap = createDomNode('div', { '@click.capture': 'capHit()' });
  const btn = createDomNode('button', { '@click': 'btnHit()' });
  delete root.dispatchEvent;
  delete cap.dispatchEvent;
  delete btn.dispatchEvent;
  root.appendChild(cap);
  cap.appendChild(btn);

  const order = [];
  const binder = new EventBinder();
  binder.bind(root, { execute: (expr) => order.push(expr) });

  AvenxMock.trigger(btn, 'click');
  assert.deepStrictEqual(order, ['capHit()', 'btnHit()'], 'AvenxMock.trigger must dispatch capture before bubble');
  binder.unbind(root);
}

console.log('✅ Event capture and passive delegation tests passed!');
