/**
 * @file treeshake.js
 * @description Decides which modules an application actually needs.
 *
 * ## What was impossible before, and why
 *
 * The build prepended `dist/runtime.min.js` — one pre-bundled blob — to every
 * application. Nothing about that arrangement admits the question "does this
 * application use the trace recorder?", because by the time the compiler ran,
 * the recorder had already been fused into a single artifact. Shaking is not a
 * feature that was missing; it was unaskable.
 *
 * With the runtime consumed as modules the question is answerable, and this
 * file answers it.
 *
 * ## The rule, and its one deliberate departure from the specification
 *
 * Two kinds of edge are treated differently, which is the whole mechanism:
 *
 * - **A plain `import` always executes its target.** That is what ES modules
 *   do, and the runtime depends on it: `reactive/proxyHandler.js` calls
 *   `setPathResolver(getPropertyPath)` at its top level, and that call has to
 *   happen. No analysis here will ever drop a module that something imports.
 *
 * - **A re-export edge is followed only for the names that are needed.** A
 *   barrel is a routing table, and `export { startRecording } from
 *   './trace/recorder.js'` in a barrel nobody asks `startRecording` of is a
 *   route to nowhere. Strictly, the specification says that re-export executes
 *   `recorder.js`; every bundler departs from it here, because otherwise no
 *   barrel is ever shakeable and `avenx-core/runtime` is a barrel.
 *
 * The departure is bounded rather than blanket. A re-export target is still
 * kept when it has a top-level side effect of its own — an expression statement
 * rather than a declaration — or when its package declares itself effectful
 * through `sideEffects` in `package.json`. Exactly one module in the Avenx
 * runtime has such a statement, and it is reached by a plain import anyway.
 *
 * ## What this does not do
 *
 * It does not remove unused *declarations inside* a module that is kept.
 * Statement-level elimination needs a real identifier analysis, and a
 * bundler that guesses at that miscompiles code rather than shrinking it.
 * The honest consequence is stated in the build's own reporting: what
 * shaking removes here is whole modules, and the fixed cost of a module that
 * something imports is its whole source.
 * @module lib/bundler/treeshake
 */

import fs from 'fs';
import path from 'path';

/**
 * The wildcard standing for "every export of this module is needed".
 * @type {string}
 */
const ALL = '*';

/**
 * Whether a module runs code at its top level beyond declaring things.
 *
 * An expression statement at module scope is a side effect: it happens when the
 * module is evaluated and nothing else will make it happen. A declaration is
 * not, even when its initialiser calls something — that is the standard
 * assumption every bundler makes, and abandoning it would keep every module
 * that ever writes `const x = new Thing()`.
 * @param {object} module - A graph module.
 * @returns {boolean} True when the module must run if it is reached at all.
 */
export function hasTopLevelEffects(module) {
  if (module.format !== 'esm') {
    // A CommonJS module's body is an assignment to `module.exports` and
    // whatever else it likes. Nothing here can tell those apart.
    return true;
  }
  return module.record.statements.some(
    (statement) => statement.kind === 'statement' && statement.declares.length === 0,
  );
}

/**
 * Reads the `sideEffects` declaration of the package a module belongs to.
 *
 * `"sideEffects": false` is the convention a package uses to say its modules
 * can be dropped when unused. It is honoured for third-party packages, where
 * this analysis has no other way to know.
 * @param {string} file - Absolute module path.
 * @param {Map<string, boolean|null>} cache - Per-directory answers.
 * @returns {boolean|null} False when the package declares itself pure, true
 *   when it declares effects, null when it says nothing.
 */
function packageSideEffects(file, cache) {
  let dir = path.dirname(file);
  for (;;) {
    if (cache.has(dir)) {
      return cache.get(dir);
    }
    const manifestPath = path.join(dir, 'package.json');
    if (fs.existsSync(manifestPath)) {
      let answer = null;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (manifest.sideEffects === false) answer = false;
        else if (manifest.sideEffects === true) answer = true;
      } catch {
        answer = null;
      }
      cache.set(dir, answer);
      return answer;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      cache.set(dir, null);
      return null;
    }
    dir = parent;
  }
}

/**
 * Works out which modules the bundle must contain.
 * @param {object} options - Shake options.
 * @param {object} options.graph - The linked module graph.
 * @param {string[]} options.order - Modules in emission order.
 * @param {Map<string, string[]>} [options.entryNeeds] - Export names an entry's
 *   consumer requires, keyed by entry id. `['*']` means the whole namespace.
 * @returns {Set<string>} Module ids to emit.
 */
export function shake({ graph, order, entryNeeds = new Map() }) {
  /** @type {Map<string, Set<string>>} */
  const needed = new Map();
  /** @type {Set<string>} */
  const executed = new Set();
  const effectsCache = new Map();

  const need = (id, name) => {
    if (!needed.has(id)) needed.set(id, new Set());
    const set = needed.get(id);
    if (set.has(ALL) || set.has(name)) return false;
    set.add(name);
    return true;
  };

  const queue = [];
  const execute = (id) => {
    if (executed.has(id)) return;
    executed.add(id);
    queue.push(id);
  };

  for (const entry of graph.entries) {
    execute(entry);
    for (const name of entryNeeds.get(entry) || []) {
      need(entry, name);
    }
  }

  /**
   * Whether a module must be kept even though none of its exports are wanted.
   * @param {object} module - The graph module.
   * @returns {boolean} True when dropping it would change behaviour.
   */
  const mustKeep = (module) => {
    const declared = module.external ? packageSideEffects(module.id, effectsCache) : null;
    if (declared === false) return false;
    if (declared === true) return true;
    return hasTopLevelEffects(module);
  };

  while (queue.length > 0) {
    const id = queue.shift();
    const module = graph.modules.get(id);
    if (!module) continue;

    const wanted = needed.get(id) || new Set();

    if (module.format === 'cjs') {
      // Nothing about a CommonJS module's exports is static, so every module it
      // requires is needed.
      for (const target of module.resolved.values()) {
        execute(target);
      }
      continue;
    }

    // A dynamic import needs the whole namespace: nothing here can say which
    // member the awaiting code will read.
    for (const entry of module.record.dynamicImports) {
      const target = entry.specifier === null ? null : module.resolved.get(entry.specifier);
      if (!target) continue;
      execute(target);
      need(target, ALL);
    }

    // A plain import executes its target, exactly as the language says.
    for (const entry of module.record.imports) {
      const target = module.resolved.get(entry.specifier);
      if (!target) continue;
      execute(target);
      if (entry.namespace) need(target, ALL);
      if (entry.defaultLocal) need(target, 'default');
      for (const binding of entry.bindings) {
        need(target, binding.imported);
      }
    }

    // A re-export is followed only for the names something asked for.
    for (const entry of module.record.reExports) {
      const target = module.resolved.get(entry.specifier);
      if (!target) continue;
      const targetModule = graph.modules.get(target);
      const asked = wanted.has(ALL) || wanted.has(entry.exported);
      if (!asked && targetModule && !mustKeep(targetModule)) continue;
      execute(target);
      if (asked) {
        if (need(target, entry.imported) && executed.has(target)) queue.push(target);
      }
    }

    for (const entry of module.record.starReExports) {
      const target = module.resolved.get(entry.specifier);
      if (!target) continue;
      const targetModule = graph.modules.get(target);
      if (!targetModule) continue;

      if (wanted.has(ALL)) {
        execute(target);
        need(target, ALL);
        queue.push(target);
        continue;
      }

      const shared = [...wanted].filter((name) => targetModule.exportNames.has(name));
      if (shared.length === 0 && !mustKeep(targetModule)) continue;
      execute(target);
      for (const name of shared) {
        if (need(target, name)) queue.push(target);
      }
    }
  }

  // Preserve emission order rather than discovery order: the emitter relies on
  // dependencies coming first, and that property belongs to the topological
  // sort, not to this traversal.
  return new Set(order.filter((id) => executed.has(id)));
}
