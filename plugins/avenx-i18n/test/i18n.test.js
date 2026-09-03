import assert from 'assert';
import '../../../test/helpers/register-happy-dom.js';
import { createI18n } from '../src/index.js';
import { expandLocale, normalizeLocale, resolveChain } from '../src/locale.js';
import { captureLogs, loggedMatching, messages, reset } from './helpers.js';

captureLogs();

/**
 * Builds an instance over the shared message set.
 * @param {object} [options] - Overrides for `createI18n()`.
 * @returns {object} The i18n instance.
 */
function i18nFor(options = {}) {
  return createI18n({ locale: 'en', fallbackLocale: 'en', messages: messages(), ...options });
}

// ---------------------------------------------------------------------------
// 1. Translation lookup
// ---------------------------------------------------------------------------

/**
 * Keys resolve, nested keys resolve, and each locale answers with its own
 * messages.
 */
async function testLookup() {
  console.log('  1. Testing translation lookup...');
  reset();

  const i18n = i18nFor();

  assert.strictEqual(i18n.t('home.title'), 'Welcome', 'a nested key resolves');
  assert.strictEqual(i18n.t('home.description'), 'Welcome to Avenx', 'a sibling key resolves');
  assert.strictEqual(i18n.t('navigation.settings'), 'Settings', 'a key in another group resolves');
  assert.strictEqual(i18n.t('errors.network.timeout'), 'The request timed out', 'a three-level key resolves');

  assert.strictEqual(i18n.has('home.title'), true, 'has() confirms a key that resolves');
  assert.strictEqual(i18n.has('home.nope'), false, 'has() denies one that does not');
  assert.strictEqual(i18n.has(''), false, 'has() denies an empty key');
  assert.strictEqual(i18n.has('home.title', 'de'), true, 'has() can ask about another locale');
  assert.strictEqual(i18n.has('home.title', 'not a locale'), false, 'has() denies an invalid locale');

  assert.strictEqual(loggedMatching('[avenx-i18n]').length, 0, 'a successful lookup says nothing');

  await i18n.locale.set('de');
  assert.strictEqual(i18n.t('home.title'), 'Willkommen', 'the other locale answers with its own message');
  assert.strictEqual(i18n.t('navigation.settings'), 'Einstellungen', 'and does so for every key it has');

  console.log('  ✅ Translation lookup passed!');
}

// ---------------------------------------------------------------------------
// 2. Locale normalization
// ---------------------------------------------------------------------------

/**
 * Tags are canonicalized wherever they arrive, and expansion walks the
 * language-script-region core.
 */
async function testNormalization() {
  console.log('  2. Testing locale normalization...');
  reset();

  assert.strictEqual(normalizeLocale('de_ch'), 'de-CH', 'an underscore tag is canonicalized');
  assert.strictEqual(normalizeLocale('  EN-us '), 'en-US', 'casing and padding are fixed');
  assert.strictEqual(normalizeLocale('zh-hant-tw'), 'zh-Hant-TW', 'a script subtag is title-cased');
  assert.strictEqual(normalizeLocale('not a locale'), null, 'nonsense is rejected');
  assert.strictEqual(normalizeLocale(''), null, 'an empty string is rejected');
  assert.strictEqual(normalizeLocale(42), null, 'a non-string is rejected');
  assert.strictEqual(normalizeLocale(null), null, 'null is rejected');

  assert.deepStrictEqual(expandLocale('zh-Hant-TW'), ['zh-Hant-TW', 'zh-Hant', 'zh'], 'a tag expands to its ancestors');
  assert.deepStrictEqual(expandLocale('en'), ['en'], 'a bare language expands to itself');
  assert.deepStrictEqual(
    expandLocale('de-u-nu-latn'),
    ['de-u-nu-latn', 'de'],
    'an extension subtag is not treated as an ancestor',
  );

  assert.deepStrictEqual(
    resolveChain('de-CH', ['en-US', 'en']),
    ['de-CH', 'de', 'en-US', 'en'],
    'the chain is the locale then each fallback, expanded',
  );
  assert.deepStrictEqual(resolveChain('en', ['en']), ['en'], 'a repeated locale appears once');

  // The same locale written three ways names one catalogue.
  const i18n = createI18n({
    locale: 'DE_ch',
    fallbackLocale: 'EN',
    messages: { 'de-ch': { greeting: 'Grüezi' }, en: { greeting: 'Hello' } },
  });
  assert.strictEqual(i18n.locale.current, 'de-CH', 'the configured locale is canonical');
  assert.strictEqual(i18n.t('greeting'), 'Grüezi', 'and matches the canonicalized catalogue');
  assert.deepStrictEqual(i18n.locale.available, ['de-CH', 'en'], 'available locales are canonical');

  console.log('  ✅ Locale normalization passed!');
}

// ---------------------------------------------------------------------------
// 3. Fallback
// ---------------------------------------------------------------------------

/**
 * A regional locale falls back to its language, then to the configured
 * fallback locales, in order.
 */
async function testFallback() {
  console.log('  3. Testing locale fallback...');
  reset();

  const i18n = i18nFor({ locale: 'de-CH' });

  assert.deepStrictEqual(i18n.locale.chain, ['de-CH', 'de', 'en'], 'the chain is de-CH then de then en');
  assert.strictEqual(i18n.t('home.title'), 'Grüezi', 'the regional message wins where it exists');
  assert.strictEqual(i18n.t('home.description'), 'Willkommen bei Avenx', 'the language answers what the region omits');
  assert.strictEqual(i18n.t('errors.network.timeout'), 'The request timed out', 'the fallback locale answers the rest');

  // A chain of several fallbacks is walked in the declared order.
  const ordered = createI18n({
    locale: 'fr',
    fallbackLocale: ['de', 'en'],
    messages: { fr: {}, de: { only: { de: 'nur de' } }, en: { only: { de: 'de only', en: 'en only' } } },
  });
  assert.deepStrictEqual(ordered.locale.chain, ['fr', 'de', 'en'], 'multiple fallbacks keep their order');
  assert.strictEqual(ordered.t('only.de'), 'nur de', 'the first fallback that has the key wins');
  assert.strictEqual(ordered.t('only.en'), 'en only', 'later fallbacks answer what earlier ones lack');

  // Fallback can be turned off entirely.
  const none = createI18n({ locale: 'de', fallbackLocale: null, messages: messages() });
  assert.deepStrictEqual(none.locale.fallback, [], 'null means no fallback locale');
  assert.strictEqual(none.t('errors.network.timeout'), 'errors.network.timeout', 'nothing answers outside the locale');

  // And replaced at runtime.
  none.setFallbackLocale('en');
  assert.strictEqual(none.t('errors.network.timeout'), 'The request timed out', 'a new fallback takes effect at once');

  console.log('  ✅ Locale fallback passed!');
}

// ---------------------------------------------------------------------------
// 4. Missing translations
// ---------------------------------------------------------------------------

/**
 * A missing key renders as something a developer can act on, is reported once,
 * and never throws.
 */
async function testMissing() {
  console.log('  4. Testing missing translations...');
  reset();

  const i18n = i18nFor();

  assert.strictEqual(i18n.t('home.missing.title'), 'home.missing.title', 'a missing key renders as the key');
  assert.notStrictEqual(i18n.t('home.missing.title'), '', 'and never as an empty string');
  assert.strictEqual(loggedMatching('no translation for "home.missing.title"').length, 1, 'the miss is reported');

  i18n.t('home.missing.title');
  i18n.t('home.missing.title');
  assert.strictEqual(loggedMatching('no translation for "home.missing.title"').length, 1, 'and reported only once');

  // A custom handler decides what a gap looks like.
  reset();
  const custom = i18nFor({ missing: (key, locale) => `[${locale}:${key}]` });
  assert.strictEqual(custom.t('nope'), '[en:nope]', 'the missing handler renders the gap');

  reset();
  const throwing = i18nFor({
    missing: () => {
      throw new Error('handler exploded');
    },
  });
  assert.strictEqual(throwing.t('nope'), 'nope', 'a throwing handler falls back to the key');
  assert.strictEqual(loggedMatching('the "missing" handler threw').length, 1, 'and is reported');

  reset();
  const wrongType = i18nFor({ missing: () => 42 });
  assert.strictEqual(wrongType.t('nope'), 'nope', 'a handler that returns a non-string falls back to the key');

  // A key that is not a usable key at all.
  reset();
  const strict = i18nFor();
  assert.strictEqual(strict.t(''), '', 'an empty key renders as nothing');
  assert.strictEqual(strict.t(null), '', 'so does a null key');
  assert.strictEqual(strict.t(undefined), '', 'and an absent one');
  assert.strictEqual(loggedMatching('must be a non-empty string').length, 3, 'each bad key shape is reported');

  console.log('  ✅ Missing translations passed!');
}

// ---------------------------------------------------------------------------
// 5. Interpolation
// ---------------------------------------------------------------------------

/**
 * Placeholders are filled from the parameters, and an absent one stays
 * visible.
 */
async function testInterpolation() {
  console.log('  5. Testing interpolation...');
  reset();

  const i18n = i18nFor();

  assert.strictEqual(i18n.t('welcome.user', { name: 'Ada' }), 'Hello, Ada!', 'one value is substituted');
  assert.strictEqual(
    i18n.t('cart.summary', { name: 'Ada', count: 3, total: 'CHF 12' }),
    'Ada, you have 3 items worth CHF 12',
    'several values are substituted',
  );

  assert.strictEqual(
    i18n.t('welcome.user', { name: 0 }),
    'Hello, 0!',
    'a falsy but present value is substituted, not treated as absent',
  );
  assert.strictEqual(i18n.t('welcome.user', { name: false }), 'Hello, false!', 'so is false');

  // Special characters survive untouched: escaping is the template's job, and
  // doing it here as well would double-escape.
  assert.strictEqual(
    i18n.t('welcome.user', { name: '<b>&</b> "quotes" \'and\' émoji 🎉' }),
    'Hello, <b>&</b> "quotes" \'and\' émoji 🎉!',
    'special characters pass through unchanged',
  );

  reset();
  const missingParam = i18nFor();
  assert.strictEqual(missingParam.t('welcome.user'), 'Hello, {name}!', 'an absent parameter leaves the placeholder');
  assert.strictEqual(missingParam.t('welcome.user', {}), 'Hello, {name}!', 'an empty parameter object does too');
  assert.strictEqual(missingParam.t('welcome.user', { name: null }), 'Hello, {name}!', 'and so does a null value');
  assert.strictEqual(loggedMatching('expects a "name" parameter').length, 1, 'the gap is reported');

  // Text between braces that is not a placeholder is literal.
  reset();
  const literal = createI18n({
    messages: { en: { braces: 'A { b } c {d} e', dotted: 'Hi {user.name}' } },
  });
  assert.strictEqual(literal.t('braces', { d: 'D' }), 'A { b } c D e', 'only well-formed placeholders substitute');
  assert.strictEqual(literal.t('dotted', { user: { name: 'Ada' } }), 'Hi Ada', 'a dotted name reads a nested value');

  console.log('  ✅ Interpolation passed!');
}

// ---------------------------------------------------------------------------
// 6. Pluralization
// ---------------------------------------------------------------------------

/**
 * Plural selection follows Intl.PluralRules, in every locale.
 */
async function testPluralization() {
  console.log('  6. Testing pluralization...');
  reset();

  const i18n = i18nFor();

  assert.strictEqual(i18n.t('cart.items', { count: 1 }), '1 item', 'one selects the singular');
  assert.strictEqual(i18n.t('cart.items', { count: 5 }), '5 items', 'five selects the plural');
  assert.strictEqual(i18n.t('cart.items', { count: 0 }), '0 items', 'English selects "other" for zero');
  assert.strictEqual(i18n.t('cart.empty', { count: 0 }), 'Your cart is empty', 'an explicit zero form wins at zero');
  assert.strictEqual(i18n.t('cart.empty', { count: 1 }), '1 item', 'and does not affect other counts');

  await i18n.locale.set('de');
  assert.strictEqual(i18n.t('cart.items', { count: 1 }), '1 Element', 'German singular');
  assert.strictEqual(i18n.t('cart.items', { count: 4 }), '4 Elemente', 'German plural');

  // Polish uses four categories; nothing in the plugin knows that.
  await i18n.locale.set('pl');
  assert.strictEqual(i18n.t('cart.items', { count: 1 }), '1 plik', 'Polish "one"');
  assert.strictEqual(i18n.t('cart.items', { count: 3 }), '3 pliki', 'Polish "few"');
  assert.strictEqual(i18n.t('cart.items', { count: 5 }), '5 plików', 'Polish "many"');
  assert.strictEqual(i18n.t('cart.items', { count: 1.5 }), '1.5 pliku', 'Polish "other"');

  // Arabic has six, including a CLDR "zero" the rules select rather than the
  // explicit-zero convention.
  reset();
  const arabic = createI18n({
    locale: 'ar',
    fallbackLocale: null,
    messages: {
      ar: {
        days: { zero: 'zero-form', one: 'one-form', two: 'two-form', few: 'few-form', many: 'many-form', other: 'other-form' },
      },
    },
  });
  assert.strictEqual(arabic.t('days', { count: 0 }), 'zero-form', 'Arabic zero');
  assert.strictEqual(arabic.t('days', { count: 2 }), 'two-form', 'Arabic two');
  assert.strictEqual(arabic.t('days', { count: 3 }), 'few-form', 'Arabic few');
  assert.strictEqual(arabic.t('days', { count: 11 }), 'many-form', 'Arabic many');

  // Japanese has one form; the same message answers every count.
  reset();
  const japanese = createI18n({
    locale: 'ja',
    fallbackLocale: null,
    messages: { ja: { items: { other: '{count}件' } } },
  });
  assert.strictEqual(japanese.t('items', { count: 1 }), '1件', 'Japanese has one form');
  assert.strictEqual(japanese.t('items', { count: 7 }), '7件', 'and uses it for every count');

  console.log('  ✅ Pluralization passed!');
}

// ---------------------------------------------------------------------------
// 7. Invalid plural configuration
// ---------------------------------------------------------------------------

/**
 * A plural message with no count, or with a category the locale needs and the
 * translator did not write, degrades rather than failing.
 */
async function testPluralEdges() {
  console.log('  7. Testing plural edge cases...');
  reset();

  const i18n = i18nFor();

  assert.strictEqual(i18n.t('cart.items'), '{count} items', 'no count falls back to "other"');
  assert.strictEqual(loggedMatching('needs a numeric "count"').length, 1, 'and is reported');

  reset();
  const notANumber = i18nFor();
  // The "other" form is selected, and the value still fills its placeholder:
  // a count that is not a number is a caller mistake, not a reason to drop it.
  assert.strictEqual(notANumber.t('cart.items', { count: 'many' }), 'many items', 'a non-numeric count falls back');
  assert.strictEqual(notANumber.t('cart.items', { count: NaN }), 'NaN items', 'so does NaN');
  assert.strictEqual(notANumber.t('cart.items', { count: Infinity }), 'Infinity items', 'and Infinity');

  // A Polish message that only declares the English categories.
  reset();
  const incomplete = createI18n({
    locale: 'pl',
    fallbackLocale: null,
    messages: { pl: { files: { one: '{count} plik', other: '{count} pliku' } } },
  });
  assert.strictEqual(incomplete.t('files', { count: 3 }), '3 pliku', 'a missing category falls back to "other"');
  assert.strictEqual(loggedMatching('has no "few" form').length, 1, 'and the gap in the translation is reported');

  // A plural form with no "other" at all.
  reset();
  const noOther = createI18n({
    locale: 'en',
    fallbackLocale: null,
    messages: { en: { odd: { one: 'just one' } } },
  });
  assert.strictEqual(noOther.t('odd', { count: 5 }), 'just one', 'the only form available is used');
  assert.strictEqual(loggedMatching('no "other" form').length, 1, 'and the misconfiguration is reported');

  console.log('  ✅ Plural edge cases passed!');
}

// ---------------------------------------------------------------------------
// 8. Formatting
// ---------------------------------------------------------------------------

/**
 * The Intl helpers format in the active locale and follow it when it changes.
 */
async function testFormatting() {
  console.log('  8. Testing Intl formatting...');
  reset();

  const i18n = i18nFor({
    locale: 'en-US',
    formats: {
      number: { euro: { style: 'currency', currency: 'EUR' } },
      date: { day: { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' } },
    },
  });

  assert.strictEqual(i18n.n(1234.5), '1,234.5', 'a number is grouped for the locale');
  assert.strictEqual(i18n.n(1234.5, { minimumFractionDigits: 2 }), '1,234.50', 'options pass through to Intl');
  assert.ok(i18n.n(12, 'euro').includes('12.00'), 'a named preset is applied');

  const date = new Date(Date.UTC(2026, 0, 15));
  assert.strictEqual(i18n.d(date, 'day'), '01/15/2026', 'a date preset is applied');
  assert.strictEqual(i18n.d(date.getTime(), 'day'), '01/15/2026', 'a timestamp is accepted');
  assert.strictEqual(i18n.d('2026-01-15T00:00:00Z', 'day'), '01/15/2026', 'so is a date string');

  assert.strictEqual(i18n.rel(-2, 'day'), '2 days ago', 'a relative time reads naturally');
  assert.strictEqual(i18n.rel(3, 'hour'), 'in 3 hours', 'in both directions');

  // Formatting follows the locale, which is the point of it living here.
  await i18n.locale.set('de-DE');
  assert.strictEqual(i18n.n(1234.5), '1.234,5', 'the new locale groups differently');
  assert.strictEqual(i18n.d(date, 'day'), '15.01.2026', 'and orders dates differently');
  assert.strictEqual(i18n.rel(-2, 'day'), 'vorgestern', 'and words relative times differently');

  console.log('  ✅ Intl formatting passed!');
}

// ---------------------------------------------------------------------------
// 9. Locale management
// ---------------------------------------------------------------------------

/**
 * The locale handle reports and changes the active locale predictably.
 */
async function testLocaleManagement() {
  console.log('  9. Testing locale management...');
  reset();

  const i18n = i18nFor({ locale: 'de-CH' });

  assert.strictEqual(i18n.locale.current, 'de-CH', 'the active locale is reported');
  assert.deepStrictEqual(i18n.locale.fallback, ['en'], 'so is the fallback');
  assert.deepStrictEqual(i18n.locale.available, ['de', 'de-CH', 'en', 'pl'], 'and every locale with messages');
  assert.strictEqual(i18n.locale.loading, false, 'nothing is loading');

  assert.strictEqual(i18n.locale.is('de'), true, 'a regional locale matches its language');
  assert.strictEqual(i18n.locale.is('de-CH'), true, 'and itself');
  assert.strictEqual(i18n.locale.is('de-AT'), false, 'but not a sibling region');
  assert.strictEqual(i18n.locale.is('en'), false, 'nor another language');
  assert.strictEqual(i18n.locale.is('nonsense!'), false, 'an invalid tag matches nothing');

  assert.strictEqual(await i18n.locale.set('EN_us'), 'en-US', 'set() canonicalizes and returns the active locale');
  assert.strictEqual(i18n.t('home.title'), 'Welcome', 'en-US falls back to en');

  assert.strictEqual(await i18n.locale.set('en-US'), 'en-US', 'setting the current locale again is a no-op');

  reset();
  const invalid = i18nFor();
  assert.strictEqual(await invalid.locale.set('not a locale'), 'en', 'an invalid tag leaves the locale alone');
  assert.strictEqual(loggedMatching('is not a valid locale tag').length, 1, 'and is reported');

  reset();
  const unknown = i18nFor();
  assert.strictEqual(await unknown.locale.set('ja'), 'ja', 'an unknown locale is still activated');
  assert.strictEqual(unknown.t('home.title'), 'Welcome', 'and renders entirely through the fallback chain');
  assert.strictEqual(loggedMatching('no messages are registered for "ja"').length, 1, 'the gap is reported');

  // A change is observable, and unsubscribing stops that.
  reset();
  const observed = i18nFor();
  const seen = [];
  const stop = observed.on('change', (payload) => seen.push(payload));
  await observed.locale.set('de');
  assert.deepStrictEqual(seen, [{ locale: 'de', previous: 'en' }], 'a locale change is emitted');
  stop();
  await observed.locale.set('pl');
  assert.strictEqual(seen.length, 1, 'unsubscribing stops the notifications');

  console.log('  ✅ Locale management passed!');
}

// ---------------------------------------------------------------------------
// 10. Adding messages at runtime
// ---------------------------------------------------------------------------

/**
 * Messages can be merged in after the fact, and the answer changes.
 */
async function testAddMessages() {
  console.log('  10. Testing runtime message registration...');
  reset();

  const i18n = i18nFor();

  assert.strictEqual(i18n.t('later.key'), 'later.key', 'the key is missing to begin with');
  i18n.addMessages('en', { later: { key: 'Added later' } });
  assert.strictEqual(i18n.t('later.key'), 'Added later', 'and resolves once registered');

  i18n.addMessages('en', { home: { title: 'Replaced' } });
  assert.strictEqual(i18n.t('home.title'), 'Replaced', 'an existing key is replaced');
  assert.strictEqual(i18n.t('home.description'), 'Welcome to Avenx', 'and its siblings are left alone');

  i18n.addMessages('fr_ca', { home: { title: 'Bienvenue' } });
  assert.ok(i18n.locale.available.includes('fr-CA'), 'a new locale becomes available, canonicalized');

  assert.throws(() => i18n.addMessages('nope!', {}), /not a valid locale tag/, 'an invalid tag is refused');
  assert.throws(() => i18n.addMessages('en', 'strings'), /expects an object of messages/, 'a non-object is refused');

  console.log('  ✅ Runtime message registration passed!');
}

// ---------------------------------------------------------------------------
// 11. Lazy loading
// ---------------------------------------------------------------------------

/**
 * A locale with a loader is fetched on demand, once, and a failure leaves the
 * application on the locale it had.
 */
async function testLazyLoading() {
  console.log('  11. Testing lazy-loaded locales...');
  reset();

  let calls = 0;
  const i18n = createI18n({
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { home: { title: 'Welcome' } } },
    loaders: {
      fr: () => {
        calls++;
        // The shape a dynamic import() resolves to.
        return Promise.resolve({ default: { home: { title: 'Bienvenue' } } });
      },
    },
  });

  assert.ok(i18n.locale.available.includes('fr'), 'a locale with a loader counts as available');
  assert.strictEqual(calls, 0, 'nothing is loaded until it is asked for');

  const switching = i18n.locale.set('fr');
  assert.strictEqual(i18n.locale.loading, true, 'the instance reports that a load is in flight');
  assert.strictEqual(await switching, 'fr', 'the switch completes once the messages arrive');
  assert.strictEqual(i18n.locale.loading, false, 'and the flag clears');
  assert.strictEqual(i18n.t('home.title'), 'Bienvenue', 'the loaded messages answer');
  assert.strictEqual(calls, 1, 'the loader ran once');

  await i18n.locale.set('en');
  await i18n.locale.set('fr');
  assert.strictEqual(calls, 1, 'and is not run again for a locale already loaded');

  // Two concurrent requests share one load.
  reset();
  let concurrent = 0;
  const shared = createI18n({
    messages: { en: {} },
    loaders: {
      es: () => {
        concurrent++;
        return new Promise((resolve) => setTimeout(() => resolve({ hola: 'Hola' }), 5));
      },
    },
  });
  const [a, b] = await Promise.all([shared.locale.load('es'), shared.locale.load('es')]);
  assert.strictEqual(concurrent, 1, 'concurrent loads of one locale are shared');
  assert.deepStrictEqual([a, b], [true, true], 'and both callers are told it succeeded');
  assert.strictEqual(shared.has('hola', 'es'), true, 'a loader may return the messages directly');
  assert.strictEqual(shared.locale.current, 'en', 'load() fetches without switching');

  // A failure is survivable.
  reset();
  const failing = createI18n({
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { home: { title: 'Welcome' } } },
    loaders: {
      it: () => Promise.reject(new Error('network down')),
    },
  });
  assert.strictEqual(await failing.locale.set('it'), 'en', 'a failed load leaves the locale unchanged');
  assert.strictEqual(failing.t('home.title'), 'Welcome', 'and the application keeps rendering');
  assert.strictEqual(failing.locale.loading, false, 'the loading flag clears after a failure');
  assert.strictEqual(loggedMatching('the loader for "it" failed').length, 1, 'the failure is reported');

  // A loader that resolves to something that is not messages.
  reset();
  const malformed = createI18n({
    messages: { en: {} },
    loaders: { nl: () => Promise.resolve('not messages') },
  });
  assert.strictEqual(await malformed.locale.load('nl'), false, 'a malformed payload is refused');
  assert.strictEqual(loggedMatching('the loader for "nl" failed').length, 1, 'and reported');

  // Asking for a locale nothing can provide.
  reset();
  const nothing = createI18n({ messages: { en: {} } });
  assert.strictEqual(await nothing.locale.load('sv'), false, 'a locale with no loader cannot be loaded');
  assert.strictEqual(loggedMatching('no messages and no loader are registered for "sv"').length, 1, 'and says so');
  assert.strictEqual(await nothing.locale.load('nonsense!'), false, 'an invalid tag cannot be loaded either');

  // Loaders can also be registered after the fact.
  reset();
  const later = createI18n({ messages: { en: {} } });
  later.addLoader('da', () => ({ hej: 'Hej' }));
  assert.ok(later.locale.available.includes('da'), 'the locale becomes available');
  assert.strictEqual(await later.locale.set('da'), 'da', 'and can be switched to');
  assert.strictEqual(later.t('hej'), 'Hej', 'with its messages loaded');
  assert.throws(() => later.addLoader('nope!', () => ({})), /not a valid locale tag/, 'an invalid tag is refused');
  assert.throws(() => later.addLoader('sv', 'nope'), /expects a function/, 'a non-function loader is refused');

  console.log('  ✅ Lazy-loaded locales passed!');
}

/**
 * Runs the suite.
 */
async function runTests() {
  console.log('🧪 Starting Avenx i18n Plugin Test Suite...\n');

  await testLookup();
  await testNormalization();
  await testFallback();
  await testMissing();
  await testInterpolation();
  await testPluralization();
  await testPluralEdges();
  await testFormatting();
  await testLocaleManagement();
  await testAddMessages();
  await testLazyLoading();

  console.log('\n🎉 ALL AVENX I18N PLUGIN TESTS PASSED SUCCESSFULLY!\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failure in Avenx i18n Plugin:');
    console.error(err);
    process.exit(1);
  });
