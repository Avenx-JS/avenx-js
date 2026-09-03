import assert from 'assert';
import '../../../test/helpers/register-happy-dom.js';
import { AvenxApp, nextTick } from '../../../lib/core/index.js';
import { avenxI18n, createI18n } from '../src/index.js';
import { captureLogs, failingStorage, loggedMatching, memoryStorage, mountTemplate, reset } from './helpers.js';

captureLogs();

const mountTarget = document.createElement('div');
mountTarget.id = 'app';
document.body.appendChild(mountTarget);

/**
 * Installs the plugin on a fresh app.
 * @param {object} options - Plugin options.
 * @returns {object} The i18n instance.
 */
function install(options) {
  const app = new AvenxApp({ target: '#app' });
  app.use(avenxI18n, options);
  return app.$i18n;
}

// ---------------------------------------------------------------------------
// 1. Configuration mistakes are loud, at setup
// ---------------------------------------------------------------------------

/**
 * Anything a developer got wrong throws where the stack still points at it.
 */
async function testConfigValidation() {
  console.log('  1. Testing configuration validation...');
  reset();

  assert.throws(() => createI18n('nope'), /expects an options object/, 'a non-object is refused');
  assert.throws(() => createI18n([]), /expects an options object/, 'an array is refused');
  assert.throws(() => createI18n({ locale: 'not a locale' }), /"locale" that is not a valid/, 'a bad locale is refused');
  assert.throws(() => createI18n({ locale: 42 }), /"locale" that is not a valid/, 'a non-string locale is refused');
  assert.throws(
    () => createI18n({ fallbackLocale: 'nope!' }),
    /no valid locale tag in it/,
    'a bad fallback is refused',
  );
  assert.throws(() => createI18n({ messages: 'strings' }), /expects an object of messages/, 'bad messages are refused');
  assert.throws(
    () => createI18n({ messages: { 'not a locale': {} } }),
    /which is not a valid locale tag/,
    'messages under a bad tag are refused',
  );
  assert.throws(
    () => createI18n({ messages: { en: 'a string' } }),
    /expects an object of messages/,
    "a locale's messages must be an object",
  );
  assert.throws(
    () => createI18n({ loaders: { fr: 'not a function' } }),
    /expects loaders\["fr"\] to be a function/,
    'a non-function loader is refused',
  );
  assert.throws(
    () => createI18n({ formats: { number: { euro: 'nope' } } }),
    /expects an object of messages/,
    'a non-object format preset is refused',
  );
  assert.throws(() => createI18n({ missing: 'blank' }), /expects "missing" to be/, 'an unknown missing mode is refused');
  assert.throws(() => createI18n({ onError: 'nope' }), /"onError" that is not a function/, 'a bad onError is refused');
  assert.throws(() => createI18n({ storage: { getItem() {} } }), /not a storage adapter/, 'a partial adapter is refused');
  assert.throws(() => createI18n({ storageKey: '' }), /"storageKey" to be a non-empty string/, 'an empty key is refused');

  assert.strictEqual(loggedMatching('[avenx-i18n]').length, 0, 'configuration errors are thrown, not logged');

  console.log('  ✅ Configuration validation passed!');
}

// ---------------------------------------------------------------------------
// 2. Malformed resources
// ---------------------------------------------------------------------------

/**
 * One bad branch in a resource file costs that branch and nothing else.
 */
async function testMalformedResources() {
  console.log('  2. Testing malformed translation resources...');
  reset();

  const i18n = createI18n({
    locale: 'en',
    fallbackLocale: null,
    messages: {
      en: {
        good: 'fine',
        aNumber: 42,
        aBoolean: true,
        nothing: null,
        aList: ['one', 'two'],
        aFunction: () => 'nope',
        group: { good: 'also fine', bad: undefined },
      },
    },
  });

  assert.strictEqual(i18n.t('good'), 'fine', 'a valid sibling of a bad entry still resolves');
  assert.strictEqual(i18n.t('group.good'), 'also fine', 'and so does one nested beside it');

  assert.strictEqual(i18n.t('aNumber'), 'aNumber', 'a number is not a message');
  assert.strictEqual(i18n.t('aList'), 'aList', 'nor is an array');
  assert.strictEqual(i18n.t('nothing'), 'nothing', 'nor null');

  assert.strictEqual(loggedMatching('"aNumber" is a number').length, 1, 'each bad entry is named');
  assert.strictEqual(loggedMatching('"aList" is an array').length, 1, 'with its actual type');
  assert.strictEqual(loggedMatching('"nothing" is null').length, 1, 'including null');
  assert.strictEqual(loggedMatching('"group.bad" is a undefined').length, 1, 'nested paths are reported in full');

  // A group whose keys merely look like plural categories is still a group.
  reset();
  const ambiguous = createI18n({
    fallbackLocale: null,
    messages: { en: { one: { title: 'A title' }, few: 'a message' } },
  });
  assert.strictEqual(ambiguous.t('one.title'), 'A title', 'a nested group named after a category is still a group');
  assert.strictEqual(ambiguous.t('few'), 'a message', 'and a sibling string is still a message');

  console.log('  ✅ Malformed translation resources passed!');
}

// ---------------------------------------------------------------------------
// 3. Failure reporting
// ---------------------------------------------------------------------------

/**
 * Every runtime failure reaches the application's onError, and a handler that
 * throws does not take the render with it.
 */
async function testErrorReporting() {
  console.log('  3. Testing failure reporting...');
  reset();

  const failures = [];
  const i18n = createI18n({
    locale: 'en',
    fallbackLocale: null,
    messages: { en: { greet: 'Hi {name}', items: { one: 'one', other: 'many' } } },
    onError: (failure) => failures.push(failure),
  });

  i18n.t('nope');
  i18n.t('greet');
  i18n.t('items');
  i18n.n('not a number');
  await i18n.locale.set('not a locale');

  const phases = failures.map((failure) => failure.phase);
  assert.ok(phases.includes('missing'), 'a missing key is reported');
  assert.ok(phases.includes('interpolation'), 'an absent parameter is reported');
  assert.ok(phases.includes('plural'), 'a missing count is reported');
  assert.ok(phases.includes('format'), 'a bad format input is reported');
  assert.ok(phases.includes('locale'), 'an invalid locale is reported');

  const missing = failures.find((failure) => failure.phase === 'missing');
  assert.strictEqual(missing.key, 'nope', 'the failure names the key');
  assert.strictEqual(missing.locale, 'en', 'and the locale');
  assert.strictEqual(missing.error, null, 'with no underlying error where there was none');

  // A handler that throws is contained.
  reset();
  const hostile = createI18n({
    fallbackLocale: null,
    messages: { en: {} },
    onError: () => {
      throw new Error('handler exploded');
    },
  });
  assert.strictEqual(hostile.t('nope'), 'nope', 'translation still returns');
  assert.strictEqual(loggedMatching('onError callback threw').length, 1, 'and the broken handler is reported');

  console.log('  ✅ Failure reporting passed!');
}

// ---------------------------------------------------------------------------
// 4. Storage failures
// ---------------------------------------------------------------------------

/**
 * A browser that will not store anything costs the "remembers your language"
 * feature and nothing else.
 */
async function testStorageFailures() {
  console.log('  4. Testing storage failures...');
  reset();

  const unreadable = createI18n({
    messages: { en: { title: 'Welcome' }, de: { title: 'Willkommen' } },
    storage: failingStorage({ onGet: new Error('storage is blocked') }),
  });
  assert.strictEqual(unreadable.locale.current, 'en', 'an unreadable store leaves the configured locale');
  assert.strictEqual(unreadable.t('title'), 'Welcome', 'and the application renders');
  assert.strictEqual(loggedMatching('stored locale could not be read').length, 1, 'the failure is reported');

  reset();
  const unwritable = createI18n({
    messages: { en: { title: 'Welcome' }, de: { title: 'Willkommen' } },
    storage: failingStorage({ onSet: new Error('quota exceeded') }),
  });
  assert.strictEqual(await unwritable.locale.set('de'), 'de', 'the locale still changes');
  assert.strictEqual(unwritable.t('title'), 'Willkommen', 'and the application follows it');
  assert.strictEqual(loggedMatching('chosen locale could not be stored').length, 1, 'the failure is reported');

  console.log('  ✅ Storage failures passed!');
}

// ---------------------------------------------------------------------------
// 5. Translations are text
// ---------------------------------------------------------------------------

/**
 * A translation is text. Markup in a message, or in an interpolated value,
 * renders as characters and never as DOM.
 */
async function testTranslationsAreText() {
  console.log('  5. Testing that translations are treated as text...');
  reset();

  install({
    locale: 'en',
    fallbackLocale: null,
    messages: {
      en: {
        markup: '<img src=x onerror="globalThis.__i18nXss = true"> & <b>bold</b>',
        greet: 'Hello {name}',
      },
    },
  });

  const view = mountTemplate('<div><p id="markup">{{ t("markup") }}</p><p id="greet">{{ t("greet", { name: evil }) }}</p></div>', {
    evil: '<script>globalThis.__i18nXss = true;</script>',
  });

  assert.strictEqual(view.root.querySelector('img'), null, 'a message containing markup produces no element');
  assert.strictEqual(view.root.querySelector('b'), null, 'not even a harmless one');
  assert.strictEqual(view.root.querySelector('script'), null, 'an interpolated value produces no element either');
  assert.strictEqual(globalThis.__i18nXss, undefined, 'and nothing from a message ran');

  assert.ok(view.root.innerHTML.includes('&lt;img'), 'the message is escaped in the markup');
  assert.ok(view.root.innerHTML.includes('&lt;script'), 'and so is the interpolated value');
  assert.strictEqual(
    view.root.querySelector('#markup').textContent,
    '<img src=x onerror="globalThis.__i18nXss = true"> & <b>bold</b>',
    'while the text a user sees is exactly what the translator wrote',
  );

  view.component.unmount();

  console.log('  ✅ Translations are treated as text passed!');
}

// ---------------------------------------------------------------------------
// 6. Rich translations are explicit and sanitized
// ---------------------------------------------------------------------------

/**
 * tHtml() is the only way markup reaches the DOM, and it sanitizes.
 */
async function testRichTranslations() {
  console.log('  6. Testing rich translations...');
  reset();

  install({
    locale: 'en',
    fallbackLocale: null,
    messages: {
      en: {
        note: 'Read the <a href="/docs" onclick="globalThis.__i18nRich = 1">docs</a>',
        hostile: '<script>globalThis.__i18nRich = 2;</script><p>text</p>',
        withValue: 'Signed in as <strong>{name}</strong>',
      },
    },
  });

  const view = mountTemplate(
    '<div>' +
      '<p id="note">{{{ tHtml("note") }}}</p>' +
      '<div id="hostile">{{{ tHtml("hostile") }}}</div>' +
      '<p id="value">{{{ tHtml("withValue", { name: injected }) }}}</p>' +
      '</div>',
    { injected: '<img src=x onerror="globalThis.__i18nRich = 3">' },
  );

  const link = view.root.querySelector('#note a');
  assert.ok(link, 'a declared rich translation does produce markup');
  assert.strictEqual(link.getAttribute('href'), '/docs', 'keeping the attributes a policy allows');
  assert.strictEqual(link.getAttribute('onclick'), null, 'and dropping the ones it does not');

  assert.strictEqual(view.root.querySelector('#hostile script'), null, 'a script in a message is removed');
  assert.ok(view.root.querySelector('#hostile p'), 'while the rest of the message survives');

  assert.ok(view.root.querySelector('#value strong'), "the translator's own markup is kept");
  assert.strictEqual(view.root.querySelector('#value img'), null, 'an interpolated value contributes no markup');
  assert.ok(
    view.root.querySelector('#value').textContent.includes('<img src=x'),
    'it contributes text, exactly as supplied',
  );

  assert.strictEqual(globalThis.__i18nRich, undefined, 'nothing from any of them ran');

  view.component.unmount();

  console.log('  ✅ Rich translations passed!');
}

// ---------------------------------------------------------------------------
// 7. Interpolation cannot execute anything
// ---------------------------------------------------------------------------

/**
 * A placeholder names a parameter. It is not an expression, and there is no
 * path from a message to code.
 */
async function testNoDynamicEvaluation() {
  console.log('  7. Testing that interpolation cannot execute code...');
  reset();

  const i18n = createI18n({
    fallbackLocale: null,
    messages: {
      en: {
        expression: 'result: {1 + 1}',
        call: 'result: {alert()}',
        template: 'result: ${globalThis.__i18nEval = 1}',
        proto: 'result: {__proto__} {constructor} {prototype}',
        deep: 'result: {a.constructor}',
      },
    },
  });

  assert.strictEqual(i18n.t('expression'), 'result: {1 + 1}', 'an expression is literal text');
  assert.strictEqual(i18n.t('call'), 'result: {alert()}', 'a call is literal text');
  assert.strictEqual(i18n.t('template'), 'result: ${globalThis.__i18nEval = 1}', 'template syntax is literal text');
  assert.strictEqual(globalThis.__i18nEval, undefined, 'nothing was evaluated');

  // A placeholder named after a structural property reads the parameters and
  // nothing else — the prototype chain is never consulted.
  assert.strictEqual(
    i18n.t('proto', {}),
    'result: {__proto__} {constructor} {prototype}',
    'structural names resolve to no value',
  );
  assert.strictEqual(i18n.t('deep', { a: {} }), 'result: {a.constructor}', 'a dotted name cannot walk the prototype');

  // A parameter is only ever stringified, whatever it is.
  const stringified = createI18n({ fallbackLocale: null, messages: { en: { v: '[{value}]' } } });
  assert.strictEqual(stringified.t('v', { value: { a: 1 } }), '[[object Object]]', 'an object is stringified');
  assert.strictEqual(
    stringified.t('v', { value: () => 'called' }),
    '[() => \'called\']',
    'a function is stringified, not invoked',
  );

  console.log('  ✅ Interpolation cannot execute code passed!');
}

// ---------------------------------------------------------------------------
// 8. A failing translation never breaks a render
// ---------------------------------------------------------------------------

/**
 * Everything that can go wrong at once still renders a page.
 */
async function testRenderSurvival() {
  console.log('  8. Testing that a broken translation still renders...');
  reset();

  const i18n = install({
    locale: 'sv',
    fallbackLocale: 'en',
    messages: { en: { present: 'Present' } },
  });

  const view = mountTemplate(
    '<div>' +
      '<p id="a">{{ t("absent.key") }}</p>' +
      '<p id="b">{{ t("present") }}</p>' +
      '<p id="c">{{ t("") }}</p>' +
      '<p id="d">{{ n(undefined) }}</p>' +
      '<p id="e">{{ d("not a date") }}</p>' +
      '</div>',
  );

  assert.strictEqual(view.root.querySelector('#a').textContent, 'absent.key', 'a missing key renders as the key');
  assert.strictEqual(view.root.querySelector('#b').textContent, 'Present', 'and its neighbours still render');
  assert.strictEqual(view.root.querySelector('#c').textContent, '', 'an empty key renders as nothing');
  assert.strictEqual(view.root.querySelector('#d').textContent, '', 'an unformattable number renders as nothing');
  assert.strictEqual(view.root.querySelector('#e').textContent, 'not a date', 'an unparseable date renders as itself');

  // And the component is still live afterwards.
  await i18n.locale.set('en');
  await nextTick();
  assert.strictEqual(view.root.querySelector('#b').textContent, 'Present', 'the component still follows the locale');

  view.component.unmount();

  console.log('  ✅ A broken translation still renders passed!');
}

// ---------------------------------------------------------------------------
// 9. Caches stay correct
// ---------------------------------------------------------------------------

/**
 * The lookup cache is an optimization, not a source of stale answers.
 */
async function testCacheCorrectness() {
  console.log('  9. Testing cache correctness...');
  reset();

  const i18n = createI18n({
    locale: 'en',
    fallbackLocale: null,
    messages: { en: { key: 'first' }, de: { key: 'erste' } },
  });

  assert.strictEqual(i18n.t('key'), 'first', 'the first answer is cached');
  i18n.addMessages('en', { key: 'second' });
  assert.strictEqual(i18n.t('key'), 'second', 'and replaced when the catalogue changes');

  assert.strictEqual(i18n.t('later'), 'later', 'a miss is cached too');
  i18n.addMessages('en', { later: 'arrived' });
  assert.strictEqual(i18n.t('later'), 'arrived', 'and invalidated when the key arrives');
  assert.strictEqual(i18n.has('later'), true, 'has() sees it as well');

  await i18n.locale.set('de');
  assert.strictEqual(i18n.t('key'), 'erste', 'each locale keeps its own cached answer');
  await i18n.locale.set('en');
  assert.strictEqual(i18n.t('key'), 'second', 'and switching back does not mix them up');

  // Changing the fallback changes what a chain resolves to.
  reset();
  const chained = createI18n({
    locale: 'fr',
    fallbackLocale: 'en',
    messages: { fr: {}, en: { key: 'english' }, de: { key: 'german' } },
  });
  assert.strictEqual(chained.t('key'), 'english', 'the configured fallback answers');
  chained.setFallbackLocale('de');
  assert.strictEqual(chained.t('key'), 'german', 'and a new one takes over immediately');

  console.log('  ✅ Cache correctness passed!');
}

// ---------------------------------------------------------------------------
// 10. Storage adapters from another plugin
// ---------------------------------------------------------------------------

/**
 * The locale round-trips through any object with the Web Storage shape, which
 * is what makes `@avenx/persistence` adapters work here with no coupling.
 */
async function testAdapterInterop() {
  console.log('  10. Testing storage adapter interoperability...');
  reset();

  const adapter = memoryStorage();
  const first = createI18n({
    messages: { en: {}, de: {}, fr: {} },
    storage: adapter,
    storageKey: 'shop:locale',
  });
  await first.locale.set('fr');

  // Anything with the same three methods reads it back — including the real
  // Web Storage API, which this stands in for.
  assert.strictEqual(adapter.getItem('shop:locale'), 'fr', 'the value is a plain locale tag, not an envelope');

  const second = createI18n({
    messages: { en: {}, de: {}, fr: {} },
    storage: adapter,
    storageKey: 'shop:locale',
  });
  assert.strictEqual(second.locale.current, 'fr', 'a second instance restores it');

  console.log('  ✅ Storage adapter interoperability passed!');
}

// ---------------------------------------------------------------------------
// 11. Diagnostics do not grow without bound
// ---------------------------------------------------------------------------

/**
 * Warnings are deduplicated, but the history that makes that possible is
 * bounded: an application is free to build keys from data, so the set of
 * distinct messages is unbounded in principle.
 */
async function testBoundedDiagnostics() {
  console.log('  11. Testing bounded diagnostics...');
  reset();

  const i18n = createI18n({ fallbackLocale: null, messages: { en: {} } });

  assert.strictEqual(i18n.t('first.key'), 'first.key', 'the first miss renders as the key');
  assert.strictEqual(loggedMatching('no translation for "first.key"').length, 1, 'and warns once');
  i18n.t('first.key');
  assert.strictEqual(loggedMatching('no translation for "first.key"').length, 1, 'a repeat is suppressed');

  // Far more distinct keys than the history remembers.
  for (let index = 0; index < 600; index++) {
    assert.strictEqual(i18n.t(`generated.${index}`), `generated.${index}`, 'every key still renders');
  }

  const before = loggedMatching('no translation for "first.key"').length;
  i18n.t('first.key');
  assert.strictEqual(
    loggedMatching('no translation for "first.key"').length,
    before + 1,
    'the history was emptied rather than grown, so the warning comes back',
  );

  console.log('  ✅ Bounded diagnostics passed!');
}

/**
 * Runs the suite.
 */
async function runTests() {
  console.log('🧪 Starting Avenx i18n Resilience & Security Test Suite...\n');

  await testConfigValidation();
  await testMalformedResources();
  await testErrorReporting();
  await testStorageFailures();
  await testTranslationsAreText();
  await testRichTranslations();
  await testNoDynamicEvaluation();
  await testRenderSurvival();
  await testCacheCorrectness();
  await testAdapterInterop();
  await testBoundedDiagnostics();

  console.log('\n🎉 ALL AVENX I18N RESILIENCE TESTS PASSED SUCCESSFULLY!\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failure in Avenx i18n resilience suite:');
    console.error(err);
    process.exit(1);
  });
