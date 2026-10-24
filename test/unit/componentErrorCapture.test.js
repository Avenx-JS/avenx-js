import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

/**
 * Mounts a real page/component/component tree with an observable error path.
 * @param {object} options - Error source and capture behavior.
 * @param {string} [options.source] - Where the child fails.
 * @param {boolean} [options.stop] - Whether the middle hook stops propagation.
 * @param {boolean} [options.mixin] - Whether the middle hook comes from a mixin.
 * @param {boolean} [options.pageOnly] - Whether only the page declares a hook.
 * @returns {object} Mounted instances and the recorded error path.
 */
function mountTree({ source = 'onMount', stop = true, mixin = false, pageOnly = false } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const calls = [];
  const failure = new Error('child failed');
  let child;
  let middle;

  const capture = function (error, instance, origin) {
    calls.push({ name: 'middle', error, instance, origin, owner: this.state.owner });
    if (stop) return false;
  };
  if (mixin) {
    AvenxComponent.mixin({
      onErrorCaptured(error, instance, origin) {
        if (this === middle) return capture.call(this, error, instance, origin);
      },
    });
  }

  class Child extends AvenxComponent {
    constructor(bridges, props) {
      super(
        {},
        {},
        bridges,
        '',
        {
          onMount() {
            if (source === 'onMount') throw failure;
          },
        },
        props,
        {},
        source === 'resource' ? { payload: () => Promise.reject(failure) } : {},
      );
      child = this;
    }

    render() {
      if (source === 'render') throw failure;
      if (source === 'resource') return String(this.payload);
      return '<span>child</span>';
    }
  }

  class Middle extends AvenxComponent {
    constructor(bridges, props) {
      super(
        { owner: 'middle' },
        {},
        bridges,
        '<section><div data-avenx-comp="Child"></div></section>',
        mixin || pageOnly ? {} : { onErrorCaptured: capture },
        props,
      );
      middle = this;
    }
  }

  class Home extends AvenxPage {
    constructor(bridges) {
      super(
        {},
        {},
        bridges,
        '<main><div data-avenx-comp="Middle"></div></main>',
        {},
        new Map([
          ['Child', Child],
          ['Middle', Middle],
        ]),
      );
    }

    onErrorCaptured(error, instance, origin) {
      calls.push({ name: 'page', error, instance, origin });
    }
  }

  const app = new AvenxApp({ target: '#app' });
  app.onError((error, instance, origin) => calls.push({ name: 'app', error, instance, origin }));
  app.register('Child', Child);
  app.register('Middle', Middle);
  app.register('Home', Home);
  app.mount('Home');
  return {
    page: document.querySelector('#app').__avenx_comp_instance,
    calls,
    failure,
    get child() {
      return child;
    },
    get middle() {
      return middle;
    },
  };
}

for (const source of ['onMount', 'render', 'resource']) {
  for (const stop of [true, false]) {
    test(`${source} errors visit the nearest component before the page${stop ? ' and stop on false' : ''}`, async (t) => {
      t.mock.method(logger, 'error', () => {});
      const tree = mountTree({ source, stop });
      t.after(() => tree.page.unmount());
      if (source === 'resource') await tree.child.$resources.payload.promise;

      assert.deepEqual(
        tree.calls.map((call) => call.name),
        stop ? ['middle'] : ['middle', 'page', 'app'],
      );
      for (const call of tree.calls) {
        assert.equal(call.error, tree.failure);
        assert.equal(call.instance, tree.child);
        assert.equal(call.origin, source === 'onMount' ? 'onMount' : 'runUpdate');
      }
      assert.equal(tree.calls[0].owner, 'middle');
    });
  }
}

test('a mixin hook on the nearest component can stop a child lifecycle error', (t) => {
  t.mock.method(logger, 'error', () => {});
  t.after(() => AvenxComponent.clearMixins());
  const tree = mountTree({ mixin: true });
  t.after(() => tree.page.unmount());
  assert.deepEqual(
    tree.calls.map((call) => call.name),
    ['middle'],
  );
  assert.equal(tree.calls[0].instance, tree.child);
  assert.equal(tree.calls[0].owner, 'middle');
});

test('a page hook still receives errors when the intermediate component has no hook', (t) => {
  t.mock.method(logger, 'error', () => {});
  const tree = mountTree({ pageOnly: true });
  t.after(() => tree.page.unmount());
  assert.deepEqual(
    tree.calls.map((call) => call.name),
    ['page', 'app'],
  );
  assert.equal(tree.calls[0].instance, tree.child);
  assert.equal(tree.calls[0].error, tree.failure);
});

test('forwarded scoped slots keep the page that authored them as their scope', (t) => {
  document.body.innerHTML = '<div id="app"></div>';
  class Middle extends AvenxComponent {
    constructor(bridges, props) {
      super({ label: 'MIDDLE' }, {}, bridges, '<section><slot></slot></section>', {}, props);
    }
  }
  class Child extends AvenxComponent {
    constructor(bridges, props) {
      super({}, {}, bridges, '<slot :value="123"></slot>', {}, props);
    }
  }
  const parser = new ComponentParser(new StyleProcessor());
  const template = parser.processComponentTags(
    '<Middle><Child><template data-slot-props="s"><span>{{ label }}:{{ s.value }}</span></template></Child></Middle>',
  );
  const page = new AvenxPage(
    { label: 'PAGE' },
    {},
    {},
    template,
    {},
    new Map([
      ['Middle', Middle],
      ['Child', Child],
    ]),
  );
  t.after(() => page.unmount());
  page.mount(document.querySelector('#app'));
  assert.equal(document.querySelector('span').textContent, 'PAGE:123');
});

test('an independently mounted application keeps its own error handler', (t) => {
  t.mock.method(logger, 'error', () => {});
  document.body.innerHTML = '<div id="app"></div>';
  const calls = [];
  class Outer extends AvenxComponent {
    constructor(bridges) {
      super({}, {}, bridges, '<div id="inner"></div>');
    }
    onErrorCaptured() {
      calls.push('outer');
      return false;
    }
  }
  class Inner extends AvenxComponent {
    constructor(bridges) {
      super({}, {}, bridges, '<span>inner</span>', {
        onMount() {
          throw new Error('inner failed');
        },
      });
    }
  }
  const outerApp = new AvenxApp({ target: '#app' });
  outerApp.register('Outer', Outer);
  outerApp.mount('Outer');
  const outer = document.querySelector('#app').__avenx_comp_instance;
  t.after(() => outer.unmount());
  const innerApp = new AvenxApp({ target: '#inner' });
  innerApp.onError(() => calls.push('inner app'));
  innerApp.register('Inner', Inner);
  innerApp.mount('Inner');
  const inner = document.querySelector('#inner').__avenx_comp_instance;
  t.after(() => inner.unmount());
  assert.deepEqual(calls, ['inner app']);
});
