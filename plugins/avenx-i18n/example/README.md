# i18n example — one storefront in four languages

A complete Avenx application, compiled with the Avenx CLI, showing every part
of `@avenx/i18n` working together.

- **[`src/main.app.js`](src/main.app.js)** — installs the plugin. English and
  German ship in the bundle; French and Italian are declared as `loaders` and
  fetched the first time somebody selects them.
- **`de-CH` overrides two strings.** Everything else it needs comes from `de`,
  and anything neither defines comes from the fallback locale `en`. That chain
  is `de-CH → de → en`, and you can watch it work: the Swiss title is
  *Avenx Warehuus*, the tagline underneath it is the German one.
- **[`src/pages/storefront.page.js`](src/pages/storefront.page.js)** — a page
  that translates. No import, no injection, no wiring: `t()`, `n()`, `d()`,
  `rel()`, `tHtml()` and `locale` are in template scope because the plugin put
  them there.
- **[`src/components/language-switcher/`](src/components/language-switcher/language-switcher.component.js)**
  — renders a button per `locale.available` and calls `locale.set()`. The
  loading hint next to it is bound to `locale.loading`, which is reactive, so
  it appears on its own while a locale downloads.
- **[`src/global/basket.bridge.js`](src/global/basket.bridge.js)** — an
  ordinary bridge that knows nothing about i18n. It counts items; the page
  decides how to say that in the visitor's language.
- **The chosen locale is remembered.** `storage: window.localStorage` is all
  that takes. Any object with `getItem`/`setItem`/`removeItem` works, including
  `browserLocalStorage()` from `@avenx/persistence`.

## Running it

From this directory:

```bash
node ../../../bin/avenx.js build
```

Then serve the **plugin** directory (one level up), because `index.html` loads
the plugin bundle from `../dist/`:

```bash
python3 -m http.server 8000 --directory ..
```

and open <http://localhost:8000/example/>.

If `../dist/avenx-i18n.global.js` is missing, build it first:

```bash
npm run build --prefix ..
```

## Things to try

1. **Switch between `de` and `de-CH`.** Only the title and the word "Language"
   change — the rest of the page is already German, and Avenx patches the two
   text nodes that differ rather than re-rendering the page.
2. **Add and remove items.** The sentence changes form at 0, at 1 and above,
   and it does so differently per language. Nothing in the application knows
   any language's plural rules: `Intl.PluralRules` decides, and the message
   file declares `zero`, `one` and `other`.
3. **Pick `fr` or `it`.** They are not in the bundle. The `…` next to the
   buttons is `locale.loading`, the page keeps its current language while the
   fetch is in flight, and the whole page changes when it lands. Open the
   network panel to watch `translations/fr.json` load exactly once.
4. **Reload.** The application comes back in the language you chose.
5. **Look at the last line in the footer.** `order.deliveryEstimate` is a key
   nothing defines, left in on purpose: it renders as the key rather than as a
   blank space, and logs one warning per locale through the Avenx logger and
   through this application's own `onError`.
6. **Watch the terms line.** It is the one message here containing markup, so
   it is rendered with `tHtml()`, which sanitizes it. Every other message is
   plain text and is escaped like any other template expression. Try adding
   `<img src=x onerror=alert(1)>` to any message in `main.app.js` and rebuild:
   with `t()` it renders as characters, and with `tHtml()` the sanitizer
   removes it.
7. **In the browser console**, plant a locale the application no longer ships
   and reload:

   ```javascript
   localStorage.setItem('avenx-shop:locale', 'ja');
   ```

   It is ignored with one warning, and the application opens on its configured
   locale rather than in a language it has no messages for.

## Why the plugin is loaded from a `<script>` tag

The Avenx CLI compiles an application into one self-contained bundle, so a
third-party runtime package is reached through a global rather than an import —
which is what `index.html` sets up, and why `main.app.js` says
`app.use(AvenxI18n.avenxI18n, ...)`.

The same constraint is why the lazily loaded locales here are JSON files
fetched at runtime. With a bundler (Vite, Rollup, webpack) neither applies:
`import { avenxI18n } from '@avenx/i18n'`, and write the loaders as
`() => import('./translations/fr.js')`.

## `templateGlobals`

[`avenx.config.json`](avenx.config.json) declares the identifiers the plugin
publishes:

```json
{
  "templateGlobals": ["t", "tHtml", "n", "d", "rel", "locale", "$i18n"]
}
```

Without it the compiler reports `t` and its neighbours as undeclared
references, because it reads your source and cannot see a plugin that installs
at runtime. Every other identifier in these templates is still checked.
