/**
 * @file moduleScope.js
 * @description Gives each concatenated source file its own scope in the bundle.
 *
 * ## The problem this solves
 *
 * A compiled Avenx application is one script. Modules reach it by being
 * concatenated, and their `import` statements are rewritten into destructuring
 * from the runtime namespace:
 *
 * ```js
 * import { AvenxGuard } from 'avenx-core/runtime';
 * // becomes
 * const { AvenxGuard } = Avenx;
 * ```
 *
 * Bridges were already wrapped in an IIFE, so each one's rewritten imports
 * lived in its own scope. Guards were not: their preambles were concatenated
 * straight into bundle scope. Two guard files therefore produced
 *
 * ```js
 * const { AvenxGuard } = Avenx;   // auth.guard.js
 * const { AvenxGuard } = Avenx;   // role.guard.js
 * ```
 *
 * which is a `SyntaxError: Identifier 'AvenxGuard' has already been declared`.
 * The whole bundle failed to parse and the application never started — while
 * the build printed "Build successful", because nothing ever checked.
 *
 * The bug was not specific to `AvenxGuard`, or to guards. It was that
 * concatenation had no notion of module scope, so *any* two files declaring the
 * same top-level name collided. Fixing only the observed identifier would leave
 * the next one to be discovered in production.
 *
 * ## The model
 *
 * Every non-entry module becomes an expression-scoped unit that publishes
 * exactly one binding into bundle scope:
 *
 * ```js
 * const AuthGuard = (() => {
 *   const { AvenxGuard } = Avenx;
 *   class AuthGuard extends AvenxGuard { ... }
 *   return AuthGuard;
 * })();
 * ```
 *
 * Anything else the module declares — helpers, constants, its own rewritten
 * imports — is invisible to every other module. What remains at bundle scope is
 * one name per module, which makes a genuine collision (two modules exporting
 * the same name) both detectable and worth reporting, rather than an accident
 * of how imports happened to be spelled.
 * @module lib/compiler/bundle/moduleScope
 */

import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { BuildError } from '../errors/index.js';

/**
 * Matches an `export default` clause.
 * @type {RegExp}
 */
const EXPORT_DEFAULT = /export\s+default\s+/;

/**
 * Matches a leading `export ` on a declaration that keeps its own name.
 * @type {RegExp}
 */
const EXPORT_NAMED = /^[ \t]*export\s+(?=(const|let|var|function|class|async)\b)/gm;

/**
 * Finds the name a module's `export default class X` / `function X` introduces.
 *
 * A guard module is written `export default class AuthGuard extends AvenxGuard`,
 * and the router refers to it by that name. Wrapping the module has to preserve
 * the name, so it has to be recovered from the source.
 * @param {string} source - The module source, after import rewriting.
 * @returns {string|null} The exported declaration's name, or null when the
 *   default export is an expression rather than a named declaration.
 */
export function findDefaultExportName(source) {
  const match = source.match(/export\s+default\s+(?:abstract\s+)?(?:class|function\*?|async\s+function\*?)\s+([\w$]+)/);
  return match ? match[1] : null;
}

/**
 * Wraps a module source so that everything it declares is private except one
 * exported binding.
 *
 * The wrapper is an arrow IIFE rather than a block, because the module's value
 * has to be assignable to the bundle-scope `const` that names it, and because a
 * block would leak `var` and function declarations back into bundle scope —
 * exactly the leak this module exists to stop.
 * @param {object} options - Emission options.
 * @param {string} options.source - Module source with runtime imports already
 *   rewritten to destructuring.
 * @param {string} options.binding - The single name to publish at bundle scope.
 * @param {string} [options.header] - Extra statements to place inside the scope
 *   before the module body, such as aliases for imported bridges.
 * @returns {string} The scoped module source, terminated by a newline.
 */
export function emitScopedModule({ source, binding, header = '' }) {
  let body = source;

  const declaredName = findDefaultExportName(body);

  if (EXPORT_DEFAULT.test(body)) {
    if (declaredName) {
      // `export default class X {}` keeps the declaration and returns the name,
      // so that recursion and static references inside the class still resolve.
      body = body.replace(EXPORT_DEFAULT, '');
      body = `${body}\nreturn ${declaredName};`;
    } else {
      body = body.replace(EXPORT_DEFAULT, 'return ');
    }
  } else if (declaredName) {
    body = `${body}\nreturn ${declaredName};`;
  }

  // Named exports lose the keyword: the IIFE is the module boundary, so there
  // is nowhere for them to be exported to.
  body = body.replace(EXPORT_NAMED, '');

  const lines = [`const ${binding} = (() => {`];
  if (header) {
    lines.push(header);
  }
  lines.push(body.trim());
  lines.push('})();');

  return lines.join('\n') + '\n';
}

/**
 * Tracks the names published at bundle scope so collisions are reported at
 * build time rather than discovered as a `SyntaxError` in a browser.
 */
export class BundleScope {
  /**
   * Creates an empty bundle scope.
   */
  constructor() {
    /**
     * Published binding name to the file that published it.
     * @type {Map<string, string>}
     */
    this.bindings = new Map();
  }

  /**
   * Claims a bundle-scope name for a module.
   * @param {string} name - The binding to publish.
   * @param {string} filePath - The file publishing it, for the error message.
   * @throws {BuildError} When another module already published that name.
   */
  claim(name, filePath) {
    const existing = this.bindings.get(name);
    if (existing && existing !== filePath) {
      throw new BuildError(AvenxErrorCodes.COMPILER_DUPLICATE_BUNDLE_BINDING, name, existing, filePath);
    }
    this.bindings.set(name, filePath);
  }

  /**
   * Whether a name has already been published.
   * @param {string} name - The binding to check.
   * @returns {boolean} True when the name is taken.
   */
  has(name) {
    return this.bindings.has(name);
  }
}
