// Type definitions for @avenx/persistence
// Project: Avenx-JS
// Definitions by: Avenx Team

/**
 * A place persisted state can be written to and read back from.
 *
 * This is the interface the platform already defines for Web Storage, so
 * `window.localStorage` and `window.sessionStorage` satisfy it as they stand,
 * and a custom backend only has to provide these three methods.
 */
export interface StorageAdapter {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * Which part of the persistence lifecycle a failure came from.
 */
export type PersistenceFailurePhase =
    | 'read'
    | 'write'
    | 'quota'
    | 'serialize'
    | 'deserialize'
    | 'malformed'
    | 'version'
    | 'migrate';

/**
 * The argument handed to an `onError` callback. It names the key and the phase
 * and never carries the persisted value itself.
 */
export interface PersistenceFailure {
    key: string;
    phase: PersistenceFailurePhase;
    message: string;
    error: Error | null;
}

/**
 * What actually reaches storage: the application's state plus the two version
 * numbers needed to recognise it again.
 */
export interface PersistenceEnvelope<S = Record<string, any>> {
    /** Version of the envelope format written by this plugin. */
    avenx: number;
    /** The application's own schema version. */
    version: number;
    state: S;
}

/**
 * Settings accepted both by `persist()` and, as defaults, by the plugin.
 */
export interface PersistenceOptions<S = Record<string, any>> {
    /** Storage adapter. Defaults to `browserLocalStorage()`. */
    storage?: StorageAdapter;
    /** Prefix applied to the storage key. Defaults to `'avenx:'`. */
    prefix?: string;
    /** Schema version of the persisted state. Defaults to `1`. */
    version?: number;
    /** Set false to keep saving but never restore. Defaults to `true`. */
    restore?: boolean;
    /** Turns the envelope into a string. Defaults to `JSON.stringify`. */
    serialize?: (envelope: PersistenceEnvelope<S>) => string;
    /** Turns a stored string back into an envelope. Defaults to `JSON.parse`. */
    deserialize?: (raw: string) => unknown;
    /** Called on any persistence failure. Persistence never throws into the application. */
    onError?: (failure: PersistenceFailure) => void;
}

/**
 * Options for a single persisted bridge.
 */
export interface PersistBridgeOptions<S = Record<string, any>> extends PersistenceOptions<S> {
    /** Storage key for this bridge. Required, and unique within the application. */
    key: string;
    /** Persist only these state keys. Mutually exclusive with `exclude`. */
    include?: Array<Extract<keyof S, string>>;
    /** Persist every state key except these. Mutually exclusive with `include`. */
    exclude?: Array<Extract<keyof S, string>>;
    /**
     * Upgrades state written by an earlier `version`. Return the upgraded state,
     * or `null` to discard the stored data and start from the bridge's defaults.
     */
    migrate?: (state: Record<string, any>, fromVersion: number, toVersion: number) => Partial<S> | null;
}

/**
 * The handle installed at `app.$persistence`.
 */
export interface PersistenceHandle {
    /** Lists the persistence keys registered by `persist()`. */
    keys(): string[];
    /** Writes pending changes immediately rather than at the end of the tick. */
    flush(key?: string): void;
    /** Removes persisted data. Live state is left untouched. */
    clear(key?: string): void;
}

/**
 * An Avenx plugin, as accepted by `app.use()`.
 */
export interface AvenxPlugin {
    install(app: any, options?: Record<string, any>): void;
}

/**
 * Persists a bridge's state. Call it from the bridge's own `setup()` hook and
 * return the result, so persistence stops when the bridge is disposed.
 *
 * ```javascript
 * export default bridge({
 *   state: { items: [], draft: '' },
 *   setup() {
 *     return persist(this, { key: 'cart', exclude: ['draft'] });
 *   },
 * });
 * ```
 * @returns The cleanup function to return from `setup()`.
 */
export function persist<S extends Record<string, any> = Record<string, any>>(
    self: S,
    options: PersistBridgeOptions<S>
): () => void;

/**
 * Official Avenx persistence plugin. Install it to set application-wide
 * defaults and to get `app.$persistence`.
 */
export const avenxPersistence: AvenxPlugin;

/**
 * Functional alias for `app.use(createAvenxPersistence(options))`.
 */
export function createAvenxPersistence(options?: PersistenceOptions): AvenxPlugin;

/** Resolves `window.localStorage`, falling back to memory when it is unusable. */
export function browserLocalStorage(): StorageAdapter;

/** Resolves `window.sessionStorage`, falling back to memory when it is unusable. */
export function browserSessionStorage(): StorageAdapter;

/** Creates an in-memory adapter. Nothing it holds survives the page. */
export function memoryStorage(): StorageAdapter;

export default avenxPersistence;
