import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

/**
 * Mounts a component using the same methods argument as a compiled SFC.
 * @param {object} methods - Component actions.
 * @returns {AvenxComponent} Mounted component.
 */
function mount(methods) {
  document.body.innerHTML = '<div id="app"></div>';
  const component = new AvenxComponent({ count: 0 }, {}, {}, '<p id="content">Content</p>', methods);
  component.mount(document.querySelector('#app'));
  return component;
}

test('an onEnter action runs after onMount with the component state', () => {
  const calls = [];
  const component = mount({
    onMount() {
      calls.push('mount');
    },
    onEnter() {
      this.state.count = 1;
      calls.push('enter');
    },
  });
  try {
    assert.deepEqual(calls, ['mount', 'enter']);
    assert.equal(component.state.count, 1);
  } finally {
    component.unmount();
  }
});

test('synchronous leave actions run before immediate teardown', () => {
  const calls = [];
  const component = mount({
    onBeforeLeave() {
      calls.push('before');
    },
    onLeave() {
      calls.push('leave');
    },
    onUnmount() {
      calls.push('unmount');
    },
  });
  assert.equal(component.unmount(), undefined);
  assert.deepEqual(calls, ['before', 'leave', 'unmount']);
  assert.equal(document.querySelector('#content'), null);
});

test('an onBeforeLeave action keeps the DOM until its Promise resolves', async () => {
  const calls = [];
  let release;
  const component = mount({
    onBeforeLeave() {
      calls.push('before');
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    onLeave() {
      calls.push('leave');
    },
    onUnmount() {
      calls.push('unmount');
    },
  });
  const finished = component.unmount();
  assert.ok(finished instanceof Promise);
  assert.deepEqual(calls, ['before']);
  assert.ok(document.querySelector('#content'));
  release();
  await finished;
  assert.deepEqual(calls, ['before', 'leave', 'unmount']);
  assert.equal(document.querySelector('#content'), null);
});

test('class-defined transition hooks still run', () => {
  const calls = [];
  class Component extends AvenxComponent {
    onEnter() {
      calls.push('enter');
    }
    onBeforeLeave() {
      calls.push('before');
    }
    onLeave() {
      calls.push('leave');
    }
  }
  document.body.innerHTML = '<div id="app"></div>';
  const component = new Component({}, {}, {}, '<span>Content</span>');
  component.mount(document.querySelector('#app'));
  component.unmount();
  assert.deepEqual(calls, ['enter', 'before', 'leave']);
});

test('extend-defined transition hooks still run', () => {
  const calls = [];
  const Component = AvenxComponent.extend({
    template: '<span>Content</span>',
    onEnter() {
      calls.push('enter');
    },
    onBeforeLeave() {
      calls.push('before');
    },
    onLeave() {
      calls.push('leave');
    },
  });
  document.body.innerHTML = '<div id="app"></div>';
  const component = new Component();
  component.mount(document.querySelector('#app'));
  component.unmount();
  assert.deepEqual(calls, ['enter', 'before', 'leave']);
});
