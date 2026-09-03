// Type definitions for @avenx/i18n
// Project: Avenx-JS
// Definitions by: Avenx Team

/**
 * A BCP 47 locale tag, e.g. `'en'`, `'en-US'`, `'de-CH'`, `'zh-Hant-TW'`.
 *
 * Deliberately a plain string alias rather than a union of known tags: the set
 * of locales an application supports is the application's business, and a
 * lazily loaded one is not known at compile time at all.
 */
export type LocaleTag = string;

/**
 * The plural categories a message may declare. Which of them a language
 * actually uses is decided by `Intl.PluralRules`, not by this type.
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * A message written once per plural category.
 *
 * `other` is the form every language falls back to, so it is required; the
 * rest are declared only where the language selects them.
 */
export type PluralMessage = { other: string } & Partial<Record<PluralCategory, string>>;

/**
 * One entry in a translation resource: a message, a plural form, or a nested
 * group of either.
 */
export type MessageNode = string | PluralMessage | { [key: string]: MessageNode };

/**
 * The nested messages for one locale.
 */
export interface MessageResource {
  [key: string]: MessageNode;
}

/**
 * Translation resources, keyed by locale tag.
 */
export type Messages = Record<LocaleTag, MessageResource>;

/**
 * Returns a locale's messages, synchronously or as a promise. A dynamic
 * `import()` satisfies this: the module's default export is used.
 */
export type MessageLoader = (
  locale: LocaleTag
) => MessageResource | Promise<MessageResource> | Promise<{ default: MessageResource }>;

/**
 * Values substituted into a message's `{placeholders}`. A numeric `count` also
 * selects the plural form.
 */
export interface TranslationParams {
  count?: number;
  [name: string]: unknown;
}

/**
 * Named `Intl` option presets, so `n(total, 'currency')` can mean one thing
 * across an application.
 */
export interface FormatPresets {
  number?: Record<string, Intl.NumberFormatOptions>;
  date?: Record<string, Intl.DateTimeFormatOptions>;
  relative?: Record<string, Intl.RelativeTimeFormatOptions>;
}

/**
 * Which part of the plugin a failure came from.
 */
export type I18nFailurePhase =
  | 'missing'
  | 'missing-locale'
  | 'malformed'
  | 'interpolation'
  | 'plural'
  | 'format'
  | 'load'
  | 'locale'
  | 'key'
  | 'storage';

/**
 * The argument handed to an `onError` callback.
 */
export interface I18nFailure {
  phase: I18nFailurePhase;
  message: string;
  key?: string;
  locale?: LocaleTag;
  error: Error | null;
}

/**
 * A place the chosen locale can be written to and read back from.
 *
 * This is the interface the platform defines for Web Storage, and the one
 * `@avenx/persistence` adapters implement — so `browserLocalStorage()` from
 * that plugin, `window.localStorage`, or three functions of your own all work
 * here without either plugin knowing about the other.
 */
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Options for `createI18n()` and for `app.use(avenxI18n, ...)`.
 */
export interface I18nOptions {
  /** The starting locale. Defaults to `'en'`. */
  locale?: LocaleTag;
  /** Locales tried when the active one has no message. `null` disables fallback. Defaults to `'en'`. */
  fallbackLocale?: LocaleTag | LocaleTag[] | null;
  /** Translation resources, keyed by locale tag. */
  messages?: Messages;
  /** Loaders for locales fetched on demand, keyed by locale tag. */
  loaders?: Record<LocaleTag, MessageLoader>;
  /** Named `Intl` presets for `n()`, `d()` and `rel()`. */
  formats?: FormatPresets;
  /** What a missing key renders as. `'key'` (the default) renders the key itself. */
  missing?: 'key' | ((key: string, locale: LocaleTag) => string);
  /** Storage adapter used to remember the chosen locale across visits. */
  storage?: StorageAdapter;
  /** Where in that adapter to keep it. Defaults to `'avenx:locale'`. */
  storageKey?: string;
  /** Called on any i18n failure. Translation never throws into the application. */
  onError?: (failure: I18nFailure) => void;
}

/**
 * The locale handle. Every read on it goes through the reactive bridge, so
 * `{{ locale.current }}` in a template updates like any other reactive value.
 */
export interface LocaleHandle {
  /** The active locale. */
  readonly current: LocaleTag;
  /** The configured fallback locales, in order. */
  readonly fallback: LocaleTag[];
  /** Every locale that has messages or a registered loader. */
  readonly available: LocaleTag[];
  /** True while a lazily loaded locale is in flight. */
  readonly loading: boolean;
  /** The chain a lookup walks for the active locale, most specific first. */
  readonly chain: LocaleTag[];
  /**
   * Activates a locale, loading it first when it is lazy. Resolves with the
   * locale that ended up active — which is the previous one if the tag was
   * invalid or its loader failed. It never rejects.
   */
  set(tag: LocaleTag): Promise<LocaleTag>;
  /** Loads a locale's messages without switching to it. Resolves false on failure. */
  load(tag: LocaleTag): Promise<boolean>;
  /** True when the active locale is, or descends from, `tag`. `is('de')` matches `de-CH`. */
  is(tag: LocaleTag): boolean;
}

/**
 * A value the Avenx renderer inserts without escaping. `tHtml()` returns one.
 */
export interface SafeHtmlValue {
  toString(): string;
}

/**
 * The translator: what `createI18n()` returns and what `app.$i18n` holds.
 */
export interface I18n {
  /** Translates a key into the active locale. Returns plain text, escaped by the template. */
  t(key: string, params?: TranslationParams): string;
  /** Translates a key whose message contains markup. The result is sanitized; params are escaped. */
  tHtml(key: string, params?: TranslationParams): SafeHtmlValue;
  /** Formats a number in the active locale. */
  n(value: number | bigint, options?: string | Intl.NumberFormatOptions): string;
  /** Formats a date in the active locale. */
  d(value: Date | number | string, options?: string | Intl.DateTimeFormatOptions): string;
  /** Formats a relative time in the active locale. Negative is past, positive is future. */
  rel(value: number, unit: Intl.RelativeTimeFormatUnit, options?: string | Intl.RelativeTimeFormatOptions): string;
  /** The locale handle. */
  locale: LocaleHandle;
  /** Whether a key resolves, without rendering it or reporting a miss. */
  has(key: string, locale?: LocaleTag): boolean;
  /** Registers additional messages for a locale, merging into whatever is there. */
  addMessages(locale: LocaleTag, messages: MessageResource): void;
  /** Registers a loader for a locale fetched on demand. */
  addLoader(locale: LocaleTag, loader: MessageLoader): void;
  /** Replaces the fallback locales. */
  setFallbackLocale(tags: LocaleTag | LocaleTag[] | null): void;
  /** Subscribes to locale changes. Returns the unsubscribe function. */
  on(event: 'change', handler: (payload: { locale: LocaleTag; previous: LocaleTag }) => void): () => void;
  /** The underlying Avenx bridge, for devtools and for `app.registerBridge`. */
  $bridge: object;
}

/**
 * An Avenx plugin, as accepted by `app.use()`.
 */
export interface AvenxPlugin {
  install(app: any, options?: Record<string, any>): void;
}

/**
 * Plugin options: `createI18n()`'s options, or an instance built earlier.
 */
export type I18nPluginOptions = I18nOptions | { i18n: I18n };

/**
 * Creates a translator without installing it. Useful in tests, and for
 * applications that want the instance before the app exists.
 */
export function createI18n(options?: I18nOptions): I18n;

/**
 * Official Avenx internationalization plugin. Installing it publishes `t`,
 * `tHtml`, `n`, `d`, `rel`, `locale` and `$i18n` into every component's
 * template scope, and puts the instance on `app.$i18n`.
 */
export const avenxI18n: AvenxPlugin;

/**
 * Functional alias for `app.use(createAvenxI18n(options))`.
 */
export function createAvenxI18n(options?: I18nPluginOptions): AvenxPlugin;

/**
 * The identifiers the plugin publishes into template scope. Declare these as
 * `templateGlobals` in avenx.config.json.
 */
export const TEMPLATE_GLOBALS: string[];

/** Canonicalizes a locale tag, or returns null when it is not a usable one. */
export function normalizeLocale(tag: unknown): LocaleTag | null;

/** Expands a locale into itself and its ancestors: `zh-Hant-TW`, `zh-Hant`, `zh`. */
export function expandLocale(tag: LocaleTag): LocaleTag[];

/** Builds the ordered list of locales a lookup tries. */
export function resolveChain(locale: LocaleTag, fallbacks?: LocaleTag[]): LocaleTag[];

export default avenxI18n;
