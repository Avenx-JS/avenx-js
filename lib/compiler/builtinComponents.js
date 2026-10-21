/**
 * @file builtinComponents.js
 * @description The PascalCase tags the framework registers at runtime through
 * `registerBuiltin()`, as the compiler needs to know them.
 *
 * The runtime registry (`lib/core/runtime/builtins.js`) is deliberately empty
 * until a built-in's install module is imported, and the compiler only imports
 * that module when a template uses the tag. So the compiler cannot ask the
 * registry what exists; it needs its own list. Keep it in step with every
 * `registerBuiltin('<Name>', ...)` call under `lib/core/runtime/`.
 *
 * Matching is exact-case: `<VirtualList>` is a built-in, `<Virtuallist>` is a
 * misspelling and is still reported as AVX_W46.
 * @module lib/compiler/builtinComponents
 */

/**
 * Built-in component tag names.
 * @type {Set<string>}
 */
export const BUILTIN_COMPONENTS = new Set(['VirtualList']);
