import { AvenxApp } from 'avenx-core/runtime';
import LanguageSwitcher from './components/language-switcher/language-switcher.component.js';

/* global AvenxI18n -- loaded from a <script> tag; see index.html. */

const app = new AvenxApp({ target: '#app' });

/**
 * English and German ship with the bundle. French and Italian do not: they are
 * fetched the first time somebody selects them, which is what the `loaders`
 * option is for. Under a bundler these would be `() => import('./fr.js')`;
 * the Avenx CLI compiles to one script, so this example fetches JSON files
 * from `translations/` instead — the plugin only cares that a loader returns
 * the messages.
 */
const loaders = {
  fr: () => fetch('translations/fr.json').then((response) => response.json()),
  it: () => fetch('translations/it.json').then((response) => response.json()),
};

app.use(AvenxI18n.avenxI18n, {
  locale: 'de-CH',
  fallbackLocale: 'en',

  messages: {
    en: {
      app: {
        title: 'Avenx Storefront',
        tagline: 'One application, four languages, no re-render of anything that is not translated.',
      },
      nav: { language: 'Language', settings: 'Settings' },
      order: {
        greeting: 'Hello, {name}!',
        // A plural message: the categories a language actually selects are
        // decided by Intl.PluralRules, not by this file.
        items: {
          zero: 'Your basket is empty.',
          one: 'You have {count} item in your basket.',
          other: 'You have {count} items in your basket.',
        },
        total: 'Total',
        placed: 'Ordered {when}',
        add: 'Add an item',
        remove: 'Remove one',
        // Markup a translator is trusted to write, rendered with tHtml().
        // Everything else on this page is plain text.
        terms: 'By ordering you accept our <a href="#terms">terms of sale</a>.',
      },
      errors: { network: { timeout: 'The request timed out. Please try again.' } },
    },

    de: {
      app: {
        title: 'Avenx Warenhaus',
        tagline: 'Eine Anwendung, vier Sprachen, kein Neurendern von allem, was nicht übersetzt ist.',
      },
      nav: { language: 'Sprache', settings: 'Einstellungen' },
      order: {
        greeting: 'Hallo, {name}!',
        items: {
          zero: 'Ihr Warenkorb ist leer.',
          one: 'Sie haben {count} Artikel im Warenkorb.',
          other: 'Sie haben {count} Artikel im Warenkorb.',
        },
        total: 'Gesamt',
        placed: 'Bestellt {when}',
        add: 'Artikel hinzufügen',
        remove: 'Einen entfernen',
        terms: 'Mit der Bestellung akzeptieren Sie unsere <a href="#terms">Verkaufsbedingungen</a>.',
      },
      errors: { network: { timeout: 'Die Anfrage hat zu lange gedauert. Bitte erneut versuchen.' } },
    },

    // Swiss German overrides two strings and inherits the rest from `de`,
    // which in turn falls back to `en` for anything neither defines.
    'de-CH': {
      app: { title: 'Avenx Warehuus' },
      nav: { language: 'Sproch' },
    },
  },

  loaders,

  // Named Intl presets, so a currency is spelled one way across the whole
  // application rather than in each component.
  formats: {
    number: {
      currency: { style: 'currency', currency: 'CHF' },
    },
    date: {
      full: { dateStyle: 'long', timeStyle: 'short' },
    },
  },

  // Remember the visitor's choice. Any object with getItem/setItem/removeItem
  // works here — window.localStorage, or browserLocalStorage() from
  // @avenx/persistence. Neither plugin needs to know about the other.
  storage: window.localStorage,
  storageKey: 'avenx-shop:locale',

  onError: ({ phase, key, locale, message }) => {
    console.warn(`[shop] i18n ${phase} problem`, { key, locale, message });
  },
});

app.register('LanguageSwitcher', LanguageSwitcher);

app.initRouter({
  '/': 'Storefront',
  '#/': 'Storefront',
});
