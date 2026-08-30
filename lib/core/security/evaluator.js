import { AvenxSandbox } from './sandbox.js';
import { Sanitizer } from './sanitize.js';
import { tracer } from '../trace/tracer.js';
import { TraceNodeType } from '../trace/schema.js';
import { journal } from '../reactive/journal.js';

/**
 * A standard Least Recently Used (LRU) Cache implementation.
 * Uses JavaScript Map's insertion order preservation to maintain recency.
 */
export class LruCache {
  /**
   * @param {number} limit - Maximum number of items allowed in the cache.
   * @param {function(string, *): void} [onEvict] - Optional callback triggered when an item is evicted.
   */
  constructor(limit, onEvict = null) {
    if (typeof limit !== 'number' || limit <= 0) {
      throw new Error('LRU Cache limit must be a positive number');
    }
    this.limit = limit;
    this.onEvict = onEvict;
    this.cache = new Map();
  }

  /**
   * Retrieves an item from the cache and updates its recency.
   * @param {string} key
   * @returns {*} The cached value, or undefined if not found.
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Inserts or updates an item in the cache. Evicts the least recently used item if limit is exceeded.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.limit) {
      const lruKey = this.cache.keys().next().value;
      const lruValue = this.cache.get(lruKey);
      this.cache.delete(lruKey);
      if (typeof this.onEvict === 'function') {
        try {
          this.onEvict(lruKey, lruValue);
        } catch (err) {
          console.error('Error in LRU Cache onEvict callback:', err);
        }
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Checks if a key exists in the cache without updating its recency.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Deletes an item from the cache.
   * @param {string} key
   * @returns {boolean} True if the item existed and was removed.
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clears all items from the cache.
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Returns the current number of items in the cache.
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }
}

const DEFAULT_CACHE_CAPACITY = 1000;

// Module-scope LRU caches for compiled expressions and statements.
// Shared across all DynamicEvaluator instances to prevent redundant compilation across components.
let expressionCache = new LruCache(DEFAULT_CACHE_CAPACITY);
let statementCache = new LruCache(DEFAULT_CACHE_CAPACITY);

/**
 * Configure the capacity of the compiled expression and statement caches.
 * @param {number} capacity - Positive integer limit.
 */
export function setExpressionCacheCapacity(capacity) {
  if (typeof capacity !== 'number' || capacity <= 0 || !Number.isInteger(capacity)) {
    throw new Error('Expression cache capacity must be a positive integer');
  }
  const oldExpr = expressionCache;
  const oldStmt = statementCache;
  expressionCache = new LruCache(capacity);
  statementCache = new LruCache(capacity);

  if (oldExpr) {
    for (const [k, v] of oldExpr.cache.entries()) {
      if (expressionCache.size >= capacity) break;
      expressionCache.set(k, v);
    }
  }
  if (oldStmt) {
    for (const [k, v] of oldStmt.cache.entries()) {
      if (statementCache.size >= capacity) break;
      statementCache.set(k, v);
    }
  }
}

/**
 * Clears the evaluator expression and statement caches.
 */
export function clearExpressionCache() {
  expressionCache.clear();
  statementCache.clear();
}

/**
 * Inspect the current cache size (used for diagnostics and testing).
 */
export function getExpressionCacheStats() {
  return {
    expressionCacheSize: expressionCache.size,
    statementCacheSize: statementCache.size,
  };
}

/**
 * Provides dynamic expression and statement evaluation within a given scope.
 */
export class DynamicEvaluator {
  /**
   * Evaluates a JavaScript expression within a scope.
   * @param {string} expression - The expression to evaluate.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The 'this' context for evaluation.
   * @returns {any} The result of evaluation.
   */
  evaluateExpression(expression, scope = {}, thisArg = scope) {
    let fn = expressionCache.get(expression);
    if (!fn) {
      // Validate source only on cache miss. Validation is a property of the source text,
      // so validating once per unique source string before compilation is secure and efficient.
      AvenxSandbox.validateSource(expression);
      fn = new Function(`with(this) { return (${expression}) }`);
      expressionCache.set(expression, fn);
    }
    const sandbox = AvenxSandbox.createProxy(scope, thisArg);
    return fn.call(sandbox);
  }

  /**
   * Executes a JavaScript statement within a scope.
   * @param {string} source - The statement(s) to execute.
   * @param {object} [scope] - The scope variables.
   * @param {object} [thisArg] - The 'this' context for execution.
   * @returns {any} The result of execution.
   */
  executeStatement(source, scope = {}, thisArg = scope) {
    let fn = statementCache.get(source);
    if (!fn) {
      AvenxSandbox.validateSource(source);
      fn = new Function(`with(this) { ${source} }`);
      statementCache.set(source, fn);
    }
    const sandbox = AvenxSandbox.createProxy(scope, thisArg);
    return fn.call(sandbox);
  }

  /**
   * Creates a map of executable methods from string definitions.
   * @param {object} [methods] - An object containing method name and source code pairs.
   * @param {function(object): object} getScope - Function to retrieve the scope for a method.
   * @param {function(): object} getThisArg - Function to retrieve the 'this' context for methods.
   * @param {object} [context] - Trace context describing who owns these methods.
   * @param {string} [context.owner] - The component or page name, used in traces.
   * @param {string} [context.kind] - What sort of unit these are, e.g. `action` or `resource`.
   * @param {string[]} [context.contracts] - Compiler contracts the owner declared.
   * @param {Object<string, {onConflict?: string}>} [context.atomic] - Actions the
   *   compiler saw declared `atomic`, keyed by name. Each one runs inside a
   *   Rewind transaction: its writes are journaled and undone if it fails.
   * @returns {object} A map of functions.
   */
  createMethodMap(methods = {}, getScope, getThisArg, context = null) {
    const executable = {};
    const owner = context && context.owner;
    const kind = (context && context.kind) || 'action';
    const contracts = context && context.contracts && context.contracts.length > 0 ? context.contracts : undefined;

    const atomicSpec = (context && context.atomic) || null;

    for (const [name, source] of Object.entries(methods)) {
      if (typeof source === 'function') {
        executable[name] = source.bind(getThisArg());
      } else {
        // Resolved once per action rather than per call: the descriptor comes
        // from the compiler and cannot change while the component is alive.
        const transaction = atomicSpec && Object.prototype.hasOwnProperty.call(atomicSpec, name)
          ? atomicSpec[name] || {}
          : null;

        executable[name] = (...args) => {
          const invoke = () => this.executeStatement(source, { ...getScope(executable), args }, getThisArg());
          const run = transaction
            ? () => journal.run({ owner, name, onConflict: transaction.onConflict }, invoke)
            : invoke;
          if (!tracer.on) {
            return run();
          }
          const token = tracer.enter(TraceNodeType.ACTION, {
            name,
            kind,
            component: owner,
            source,
            contracts,
            args: args.length > 0 ? tracer.sink.capture(args, `${name}.args`) : undefined,
          });
          try {
            return run();
          } finally {
            tracer.leave(token);
          }
        };
      }
    }

    return executable;
  }

  /**
   * Sanitizes an HTML string using the Sanitizer utility with optional custom policy configuration.
   * @param {any} value - The HTML string or value to sanitize.
   * @param {object} [options] - Optional custom policy configuration for Sanitizer.
   * @returns {string} The sanitized HTML string.
   */
  sanitizeHTML(value, options = {}) {
    const sanitizer = new Sanitizer(options);
    return sanitizer.sanitize(value);
  }
}