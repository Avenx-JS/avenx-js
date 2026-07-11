import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';
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

const RAW_TARGET = Symbol.for('rawTarget');
const proxyCache = new WeakMap();

try {
  Object.defineProperty(Function.prototype, 'constructor', {
    get() {
      throw new AvenxError(
        AvenxErrorCodes.SANDBOX_VIOLATION,
        'Access to Function constructor is blocked for security reasons.',
      );
    },
    configurable: true,
  });
} catch {
  // Ignore if descriptor is already configured or frozen
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

      let res = Reflect.get(target, key, receiver);

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
      const rawThis = unwrap(thisArg);
      const rawArgs = argumentsList.map(unwrap);
      const result = Reflect.apply(target, rawThis, rawArgs);
      return wrapValue(result);
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
   * @returns {Proxy} The sandboxed Proxy object.
   */
  static createProxy(scope, thisArg) {
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

        if (ALLOWED_GLOBALS.has(key)) {
          return wrapValue(globalThis[key]);
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
