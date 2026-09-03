# @avenx/i18n

The official internationalization plugin for [Avenx.js](https://avenx-js.com/).

Translation in Avenx is not a second rendering system bolted on the side. The
active locale lives in an ordinary Avenx [bridge](https://avenx-js.com/core-concepts/bridges/),
and `t()` reads it — so calling `t()` while a component renders *is* subscribing
to the language, through the same dependency tracking that answers a counter
increment. Switching locale re-renders exactly the components that translate,
patches only the text nodes that changed, and leaves everything else alone.

```bash
npm install @avenx/i18n
```

```javascript
import { AvenxApp } from 'avenx-core/runtime';
import { avenxI18n } from '@avenx/i18n';

const app = new AvenxApp({ target: '#app' });

app.use(avenxI18n, {
  locale: 'de-CH',
  fallbackLocale: 'en',
  messages: {
    en: { home: { title: 'Welcome', description: 'Welcome to Avenx' } },
    de: { home: { title: 'Willkommen', description: 'Willkommen bei Avenx' } },
    'de-CH': { home: { title: 'Grüezi' } },
  },
});
```

```html
<h1>{{ t('home.title') }}</h1>
<p>{{ t('home.description') }}</p>

<button @click="locale.set('en')">English</button>
```

No import in the component, no injection, no wiring. Installing the plugin
publishes `t`, `tHtml`, `n`, `d`, `rel`, `locale` and `$i18n` into every
component's template scope.

## What it does

| | |
| --- | --- |
| **Reactive locale** | `locale.set('de')` re-renders the components that translate, and only those |
| **Nested keys** | `t('errors.network.timeout')` |
| **Fallback chains** | `de-CH → de → en`, walked per key |
| **Interpolation** | `t('welcome.user', { name })` — string substitution, never evaluation |
| **Pluralization** | `Intl.PluralRules`, so no language's rules are hard-coded |
| **Formatting** | `n()`, `d()`, `rel()` over `Intl`, in the active locale |
| **Lazy locales** | `loaders: { fr: () => import('./fr.js') }` |
| **Persistence** | any `getItem`/`setItem`/`removeItem` adapter remembers the choice |
| **Safe by default** | a translation is text; markup needs an explicit `tHtml()` |

## Documentation

The full guide is at
[avenx-js.com/guides/i18n](https://avenx-js.com/guides/i18n) — resources,
locale management, plural categories, formatting presets, lazy loading,
persistence, the security model, and the limitations.

## Example

[`example/`](example/) is a complete storefront in four languages, compiled
with the Avenx CLI. Its README walks through what to try.

```bash
cd example
node ../../../bin/avenx.js build
python3 -m http.server 8000 --directory ..
```

## Compiler integration

The Avenx compiler validates template identifiers against what it can read in
your source, and a plugin that installs at runtime is invisible to it. Declare
what this plugin publishes in `avenx.config.json`:

```json
{
  "templateGlobals": ["t", "tHtml", "n", "d", "rel", "locale", "$i18n"]
}
```

Every other identifier in your templates is still checked. `TEMPLATE_GLOBALS`
is exported from the package if you would rather generate the list.

## Tests

```bash
npm test
```

## License

MIT
