/**
 * @file scopeProxy.js
 * @description The evaluation scope handed to template expressions, computed
 * values and action bodies.
 *
 * ## What was wrong with building it as an object
 *
 * The scope used to be assembled with a spread:
 *
 * ```js
 * const scope = { state: this.state, ...this.bridges, ...this.state, ...methods, … };
 * ```
 *
 * `...this.state` reads every key on the reactive proxy, eagerly, every time a
 * scope is built — which is once per render, per action call and per computed
 * evaluation. Three separate defects followed from that one line.
 *
 * **Bare identifiers were not reactive.** The documented computed form
 * `<computed value="count * 2" />` reads `count` out of the *snapshot* the
 * spread produced, not out of the proxy, so no dependency was registered for
 * the expression itself. `state.count * 2` worked; the form in the README,
 * quickstart and state-management guide did not, and failed silently — the
 * first render was correct and the value then never changed again.
 *
 * **Computed values reported false cycles.** Spreading the state proxy reads
 * the computed key currently being evaluated. That re-entered the computed's
 * own watcher mid-collection, tripping the re-entrancy guard: every app using
 * computed properties logged `AVX_R04 Circular dependency detected` on every
 * re-render, for a cycle that did not exist. Worse, the re-entrant
 * `watcher.evaluate()` reset the watcher's dependency set part-way through
 * collection, which is what actually lost the `count` dependency above. The
 * bogus warning and the missing dependency were the same event.
 *
 * **Reactivity was component-granular.** Because the spread touched every key,
 * the render watcher depended on all of them. Changing a key no expression
 * mentioned still re-rendered the component, so the per-key precision the Proxy
 * layer computes was discarded one level above it.
 *
 * ## What this does instead
 *
 * Nothing is read until an expression actually names it. The scope is a Proxy
 * over ordered layers; a `get` resolves through them and, for a state or
 * computed key, reads the live reactive proxy — inside whichever watcher is
 * currently evaluating. So `count` in `count * 2` registers a dependency on
 * `count` and on nothing else.
 *
 * ## Derivation instead of spreading
 *
 * Several call sites layer extra names onto a scope — a `<@for>` loop variable,
 * an `event`, an action's `args`. Written as `{ ...scope, index }` that would
 * reintroduce the eager read this module exists to remove, so scopes derive
 * instead: {@link deriveScope} pushes another layer without materialising
 * anything. It falls back to a spread for plain objects, so external code that
 * passes an ordinary object still works.
 * @module lib/core/reactive/scopeProxy
 */

/**
 * Marks a value as one of this module's scope proxies.
 * @type {symbol}
 */
export const IS_REACTIVE_SCOPE = Symbol.for('avenx.reactiveScope');

/**
 * Derives a child scope from a scope proxy.
 * @type {symbol}
 */
export const SCOPE_DERIVE = Symbol.for('avenx.scopeDerive');

/**
 * Reports whether a value is a scope proxy created here.
 * @param {any} value - The value to test.
 * @returns {boolean} True for a reactive scope proxy.
 */
export function isReactiveScope(value) {
  return !!(value && typeof value === 'object' && value[IS_REACTIVE_SCOPE]);
}

/**
 * Layers extra bindings on top of an existing scope.
 *
 * Prefer this over `{ ...scope, extra }` anywhere a scope gains names. A spread
 * of a scope proxy reads every key it can enumerate, which is exactly the eager
 * read this module removes.
 * @param {object} scope - The scope to extend. May be a scope proxy or a plain object.
 * @param {object} extras - The bindings to layer on top.
 * @returns {object} A scope with the extras applied.
 */
export function deriveScope(scope, extras) {
  if (!extras) {
    return scope;
  }
  if (isReactiveScope(scope)) {
    return scope[SCOPE_DERIVE](extras);
  }
  return { ...scope, ...extras };
}

/**
 * @typedef {object} ScopeLayer
 * @property {function(string): boolean} has - Whether the layer binds a name.
 * @property {function(string): any} get - The value bound to a name.
 * @property {function(string, any): boolean} [set] - Assigns to a bound name.
 * @property {function(): string[]} keys - The names the layer binds.
 */

/**
 * Builds a layer over a plain object.
 * @param {object} source - The object to expose.
 * @returns {ScopeLayer} The layer.
 */
export function objectLayer(source) {
  const target = source || {};
  return {
    /**
     * @param {string} key - The name to test.
     * @returns {boolean} Whether the object binds it.
     */
    has(key) {
      return Object.prototype.hasOwnProperty.call(target, key);
    },
    /**
     * @param {string} key - The name to read.
     * @returns {any} The bound value.
     */
    get(key) {
      return target[key];
    },
    /**
     * @param {string} key - The name to write.
     * @param {any} value - The value to assign.
     * @returns {boolean} Always true.
     */
    set(key, value) {
      target[key] = value;
      return true;
    },
    /**
     * @returns {string[]} The names bound.
     */
    keys() {
      return Object.keys(target);
    },
  };
}

/**
 * Builds a layer over the component's reactive state.
 *
 * The names are known without reading anything: they come from the raw target
 * and the compiler's computed list. A value is read from the proxy only when an
 * expression asks for it, which is what makes the read land inside the watcher
 * that is currently evaluating.
 * @param {object} state - The reactive state proxy.
 * @param {function(): string[]} listKeys - Returns the bound names.
 * @returns {ScopeLayer} The layer.
 */
export function stateLayer(state, listKeys) {
  let cached = null;
  return {
    /**
     * @param {string} key - The name to test.
     * @returns {boolean} Whether state binds it.
     */
    has(key) {
      if (!cached) {
        cached = new Set(listKeys());
      }
      return cached.has(key);
    },
    /**
     * @param {string} key - The name to read.
     * @returns {any} The value, read through the reactive proxy.
     */
    get(key) {
      return state[key];
    },
    /**
     * @param {string} key - The name to write.
     * @param {any} value - The value to assign.
     * @returns {boolean} Always true.
     */
    set(key, value) {
      state[key] = value;
      return true;
    },
    /**
     * @returns {string[]} The names bound.
     */
    keys() {
      if (!cached) {
        cached = new Set(listKeys());
      }
      return [...cached];
    },
  };
}

/**
 * Builds a layer of lazily evaluated bindings.
 *
 * Used for resources, whose value is produced by calling `read()` and must not
 * be produced merely because a scope was built.
 * @param {Object<string, function(): any>} getters - Name to getter.
 * @returns {ScopeLayer} The layer.
 */
export function getterLayer(getters) {
  const source = getters || {};
  return {
    /**
     * @param {string} key - The name to test.
     * @returns {boolean} Whether a getter is bound.
     */
    has(key) {
      return Object.prototype.hasOwnProperty.call(source, key);
    },
    /**
     * @param {string} key - The name to read.
     * @returns {any} The getter's result.
     */
    get(key) {
      return source[key]();
    },
    /**
     * @returns {string[]} The names bound.
     */
    keys() {
      return Object.keys(source);
    },
  };
}

/**
 * Creates the evaluation scope.
 *
 * Layers are given in precedence order, highest first: the first layer that
 * binds a name wins. That mirrors the object-literal precedence the previous
 * implementation had, where later spreads overwrote earlier ones.
 * @param {ScopeLayer[]} layers - The layers, highest precedence first.
 * @returns {object} A scope proxy.
 */
export function createReactiveScope(layers) {
  const active = layers.filter(Boolean);

  /**
   * Finds the layer that binds a name.
   * @param {string} key - The name to resolve.
   * @returns {ScopeLayer|null} The binding layer, or null.
   */
  function resolve(key) {
    for (const layer of active) {
      if (layer.has(key)) {
        return layer;
      }
    }
    return null;
  }

  const handler = {
    /**
     * @param {object} target - Unused backing object.
     * @param {string|symbol} key - The name to test.
     * @returns {boolean} Whether the scope binds it.
     */
    has(target, key) {
      if (key === IS_REACTIVE_SCOPE || key === SCOPE_DERIVE) return true;
      if (typeof key === 'symbol') return false;
      return resolve(key) !== null;
    },

    /**
     * @param {object} target - Unused backing object.
     * @param {string|symbol} key - The name to read.
     * @returns {any} The bound value, or undefined.
     */
    get(target, key) {
      if (key === IS_REACTIVE_SCOPE) return true;
      if (key === SCOPE_DERIVE) {
        return (extras) => createReactiveScope([objectLayer(extras), ...active]);
      }
      if (typeof key === 'symbol') return undefined;
      const layer = resolve(key);
      return layer ? layer.get(key) : undefined;
    },

    /**
     * @param {object} target - Unused backing object.
     * @param {string|symbol} key - The name to write.
     * @param {any} value - The value to assign.
     * @returns {boolean} Whether the write was accepted.
     */
    set(target, key, value) {
      if (typeof key === 'symbol') return false;
      const layer = resolve(key);
      if (layer && typeof layer.set === 'function') {
        return layer.set(key, value);
      }
      // An undeclared name assigned from an action lands on the highest layer
      // that can hold it, matching the previous behaviour where
      // `scope[key] = value` created a key on the scope object.
      for (const candidate of active) {
        if (typeof candidate.set === 'function') {
          return candidate.set(key, value);
        }
      }
      return false;
    },

    /**
     * Enumerating a scope materialises it, which is what spreading one does.
     * Present so that external code holding a scope still behaves; internal
     * call sites use {@link deriveScope} instead.
     * @returns {string[]} Every bound name.
     */
    ownKeys() {
      const names = new Set();
      for (const layer of active) {
        for (const key of layer.keys()) {
          names.add(key);
        }
      }
      return [...names];
    },

    /**
     * @param {object} target - Unused backing object.
     * @param {string|symbol} key - The name to describe.
     * @returns {object|undefined} A descriptor for a bound name.
     */
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'symbol') return undefined;
      if (!resolve(key)) return undefined;
      return { configurable: true, enumerable: true, writable: true, value: this.get(target, key) };
    },
  };

  return new Proxy(Object.create(null), handler);
}
