import assert from 'assert';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { mountTestComponent } from '../../lib/core/testing.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

(async () => {
  try {
    setupDOMMock();

    class ButtonComponent extends AvenxComponent {
      constructor(bridges, props) {
        super(
          { clicks: 0 },
          {},
          bridges,
          `<button class="go" @click="state.clicks++">{{props.label || 'Go'}}</button>`,
          {},
          props,
        );
      }
    }

    const wrapper = await mountTestComponent(ButtonComponent, {
      props: { label: 'Click' },
    });

    assert.ok(typeof wrapper.find === 'function');
    assert.ok(typeof wrapper.findAll === 'function');
    assert.ok(typeof wrapper.findComponent === 'function');
    assert.ok(typeof wrapper.trigger === 'function');

    const btn = wrapper.find('button');
    assert.ok(btn, 'find should locate button');
    assert.ok(wrapper.findAll('button').length >= 1);
    assert.ok(wrapper.find('.go'), 'find should support class selector');

    const found = wrapper.findComponent(ButtonComponent);
    assert.ok(found, 'findComponent should locate mounted instance');
    assert.strictEqual(found, wrapper.instance);

    assert.strictEqual(wrapper.instance.state.clicks, 0);
    await wrapper.trigger('button', 'click');
    assert.strictEqual(wrapper.instance.state.clicks, 1);

    wrapper.unmount();
    teardownDOMMock();
    console.log('✅ mountTestComponent query helpers tests passed');
    process.exit(0);
  } catch (err) {
    teardownDOMMock();
    console.error('❌ mountTestComponent query helpers failed:', err);
    process.exit(1);
  }
})();
