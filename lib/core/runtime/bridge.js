/**
 * @file bridge.js
 * @description The Avenx-JS Bridge factory.
 *
 * A Bridge is a module-scoped, reactive unit of shared state and behaviour.
 * Components reach a bridge by importing it, which is what makes the
 * connection statically visible to the compiler:
 *
 *   // src/bridges/auth.bridge.js
 *   import { bridge } from 'avenx-core/runtime';
 *
 *   export default bridge({
 *     state: { user: null },
 *     get isLoggedIn() { return this.user !== null; },
 *     login(user) {
 *       this.user = user;
 *       this.emit('login', user);
 *     },
 *   });
 *
 *   // any component
 *   import auth from '../bridges/auth.bridge.js';
 *   <p>{{ auth.user?.name }}</p>
 *
 * Two facades are built over one reactive state object:
 *
 *   - `this` inside actions, getters and setup() can read *and* write state,
 *     and can emit events.
 *   - the exported instance can read state, call actions and subscribe with
 *     `on()`, but cannot assign state and cannot emit.
 *
 * The split is lexical rather than temporal, so it survives `await` inside an
 * async action, and it gives every mutation a single traceable origin.
 */

import { StateFactory } from '../reactive/createState.js';
import { pushWatcher, popWatcher } from '../reactive/watcher.js';
import { onScopeDispose, runInScope } from '../reactive/scope.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from './AvenxError.js';
import { logger } from './AvenxLogger.js';

/**
 * Marks a value as an Avenx bridge instance.
 * @type {symbol}
 */
export const IS_BRIDGE = Symbol.for('avenx.bridge');

/**
 * Internal channel used by the compiler to label a bridge. A symbol keeps it
 * out of the member namespace that templates and `ownKeys` see.
 * @type {symbol}
 */
const SET_NAME = Symbol.for('avenx.bridge.setName');

/**
 * Definition keys that the Bridge API owns and a definition may not redeclare.
 * @type {string[]}
 */
const RESERVED_KEYS = ['on', 'emit', '$dispose', '$name'];

/**
 * Keys of the consumer-facing instance that are not bridge state.
 * @type {Set<string>}
 */
const INSTANCE_API_KEYS = new Set(['on', '$dispose', '$name']);

const stateFactory = new StateFactory();

/**
 * Deep-copies plain objects and arrays so a bridge never mutates the literal
 * that was passed to `bridge()`. Everything else (class instances, Dates,
 * functions, Maps) is intentionally shared by reference: those values are not
 * made reactive either, so copying them would only be surprising.
 * @param {any} value - The value to copy.
 * @returns {any} A copy for plain containers, or the original value.
 */
function cloneInitial(value) {
  if (Array.isArray(value)) {
    return value.map(cloneInitial);
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy = {};
    for (const key of Object.keys(value)) {
      copy[key] = cloneInitial(value[key]);
    }
    return copy;
  }
  return value;
}

/**
 * Runs a function outside of any reactive watcher, so reads performed inside it
 * are not attributed to whichever render happened to trigger it.
 * @template T
 * @param {() => T} fn - The function to run untracked.
 * @returns {T} Whatever `fn` returned.
 */
function untracked(fn) {
  pushWatcher(null);
  try {
    return fn();
  } finally {
    popWatcher();
  }
}

/**
 * Creates a Bridge: a reactive unit of shared state and behaviour that
 * components consume by importing it.
 * @param {object} definition - The bridge definition.
 * @param {object} [definition.state] - Initial shared state. Reactive, read-only for consumers.
 * @param {Function} [definition.setup] - Lazy initializer run on first use. May return a cleanup function.
 * @returns {object} The bridge instance to export from the module.
 */
export function bridge(definition) {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new AvenxError(
      AvenxErrorCodes.BRIDGE_INVALID_DEFINITION,
      definition === null ? 'null' : Array.isArray(definition) ? 'an array' : typeof definition,
    );
  }

  const descriptors = Object.getOwnPropertyDescriptors(definition);

  /** @type {Map<string, Function>} Getter name to getter implementation. */
  const getters = new Map();
  /** @type {Map<string, Function>} Action name to raw implementation. */
  const rawActions = new Map();
  /** @type {Function|null} */
  let setupFn = null;

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (RESERVED_KEYS.includes(key)) {
      throw new AvenxError(AvenxErrorCodes.BRIDGE_RESERVED_KEY, key, RESERVED_KEYS.join(', '));
    }
    if (key === 'state') {
      if (descriptor.get) {
        throw new AvenxError(AvenxErrorCodes.BRIDGE_RESERVED_KEY, 'state', 'state must be a plain object, not a getter');
      }
      continue;
    }
    if (descriptor.get) {
      getters.set(key, descriptor.get);
      continue;
    }
    if (key === 'setup') {
      if (typeof descriptor.value !== 'function') {
        throw new AvenxError(AvenxErrorCodes.BRIDGE_INVALID_MEMBER, 'setup', typeof descriptor.value, 'setup');
      }
      setupFn = descriptor.value;
      continue;
    }
    if (typeof descriptor.value === 'function') {
      rawActions.set(key, descriptor.value);
      continue;
    }
    throw new AvenxError(
      AvenxErrorCodes.BRIDGE_INVALID_MEMBER,
      key,
      descriptor.value === null ? 'null' : typeof descriptor.value,
      key,
    );
  }

  const initialState = definition.state;
  if (initialState !== undefined && (initialState === null || typeof initialState !== 'object' || Array.isArray(initialState))) {
    throw new AvenxError(
      AvenxErrorCodes.BRIDGE_INVALID_MEMBER,
      'state',
      initialState === null ? 'null' : Array.isArray(initialState) ? 'array' : typeof initialState,
      'state',
    );
  }

  const stateKeys = initialState ? Object.keys(initialState) : [];
  for (const key of stateKeys) {
    if (getters.has(key) || rawActions.has(key)) {
      throw new AvenxError(AvenxErrorCodes.BRIDGE_RESERVED_KEY, key, 'state keys must not collide with actions or getters');
    }
  }

  /** @type {string} Debug label; set by the compiler through defineBridgeName(). */
  let name = 'bridge';
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** @type {Function|null} Cleanup returned by setup(). */
  let cleanupFn = null;
  /** @type {boolean} */
  let initialized = false;
  /** @type {boolean} */
  let initializing = false;
  /** @type {object} The reactive state proxy. */
  const state = stateFactory.create(cloneInitial(initialState) || {});

  /**
   * Broadcasts an event to every listener. Available on `this` inside the
   * bridge only: consumers observe events, they do not fabricate them.
   * @param {string} event - The event name.
   * @param {any} [payload] - The value handed to each listener.
   */
  const emit = (event, payload) => {
    if (typeof event !== 'string' || event.length === 0) {
      throw new AvenxError(AvenxErrorCodes.BRIDGE_INVALID_EVENT, `emitted by "${name}"`, typeof event, typeof payload);
    }
    const handlers = listeners.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }
    // Copy: a listener may unsubscribe itself or others while running.
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        // One faulty listener must not stop the others.
        logger.error(formatMessage(AvenxErrorCodes.BRIDGE_LISTENER_ERROR, name, event, error));
      }
    }
  };

  /** @type {Map<string, Function>} Stable bound action identities. */
  const boundActions = new Map();

  /**
   * Resolves a member on the write-capable facade.
   * @param {string|symbol} key - The member name.
   * @returns {any} The resolved value.
   */
  const readSelf = (key) => {
    if (key === 'emit') return emit;
    if (typeof key !== 'string') return undefined;
    if (boundActions.has(key)) return boundActions.get(key);
    const getter = getters.get(key);
    if (getter) return getter.call(self);
    return state[key];
  };

  /**
   * The write-capable facade bound to `this` inside actions, getters and setup.
   * @type {object}
   */
  const self = new Proxy(Object.create(null), {
    get: (_target, key) => readSelf(key),
    set: (_target, key, value) => {
      if (typeof key === 'string' && (getters.has(key) || boundActions.has(key) || key === 'emit')) {
        throw new AvenxError(AvenxErrorCodes.BRIDGE_RESERVED_KEY, key, 'actions and getters are not assignable');
      }
      state[key] = value;
      return true;
    },
    has: (_target, key) => key === 'emit' || getters.has(key) || boundActions.has(key) || key in state,
    deleteProperty: (_target, key) => {
      delete state[key];
      return true;
    },
    ownKeys: () => [...new Set([...Object.keys(state), ...getters.keys()])],
    getOwnPropertyDescriptor: (_target, key) => {
      if (typeof key !== 'string' || !(getters.has(key) || key in state)) {
        return undefined;
      }
      return { enumerable: true, configurable: true, writable: true, value: readSelf(key) };
    },
  });

  for (const [key, fn] of rawActions) {
    boundActions.set(key, (...args) => fn.apply(self, args));
  }

  /**
   * Runs setup() on first use. Detached from the caller's reactive watcher and
   * disposal scope: a bridge belongs to the module, not to whichever component
   * happened to touch it first.
   */
  const ensureInitialized = () => {
    if (initialized || initializing) {
      return;
    }
    initializing = true;
    try {
      if (setupFn) {
        const cleanup = runInScope(null, () => untracked(() => setupFn.call(self)));
        cleanupFn = typeof cleanup === 'function' ? cleanup : null;
      }
      initialized = true;
    } catch (error) {
      initialized = true;
      throw new AvenxError(AvenxErrorCodes.BRIDGE_SETUP_FAILED, name, error && error.message ? error.message : error);
    } finally {
      initializing = false;
    }
  };

  /**
   * Subscribes to a bridge event.
   *
   * When called while a component's disposal scope is active — that is, from a
   * lifecycle hook or an event handler — the subscription is released
   * automatically on unmount. The returned function unsubscribes early.
   * @param {string} event - The event name to listen for.
   * @param {Function} handler - Invoked with the emitted payload.
   * @returns {Function} Unsubscribe function. Safe to call more than once.
   */
  const on = (event, handler) => {
    if (typeof event !== 'string' || event.length === 0 || typeof handler !== 'function') {
      throw new AvenxError(
        AvenxErrorCodes.BRIDGE_INVALID_EVENT,
        `subscription on "${name}"`,
        typeof event,
        typeof handler,
      );
    }
    ensureInitialized();

    let handlers = listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      listeners.set(event, handlers);
    }
    handlers.add(handler);

    return onScopeDispose(() => {
      const current = listeners.get(event);
      if (current) {
        current.delete(handler);
        if (current.size === 0) {
          listeners.delete(event);
        }
      }
    });
  };

  /**
   * Releases everything the bridge holds: the cleanup returned by setup(), all
   * event listeners, and any state changes. The bridge stays usable — the next
   * access re-runs setup() with the original state. This makes bridges safe to
   * reuse across tests and across hot reloads.
   */
  const $dispose = () => {
    if (cleanupFn) {
      const cleanup = cleanupFn;
      cleanupFn = null;
      try {
        untracked(() => cleanup());
      } catch (error) {
        logger.error(formatMessage(AvenxErrorCodes.BRIDGE_SETUP_FAILED, name, error && error.message ? error.message : error));
      }
    }
    listeners.clear();
    initialized = false;

    // Reset in place rather than building a fresh reactive object. A new object
    // would strand every watcher that already tracked the old one — consumers
    // would silently stop updating — and it would hide the reset from anyone
    // currently rendering. Writing through the existing proxy keeps identity
    // stable and notifies dependents that the state reverted.
    const defaults = cloneInitial(initialState) || {};
    for (const key of Object.keys(state)) {
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
        delete state[key];
      }
    }
    for (const [key, value] of Object.entries(defaults)) {
      state[key] = value;
    }
  };

  /**
   * Resolves a member on the consumer-facing instance.
   * @param {string|symbol} key - The member name.
   * @returns {any} The resolved value.
   */
  const readInstance = (key) => {
    if (key === IS_BRIDGE) return true;
    if (key === '$name') return name;
    if (key === SET_NAME) {
      return (bridgeName) => {
        if (typeof bridgeName === 'string' && bridgeName.length > 0) {
          name = bridgeName;
        }
      };
    }
    if (typeof key !== 'string') return undefined;
    if (key === 'on') return on;
    if (key === '$dispose') return $dispose;
    // Emission is the bridge's own capability: consumers observe events, they
    // never fabricate them. Keeping `emit` off the instance is what makes the
    // direction of a bridge unambiguous.
    if (key === 'emit') return undefined;
    ensureInitialized();
    return readSelf(key);
  };

  /**
   * The consumer-facing bridge instance.
   * @type {object}
   */
  const instance = new Proxy(Object.create(null), {
    get: (_target, key) => readInstance(key),
    set: (_target, key) => {
      throw new AvenxError(
        AvenxErrorCodes.BRIDGE_READONLY_STATE,
        name,
        String(key),
        `${name}.someAction(value)`,
      );
    },
    has: (_target, key) =>
      key === IS_BRIDGE ||
      INSTANCE_API_KEYS.has(key) ||
      getters.has(key) ||
      boundActions.has(key) ||
      key in state,
    deleteProperty: (_target, key) => {
      throw new AvenxError(
        AvenxErrorCodes.BRIDGE_READONLY_STATE,
        name,
        String(key),
        `${name}.someAction(value)`,
      );
    },
    // Spreading or serialising a bridge yields a snapshot of its data, not its
    // API surface: {...auth} and JSON.stringify(auth) both give state.
    ownKeys: () => {
      ensureInitialized();
      return [...new Set([...Object.keys(state), ...getters.keys()])];
    },
    getOwnPropertyDescriptor: (_target, key) => {
      if (typeof key !== 'string' || !(getters.has(key) || key in state)) {
        return undefined;
      }
      return { enumerable: true, configurable: true, writable: false, value: readInstance(key) };
    },
  });

  return instance;
}

/**
 * Reports whether a value is a bridge instance created by {@link bridge}.
 * @param {any} value - The value to test.
 * @returns {boolean} True when the value is a bridge instance.
 */
export function isBridge(value) {
  return !!(value && (typeof value === 'object' || typeof value === 'function') && value[IS_BRIDGE] === true);
}

/**
 * Assigns a bridge its diagnostic name. Emitted by the compiler alongside each
 * bridge definition so error messages and devtools can identify it.
 * @param {string} name - The bridge name, derived from its file name.
 * @param {object} instance - The bridge instance.
 * @returns {object} The same instance, for convenient chaining.
 */
export function defineBridgeName(name, instance) {
  if (isBridge(instance)) {
    const setName = instance[SET_NAME];
    if (typeof setName === 'function') {
      setName(name);
    }
  }
  return instance;
}
