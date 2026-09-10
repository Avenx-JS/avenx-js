/**
 * @file ComponentScope.js
 * @description How a component resolves the names an expression uses.
 *
 * ## Why this is its own object
 *
 * Now that expressions are compiled at build time, the scope is what remains of
 * the compiler/runtime boundary inside the runtime: the compiler emits closures
 * that take one argument, and this is the thing it is given. Everything about
 * what a component's expressions can see — its state, its computed values, its
 * actions, its props, its bridges, its resources, the values injected into it,
 * the names its own module imported — is decided here and nowhere else.
 *
 * It used to be four private methods and a cache field spread across a
 * 2,900-line class, which made two things hard to see. It hid the ordering
 * rule, which is load-bearing and easy to get wrong. And it hid the fact that a
 * scope was being constructed *per evaluation*: on the compiled path that is
 * one allocation and one layer walk per binding, per update, for an object
 * whose contents almost never change.
 *
 * ## Precedence, and why it is what it is
 *
 * Layers are consulted highest first:
 *
 *   1. per-call extras — a `<@for>` item, an `event`, an action's `args`
 *   2. injected values (`provide` / `inject`)
 *   3. framework names — `props`, `styles`, `$route`, `$emit`, `$watch`, …
 *   4. the component's own actions
 *   5. state and computed values, read from the live reactive proxy
 *   6. resources
 *   7. bridges
 *   8. mixin properties
 *   9. `state` itself
 *  10. the names the component's module imported
 *
 * Bridges sit below the component's own declarations so a bridge cannot
 * silently shadow a `<state>` key or an action; the compiler reports such a
 * collision separately. Imports sit last because an import is the least
 * specific thing in scope.
 *
 * ## Nothing is read until it is named
 *
 * The layers are a Proxy, not a merged object. Spreading the reactive state
 * into a plain object — which is what this replaced — read every key eagerly,
 * which made bare identifiers non-reactive, reported cycles that did not exist,
 * and tied every render to every state key. A `get` here resolves through the
 * layers and, for a state or computed name, reads the live proxy inside
 * whichever watcher is evaluating, so an expression depends on exactly the
 * names it mentions.
 *
 * ## Caching
 *
 * The base scope — the one with no per-call extras — is built once and reused.
 * It is invalidated when something changes what a name resolves to: the set of
 * state keys, the action map, the injected values. A scope with extras derives
 * from it rather than rebuilding, which is why {@link deriveScope} exists: a
 * spread would reintroduce the eager read this whole design removes.
 * @module lib/core/runtime/ComponentScope
 */

import {
  createReactiveScope,
  objectLayer,
  stateLayer,
  getterLayer,
  deriveScope,
} from '../reactive/scopeProxy.js';
import { toRaw } from '../reactive/proxyHandler.js';

/**
 * The evaluation scope of one component.
 */
export class ComponentScope {
  /**
   * @param {object} owner - The component this scope belongs to.
   */
  constructor(owner) {
    /** @type {object} */
    this.owner = owner;

    /**
     * The base scope, built on first use and reused until invalidated.
     * @type {object|null}
     */
    this.base = null;

    /**
     * The names the state layer binds, cached because computing them is
     * `Object.keys()` over the whole state object and a scope used to be built
     * per expression evaluated.
     * @type {string[]|null}
     */
    this.stateKeys = null;

    /**
     * The method map the cached base scope was built against.
     *
     * A component's actions are established once, but `createMethodMap` hands
     * the scope builder the map it is still filling, so the first scopes are
     * built against an object that is not yet complete. Recording which map the
     * cache belongs to is what stops a stale one being reused.
     * @type {object|null}
     */
    this.methods = null;
  }

  /**
   * Discards the cached scope.
   *
   * Called when something changes what a name would resolve to. Cheap enough to
   * call speculatively: the cost is one scope rebuild on the next evaluation.
   */
  invalidate() {
    this.base = null;
    this.stateKeys = null;
  }

  /**
   * Discards only the cached state-key list.
   *
   * A key being added to or removed from state changes what the state layer
   * binds but not the shape of the scope, so the layers themselves survive.
   */
  invalidateKeys() {
    this.stateKeys = null;
  }

  /**
   * The names state and computed values bind.
   *
   * Read from the raw target and the compiler's computed list rather than by
   * enumerating the proxy, so building a scope registers no dependency and
   * evaluates no computed value.
   * @returns {string[]} The bound names.
   */
  keys() {
    if (this.stateKeys === null) {
      const raw = toRaw(this.owner.state);
      const names = raw && typeof raw === 'object' ? Object.keys(raw) : [];
      this.stateKeys = names.concat(this.owner.__computedKeys());
    }
    return this.stateKeys;
  }

  /**
   * The names `provide`/`inject` makes visible.
   *
   * The names are a property of the component's `inject` declaration and do not
   * change; the values behind them do, because a provider higher up the tree
   * can update one at any time. So the names are resolved once and the values
   * are read live -- caching the values is what made a child keep rendering the
   * theme its ancestor no longer provides.
   * @returns {string[]} The injected names.
   */
  #injectedNames() {
    const owner = this.owner;
    const option =
      owner.inject ||
      (typeof owner.constructor.inject === 'function' ? owner.constructor.inject() : owner.constructor.inject);
    if (!option) {
      return [];
    }

    const resolved = typeof option === 'function' ? option.call(owner) : option;
    if (Array.isArray(resolved)) {
      return resolved;
    }
    if (resolved && typeof resolved === 'object') {
      return Object.keys(resolved);
    }
    return [];
  }

  /**
   * Builds the layered scope.
   * @param {object} methods - The component's executable actions.
   * @returns {object} The scope proxy.
   */
  #build(methods) {
    const owner = this.owner;

    const injected = {};
    for (const name of this.#injectedNames()) {
      injected[name] = () => owner[name];
    }

    // The set of resources is fixed once the constructor has run, but a scope
    // can be built *during* construction -- `createMethodMap` asks for one --
    // so the names are resolved on read rather than snapshotted here.
    const resources = {
      /**
       * @param {string} key - The name to test.
       * @returns {boolean} Whether a resource is declared under it.
       */
      has: (key) => owner.__resourceNames().includes(key),
      /**
       * @param {string} key - The name to read.
       * @returns {any} The resource's current value.
       */
      get: (key) => owner.__readResource(key),
      /**
       * @returns {string[]} The declared resource names.
       */
      keys: () => owner.__resourceNames(),
    };

    return createReactiveScope([
      getterLayer(injected),
      objectLayer({
        props: owner.props,
        styles: owner.styles,
        $route: owner.$route,
        $emit: (eventName, detail) => owner.$emit(eventName, detail),
        $watch: (source, callback, options) => owner.$watch(source, callback, options),
        $watchEffect: (effect, options) => owner.$watchEffect(effect, options),
        $nextTick: (callback) => owner.$nextTick(callback),
      }),
      objectLayer(methods),
      stateLayer(owner.state, () => this.keys()),
      resources,
      owner.__isIsolated() ? null : objectLayer(owner.__bridgeValues()),
      objectLayer(owner._mixinProps),
      objectLayer({ state: owner.state }),
      // Omitted entirely when there are none, so a component that imports
      // nothing resolves through exactly the layers it did before imports
      // became part of a component's scope at all.
      owner.__hasImports() ? objectLayer(owner.__importValues()) : null,
    ]);
  }

  /**
   * The scope an expression should be evaluated against.
   * @param {object} [methods] - The action map to expose. Defaults to the owner's.
   * @param {object} [extras] - Per-call bindings layered on top.
   * @returns {object} The scope.
   */
  resolve(methods = this.owner.__methods(), extras = null) {
    if (this.base === null || this.methods !== methods) {
      this.base = this.#build(methods);
      this.methods = methods;
    }
    if (!extras) {
      return this.base;
    }
    // Derived rather than spread: a spread of a scope proxy reads every name it
    // can enumerate, which is the eager read the layering exists to remove.
    return deriveScope(this.base, extras);
  }
}
