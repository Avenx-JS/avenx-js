/**
 * @file symbols.js
 * @description The symbols that mark and unwrap reactive values.
 *
 * These live in their own module so that consumers which only need to
 * recognise a reactive value — rather than create one — can do so without
 * importing `proxyHandler.js`. `proxyHandler.js` re-exports every name here,
 * so this split is invisible to existing importers.
 * @module lib/core/reactive/symbols
 */

/**
 * Reads the raw target behind a reactive proxy.
 * @type {symbol}
 */
export const RAW_SYMBOL = Symbol('raw');

/**
 * Marks a value as an Avenx reactive proxy.
 * @type {symbol}
 */
export const IS_REACTIVE_PROXY = Symbol('avenx.reactive.proxy');

/**
 * Links a raw target back to the proxy that wraps it, so a value reached by
 * two routes yields one stable proxy identity.
 * @type {symbol}
 */
export const PROXY_REF_SYMBOL = Symbol.for('__avenx_proxy_ref__');

/**
 * Marks a value that must never be wrapped in a reactive proxy.
 * @type {symbol}
 */
export const NON_REACTIVE_SYMBOL = Symbol.for('avenx.reactive.skip');
