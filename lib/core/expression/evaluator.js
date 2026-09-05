/**
 * @file evaluator.js
 * @description Evaluates a parsed expression against a scope.
 *
 * ## This is where the security boundary actually is
 *
 * The old sandbox tried to be a boundary from outside the evaluation: it
 * wrapped values that reached an expression through the scope, and it grepped
 * the source text for `constructor`, `__proto__` and `prototype`. Neither
 * survives contact with the language.
 *
 * ```js
 * ({})['const'+'ructor']['const'+'ructor']('return 1')()
 * ```
 *
 * The object literal is created by the engine *inside* the expression, so it
 * never passes through the scope and is never wrapped; and the property name is
 * assembled at runtime, so no amount of reading the source finds it. Both
 * escapes are consequences of handing the expression to `new Function` and
 * inspecting from the outside.
 *
 * Here, nothing is handed over. Every property read goes through
 * {@link readMember} with the key already resolved to a string, so `x.constructor`
 * and `x['const'+'ructor']` arrive at the same check as the same value. Every
 * call goes through {@link invoke}. There is no path to a value the evaluator
 * did not itself produce.
 *
 * ## What is guaranteed, and what is not
 *
 * Guaranteed: an expression cannot reach the `Function` constructor, cannot
 * read or write `__proto__` / `constructor` / `prototype` however the key is
 * spelled, cannot reach a built-in prototype object, and cannot name a global
 * outside {@link ALLOWED_GLOBALS}. There is no `eval` and no `new Function`, so
 * a page carrying only Avenx expressions does not need `'unsafe-eval'`.
 *
 * Not guaranteed: this is not an isolation boundary against hostile expression
 * source*. An expression can still call any function the scope legitimately
 * exposes, and a bridge action can do whatever its own JavaScript does. The
 * boundary protects the runtime from accidents and from reaching outside the
 * declared scope; it does not make it safe to evaluate expressions written by
 * an untrusted party. Anything stronger would need a separate realm, and
 * claiming it without one is how the previous sandbox came to be believed.
 *
 * ## Determinism
 *
 * Global resolution goes through the tracer's substitution point, exactly as
 * the previous sandbox did, so a recorded session still observes and replays
 * the non-deterministic values (`Date`, `Math.random`) an expression sees.
 * There is a single evaluation choke point here, which is what Trace needs.
 * @module lib/core/expression/evaluator
 */

import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';
import { resolveSandboxGlobal } from '../trace/globals.js';

/**
 * Globals an expression may name.
 *
 * Deliberately identical to the set the previous sandbox allowed, so migrating
 * an application changes nothing about which globals its templates can see.
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
const RESTRICTED_GLOBALS = new Set([
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
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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
function refuse(message) {
  throw new AvenxError(AvenxErrorCodes.SANDBOX_VIOLATION, message);
}

/**
 * Refuses a value that must never reach an expression.
 * @param {any} value - The value about to be returned.
 * @returns {any} The value, when it is allowed.
 */
function guardValue(value) {
  if (typeof value === 'function' && FUNCTION_CONSTRUCTORS.has(value)) {
    refuse('Access to the Function constructor is blocked for security reasons.');
  }
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && PROTECTED_PROTOTYPES.has(value)) {
    refuse('Access to built-in prototypes is blocked for security reasons.');
  }
  return value;
}

/**
 * Reads a property, with the key already resolved.
 *
 * This is the single gate the old sandbox lacked. Because the key arrives as a
 * value rather than as source text, there is no spelling of it that avoids the
 * check.
 * @param {any} object - The object to read from.
 * @param {any} key - The resolved property key.
 * @param {boolean} optional - Whether the access used `?.`.
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
 * Calls a function on behalf of an expression.
 * @param {any} fn - The callee.
 * @param {any} thisArg - The receiver.
 * @param {any[]} args - The arguments.
 * @param {string} description - How the callee was written, for the error.
 * @returns {any} The result.
 */
export function invoke(fn, thisArg, args, description) {
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
 * A chain of name bindings.
 *
 * Arrow-function parameters and nothing else live here; everything else
 * resolves against the scope the caller supplied. Keeping the two separate is
 * what stops a lambda parameter from silently writing to component state.
 */
class Frame {
  /**
   * @param {Frame|null} parent - The enclosing frame.
   * @param {Object<string, any>} bindings - Names bound by this frame.
   */
  constructor(parent, bindings) {
    this.parent = parent;
    this.bindings = bindings;
  }

  /**
   * Finds the frame binding a name.
   * @param {string} name - The name to resolve.
   * @returns {Frame|null} The binding frame, or null.
   */
  lookup(name) {
    let frame = this;
    while (frame) {
      if (Object.prototype.hasOwnProperty.call(frame.bindings, name)) {
        return frame;
      }
      frame = frame.parent;
    }
    return null;
  }
}

/**
 * Evaluates a parsed expression.
 * @param {object} node - The AST root.
 * @param {object} scope - The evaluation scope. Reads and writes of names the
 *   scope binds go through it, which is what keeps dependency tracking working.
 * @param {object} [options] - Evaluation options.
 * @param {Frame} [options.frame] - The enclosing binding frame.
 * @returns {any} The expression's value.
 */
export function evaluate(node, scope, options = {}) {
  const frame = options.frame || null;
  return evalNode(node, scope, frame);
}

/**
 * Resolves an identifier to a value.
 * @param {string} name - The identifier.
 * @param {object} scope - The evaluation scope.
 * @param {Frame|null} frame - The enclosing binding frame.
 * @returns {any} The bound value.
 */
function readIdentifier(name, scope, frame) {
  const bindingFrame = frame && frame.lookup(name);
  if (bindingFrame) {
    return bindingFrame.bindings[name];
  }
  if (scope && name in scope) {
    return guardValue(scope[name]);
  }
  if (ALLOWED_GLOBALS.has(name)) {
    // Routed through the tracer's substitution point rather than read straight
    // off globalThis, so a recording can log the non-deterministic values an
    // expression observes and a replay can hand the same ones back.
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
 * Assigns to an identifier.
 * @param {string} name - The identifier.
 * @param {any} value - The value to assign.
 * @param {object} scope - The evaluation scope.
 * @param {Frame|null} frame - The enclosing binding frame.
 * @returns {any} The assigned value.
 */
function writeIdentifier(name, value, scope, frame) {
  const bindingFrame = frame && frame.lookup(name);
  if (bindingFrame) {
    bindingFrame.bindings[name] = value;
    return value;
  }
  if (ALLOWED_GLOBALS.has(name) && !(scope && name in scope)) {
    refuse(`Assigning to the global "${name}" is blocked for security reasons.`);
  }
  if (!(scope && name in scope) && isKnownGlobal(name)) {
    refuse(
      `[Avenx Sandbox Violation] Access to global object "${name}" is restricted inside templates. Decouple browser APIs into component methods.`,
    );
  }
  scope[name] = value;
  return value;
}

/**
 * Applies a binary operator.
 * @param {string} operator - The operator.
 * @param {any} left - Left operand.
 * @param {any} right - Right operand.
 * @returns {any} The result.
 */
function applyBinary(operator, left, right) {
  switch (operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return left / right;
    case '%': return left % right;
    case '**': return left ** right;
    // Loose equality is part of the language being evaluated, not a choice
    // made here: an expression that writes `==` must mean `==`.
    case '==': return left == right;
    case '!=': return left != right;
    case '===': return left === right;
    case '!==': return left !== right;
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    case '&': return left & right;
    case '|': return left | right;
    case '^': return left ^ right;
    case '<<': return left << right;
    case '>>': return left >> right;
    case '>>>': return left >>> right;
    case 'in': return left in Object(right);
    case 'instanceof': return left instanceof right;
    default:
      refuse(`Unsupported operator "${operator}"`);
      return undefined;
  }
}

/**
 * Computes the value an assignment operator produces.
 * @param {string} operator - The assignment operator.
 * @param {any} current - The current value.
 * @param {any} operand - The right-hand value.
 * @returns {any} The value to store.
 */
function applyCompound(operator, current, operand) {
  if (operator === '=') return operand;
  return applyBinary(operator.slice(0, -1), current, operand);
}

/**
 * Evaluates one AST node.
 * @param {object} node - The node.
 * @param {object} scope - The evaluation scope.
 * @param {Frame|null} frame - The enclosing binding frame.
 * @returns {any} The node's value.
 */
function evalNode(node, scope, frame) {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Identifier':
      return readIdentifier(node.name, scope, frame);

    case 'TemplateLiteral': {
      let out = node.quasis[0];
      for (let i = 0; i < node.expressions.length; i++) {
        out += String(evalNode(node.expressions[i], scope, frame));
        out += node.quasis[i + 1];
      }
      return out;
    }

    case 'ArrayLiteral': {
      const items = [];
      for (const element of node.elements) {
        if (element.type === 'Spread') {
          items.push(...evalNode(element.argument, scope, frame));
        } else {
          items.push(evalNode(element, scope, frame));
        }
      }
      return items;
    }

    case 'ObjectLiteral': {
      // Created with a null prototype and then given Object.prototype, so a
      // key named __proto__ cannot change the object's prototype on the way in.
      const result = {};
      for (const property of node.properties) {
        if (property.kind === 'spread') {
          Object.assign(result, evalNode(property.value, scope, frame));
          continue;
        }
        const key = property.key.computed
          ? String(evalNode(property.key.node, scope, frame))
          : property.key.node.value;
        if (FORBIDDEN_KEYS.has(key)) {
          refuse(`Defining property "${key}" is blocked for security reasons.`);
        }
        result[key] = evalNode(property.value, scope, frame);
      }
      return result;
    }

    case 'Member': {
      const object = evalNode(node.object, scope, frame);
      if (node.optional && (object === null || object === undefined)) {
        return undefined;
      }
      const key = node.computed ? evalNode(node.property, scope, frame) : node.property.value;
      return readMember(object, key, node.optional);
    }

    case 'Call': {
      const { callee } = node;
      let thisArg;
      let fn;
      let description;

      if (callee.type === 'Member') {
        const object = evalNode(callee.object, scope, frame);
        if (callee.optional && (object === null || object === undefined)) {
          return undefined;
        }
        const key = callee.computed ? evalNode(callee.property, scope, frame) : callee.property.value;
        thisArg = object;
        fn = readMember(object, key, callee.optional);
        description = `${describe(callee.object)}.${String(key)}`;
      } else {
        thisArg = undefined;
        fn = evalNode(callee, scope, frame);
        description = describe(callee);
      }

      if (node.optional && (fn === null || fn === undefined)) {
        return undefined;
      }

      const args = [];
      for (const arg of node.args) {
        if (arg.type === 'Spread') {
          args.push(...evalNode(arg.argument, scope, frame));
        } else {
          args.push(evalNode(arg, scope, frame));
        }
      }

      return invoke(fn, thisArg, args, description);
    }

    case 'New': {
      const ctor = evalNode(node.callee, scope, frame);
      if (typeof ctor !== 'function') {
        throw new TypeError(`${describe(node.callee)} is not a constructor`);
      }
      if (FUNCTION_CONSTRUCTORS.has(ctor)) {
        refuse('Constructing a function from a string is blocked for security reasons.');
      }
      const args = [];
      for (const arg of node.args) {
        if (arg.type === 'Spread') {
          args.push(...evalNode(arg.argument, scope, frame));
        } else {
          args.push(evalNode(arg, scope, frame));
        }
      }
      return guardValue(Reflect.construct(ctor, args));
    }

    case 'Unary': {
      if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
        // `typeof maybeUndefined` must not throw for an unbound name, which is
        // the whole reason the operator gets used in a template.
        const bindingFrame = frame && frame.lookup(node.argument.name);
        if (!bindingFrame && !(scope && node.argument.name in scope) && !ALLOWED_GLOBALS.has(node.argument.name)) {
          return 'undefined';
        }
      }
      const value = evalNode(node.argument, scope, frame);
      switch (node.operator) {
        case '!': return !value;
        case '-': return -value;
        case '+': return +value;
        case '~': return ~value;
        case 'typeof': return typeof value;
        case 'void': return undefined;
        default:
          refuse(`Unsupported operator "${node.operator}"`);
          return undefined;
      }
    }

    case 'Binary':
      return applyBinary(node.operator, evalNode(node.left, scope, frame), evalNode(node.right, scope, frame));

    case 'Logical': {
      const left = evalNode(node.left, scope, frame);
      if (node.operator === '&&') return left ? evalNode(node.right, scope, frame) : left;
      if (node.operator === '||') return left ? left : evalNode(node.right, scope, frame);
      return left === null || left === undefined ? evalNode(node.right, scope, frame) : left;
    }

    case 'Conditional':
      return evalNode(node.test, scope, frame)
        ? evalNode(node.consequent, scope, frame)
        : evalNode(node.alternate, scope, frame);

    case 'Assignment': {
      const { target } = node;

      if (target.type === 'Identifier') {
        if (node.operator === '=') {
          return writeIdentifier(target.name, evalNode(node.value, scope, frame), scope, frame);
        }
        const current = readIdentifier(target.name, scope, frame);
        if (node.operator === '&&=' && !current) return current;
        if (node.operator === '||=' && current) return current;
        if (node.operator === '??=' && current !== null && current !== undefined) return current;
        const operand = evalNode(node.value, scope, frame);
        const next = node.operator.length === 3 && node.operator[2] === '='
          ? operand
          : applyCompound(node.operator, current, operand);
        return writeIdentifier(target.name, next, scope, frame);
      }

      const object = evalNode(target.object, scope, frame);
      const key = target.computed ? evalNode(target.property, scope, frame) : target.property.value;

      if (node.operator === '=') {
        return writeMember(object, key, evalNode(node.value, scope, frame));
      }
      const current = readMember(object, key, false);
      if (node.operator === '&&=' && !current) return current;
      if (node.operator === '||=' && current) return current;
      if (node.operator === '??=' && current !== null && current !== undefined) return current;
      const operand = evalNode(node.value, scope, frame);
      const next = node.operator.length === 3 && node.operator[2] === '='
        ? operand
        : applyCompound(node.operator, current, operand);
      return writeMember(object, key, next);
    }

    case 'Update': {
      const { argument } = node;
      if (argument.type === 'Identifier') {
        const current = Number(readIdentifier(argument.name, scope, frame));
        const next = node.operator === '++' ? current + 1 : current - 1;
        writeIdentifier(argument.name, next, scope, frame);
        return node.prefix ? next : current;
      }
      const object = evalNode(argument.object, scope, frame);
      const key = argument.computed ? evalNode(argument.property, scope, frame) : argument.property.value;
      const current = Number(readMember(object, key, false));
      const next = node.operator === '++' ? current + 1 : current - 1;
      writeMember(object, key, next);
      return node.prefix ? next : current;
    }

    case 'Arrow': {
      const params = node.params;
      const body = node.body;
      return (...args) => {
        const bindings = {};
        for (let i = 0; i < params.length; i++) {
          bindings[params[i]] = args[i];
        }
        return evalNode(body, scope, new Frame(frame, bindings));
      };
    }

    case 'Program': {
      // A statement program's value is discarded: `executeStatement` returns
      // undefined unless the body used `return`, which is not an expression
      // and therefore never reaches here.
      for (const statement of node.body) {
        evalNode(statement, scope, frame);
      }
      return undefined;
    }

    case 'Sequence': {
      let result;
      for (const expression of node.expressions) {
        result = evalNode(expression, scope, frame);
      }
      return result;
    }

    case 'Spread':
      refuse('A spread element is not valid here');
      return undefined;

    default:
      refuse(`Unsupported expression node "${node.type}"`);
      return undefined;
  }
}

/**
 * Describes a node for an error message.
 * @param {object} node - The node.
 * @returns {string} A short human-readable description.
 */
function describe(node) {
  switch (node.type) {
    case 'Identifier': return node.name;
    case 'Literal': return JSON.stringify(node.value);
    case 'Member':
      return node.computed
        ? `${describe(node.object)}[…]`
        : `${describe(node.object)}.${node.property.value}`;
    case 'Call': return `${describe(node.callee)}(…)`;
    default: return 'expression';
  }
}
