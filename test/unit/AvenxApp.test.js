import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

console.log('Testing AvenxApp registration inspection APIs...');

const container = document.createElement('div');
container.id = 'app';
document.body.appendChild(container);

class TestComponent extends AvenxComponent {}

class AnotherComponent extends AvenxComponent {}

class HomePage extends AvenxComponent {}

class AboutPage extends AvenxComponent {}

const app = new AvenxApp({ target: '#app' });

console.log('Testing registered component names...');

app.register('TestComponent', TestComponent);
app.register('AnotherComponent', AnotherComponent);

// `VirtualList` used to appear here unconditionally, because AvenxApp imported
// and registered it in its constructor -- which put it, the template renderer
// and the DOM patcher into every bundle whether or not the application wrote
// the tag. Built-ins now come from a registry the compiler fills when it sees
// the tag, so an app that registers two components has two components.
assert.deepStrictEqual(
  app.getRegisteredComponents(),
  ['TestComponent', 'AnotherComponent'],
  'getRegisteredComponents() should return registered component names',
);

// The built-in is still available; it arrives with the module that registers
// it, which is what the compiler links when a template references the tag.
await import('../../lib/core/runtime/installVirtualList.js');
const appWithBuiltins = new AvenxApp({ target: '#app' });
assert.ok(
  appWithBuiltins.getRegisteredComponents().includes('VirtualList'),
  'a built-in is registered once its install module has been imported',
);

console.log('Registered component names returned correctly.');

console.log('Testing registered page names...');

app.registerPage('HomePage', HomePage);
app.registerPage('AboutPage', AboutPage);

assert.deepStrictEqual(
  app.getRegisteredPages(),
  ['HomePage', 'AboutPage'],
  'getRegisteredPages() should return registered page names',
);

console.log('Registered page names returned correctly.');

console.log('Testing registration and mounting of component created via AvenxComponent.extend()...');

const ExtendedCard = AvenxComponent.extend({
  name: 'ExtendedCard',
  state: { theme: 'dark' },
  methods: {
    toggleTheme() {
      this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
    },
  },
});

app.register('ExtendedCard', ExtendedCard);
assert.ok(
  app.getRegisteredComponents().includes('ExtendedCard'),
  'getRegisteredComponents() should include ExtendedCard',
);

const cardInstance = new ExtendedCard();
assert.strictEqual(cardInstance.state.theme, 'dark');
cardInstance.toggleTheme();
assert.strictEqual(cardInstance.state.theme, 'light');

console.log('AvenxComponent.extend() registration and instantiation test passed.');

console.log('AvenxApp registration inspection tests passed.');