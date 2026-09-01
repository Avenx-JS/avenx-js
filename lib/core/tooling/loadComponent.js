/**
 * @file loadComponent.js
 * @description Compiles a single Avenx component file into a usable class.
 *
 * Avenx component files are not JavaScript modules. A `.component.js` holds
 * `<state>`, `<action>` and template markup, and only means anything after the
 * compiler has turned it into a class. So a test cannot `import` one — which
 * is a problem for generated regression tests, whose whole purpose is to mount
 * the component a trace was recorded against.
 *
 * This runs the same `ComponentParser` the build uses on one file and
 * evaluates the class it emits. Because it is the real compiler, a generated
 * test exercises the same code the application ships, not a hand-written
 * approximation of it.
 *
 * Lives under `tooling/` rather than `testing/` because it reads from disk:
 * the house rule is that `fs` and `path` stay out of anything the browser
 * runtime can reach.
 * @module lib/core/tooling/loadComponent
 */

import fs from 'fs';
import path from 'path';
import ComponentParser from '../../compiler/ComponentParser.js';
import StyleProcessor from '../../compiler/StyleProcessor.js';
import {
  findBridgeImports,
  bridgeNameFromFile,
  bridgeBindingName,
} from '../../compiler/BridgeParser.js';
import { AvenxComponent } from '../runtime/AvenxComponent.js';
import { AvenxPage } from '../runtime/AvenxPage.js';

/**
 * Derives the class name the compiler will emit for a component file.
 * @param {string} filePath - Path to the component or page file.
 * @returns {string} The PascalCase class name.
 */
export function classNameFor(filePath) {
  return path
    .basename(filePath)
    .replace(/\.(component|page)?\.(js|html|avx)$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Lists the bridges a component file imports.
 *
 * A component that imports a bridge compiles to a class that references a
 * binding the *bundle* supplies. Loading such a component outside a bundle
 * means supplying those bindings, so a caller needs to know which are wanted.
 * @param {string} filePath - Path to the component or page file.
 * @returns {string[]} Bridge names, e.g. `['cart', 'auth']`.
 */
export function bridgeDependencies(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return [];
  }
  const source = fs.readFileSync(resolved, 'utf-8');
  return findBridgeImports(resolved, source).map((entry) => bridgeNameFromFile(entry.resolved));
}

/**
 * Compiles a component or page file and returns the class.
 * @param {string} filePath - Absolute or cwd-relative path to the file.
 * @param {object} [options] - Compilation options.
 * @param {'component'|'page'} [options.type] - Inferred from the filename when omitted.
 * @param {object} [options.config] - Project configuration to compile with.
 * @param {object} [options.bridges] - Bridge instances keyed by bridge name, for a
 *   component that imports one. Import the bridge module and pass its default
 *   export; {@link bridgeDependencies} lists which are needed.
 * @returns {Function} The compiled component or page class.
 * @throws {Error} When the file does not exist, does not compile to a class, or
 *   imports a bridge that was not supplied.
 */
export function loadComponent(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Cannot load component: ${resolved} does not exist.`);
  }

  const type = options.type || (/\.page\.js$/i.test(resolved) ? 'page' : 'component');
  const parser = new ComponentParser(new StyleProcessor({}, options.config || {}), [], options.config || null);
  const source = parser.parse(resolved, type);
  const className = classNameFor(resolved);

  // A component that imports a bridge compiles to a reference to
  // `__avx_bridge_<name>`, which the bundle declares. Outside a bundle those
  // bindings have to be provided, so they become parameters of the factory.
  const required = bridgeDependencies(resolved);
  const supplied = options.bridges || {};
  const missing = required.filter((name) => !(name in supplied));
  if (missing.length > 0) {
    throw new Error(
      `${path.basename(resolved)} imports the bridge${missing.length === 1 ? '' : 's'} ` +
        `${missing.map((name) => `"${name}"`).join(', ')}. Pass ${missing.length === 1 ? 'it' : 'them'} to ` +
        `loadComponent(path, { bridges: { ${missing.join(', ')} } }) — import the bridge module and pass its ` +
        'default export.',
    );
  }

  const bindingNames = required.map(bridgeBindingName);
  const bindingValues = required.map((name) => supplied[name]);

  // The compiler emits `class X extends AvenxComponent { ... }` as a bare
  // declaration, which is exactly what a bundle concatenates. Evaluating it
  // with the base classes and bridge bindings in scope is the same thing the
  // bundle does, and keeps this helper from having to understand the shape of
  // the generated code.
  const factory = new Function(
    'AvenxComponent',
    'AvenxPage',
    ...bindingNames,
    `${source}\nreturn ${className};`,
  );

  const ComponentClass = factory(AvenxComponent, AvenxPage, ...bindingValues);
  if (typeof ComponentClass !== 'function') {
    throw new Error(`Compiling ${resolved} did not produce a class called ${className}.`);
  }
  return ComponentClass;
}
