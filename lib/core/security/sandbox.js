import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';
import { resolveSandboxGlobal } from '../trace/globals.js';
/**
 * @file sandbox.js
 * @description Secure Template Expression Sandbox module for the Avenx-JS framework.
 * Located at `lib/core/security/sandbox.js`.
 * To prevent critical security vulnerabilities such as prototype pollution and Cross-Site Scripting (XSS),
 * all template expressions and computed properties execute within an isolated execution sandbox wrapper.
 * The sandbox dynamically guards evaluation context by blocking access to structural object properties
 * (`__proto__`, `constructor`, `prototype`) and restricts active identifier scopes strictly to the
 * `ALLOWED_GLOBALS` whitelist map.
 * If an expression attempts to invoke an unauthorized standard window API environment variable
 * (e.g., calling `alert()` or checking `localStorage` directly in an HTML attribute binding),
 * the application state will gracefully halt and trigger an execution failure throw code: **`AVX_R15`**.
 * @example
 * // ❌ ANTI-PATTERN (Will trigger an AVX_R15 Sandbox Violation at runtime)
 * // <button onclick="alert('Operation successful!')">Submit</button>
 * // <div v-if="localStorage.getItem('user_token')">Profile Content</div>
 * @example
 * // ✅ PROPER ARCHITECTURAL PATTERN
 * // Decouple browser environment window APIs into standard component method actions:
 * export default {
 * name: 'SecureActionComponent',
 * methods: {
 * handleSubmit() {
 * // Native browser ecosystem APIs are fully available here
 * alert('Operation successful!');
 * localStorage.setItem('user_token', 'validated_hash');
 * }
 * }
 * };
 */

/**
 * Whitelist allocation set tracking global identifiers authorized for inline evaluation scope.
 * Global scopes outside this tracking collection are rejected with a sandbox exception.
 * @type {Set<string>}
 * @property {string} Math - Native mathematical calculations and constants.
 * @property {string} JSON - Structured string serialization and parsing tools.
 * @property {string} Array - Array generation constructors.
 * @property {string} Object - Standard JavaScript object manipulators.
 * @property {string} String - Text parsing constructors.
 * @property {string} console - Core debugging console methods.
 * @property {string} parseInt - Numeric text converter algorithms.
 * @property {string} parseFloat - Decimal text converter algorithms.
 */

const ALLOWED_GLOBALS = new Set([
  'Math',
  'JSON',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Date',
  'Error',
  'Map',
  'Set',
  'Promise',
  'console',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'undefined',
  'NaN',
  'Infinity',
]);

const RESTRICTED_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'location',
  'navigator',
  'history',
  'fetch',
  'alert',
  'confirm',
  'prompt',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'XMLHttpRequest',
  'WebSocket',
  'global',
  'globalThis',
  'process',
  'eval',
  'Function',
]);

/**
 * Determines whether a property key refers to a restricted global object.
 * @param {string|symbol} key - Property key to check.
 * @returns {boolean}
 */
function isRestrictedGlobal(key) {
  if (typeof key !== 'string') return false;
  if (ALLOWED_GLOBALS.has(key)) return false;
  if (RESTRICTED_GLOBALS.has(key)) return true;
  try {
    return typeof globalThis !== 'undefined' && key in globalThis;
  } catch {
    return false;
  }
}

const RAW_TARGET = Symbol.for('rawTarget');
const proxyCache = new WeakMap();

// NOTE: this module deliberately does not patch `Function.prototype.constructor`.
// Doing so at import time altered a shared intrinsic for the whole realm, so
// every unrelated library on the page saw `fn.constructor` throw — a common
// idiom in type guards, polyfills and serializers. Access to the Function
// constructor from inside a template is blocked where it belongs instead: on
// the sandbox proxies themselves (see FUNCTION_CONSTRUCTORS below).

/**
 * The dynamic-code constructors. Reaching any of these from a template would
 * allow arbitrary code execution, so the sandbox refuses to hand them out or
 * invoke them regardless of the route taken to obtain them (property access,
 * property descriptors, prototype walks).
 * @type {Set<Function>}
 */
const FUNCTION_CONSTRUCTORS = new Set(
  [
    Function,
    Object.getPrototypeOf(function* () {}).constructor,
    Object.getPrototypeOf(async () => {}).constructor,
    Object.getPrototypeOf(async function* () {}).constructor,
  ].filter((ctor) => typeof ctor === 'function'),
);

/**
 * Throws when a value is one of the dynamic-code constructors.
 * @param {any} value - The value about to be returned or invoked.
 */
function assertNotFunctionConstructor(value) {
  if (typeof value === 'function' && FUNCTION_CONSTRUCTORS.has(value)) {
    throw new AvenxError(
      AvenxErrorCodes.SANDBOX_VIOLATION,
      'Access to the Function constructor is blocked for security reasons.',
    );
  }
}

/**
 * Built-in prototypes shared by every object in the realm.
 *
 * `validateSource` only rejects the literal identifiers `constructor`,
 * `__proto__` and `prototype`, which a computed access such as
 * `Object.getPrototypeOf({})` or `Object['proto' + 'type']` walks straight
 * past. Handing one of these objects to a template would let it mutate state
 * shared with the host application, so the sandbox refuses to surface them at
 * all rather than trying to enumerate every mutating API.
 * @type {Set<object>}
 */
const PROTECTED_PROTOTYPES = new Set(
  [
    Object.prototype,
    Array.prototype,
    Function.prototype,
    String.prototype,
    Number.prototype,
    Boolean.prototype,
    Date.prototype,
    RegExp.prototype,
    Error.prototype,
    Map.prototype,
    Set.prototype,
    WeakMap.prototype,
    WeakSet.prototype,
    Promise.prototype,
  ].filter((proto) => proto !== null && proto !== undefined),
);

/**
 * Throws when a value is a shared built-in prototype.
 * @param {any} value - The value about to be returned, passed or invoked.
 */
function assertNotProtectedPrototype(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return;
  }
  if (PROTECTED_PROTOTYPES.has(value)) {
    throw new AvenxError(
      AvenxErrorCodes.SANDBOX_VIOLATION,
      'Access to built-in prototypes is blocked for security reasons.',
    );
  }
}

/**
 * Unwraps a value if it's a sandbox Proxy, returning its raw target object.
 * @param {any} val - The value to unwrap.
 * @returns {any}
 */
function unwrap(val) {
  if (val && typeof val === 'object' && val[RAW_TARGET]) {
    return val[RAW_TARGET];
  }
  return val;
}

/**
 * Wraps an object or function recursively in a Proxy that blocks prototype pollution
 * and un-proxies arguments/context when called.
 * @param {any} val - The value to wrap.
 * @returns {any}
 */
function wrapValue(val) {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val !== 'object' && typeof val !== 'function') {
    return val;
  }

  if (proxyCache.has(val)) {
    return proxyCache.get(val);
  }

  const traps = {
    /**
     * Intercepts property retrieval.
     * @param {object} target - The target object.
     * @param {string|symbol} key - The property name.
     * @param {object} receiver - The Proxy or inherits from it.
     * @returns {any}
     */
    get(target, key, receiver) {
      if (key === RAW_TARGET) {
        return target;
      }

      if (key === '__proto__') {
        throw new AvenxError(
          AvenxErrorCodes.SANDBOX_VIOLATION,
          'Access to property "__proto__" is blocked for security reasons.',
        );
      }
      if (key === 'constructor' && typeof target === 'function') {
        throw new AvenxError(
          AvenxErrorCodes.SANDBOX_VIOLATION,
          'Access to property "constructor" on functions is blocked for security reasons.',
        );
      }

      let res;
      try {
        // The proxy is the receiver so reactive state keeps tracking property
        // reads through it.
        res = Reflect.get(target, key, receiver);
      } catch (err) {
        // Accessors backed by an internal slot (Set.prototype.size,
        // Map.prototype.size) reject a receiver that does not carry the slot.
        if (err instanceof TypeError) {
          res = Reflect.get(target, key, target);
        } else {
          throw err;
        }
      }

      // Never hand out a dynamic-code constructor or a shared built-in
      // prototype, however they were reached.
      assertNotFunctionConstructor(res);
      assertNotProtectedPrototype(res);

      const desc = Reflect.getOwnPropertyDescriptor(target, key);
      if (desc && !desc.configurable && !desc.writable) {
        return res;
      }

      if (typeof res === 'function') {
        res = res.bind(target);
      }

      return wrapValue(res);
    },

    /**
     * Intercepts property assignment.
     * @param {object} target - The target object.
     * @param {string|symbol} key - The property name.
     * @param {any} value - The new value.
     * @param {object} receiver - The object originally targeted.
     * @returns {boolean}
     */
    set(target, key, value, receiver) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new AvenxError(
          AvenxErrorCodes.SANDBOX_VIOLATION,
          `Writing to property "${String(key)}" is blocked for security reasons.`,
        );
      }
      return Reflect.set(target, key, value, receiver);
    },
  };

  if (typeof val === 'function') {
    /**
     * Intercepts function execution.
     * @param {object} target - The target function.
     * @param {any} thisArg - The context.
     * @param {any[]} argumentsList - The arguments passed.
     * @returns {any}
     */
    traps.apply = function (target, thisArg, argumentsList) {
      assertNotFunctionConstructor(target);
      const rawThis = unwrap(thisArg);
      const rawArgs = argumentsList.map(unwrap);

      // A reflection call such as Object.assign or Object.defineProperty must
      // not be handed a shared prototype as its target.
      assertNotProtectedPrototype(rawThis);
      rawArgs.forEach(assertNotProtectedPrototype);

      const result = Reflect.apply(target, rawThis, rawArgs);
      assertNotFunctionConstructor(result);
      assertNotProtectedPrototype(result);
      return wrapValue(result);
    };

    /**
     * Intercepts `new` on a wrapped function.
     *
     * The raw target is used as newTarget. Passing the proxy would make
     * Reflect.construct read `newTarget.prototype` back through the `get`
     * trap, where the built-in prototype guard would reject the constructor's
     * own prototype and break ordinary `new Date(...)` / `new Map(...)` calls.
     * @param {object} target - The target function.
     * @param {any[]} argumentsList - The arguments passed.
     * @returns {any}
     */
    traps.construct = function (target, argumentsList) {
      assertNotFunctionConstructor(target);
      const rawArgs = argumentsList.map(unwrap);
      rawArgs.forEach(assertNotProtectedPrototype);
      return wrapValue(Reflect.construct(target, rawArgs, target));
    };
  }

  const wrapped = new Proxy(val, traps);
  proxyCache.set(val, wrapped);
  return wrapped;
}

/**
 * Handles creation of secure sandbox contexts.
 */
export class AvenxSandbox {
  /**
   * Statically validates an expression or statement string to ensure it does not contain
   * forbidden property names.
   * @param {string} source - The source code to check.
   */
  static validateSource(source) {
    const FORBIDDEN_WORDS = /\b(constructor|__proto__|prototype)\b/;
    if (typeof source === 'string' && FORBIDDEN_WORDS.test(source)) {
      throw new AvenxError(
        AvenxErrorCodes.SANDBOX_VIOLATION,
        'Access to "constructor", "__proto__", or "prototype" is blocked for security reasons.',
      );
    }
  }
  /**
   * Creates a sandboxed Proxy context representing the combined scope and thisArg.
   * @param {object} scope - The scope variables.
   * @param {object} thisArg - The active 'this' context.
   * @param {boolean} [excludeParams] - If true, excludes special event params from the has trap.
   * @returns {Proxy} The sandboxed Proxy object.
   */
  static createProxy(scope, thisArg, excludeParams = false) {
    const target = {};
    const activeThis = thisArg || scope || {};

    return new Proxy(target, {
      /**
       * Intercepts `has` check, claiming to have all properties to capture lookups in `with`.
       * @param {object} t - The target object.
       * @param {string|symbol} key - The property checked.
       * @returns {boolean}
       */
      has(t, key) {
        if (key === Symbol.unscopables) {
          return false;
        }
        if (excludeParams && (key === 'state' || key === 'methods' || key === 'event' || key === 'args')) {
          return false;
        }
        return true;
      },

      /**
       * Intercepts property retrieval.
       * @param {object} t - The target object.
       * @param {string|symbol} key - The property name.
       * @returns {any}
       */
      get(t, key) {
        if (key === Symbol.unscopables) {
          return undefined;
        }

        if (key === RAW_TARGET) {
          return activeThis;
        }

        if (key === '__proto__') {
          throw new AvenxError(
            AvenxErrorCodes.SANDBOX_VIOLATION,
            'Access to property "__proto__" is blocked for security reasons.',
          );
        }
        if (key === 'constructor' && typeof activeThis === 'function') {
          throw new AvenxError(
            AvenxErrorCodes.SANDBOX_VIOLATION,
            'Access to property "constructor" on functions is blocked for security reasons.',
          );
        }

        if (scope && key in scope) {
          return wrapValue(scope[key]);
        }

        if (thisArg && key in thisArg) {
          return wrapValue(thisArg[key]);
        }

        // Resolved through the tracer rather than read off globalThis so a
        // recording session can log the non-deterministic values template code
        // observes, and a replaying session can hand the same ones back. With
        // no recording in progress this is a Map.size check and the same
        // property read as before. Substituting here rather than patching the
        // page's real globals keeps the swap invisible to unrelated scripts
        // and impossible to outlive the recording.
        if (ALLOWED_GLOBALS.has(key)) {
          return wrapValue(resolveSandboxGlobal(key));
        }

        if (isRestrictedGlobal(key)) {
          throw new AvenxError(
            AvenxErrorCodes.SANDBOX_VIOLATION,
            `[Avenx Sandbox Violation] Access to global object "${String(key)}" is restricted inside templates. Decouple browser APIs into component methods.`,
          );
        }

        return undefined;
      },

      /**
       * Intercepts property assignment.
       * @param {object} t - The target object.
       * @param {string|symbol} key - The property name.
       * @param {any} value - The new value.
       * @returns {boolean}
       */
      set(t, key, value) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new AvenxError(
            AvenxErrorCodes.SANDBOX_VIOLATION,
            `Writing to property "${String(key)}" is blocked for security reasons.`,
          );
        }

        if (isRestrictedGlobal(key) && (!scope || !(key in scope)) && (!thisArg || !(key in thisArg))) {
          throw new AvenxError(
            AvenxErrorCodes.SANDBOX_VIOLATION,
            `[Avenx Sandbox Violation] Access to global object "${String(key)}" is restricted inside templates. Decouple browser APIs into component methods.`,
          );
        }

        if (thisArg && key in thisArg) {
          thisArg[key] = value;
          return true;
        }

        if (scope && key in scope) {
          scope[key] = value;
          return true;
        }

        if (scope) {
          scope[key] = value;
          return true;
        }

        return false;
      },

      /**
       * Intercepts `getPrototypeOf` check.
       * @returns {object}
       */
      getPrototypeOf() {
        return Reflect.getPrototypeOf(activeThis);
      },

      /**
       * Intercepts `getOwnPropertyDescriptor` check.
       * @param {object} t - The target.
       * @param {string|symbol} key - The property.
       * @returns {object}
       */
      getOwnPropertyDescriptor(t, key) {
        const desc = Reflect.getOwnPropertyDescriptor(activeThis, key);
        if (desc) return desc;
        return { configurable: true, enumerable: true, writable: true };
      },
    });
  }
}
