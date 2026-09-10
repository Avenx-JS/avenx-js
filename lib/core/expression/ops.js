/**
 * @file ops.js
 * @description The runtime primitives a compiled expression calls.
 *
 * ## Why these exist separately from the evaluator
 *
 * Avenx used to evaluate template expressions by walking an AST in the browser.
 * The security boundary lived inside that walk: every property read went
 * through one function with the key already resolved, so `x.constructor` and
 * `x['const'+'ructor']` arrived at the same check as the same string.
 *
 * Expressions are now compiled to JavaScript at build time, so the walk is
 * gone. The boundary is not: the compiler emits a call to {@link readMember}
 * wherever the AST walk would have made one, and to {@link callFunction}
 * wherever it would have invoked. The guarantees are therefore identical, and
 * the cost per access drops from a recursive dispatch to one monomorphic call.
 *
 * This module is what a production bundle keeps. The parser and the evaluator
 * that used to sit above it are build-time only.
 *
 * ## What is guaranteed, and what is not
 *
 * Guaranteed: a compiled expression cannot reach the `Function` constructor,
 * cannot read or write `__proto__` / `constructor` / `prototype` however the
 * key is spelled, cannot obtain a built-in prototype object, and cannot name a
 * global outside {@link ALLOWED_GLOBALS}. Nothing here uses `eval` or
 * `new Function`, and neither does the code the compiler emits, so a page of
 * compiled Avenx expressions needs no `'unsafe-eval'`.
 *
 * Not guaranteed: this is not an isolation boundary against hostile expression
 * source. An expression can still call any function the scope legitimately
 * exposes. The boundary protects the runtime from accidents and from reaching
 * outside the declared scope; it does not make it safe to compile expressions
 * written by an untrusted party.
 * @module lib/core/expression/ops
 */

import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';
import { resolveSandboxGlobal } from '../trace/globals.js';

/**
 * Globals an expression may name.
 *
 * Deliberately identical to the set the AST evaluator allowed, so migrating an
 * application changes nothing about which globals its templates can see.
 * @type {Set<string>}
 */
export const ALLOWED_GLOBALS = new Set([
  'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Error',
  'Map', 'Set', 'Promise', 'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'undefined', 'NaN', 'Infinity',
]);

/**
 * Globals an expression may never name, whether or not the host defines them.
 *
 * Listed explicitly rather than inferred from `in globalThis`, because the
 * diagnostic has to be the same in every environment: `localStorage` is
 * restricted in a browser, in happy-dom and in bare Node, and a developer
 * reading AVX_R15 should not get a different answer depending on where the
 * expression happened to run.
 * @type {Set<string>}
 */
export const RESTRICTED_GLOBALS = new Set([
  'window', 'document', 'localStorage', 'sessionStorage', 'location', 'navigator',
  'history', 'fetch', 'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'XMLHttpRequest', 'WebSocket', 'global',
  'globalThis', 'process', 'eval', 'Function', 'Reflect', 'Proxy', 'Symbol',
  'require', 'import', 'structuredClone',
]);

/**
 * Property names an expression may never read or write.
 *
 * Checked against the *resolved* key, so a computed access spelled
 * `x['const' + 'ructor']` is rejected on the same terms as `x.constructor`.
 * @type {Set<string>}
 */
export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * The dynamic-code constructors.
 *
 * Reaching any of these would be arbitrary code execution, so they are refused
 * as values however they were obtained.
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
 * Built-in prototypes shared by every object in the realm.
 *
 * Handing one to an expression would let it mutate state shared with the host
 * page, so they are refused as values rather than by enumerating every mutating
 * method on them.
 * @type {Set<object>}
 */
const PROTECTED_PROTOTYPES = new Set(
  [
    Object.prototype, Array.prototype, Function.prototype, String.prototype,
    Number.prototype, Boolean.prototype, Date.prototype, RegExp.prototype,
    Error.prototype, Map.prototype, Set.prototype, WeakMap.prototype,
    WeakSet.prototype, Promise.prototype,
  ].filter(Boolean),
);

/**
 * Raises a sandbox violation.
 * @param {string} message - What was refused.
 * @throws {AvenxError} Always.
 */
export function refuse(message) {
  throw new AvenxError(AvenxErrorCodes.SANDBOX_VIOLATION, message);
}

/**
 * Refuses a value that must never reach an expression.
 * @param {any} value - The value about to be returned.
 * @returns {any} The value, when it is allowed.
 */
export function guardValue(value) {
  if (typeof value === 'function' && FUNCTION_CONSTRUCTORS.has(value)) {
    refuse('Access to the Function constructor is blocked for security reasons.');
  }
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && PROTECTED_PROTOTYPES.has(value)) {
    refuse('Access to built-in prototypes is blocked for security reasons.');
  }
  return value;
}

/**
 * Whether a name exists on the host global object.
 * @param {string} name - The identifier.
 * @returns {boolean} True when the host defines it.
 */
function isKnownGlobal(name) {
  if (RESTRICTED_GLOBALS.has(name)) {
    return true;
  }
  try {
    return typeof globalThis !== 'undefined' && name in globalThis;
  } catch {
    return false;
  }
}

/**
 * Reads a property, with the key already resolved.
 *
 * This is the gate a source-text check cannot provide. Because the key arrives
 * as a value rather than as source, there is no spelling of it that avoids the
 * check.
 * @param {any} object - The object to read from.
 * @param {any} key - The resolved property key.
 * @param {boolean} [optional] - Whether the access used `?.`.
 * @returns {any} The property value.
 */
export function readMember(object, key, optional) {
  if (object === null || object === undefined) {
    if (optional) return undefined;
    throw new TypeError(`Cannot read property "${String(key)}" of ${object === null ? 'null' : 'undefined'}`);
  }

  const name = typeof key === 'symbol' ? key : String(key);
  if (typeof name === 'string' && FORBIDDEN_KEYS.has(name)) {
    refuse(`Access to property "${name}" is blocked for security reasons.`);
  }

  return guardValue(object[name]);
}

/**
 * Writes a property, with the key already resolved.
 * @param {any} object - The object to write to.
 * @param {any} key - The resolved property key.
 * @param {any} value - The value to assign.
 * @returns {any} The assigned value.
 */
export function writeMember(object, key, value) {
  if (object === null || object === undefined) {
    throw new TypeError(`Cannot set property "${String(key)}" of ${object === null ? 'null' : 'undefined'}`);
  }
  const name = typeof key === 'symbol' ? key : String(key);
  if (typeof name === 'string' && FORBIDDEN_KEYS.has(name)) {
    refuse(`Writing to property "${name}" is blocked for security reasons.`);
  }
  if (PROTECTED_PROTOTYPES.has(object)) {
    refuse('Writing to a built-in prototype is blocked for security reasons.');
  }
  object[name] = value;
  return value;
}

/**
 * Validates a computed property key before it is used in an object literal.
 * @param {any} key - The evaluated key.
 * @returns {any} The key, when it is allowed.
 */
export function guardKey(key) {
  const name = typeof key === 'symbol' ? key : String(key);
  if (typeof name === 'string' && FORBIDDEN_KEYS.has(name)) {
    refuse(`Defining property "${name}" is blocked for security reasons.`);
  }
  return name;
}

/**
 * Calls a function on behalf of an expression.
 * @param {any} fn - The callee.
 * @param {any} thisArg - The receiver.
 * @param {any[]} args - The arguments.
 * @param {string} description - How the callee was written, for the error.
 * @returns {any} The result.
 */
export function callFunction(fn, thisArg, args, description) {
  if (typeof fn !== 'function') {
    throw new TypeError(`${description} is not a function`);
  }
  if (FUNCTION_CONSTRUCTORS.has(fn)) {
    refuse('Calling the Function constructor is blocked for security reasons.');
  }
  for (const arg of args) {
    if (arg !== null && (typeof arg === 'object' || typeof arg === 'function') && PROTECTED_PROTOTYPES.has(arg)) {
      refuse('Passing a built-in prototype is blocked for security reasons.');
    }
  }
  return guardValue(fn.apply(thisArg, args));
}

/**
 * Constructs a value on behalf of an expression.
 * @param {any} ctor - The constructor.
 * @param {any[]} args - The arguments.
 * @param {string} description - How the constructor was written, for the error.
 * @returns {any} The constructed value.
 */
export function construct(ctor, args, description) {
  if (typeof ctor !== 'function') {
    throw new TypeError(`${description} is not a constructor`);
  }
  if (FUNCTION_CONSTRUCTORS.has(ctor)) {
    refuse('Constructing a function from a string is blocked for security reasons.');
  }
  return guardValue(Reflect.construct(ctor, args));
}

/**
 * Resolves a free identifier against the scope, then the allowed globals.
 *
 * Scope first, so a component's own `Date` state key wins over the global, and
 * so the reactive scope registers the dependency. A global is resolved through
 * the tracer's substitution point rather than read straight off `globalThis`,
 * which is what lets a recording log the non-deterministic values an expression
 * observed and a replay hand the same ones back.
 * @param {object} scope - The evaluation scope.
 * @param {string} name - The identifier.
 * @returns {any} The bound value, or undefined when nothing binds it.
 */
export function readIdentifier(scope, name) {
  if (scope && name in scope) {
    return guardValue(scope[name]);
  }
  if (ALLOWED_GLOBALS.has(name)) {
    return guardValue(resolveSandboxGlobal(name));
  }
  if (isKnownGlobal(name)) {
    refuse(
      `[Avenx Sandbox Violation] Access to global object "${name}" is restricted inside templates. Decouple browser APIs into component methods.`,
    );
  }
  return undefined;
}

/**
 * Assigns to a free identifier.
 * @param {object} scope - The evaluation scope.
 * @param {string} name - The identifier.
 * @param {any} value - The value to assign.
 * @returns {any} The assigned value.
 */
export function writeIdentifier(scope, name, value) {
  const bound = !!(scope && name in scope);
  if (ALLOWED_GLOBALS.has(name) && !bound) {
    refuse(`Assigning to the global "${name}" is blocked for security reasons.`);
  }
  if (!bound && isKnownGlobal(name)) {
    refuse(
      `[Avenx Sandbox Violation] Access to global object "${name}" is restricted inside templates. Decouple browser APIs into component methods.`,
    );
  }
  scope[name] = value;
  return value;
}

/**
 * `typeof` applied to a free identifier.
 *
 * `typeof maybeUndefined` must not throw for an unbound name, which is the
 * whole reason the operator gets used in a template.
 * @param {object} scope - The evaluation scope.
 * @param {string} name - The identifier.
 * @returns {string} The type name.
 */
export function typeofIdentifier(scope, name) {
  if (scope && name in scope) {
    return typeof scope[name];
  }
  if (ALLOWED_GLOBALS.has(name)) {
    return typeof resolveSandboxGlobal(name);
  }
  return 'undefined';
}

/**
 * `in` applied with the right-hand side coerced, matching the interpreter.
 * @param {any} key - The key to test.
 * @param {any} target - The object to test against.
 * @returns {boolean} Whether the key is present.
 */
export function hasIn(key, target) {
  return key in Object(target);
}

/**
 * The primitives a compiled expression calls, keyed by the name the generator
 * emits for each.
 *
 * One map rather than a list repeated at every consumer. A generated module
 * gets these as named imports the bundler resolves; a host that evaluates a
 * bare class body instead (`avenx-core/tooling`, the Vite plugin) injects them
 * from here. `lib/compiler/codegen/expression.js` declares the same names on
 * the emitting side, and a test requires the two to agree.
 * @type {Object<string, Function>}
 */
export const EXPRESSION_OPS = {
  axRead: readMember,
  axWrite: writeMember,
  axCall: callFunction,
  axNew: construct,
  axGet: readIdentifier,
  axSet: writeIdentifier,
  axTypeof: typeofIdentifier,
  axKey: guardKey,
  axIn: hasIn,
};
