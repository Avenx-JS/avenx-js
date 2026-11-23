import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { parseDeferTriggers } from '../../lib/compiler/utils/deferTriggers.js';
import { buildTemplateIR } from '../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../lib/compiler/ir/lower.js';
import { processDefer } from '../../lib/compiler/parser/directives/defer.js';
import { DeferBinding } from '../../lib/core/renderer/program/blocks.js';
import { DeferManager } from '../../lib/core/renderer/deferManager.js';

assert.deepEqual(parseDeferTriggers('VISIBLE; interaction; 200 ms'), ['visible', 'interaction', 'timer(200)']);
for (const value of ['ready', "text.includes(';')", '(() => { return ready; })()', 'count &gt; 0']) {
  assert.equal(parseDeferTriggers(value), null, 'semicolons inside an expression are not trigger separators');
}
for (const value of ['idle', 'visible', 'hover', 'click', 'interaction', 'timer(5)', '5ms']) {
  assert.deepEqual(parseDeferTriggers(value), [value]);
}

const source = '<@defer when="visible; interaction; 20 ms"><span>Loaded</span></@defer>';
const built = buildTemplateIR(source);
assert.equal(built.refusal, null);
assert.deepEqual(built.ir.children[0].when, ['visible', 'interaction', 'timer(20)']);
const lowered = lowerToProgram(built.ir);
assert.equal(lowered.refusal, null);
assert.deepEqual(lowered.program.ops[0].when, ['visible', 'interaction', 'timer(20)']);
assert.equal(lowered.expressions.length, 0, 'a trigger list is never compiled as an expression');
assert.match(processDefer(source), /data-ax-defer-when="visible; interaction; timer\(20\)"/);
assert.match(processDefer('<@defer when="text.includes(\';\')"><p>yes</p></@defer>'), /includes/);
for (const value of [
  'visible; rows.length',
  'visible; VISIBLE',
  'timer(20); 20 ms',
  'idle;',
  ';click',
  'click; timer(delay)',
]) {
  for (const compile of [
    parseDeferTriggers,
    (when) => buildTemplateIR(`<@defer when="${when}"><p>x</p></@defer>`),
    (when) => processDefer(`<@defer when="${when}"><p>x</p></@defer>`),
  ]) {
    assert.throws(
      () => compile(value),
      (error) => error.code === 'AVX_C34' && error.message.includes(value),
    );
  }
}

/**
 * Runs a lifecycle scenario with deterministic subscription callbacks.
 * @param {Function} run - Scenario using the subscriptions.
 * @param {boolean} [synchronous] - Whether observing immediately reports visible.
 */
function subscriptions(run, synchronous = false) {
  const timers = new Map();
  const idles = new Map();
  const observers = [];
  const callbacks = [];
  const listeners = new Set();
  let serial = 0;
  const saved = {
    timer: globalThis.setTimeout,
    clear: globalThis.clearTimeout,
    idle: globalThis.requestIdleCallback,
    cancel: globalThis.cancelIdleCallback,
    observer: globalThis.IntersectionObserver,
    windowIdle: window.requestIdleCallback,
    windowCancel: window.cancelIdleCallback,
    add: window.EventTarget.prototype.addEventListener,
    remove: window.EventTarget.prototype.removeEventListener,
  };
  globalThis.setTimeout = (callback) => {
    callbacks.push(callback);
    timers.set(++serial, callback);
    return serial;
  };
  globalThis.clearTimeout = (handle) => timers.delete(handle);
  globalThis.requestIdleCallback = window.requestIdleCallback = (callback) => {
    callbacks.push(callback);
    idles.set(++serial, callback);
    return serial;
  };
  globalThis.cancelIdleCallback = window.cancelIdleCallback = (handle) => idles.delete(handle);
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.active = true;
      observers.push(this);
    }
    observe(target) {
      this.target = target;
      if (synchronous) this.callback([{ isIntersecting: true }]);
    }
    disconnect() {
      this.active = false;
    }
  };
  window.EventTarget.prototype.addEventListener = function (type, listener, ...rest) {
    if (type === 'click' || type === 'mouseenter') listeners.add(listener);
    return saved.add.call(this, type, listener, ...rest);
  };
  window.EventTarget.prototype.removeEventListener = function (type, listener, ...rest) {
    listeners.delete(listener);
    return saved.remove.call(this, type, listener, ...rest);
  };
  try {
    run({ timers, idles, observers, callbacks, listeners });
  } finally {
    globalThis.setTimeout = saved.timer;
    globalThis.clearTimeout = saved.clear;
    globalThis.requestIdleCallback = saved.idle;
    globalThis.cancelIdleCallback = saved.cancel;
    globalThis.IntersectionObserver = saved.observer;
    window.requestIdleCallback = saved.windowIdle;
    window.cancelIdleCallback = saved.windowCancel;
    window.EventTarget.prototype.addEventListener = saved.add;
    window.EventTarget.prototype.removeEventListener = saved.remove;
  }
}

/**
 * Creates the same placeholder/content lifecycle on each rendering path.
 * @param {string} engine - Compiled or fallback.
 * @param {string[]} triggers - Subscriptions to arm.
 * @returns {object} The fixture and its lifecycle operations.
 */
function fixture(engine, triggers) {
  const root = document.createElement('section');
  document.body.appendChild(root);
  let update;
  let dispose;
  if (engine === 'compiled') {
    const anchor = document.createTextNode('');
    root.appendChild(anchor);
    const binding = new DeferBinding(
      anchor,
      (block) => ({
        usable: true,
        create() {
          const fragment = document.createDocumentFragment();
          const span = document.createElement('span');
          span.className = block.name;
          span.textContent = block.name;
          fragment.appendChild(span);
          return fragment;
        },
        dispose() {},
      }),
      [{ name: 'loaded' }, { name: 'waiting' }],
      null,
    );
    update = () => binding.update({ when: triggers, b: 0, ph: 1 }, () => false);
    dispose = () => binding.dispose();
  } else {
    root.innerHTML = processDefer(
      `<@defer when="${triggers.join('; ')}"><@placeholder><span class="waiting">waiting</span></@placeholder><span class="loaded">loaded</span></@defer>`,
    );
    const manager = new DeferManager(null, { render: (markup) => markup });
    update = () => manager.process(root, {}, {});
    dispose = () => manager.destroy();
  }
  return { root, update, dispose };
}

for (const engine of ['compiled', 'fallback']) {
  for (const winner of ['visible', 'interaction', 'timer', 'idle', 'unmount']) {
    subscriptions((api) => {
      const { root, update, dispose } = fixture(engine, ['visible', 'interaction', 'timer(4000)', 'idle']);
      try {
        update();
        update();
        assert.equal(root.querySelector('.loaded'), null);
        assert.equal(api.observers.length, 1, 'an update cannot rearm existing subscriptions');
        assert.equal(api.timers.size, 1);
        assert.equal(api.idles.size, 1);
        const observer = api.observers[0];
        if (winner === 'unmount') dispose();
        else if (winner === 'visible') observer.callback([{ isIntersecting: true }]);
        else if (winner === 'interaction') observer.target.dispatchEvent(new window.Event('click', { bubbles: true }));
        else if (winner === 'timer') [...api.timers.values()][0]();
        else [...api.idles.values()][0]();
        assert.equal(api.timers.size, 0, `${engine}: all timers are cancelled on ${winner}`);
        assert.equal(api.idles.size, 0, `${engine}: all idle callbacks are cancelled on ${winner}`);
        assert.equal(api.listeners.size, 0, `${engine}: all listeners are removed on ${winner}`);
        assert.equal(observer.active, false);
        for (const callback of api.callbacks) callback();
        observer.callback([{ isIntersecting: true }]);
        assert.equal(
          root.querySelectorAll('.loaded').length,
          winner === 'unmount' ? 0 : 1,
          'late callbacks cannot mount twice',
        );
        if (winner !== 'unmount') assert.equal(root.querySelector('.waiting'), null);
      } finally {
        dispose();
        root.remove();
      }
    });
  }
  subscriptions((api) => {
    const { root, update, dispose } = fixture(engine, ['visible', 'timer(4000)', 'idle']);
    try {
      update();
      assert.equal(root.querySelectorAll('.loaded').length, 1);
      assert.equal(api.observers[0].active, false, 'a synchronous observer is also released');
      assert.equal(api.timers.size + api.idles.size, 0, 'a synchronous winner prevents later subscriptions');
    } finally {
      dispose();
      root.remove();
    }
  }, true);
}
console.log('Combined defer compiler, first-trigger wins and teardown tests passed on both renderers.');
