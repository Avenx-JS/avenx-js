import assert from 'assert';
import '../../../test/helpers/register-happy-dom.js';
import { AvenxApp, AvenxComponent, bridge, nextTick } from '../../../lib/core/index.js';
import { avenxI18n, createAvenxI18n, createI18n, TEMPLATE_GLOBALS } from '../src/index.js';
import { captureLogs, loggedMatching, memoryStorage, messages, mountTemplate, reset } from './helpers.js';

captureLogs();

const mountTarget = document.createElement('div');
mountTarget.id = 'app';
document.body.appendChild(mountTarget);

/**
 * Creates an app bound to the shared mount target.
 * @returns {AvenxApp} A fresh application instance.
 */
function createApp() {
  return new AvenxApp({ target: '#app' });
}

/**
 * Installs the plugin on a fresh app over the shared message set.
 * @param {object} [options] - Overrides for the plugin options.
 * @returns {object} `{ app, i18n }`.
 */
function installed(options = {}) {
  const app = createApp();
  app.use(avenxI18n, { locale: 'en', fallbackLocale: 'en', messages: messages(), ...options });
  return { app, i18n: app.$i18n };
}

// ---------------------------------------------------------------------------
// 1. Installation
// ---------------------------------------------------------------------------

/**
 * The plugin installs in both supported shapes and publishes its handle.
 */
async function testInstallation() {
  console.log('  1. Testing plugin installation...');
  reset();

  const { app, i18n } = installed();
  assert.ok(app.$i18n, 'app.$i18n is installed');
  assert.strictEqual(typeof i18n.t, 'function', 'the handle is the translator');
  assert.strictEqual(i18n.locale.current, 'en', 'configured with the options given');

  // The factory form.
  reset();
  const second = createApp();
  second.use(createAvenxI18n({ locale: 'de', messages: messages() }));
  assert.strictEqual(second.$i18n.locale.current, 'de', 'the factory form installs too');

  // An instance built earlier can be installed as it is, which is how two apps
  // (or a test and an app) share one translator.
  reset();
  const shared = createI18n({ locale: 'pl', messages: messages() });
  const third = createApp();
  third.use(avenxI18n, { i18n: shared });
  assert.strictEqual(third.$i18n, shared, 'a prepared instance is installed unchanged');

  assert.throws(() => avenxI18n.install(null), /Invalid AvenxApp instance/, 'installing without an app is rejected');
  assert.throws(
    () => avenxI18n.install(createApp(), { i18n: {} }),
    /expects an instance built by createI18n/,
    'a bogus instance is rejected',
  );
  assert.throws(
    () => avenxI18n.install(createApp(), { locale: 'not a locale' }),
    /not a valid locale tag/,
    'bad options are rejected at install time',
  );
  assert.throws(
    () => avenxI18n.install(createApp(), { formats: { colour: {} } }),
    /format group/,
    'an unknown format group is rejected',
  );
  assert.throws(
    () => avenxI18n.install(createApp(), 'nope'),
    /expects an options object/,
    'non-object options are rejected',
  );

  assert.deepStrictEqual(
    TEMPLATE_GLOBALS,
    ['t', 'tHtml', 'n', 'd', 'rel', 'locale', '$i18n'],
    'the plugin names the identifiers it publishes, for avenx.config.json',
  );

  console.log('  ✅ Plugin installation passed!');
}

// ---------------------------------------------------------------------------
// 2. Translating inside a component
// ---------------------------------------------------------------------------

/**
 * A component template can translate with no import and no wiring.
 */
async function testComponentTranslation() {
  console.log('  2. Testing translation inside a component...');
  reset();

  installed();

  const view = mountTemplate(
    '<div>' +
      '<h1>{{ t("home.title") }}</h1>' +
      '<p>{{ t("home.description") }}</p>' +
      '<nav>{{ t("navigation.settings") }}</nav>' +
      '<b>{{ locale.current }}</b>' +
      '</div>',
  );

  assert.ok(view.text().includes('Welcome'), 'the title is translated');
  assert.ok(view.text().includes('Welcome to Avenx'), 'so is the description');
  assert.ok(view.text().includes('Settings'), 'and a key from another group');
  assert.ok(view.text().includes('en'), 'the active locale is readable from the template');

  console.log('  ✅ Translation inside a component passed!');
}

// ---------------------------------------------------------------------------
// 3. Reactive locale switching
// ---------------------------------------------------------------------------

/**
 * Changing the locale re-renders exactly the components that translate.
 */
async function testReactivity() {
  console.log('  3. Testing reactive locale switching...');
  reset();

  const { i18n } = installed();

  const translated = mountTemplate('<h1>{{ t("home.title") }}</h1>');
  const untranslated = mountTemplate('<span>{{ count }}</span>', { count: 0 });

  assert.strictEqual(translated.counter.renders, 1, 'the translated component rendered once');
  assert.strictEqual(untranslated.counter.renders, 1, 'so did the other one');
  assert.ok(translated.text().includes('Welcome'), 'in English');

  await i18n.locale.set('de');
  await nextTick();

  assert.ok(translated.text().includes('Willkommen'), 'the translated component followed the locale');
  assert.strictEqual(translated.counter.renders, 2, 'by re-rendering exactly once');
  assert.strictEqual(
    untranslated.counter.renders,
    1,
    'a component that never translates is not re-rendered — there is no application-wide update',
  );

  // Setting the same locale again changes nothing at all.
  await i18n.locale.set('de');
  await nextTick();
  assert.strictEqual(translated.counter.renders, 2, 'a no-op locale change causes no update');

  // And no loop: one switch is one render, not a cascade.
  await i18n.locale.set('en');
  await nextTick();
  await nextTick();
  assert.strictEqual(translated.counter.renders, 3, 'switching back re-renders once, not repeatedly');
  assert.ok(translated.text().includes('Welcome'), 'with the English message');

  translated.component.unmount();
  untranslated.component.unmount();

  console.log('  ✅ Reactive locale switching passed!');
}

// ---------------------------------------------------------------------------
// 4. Only the translated part of the DOM changes
// ---------------------------------------------------------------------------

/**
 * A locale change patches the text that changed and leaves the rest of the DOM
 * — including element identity and uncontrolled state — alone.
 */
async function testTargetedUpdate() {
  console.log('  4. Testing targeted DOM updates...');
  reset();

  const { i18n } = installed();

  const view = mountTemplate(
    '<div>' +
      '<h1 id="title">{{ t("home.title") }}</h1>' +
      '<p id="static">Never translated</p>' +
      '<input id="draft" type="text" />' +
      '</div>',
  );

  const staticNode = view.root.querySelector('#static');
  const input = view.root.querySelector('#draft');
  input.value = 'half-typed';

  await i18n.locale.set('de');
  await nextTick();

  assert.strictEqual(view.root.querySelector('#title').textContent, 'Willkommen', 'the translated node changed');
  assert.strictEqual(view.root.querySelector('#static'), staticNode, 'the untranslated element is the same node');
  assert.strictEqual(view.root.querySelector('#draft'), input, 'and so is the input');
  assert.strictEqual(view.root.querySelector('#draft').value, 'half-typed', 'its uncontrolled value survived');

  view.component.unmount();

  console.log('  ✅ Targeted DOM updates passed!');
}

// ---------------------------------------------------------------------------
// 5. Interpolation, plurals and formatting in templates
// ---------------------------------------------------------------------------

/**
 * The whole surface works through the template expression sandbox, with values
 * that come from component state.
 */
async function testTemplateSurface() {
  console.log('  5. Testing the template surface...');
  reset();

  const { i18n } = installed({
    locale: 'en-US',
    formats: { number: { euro: { style: 'currency', currency: 'EUR' } } },
  });

  const view = mountTemplate(
    '<div>' +
      '<p id="greeting">{{ t("welcome.user", { name: user }) }}</p>' +
      '<p id="count">{{ t("cart.items", { count: items }) }}</p>' +
      '<p id="price">{{ n(price, "euro") }}</p>' +
      '<p id="when">{{ rel(-1, "day") }}</p>' +
      '</div>',
    { user: 'Ada', items: 1, price: 12 },
  );

  assert.strictEqual(view.root.querySelector('#greeting').textContent, 'Hello, Ada!', 'a state value interpolates');
  assert.strictEqual(view.root.querySelector('#count').textContent, '1 item', 'a state value pluralizes');
  assert.ok(view.root.querySelector('#price').textContent.includes('12.00'), 'a number is formatted');
  assert.strictEqual(view.root.querySelector('#when').textContent, 'yesterday', 'a relative time is formatted');

  // Component state driving a translation stays reactive on its own.
  view.component.state.items = 4;
  await nextTick();
  assert.strictEqual(view.root.querySelector('#count').textContent, '4 items', 'the plural follows component state');

  await i18n.locale.set('de');
  await nextTick();
  assert.strictEqual(view.root.querySelector('#greeting').textContent, 'Hallo, Ada!', 'and the locale');
  assert.strictEqual(view.root.querySelector('#count').textContent, '4 Elemente', 'in both places at once');

  view.component.unmount();

  console.log('  ✅ The template surface passed!');
}

// ---------------------------------------------------------------------------
// 6. Component-declared members win over the plugin's
// ---------------------------------------------------------------------------

/**
 * A component that declares its own `t` keeps it. The plugin publishes into
 * scope; it does not overwrite application code.
 */
async function testNoShadowing() {
  console.log('  6. Testing that components keep their own members...');
  reset();

  installed();

  const view = mountTemplate('<p>{{ t }} {{ n }}</p>', { t: 'my own t', n: 7 });
  assert.strictEqual(view.text().trim(), 'my own t 7', "the component's own state shadows the plugin's helpers");

  view.component.unmount();

  console.log('  ✅ Component members win passed!');
}

// ---------------------------------------------------------------------------
// 7. Translating alongside bridges
// ---------------------------------------------------------------------------

/**
 * A translated component that also reads a bridge tracks both, independently.
 */
async function testWithBridges() {
  console.log('  7. Testing translation alongside bridges...');
  reset();

  const { i18n } = installed();

  const cart = bridge({
    state: { items: 1 },
    add() {
      this.items++;
    },
  });

  const root = document.createElement('div');
  document.body.appendChild(root);
  let renders = 0;

  /**
   * A component reading both a bridge and the translator.
   */
  class CartLine extends AvenxComponent {
    /**
     * Builds the component.
     */
    constructor() {
      super({}, {}, { cart }, '<p>{{ t("cart.items", { count: cart.items }) }}</p>', {});
    }

    /**
     * Renders, recording that it happened.
     * @returns {string} The rendered HTML.
     */
    render() {
      renders++;
      return super.render();
    }
  }

  const component = new CartLine();
  component.mount(root);
  assert.strictEqual(root.textContent, '1 item', 'the bridge value pluralizes the translation');

  cart.add();
  await nextTick();
  assert.strictEqual(root.textContent, '2 items', 'a bridge change re-renders the translated line');
  assert.strictEqual(renders, 2, 'once');

  await i18n.locale.set('de');
  await nextTick();
  assert.strictEqual(root.textContent, '2 Elemente', 'a locale change does too');
  assert.strictEqual(renders, 3, 'also once');

  component.unmount();
  cart.$dispose();

  console.log('  ✅ Translation alongside bridges passed!');
}

// ---------------------------------------------------------------------------
// 8. Lifecycle
// ---------------------------------------------------------------------------

/**
 * An unmounted component stops following the locale, and a subscription taken
 * in a lifecycle hook is released with it.
 */
async function testLifecycle() {
  console.log('  8. Testing component lifecycle behaviour...');
  reset();

  const { i18n } = installed();

  const view = mountTemplate('<h1>{{ t("home.title") }}</h1>');
  const before = view.counter.renders;

  view.component.unmount();
  await i18n.locale.set('de');
  await nextTick();

  assert.strictEqual(view.counter.renders, before, 'an unmounted component is not re-rendered');

  // A subscription opened inside a lifecycle hook belongs to that component's
  // disposal scope, because it is the bridge's own on().
  reset();
  const { i18n: second } = installed();
  const seen = [];
  const root = document.createElement('div');
  document.body.appendChild(root);

  /**
   * A component that watches for locale changes.
   */
  class Watcher extends AvenxComponent {
    /**
     * Builds the component.
     */
    constructor() {
      super({}, {}, {}, '<p>{{ t("home.title") }}</p>', {});
    }

    /**
     * Subscribes to locale changes on mount.
     */
    onMount() {
      second.on('change', (payload) => seen.push(payload.locale));
    }
  }

  const watcher = new Watcher();
  watcher.mount(root);

  await second.locale.set('de');
  assert.deepStrictEqual(seen, ['de'], 'the hook heard the change');

  watcher.unmount();
  await second.locale.set('pl');
  assert.deepStrictEqual(seen, ['de'], 'and stopped hearing them once unmounted');

  console.log('  ✅ Component lifecycle behaviour passed!');
}

// ---------------------------------------------------------------------------
// 9. Lazy loading inside a running application
// ---------------------------------------------------------------------------

/**
 * A locale that arrives later updates the components already on screen.
 */
async function testLazyInApp() {
  console.log('  9. Testing lazy loading in a running application...');
  reset();

  let resolveLoader;
  const { i18n } = installed({
    loaders: {
      fr: () =>
        new Promise((resolve) => {
          resolveLoader = () => resolve({ default: { home: { title: 'Bienvenue' } } });
        }),
    },
  });

  const view = mountTemplate('<div><h1>{{ t("home.title") }}</h1><i>{{ locale.loading }}</i></div>');
  assert.ok(view.text().includes('Welcome'), 'the page starts in English');

  const switching = i18n.locale.set('fr');
  await nextTick();
  assert.ok(view.text().includes('true'), 'the loading flag is reactive while the locale is in flight');
  assert.ok(view.text().includes('Welcome'), 'and the page keeps its current language meanwhile');

  resolveLoader();
  await switching;
  await nextTick();

  assert.ok(view.text().includes('Bienvenue'), 'the loaded locale reaches the mounted component');
  assert.ok(view.text().includes('false'), 'and the loading flag clears');

  // Messages added later also reach what is already on screen.
  const renders = view.counter.renders;
  i18n.addMessages('fr', { home: { title: 'Salut' } });
  await nextTick();
  assert.ok(view.text().includes('Salut'), 'a replaced message re-renders the component that shows it');
  assert.strictEqual(view.counter.renders, renders + 1, 'once');

  view.component.unmount();

  console.log('  ✅ Lazy loading in a running application passed!');
}

// ---------------------------------------------------------------------------
// 10. Persistence of the chosen locale
// ---------------------------------------------------------------------------

/**
 * The chosen locale is written through a storage adapter and restored from it,
 * with no coupling to any particular storage plugin.
 */
async function testLocalePersistence() {
  console.log('  10. Testing locale persistence...');
  reset();

  const storage = memoryStorage();
  const first = installed({ storage });

  assert.strictEqual(storage.counts.writes, 0, 'nothing is written before the user chooses');
  await first.i18n.locale.set('de-CH');
  assert.strictEqual(storage.getItem('avenx:locale'), 'de-CH', 'the chosen locale is stored');
  assert.strictEqual(storage.counts.writes, 1, 'with one write');

  // The next visit.
  reset();
  const second = installed({ storage });
  assert.strictEqual(second.i18n.locale.current, 'de-CH', 'and restored on the next visit');
  assert.strictEqual(second.i18n.t('home.title'), 'Grüezi', 'so the application opens in that language');

  // A different key keeps two applications apart.
  reset();
  const scoped = installed({ storage, storageKey: 'shop:locale' });
  assert.strictEqual(scoped.i18n.locale.current, 'en', 'a different key sees a different value');
  await scoped.i18n.locale.set('pl');
  assert.strictEqual(storage.getItem('shop:locale'), 'pl', 'and writes to its own key');
  assert.strictEqual(storage.getItem('avenx:locale'), 'de-CH', 'leaving the other alone');

  // A stored locale the application no longer ships is ignored.
  reset();
  const stale = installed({ storage: memoryStorage({ 'avenx:locale': 'ja' }) });
  assert.strictEqual(stale.i18n.locale.current, 'en', 'a locale that is no longer available is ignored');
  assert.strictEqual(loggedMatching('no longer available').length, 1, 'and reported');

  // As is a stored value that is not a locale at all.
  reset();
  const corrupt = installed({ storage: memoryStorage({ 'avenx:locale': '{{{' }) });
  assert.strictEqual(corrupt.i18n.locale.current, 'en', 'a corrupt stored value is ignored');
  assert.strictEqual(loggedMatching('is not a valid locale tag and was ignored').length, 1, 'and reported');

  // A regional locale of an available language is still adopted.
  reset();
  const regional = installed({ storage: memoryStorage({ 'avenx:locale': 'de-AT' }) });
  assert.strictEqual(regional.i18n.locale.current, 'de-AT', 'a regional variant of a known language is adopted');
  assert.strictEqual(regional.i18n.t('home.title'), 'Willkommen', 'and renders through its language');

  console.log('  ✅ Locale persistence passed!');
}

/**
 * Runs the suite.
 */
async function runTests() {
  console.log('🧪 Starting Avenx i18n Integration Test Suite...\n');

  await testInstallation();
  await testComponentTranslation();
  await testReactivity();
  await testTargetedUpdate();
  await testTemplateSurface();
  await testNoShadowing();
  await testWithBridges();
  await testLifecycle();
  await testLazyInApp();
  await testLocalePersistence();

  console.log('\n🎉 ALL AVENX I18N INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failure in Avenx i18n integration suite:');
    console.error(err);
    process.exit(1);
  });
