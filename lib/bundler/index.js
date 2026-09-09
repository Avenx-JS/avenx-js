/**
 * @file index.js
 * @description The Avenx bundler: resolve, link, shake, emit.
 *
 * ## The boundary this file sits on
 *
 * The compiler owns everything Avenx-specific — template compilation,
 * declaration processing, expression handling, Atlas, scoped CSS, the shape of
 * a generated component class. It hands the bundler *modules*: some virtual
 * (the classes it just generated), the rest real files on disk.
 *
 * The bundler owns everything module-specific — resolution, npm packages, the
 * dependency graph, dead-code elimination, format interop, the final script and
 * its source map. It knows nothing about components, bridges or pages, and it
 * must stay that way: the moment the bundler needs to know what a `.page.js` is,
 * the two halves have grown back together.
 *
 * ## Why Avenx has its own
 *
 * The same reason it has its own HTML tokenizer, its own expression parser and
 * its own reference scanner: the build is dependency-free by policy. A bundler
 * is a graph walk, a reachability analysis and a code generator, and each of
 * those is a few hundred lines when it only has to serve one compiler.
 * @module lib/bundler
 */

import { Resolver, ResolveError, isRuntimeSpecifier, AVENX_PACKAGE_ROOT } from './resolve.js';
import { buildGraph, BindingError, DynamicImportError } from './graph.js';
import { emitBundle, EmitError } from './emit.js';
import { shake } from './treeshake.js';
import { minify } from './minify.js';
import { ModuleParseError } from './parseModule.js';

export {
  Resolver,
  ResolveError,
  BindingError,
  DynamicImportError,
  EmitError,
  ModuleParseError,
  isRuntimeSpecifier,
  AVENX_PACKAGE_ROOT,
};

/**
 * Bundles an application from one or more entry modules.
 * @param {object} options - Bundle options.
 * @param {string[]} options.entries - Entry specifiers or absolute paths.
 * @param {Map<string, string>} [options.virtualModules] - Generated module id to source.
 * @param {string} options.rootDir - The project root, for relative paths.
 * @param {boolean} [options.treeShake] - Drop modules nothing needs. Default true.
 * @param {Map<string, string[]>} [options.entryNeeds] - Export names an entry's
 *   consumer requires, so a footer that reads the entry namespace keeps it.
 * @param {boolean} [options.minify] - Strip comments and indentation. Default false.
 * @param {boolean} [options.sourceMap] - Emit a source map. Default false.
 * @param {string} [options.banner] - Text before the bundle.
 * @param {string} [options.footer] - Text after the bundle.
 * @param {string} [options.file] - Output file name, used in the source map.
 * @returns {{code: string, map: object|null, stats: object}} The bundle and what it contains.
 * @throws {ResolveError|BindingError|EmitError|ModuleParseError} When the application does not link.
 */
export function bundle({
  entries,
  virtualModules = new Map(),
  rootDir,
  treeShake = true,
  entryNeeds = new Map(),
  minify: shouldMinify = false,
  sourceMap = false,
  banner = '',
  footer = '',
  file = 'bundle.js',
}) {
  const resolver = new Resolver({ virtualModules, roots: [rootDir] });
  const resolvedEntries = entries.map((entry) =>
    virtualModules.has(entry) ? entry : resolver.resolve(entry, `${rootDir}/__avenx_entry__.js`),
  );

  const { graph, order } = buildGraph({ entries: resolvedEntries, resolver });

  const included = treeShake ? shake({ graph, order, entryNeeds }) : new Set(order);

  const emitted = emitBundle({
    graph,
    order,
    included,
    banner,
    footer,
    rootDir,
    sourceMap,
    file,
  });

  // Minification preserves line count, so the map stays valid for either form.
  const code = shouldMinify ? minify(emitted.code) : emitted.code;

  return {
    code,
    map: emitted.map,
    stats: {
      modulesInGraph: graph.modules.size,
      modulesEmitted: emitted.modules,
      modulesShaken: graph.modules.size - emitted.modules,
      cycles: graph.cycles.length,
      externals: [...graph.modules.values()].filter((module) => module.external && included.has(module.id)).length,
      bytes: Buffer.byteLength(code, 'utf-8'),
    },
    graph,
    included,
  };
}
