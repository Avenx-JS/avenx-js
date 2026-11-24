import assert from 'node:assert/strict';
import { createI18n } from '../src/i18n.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

for (const next of ['de', 'en']) {
  const french = deferred();
  const i18n = createI18n({
    messages: { en: { greeting: 'Hello' }, de: { greeting: 'Hallo' } },
    loaders: { fr: () => french.promise },
  });
  const changes = [];
  i18n.on('change', ({ locale }) => changes.push(locale));
  const pending = i18n.locale.set('fr');
  await i18n.locale.set(next);
  french.resolve({ greeting: 'Bonjour' });
  assert.equal(await pending, next);
  assert.equal(i18n.locale.current, next);
  assert.deepEqual(changes, next === 'en' ? [] : ['de']);
  assert.equal(i18n.has('greeting', 'fr'), true, 'superseded downloads remain cached');
  assert.equal(i18n.locale.loading, false);
}

const french = deferred();
const german = deferred();
const i18n = createI18n({
  messages: { en: { greeting: 'Hello' } },
  loaders: { fr: () => french.promise, de: () => german.promise },
});
const first = i18n.locale.set('fr');
const second = i18n.locale.set('de');
german.resolve({ greeting: 'Hallo' });
assert.equal(await second, 'de');
french.resolve({ greeting: 'Bonjour' });
assert.equal(await first, 'de');
assert.equal(i18n.t('greeting'), 'Hallo');
console.log('The most recent locale selection wins, including selection of the current locale.');
