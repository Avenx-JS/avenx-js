/**
 * Rewrites Avenx runtime imports into destructuring from the global namespace.
 *
 * A compiled application is one concatenated script, so the `import`
 * statements in `main.app.js`, guard modules and bridge modules cannot survive
 * as imports. They used to be deleted outright, which left the imported names
 * resolving to bare globals — and worked only because the runtime copied all
 * 67 of its exports onto `globalThis`.
 *
 * Rewriting instead of deleting means an import keeps meaning what it says:
 *
 *   import { logger, LruCache } from 'avenx-core/runtime';
 *   -> const { logger, LruCache } = Avenx;
 *
 * so the runtime only has to publish a namespace, not its whole surface.
 * @module lib/compiler/runtimeImports
 */

import { NAMESPACE_GLOBAL } from '../core/globals.js';

/**
 * Matches an import whose specifier resolves to the Avenx runtime entry.
 * @type {RegExp}
 */
const RUNTIME_SPECIFIER = /^(avenx-core(\/(runtime|core))?|.*\/lib\/core(\/index\.js)?)$/;

/**
 * Matches a complete import statement, capturing its clause and specifier.
 * @type {RegExp}
 */
const IMPORT_STATEMENT = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];?/g;

/**
 * Converts an import clause into a destructuring pattern.
 *
 * `{ a, b as c }` becomes `{ a, b: c }`. A namespace clause (`* as Avenx`)
 * binds the namespace object itself. A bare specifier with no clause
 * contributes nothing.
 * @param {string} clause - The text between `import` and `from`.
 * @returns {string|null} A destructuring pattern, an identifier, or null.
 */
function clauseToPattern(clause) {
  const trimmed = (clause || '').trim();
  if (!trimmed) {
    return null;
  }

  const namespaceMatch = trimmed.match(/^\*\s+as\s+([\w$]+)$/);
  if (namespaceMatch) {
    return namespaceMatch[1];
  }

  const namedMatch = trimmed.match(/\{([\s\S]*?)\}/);
  if (!namedMatch) {
    // A default import. The runtime entry has no default export, so there is
    // nothing to bind.
    return null;
  }

  const bindings = namedMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const aliased = part.split(/\s+as\s+/);
      return aliased.length === 2 ? `${aliased[0].trim()}: ${aliased[1].trim()}` : aliased[0].trim();
    });

  return bindings.length > 0 ? `{ ${bindings.join(', ')} }` : null;
}

/**
 * Reports whether a specifier points at the Avenx runtime.
 * @param {string} specifier - The import specifier.
 * @returns {boolean} True when the import targets the runtime entry.
 */
export function isRuntimeSpecifier(specifier) {
  return RUNTIME_SPECIFIER.test(specifier);
}

/**
 * Rewrites runtime imports and removes every other import statement.
 *
 * Non-runtime imports are relative references to components, pages and bridges,
 * which the compiler resolves by concatenation rather than by module
 * resolution, so they are dropped as they always have been.
 * @param {string} source - The module source.
 * @returns {string} The source with imports rewritten or removed.
 */
export function rewriteRuntimeImports(source) {
  if (!source) {
    return source;
  }

  return source.replace(IMPORT_STATEMENT, (statement, clause, specifier) => {
    if (!isRuntimeSpecifier(specifier)) {
      return '';
    }

    const pattern = clauseToPattern(clause);
    if (!pattern) {
      return '';
    }

    return `const ${pattern} = ${NAMESPACE_GLOBAL};`;
  });
}
