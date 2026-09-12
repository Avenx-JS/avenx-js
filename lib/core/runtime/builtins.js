/**
 * @file builtins.js
 * @description The registry of components an application gets without
 * declaring them.
 *
 * ## Why this is a registry rather than an import
 *
 * `AvenxApp` used to `import { VirtualList }` and register it in its
 * constructor. That is one line, and it put `VirtualList`, the template
 * renderer and the DOM patcher into every bundle ever built -- including the
 * overwhelming majority of applications that never write `<VirtualList>`.
 * Roughly 60 KB of source, reachable because of a registration nobody asked
 * for.
 *
 * A built-in is now registered by importing a module whose only job is to
 * register it, and the compiler adds that module to the graph when it sees the
 * tag in a template. An application that uses the component pays for it; one
 * that does not, does not.
 *
 * ## Deliberately tiny
 *
 * This module imports nothing, for the same reason
 * {@link module:lib/core/renderer/stringRenderer} imports nothing: a default
 * would make the thing it defaults to reachable, and the arrangement would
 * achieve nothing.
 * @module lib/core/runtime/builtins
 */

/**
 * Built-in component classes by tag name.
 * @type {Map<string, Function>}
 */
const builtins = new Map();

/**
 * Registers a built-in component.
 * @param {string} name - The PascalCase tag name.
 * @param {Function} componentClass - The component class.
 */
export function registerBuiltin(name, componentClass) {
  builtins.set(name, componentClass);
}

/**
 * Every registered built-in, for an application to adopt at construction.
 * @returns {Map<string, Function>} The registry.
 */
export function getBuiltins() {
  return builtins;
}
