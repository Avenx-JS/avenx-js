/**
 * @file componentHelpers.js
 * @description Canonical definition of component $ helpers and members.
 * Single source of truth for:
 * 1. Bare injected $ helpers available without `this.` in expression & action scopes
 *    (ComponentScope, Atlas AMBIENT_ROOTS, and template validation).
 * 2. `this.`-only $ members on AvenxComponent that must be invoked/accessed on `this.`.
 * @module lib/core/runtime/componentHelpers
 */

/**
 * Injected component helpers exposed bare (without `this.`) to expression and
 * action scopes via ComponentScope.
 * @type {string[]}
 */
export const BARE_DOLLAR_HELPERS = Object.freeze([
  '$route',
  '$router',
  '$emit',
  '$watch',
  '$watchEffect',
  '$nextTick',
  '$refs',
  '$element',
  '$slots',
  '$app',
]);

/**
 * Set of bare injected component helpers for fast membership lookup.
 * @type {Set<string>}
 */
export const BARE_DOLLAR_HELPERS_SET = new Set(BARE_DOLLAR_HELPERS);

/**
 * Component instance members and methods beginning with `$` that require `this.`
 * and are not injected bare into expression or action scope.
 * @type {string[]}
 */
export const THIS_ONLY_DOLLAR_MEMBERS = Object.freeze([
  '$destroy',
  '$isMounted',
  '$isUnmounted',
  '$keepAlive',
  '$inspect',
  '$tripDeadlockBoundary',
  '$resetDeadlockBoundary',
  '$validateElement',
  '$parent',
  '$parentComponent',
  '$id',
  '$instanceId',
  '$resources',
  '$logContext',
  '$compiled',
]);

/**
 * Set of `this.`-only component members for fast membership lookup.
 * @type {Set<string>}
 */
export const THIS_ONLY_DOLLAR_MEMBERS_SET = new Set(THIS_ONLY_DOLLAR_MEMBERS);

/**
 * Union of all documented and runtime `$` members on AvenxComponent.
 * @type {string[]}
 */
export const ALL_COMPONENT_DOLLAR_MEMBERS = Object.freeze([
  ...BARE_DOLLAR_HELPERS,
  ...THIS_ONLY_DOLLAR_MEMBERS,
]);

/**
 * Set of all component `$` members for fast membership lookup.
 * @type {Set<string>}
 */
export const ALL_COMPONENT_DOLLAR_MEMBERS_SET = new Set(ALL_COMPONENT_DOLLAR_MEMBERS);
