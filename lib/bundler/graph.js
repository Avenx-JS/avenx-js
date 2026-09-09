/**
 * @file graph.js
 * @description Builds the module graph an Avenx application actually has.
 *
 * ## The invariant this file exists to establish
 *
 * ```text
 * avenx build reports success  =>  every import in the application resolved,
 *                                  and every name it imported is exported
 * ```
 *
 * The concatenator could not state anything of the kind. It had no graph: it
 * read a directory, appended text, and deleted the imports it did not
 * recognise. An import that named nothing and an import that named a real
 * package produced the same output — none — so "the build succeeded" carried
 * no information about whether the application could start.
 *
 * Here, loading a module means resolving each of its specifiers. A specifier
 * that resolves to nothing throws, with the importer and the reason. Nothing is
 * skipped, and there is no path through this file that drops an edge.
 *
 * ## Binding validation
 *
 * Real ES modules are checked further: `import { formt } from './format.js'`
 * fails at link time in a browser, so it fails here, with the near-miss
 * suggested. CommonJS modules are exempt because their exports are a runtime
 * object rather than a declaration — claiming to know them statically would
 * produce confident false positives, which is worse than not checking.
 *
 * ## Cycles
 *
 * Cycles are legal ES modules and the runtime contains one
 * (`reactive/watcher.js` ↔ `trace/reactive.js`), so refusing them is not an
 * option. They are detected, recorded per edge, and handed to the emitter,
 * which reproduces the only guarantee the language itself makes across a cycle:
 * function declarations hoist, so a cyclic import of a function works and a
 * cyclic import of a class or a `const` is a temporal dead zone. The emitter
 * mirrors that exactly rather than inventing a weaker rule.
 * @module lib/bundler/graph
 */

import fs from 'fs';
import { parseModule } from './parseModule.js';
import { CodeMask } from './scanner.js';
import { ResolveError } from './resolve.js';

/**
 * Keys an edge for the cyclic-edge set.
 *
 * A NUL separator rather than a space, because module ids are file paths and a
 * path may legitimately contain spaces.
 * @param {string} from - Importing module id.
 * @param {string} to - Imported module id.
 * @returns {string} The edge key.
 */
function edgeKey(from, to) {
  return `${from}\u0000${to}`;
}

/**
 * Signals that a module imports a name its source does not export.
 */
export class BindingError extends Error {
  /**
   * @param {string} message - The diagnostic.
   * @param {string} importer - The module doing the importing.
   * @param {string} specifier - The specifier it imported from.
   * @param {string} name - The missing export.
   */
  constructor(message, importer, specifier, name) {
    super(message);
    this.name = 'BindingError';
    /** @type {string} */
    this.importer = importer;
    /** @type {string} */
    this.specifier = specifier;
    /** @type {string} */
    this.missing = name;
  }
}

/**
 * Detects whether a source is CommonJS rather than an ES module.
 *
 * ES syntax wins outright: a file with `import` or `export` declarations is a
 * module regardless of what else it contains. Only when there are none does a
 * `module.exports`, `exports.x` or `require(` marker make it CommonJS.
 * @param {object} record - The parsed module record.
 * @param {string} source - The module source.
 * @param {string} file - The module path, for extension hints.
 * @returns {'esm'|'cjs'} The module format.
 */
export function detectFormat(record, source, file) {
  if (file.endsWith('.cjs')) {
    return 'cjs';
  }
  if (file.endsWith('.mjs')) {
    return 'esm';
  }
  const hasEsm =
    record.imports.length > 0 ||
    record.exports.length > 0 ||
    record.reExports.length > 0 ||
    record.starReExports.length > 0;
  if (hasEsm) {
    return 'esm';
  }
  return /\bmodule\.exports\b|\bexports\.[A-Za-z_$]|\brequire\s*\(/.test(source) ? 'cjs' : 'esm';
}

/**
 * Finds the static `require()` specifiers in a CommonJS module.
 *
 * A CommonJS dependency is as real as an ES one, so it belongs in the graph.
 * Only literal specifiers are collected: `require(name)` with a computed
 * argument cannot be resolved at build time by anyone, and pretending otherwise
 * would produce a confident wrong answer.
 * @param {string} source - The module source.
 * @returns {string[]} Distinct specifiers, in source order.
 */
function collectRequires(source) {
  const mask = new CodeMask(source);
  const text = mask.withoutComments();
  const pattern = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  const found = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // The specifier itself sits inside a string, so test the `require` keyword.
    if (!mask.isCode(match.index)) continue;
    if (!found.includes(match[2])) found.push(match[2]);
  }
  return found;
}

/**
 * Suggests the closest name to a missing one, for a diagnostic.
 * @param {string} name - The name that was not found.
 * @param {string[]} candidates - Names that do exist.
 * @returns {string} A suggestion clause, or an empty string.
 */
function suggest(name, candidates) {
  const lower = name.toLowerCase();
  const near = candidates.find(
    (candidate) =>
      candidate.toLowerCase() === lower ||
      (Math.abs(candidate.length - name.length) <= 2 && candidate.toLowerCase().startsWith(lower.slice(0, 3))),
  );
  return near ? ` Did you mean "${near}"?` : '';
}

/**
 * One module in the graph.
 * @typedef {object} GraphModule
 * @property {string} id - Resolved module id.
 * @property {string} source - Module source.
 * @property {'esm'|'cjs'} format - How the module declares its exports.
 * @property {object} record - The parsed module structure.
 * @property {Map<string, string>} resolved - Specifier to resolved module id.
 * @property {boolean} virtual - Whether the compiler generated this module.
 * @property {Set<string>} exportNames - Every name the module exports.
 * @property {boolean} external - Whether the module came from node_modules.
 */

/**
 * The module graph for one bundle.
 */
export class ModuleGraph {
  /**
   * @param {object} options - Graph options.
   * @param {import('./resolve.js').Resolver} options.resolver - Specifier resolution.
   */
  constructor({ resolver }) {
    /** @type {import('./resolve.js').Resolver} */
    this.resolver = resolver;
    /** @type {Map<string, GraphModule>} */
    this.modules = new Map();
    /** @type {string[]} */
    this.entries = [];
    /** @type {Array<string[]>} */
    this.cycles = [];
    /** @type {Set<string>} */
    this.cyclicEdges = new Set();
  }

  /**
   * Reads a module's source, from the virtual table or from disk.
   * @param {string} id - The module id.
   * @returns {string} The source text.
   * @private
   */
  readSource(id) {
    if (this.resolver.isVirtual(id)) {
      return this.resolver.virtualModules.get(id);
    }
    return fs.readFileSync(id, 'utf-8');
  }

  /**
   * Loads a module and, transitively, everything it imports.
   * @param {string} id - The resolved module id.
   * @returns {GraphModule} The loaded module.
   * @throws {ResolveError} When one of its specifiers resolves to nothing.
   * @private
   */
  load(id) {
    const existing = this.modules.get(id);
    if (existing) {
      return existing;
    }

    const source = this.readSource(id);
    const record = parseModule(source, id);
    const format = detectFormat(record, source, id);

    /** @type {GraphModule} */
    const module = {
      id,
      source,
      format,
      record,
      resolved: new Map(),
      virtual: this.resolver.isVirtual(id),
      exportNames: new Set(),
      external: id.includes('node_modules'),
    };
    this.modules.set(id, module);

    const specifiers = format === 'esm' ? record.dependencies : collectRequires(source);
    for (const specifier of specifiers) {
      const target = this.resolver.resolve(specifier, id);
      module.resolved.set(specifier, target);
      this.load(target);
    }

    return module;
  }

  /**
   * Adds an entry module and everything reachable from it.
   * @param {string} id - The resolved entry id.
   * @returns {GraphModule} The entry module.
   */
  addEntry(id) {
    const module = this.load(id);
    if (!this.entries.includes(id)) {
      this.entries.push(id);
    }
    return module;
  }

  /**
   * Computes each module's export names, following re-exports and `export *`.
   *
   * Runs after every module is loaded, because `export * from './x.js'` cannot
   * be answered until `x.js` itself has been read.
   * @returns {void}
   */
  resolveExportNames() {
    const inProgress = new Set();

    const compute = (id) => {
      const module = this.modules.get(id);
      if (!module || module.exportNames.size > 0 || inProgress.has(id)) {
        return module ? module.exportNames : new Set();
      }
      inProgress.add(id);

      if (module.format === 'cjs') {
        // A CommonJS module's shape is a runtime value. `default` is the whole
        // exports object and named access is checked by nothing here, which is
        // honest: the alternative is a static claim that cannot be true.
        module.exportNames.add('default');
        module.exportNames.add('*');
      } else {
        for (const entry of module.record.exports) {
          module.exportNames.add(entry.exported);
        }
        for (const entry of module.record.reExports) {
          module.exportNames.add(entry.exported);
        }
        for (const entry of module.record.starReExports) {
          const target = module.resolved.get(entry.specifier);
          if (!target) continue;
          for (const name of compute(target)) {
            // `export *` never re-exports `default`.
            if (name !== 'default') module.exportNames.add(name);
          }
        }
      }

      inProgress.delete(id);
      return module.exportNames;
    };

    for (const id of this.modules.keys()) {
      compute(id);
    }
  }

  /**
   * Checks that every imported name is actually exported.
   *
   * Only ES modules are checked, and only when the *target* is an ES module: a
   * CommonJS target has no static export list, and a wildcard entry (`*`)
   * stands for "cannot be known".
   * @returns {void}
   * @throws {BindingError} When a module imports a name that does not exist.
   */
  validateBindings() {
    for (const module of this.modules.values()) {
      if (module.format !== 'esm') continue;

      const check = (specifier, imported, label) => {
        const targetId = module.resolved.get(specifier);
        const target = targetId && this.modules.get(targetId);
        if (!target || target.format !== 'esm' || target.exportNames.has('*')) return;
        if (imported === '*' || target.exportNames.has(imported)) return;

        const available = [...target.exportNames].sort();
        throw new BindingError(
          `${label} "${imported}" from "${specifier}", but that module does not export it.` +
            suggest(imported, available) +
            (available.length > 0
              ? `\nIt exports: ${available.join(', ')}`
              : '\nIt exports nothing.'),
          module.id,
          specifier,
          imported,
        );
      };

      for (const entry of module.record.imports) {
        if (entry.namespace) continue;
        if (entry.defaultLocal) check(entry.specifier, 'default', 'imports');
        for (const binding of entry.bindings) {
          check(entry.specifier, binding.imported, 'imports');
        }
      }
      for (const entry of module.record.reExports) {
        check(entry.specifier, entry.imported, 're-exports');
      }
    }
  }

  /**
   * Orders modules so a dependency is emitted before its dependants.
   *
   * Depth-first post-order. When the walk meets a module already on the stack
   * it has found a cycle: the cycle is recorded for diagnostics and the edge
   * that closes it is marked, so the emitter knows which bindings cannot be
   * read at module-initialisation time.
   * @returns {string[]} Module ids in emission order.
   */
  topologicalOrder() {
    const order = [];
    const state = new Map();
    const stack = [];

    const visit = (id) => {
      const current = state.get(id);
      if (current === 'done') return;
      if (current === 'active') {
        const start = stack.indexOf(id);
        const cycle = stack.slice(start).concat(id);
        this.cycles.push(cycle);
        this.cyclicEdges.add(edgeKey(stack[stack.length - 1], id));
        return;
      }

      state.set(id, 'active');
      stack.push(id);

      const module = this.modules.get(id);
      if (module) {
        for (const target of module.resolved.values()) {
          visit(target);
        }
      }

      stack.pop();
      state.set(id, 'done');
      order.push(id);
    };

    for (const entry of this.entries) {
      visit(entry);
    }

    return order;
  }

  /**
   * Whether an edge closes a cycle.
   * @param {string} from - Importing module id.
   * @param {string} to - Imported module id.
   * @returns {boolean} True when the import is a back edge.
   */
  isCyclicEdge(from, to) {
    return this.cyclicEdges.has(edgeKey(from, to));
  }
}

/**
 * Builds a graph from one or more entry modules.
 * @param {object} options - Build options.
 * @param {string[]} options.entries - Resolved entry module ids.
 * @param {import('./resolve.js').Resolver} options.resolver - Specifier resolution.
 * @param {boolean} [options.validate] - Whether to check imported names exist.
 * @returns {{graph: ModuleGraph, order: string[]}} The graph and its emission order.
 * @throws {ResolveError|BindingError} When the application does not link.
 */
export function buildGraph({ entries, resolver, validate = true }) {
  const graph = new ModuleGraph({ resolver });

  for (const entry of entries) {
    graph.addEntry(entry);
  }

  graph.resolveExportNames();
  if (validate) {
    graph.validateBindings();
  }

  const order = graph.topologicalOrder();
  return { graph, order };
}

export { ResolveError };
