/**
 * @file emit.js
 * @description Renders a linked module graph into one classic script.
 *
 * ## The output shape, and why
 *
 * One outer IIFE. Inside it, each module is an inner IIFE assigned to a `var`,
 * emitted in dependency order:
 *
 * ```js
 * (function () {
 *   'use strict';
 *   var __avx3 = (function () { var __x = {}; ...body...; return __x; })();
 *   var __avx7 = (function () { var { thing } = __avx3; ...body...; })();
 * })();
 * ```
 *
 * `var` rather than `const` is load-bearing: `var` hoists to the top of the
 * outer function, so a module emitted *before* its dependency — which happens
 * exactly once per cycle — can still name it. The binding is `undefined` at
 * that moment and holds the exports object by the time anything dereferences
 * it, which is the same shape the language itself has across a cycle.
 *
 * ## Three problems this file has to get right
 *
 * **Live bindings.** `reactive/watcher.js` has `export let activeWatcher`, it
 * reassigns it, and `runtime/AvenxComponent.js` reads it across the module
 * boundary to decide whether it is inside its own render. Copying the value at
 * import time would capture `null` forever and break that check silently. So a
 * mutable exported binding is *hoisted out of its module* into bundle scope
 * under its own name: the exporter's assignments and every importer's reads
 * then resolve to one variable through the ordinary scope chain, with no
 * identifier rewriting anywhere. Exports are exposed as getters for the same
 * reason, so a namespace or a re-export barrel sees the current value.
 *
 * **Cycles.** Across the one edge that closes a cycle, the dependency's
 * exports object does not exist yet. ES modules make exactly one guarantee
 * there — function declarations hoist — so this emitter reproduces exactly
 * that: a cyclic import of a function becomes a forwarder that dereferences on
 * call, and a cyclic import of anything else is a build error, because in a
 * browser it would be a temporal dead zone.
 *
 * **Line fidelity.** Every rewritten declaration is emitted on a single line
 * and padded back to the line count it replaced, so a module's body keeps a
 * 1:1 line correspondence with its source. That is what makes the source map
 * exact and a production stack trace point at a line the developer wrote.
 * @module lib/bundler/emit
 */

import path from 'path';

/**
 * Raised when a graph cannot be rendered into a correct bundle.
 */
export class EmitError extends Error {
  /**
   * @param {string} message - What cannot be emitted, and why.
   * @param {string} [file] - The module responsible.
   * @param {'cycle'|'live-binding-alias'|'live-binding-collision'} [kind] - Which
   *   condition was hit, so a caller can map it onto its own diagnostics
   *   without matching on the message text.
   */
  constructor(message, file = '', kind = 'cycle') {
    super(message);
    this.name = 'EmitError';
    /** @type {string} */
    this.file = file;
    /** @type {string} */
    this.kind = kind;
    /** @type {Array<string[]>} */
    this.cycles = [];
  }
}

/**
 * Counts the lines a chunk of text occupies.
 * @param {string} text - The text.
 * @returns {number} Line count, minimum one.
 */
function lineCount(text) {
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') lines += 1;
  }
  return lines;
}

/**
 * Pads generated text so it occupies the same number of lines it replaced.
 * @param {string} generated - Replacement text, expected to be one line.
 * @param {string} original - The text being replaced.
 * @returns {string} The replacement, newline-padded.
 */
function padToLines(generated, original) {
  const want = lineCount(original);
  const have = lineCount(generated);
  return have >= want ? generated : generated + '\n'.repeat(want - have);
}

/**
 * A valid JavaScript identifier for a module's exports object.
 * @param {number} index - The module's index in emission order.
 * @returns {string} The binding name.
 */
function moduleBinding(index) {
  return `__avx${index}`;
}

/**
 * Finds the exported bindings a module can reassign.
 *
 * Only `let` and `var` declarations qualify. A `const`, a `function` and a
 * `class` binding cannot be reassigned, so copying their value at import time
 * is indistinguishable from a live binding and costs nothing.
 * @param {object} module - A graph module.
 * @returns {Set<string>} Names that must live at bundle scope.
 */
export function mutableExports(module) {
  const names = new Set();
  if (module.format !== 'esm') {
    return names;
  }
  for (const statement of module.record.statements) {
    if (statement.kind !== 'export-declaration') continue;
    const text = module.source.slice(statement.bodyStart, statement.end).trimStart();
    if (/^(let|var)\b/.test(text)) {
      for (const name of statement.declares) {
        names.add(name);
      }
    }
  }
  return names;
}

/**
 * The local name under which a module declares an exported function.
 *
 * This is the question that decides whether a cyclic import is legal, so it is
 * answered from the declaration rather than guessed from usage: only a function
 * declaration is initialised before any module body runs, which is the one
 * guarantee ES modules make across a cycle.
 * @param {object} module - The exporting graph module.
 * @param {string} exported - The exported name.
 * @returns {string|null} The local declaration name, or null when the export is
 *   not a function declaration.
 */
function functionExportLocal(module, exported) {
  if (!module || module.format !== 'esm') {
    return null;
  }
  for (const statement of module.record.statements) {
    const isDefault = statement.kind === 'export-default';
    if (statement.kind !== 'export-declaration' && !isDefault) continue;
    if (isDefault ? exported !== 'default' : !statement.declares.includes(exported)) continue;
    const text = module.source.slice(statement.bodyStart, statement.end).trimStart();
    if (/^(async\s+)?function\b/.test(text)) {
      return isDefault ? statement.declares[0] || null : exported;
    }
  }
  return null;
}

/**
 * Renders one module's body with its declarations rewritten.
 * @param {object} context - Emission context.
 * @param {object} context.module - The graph module.
 * @param {object} context.graph - The module graph.
 * @param {Map<string, number>} context.indexOf - Module id to emission index.
 * @param {Set<string>} context.hoisted - Names living at bundle scope.
 * @param {Set<string>} context.included - Module ids that reached the bundle.
 * @param {function(string, string): string} context.slotFor - Allocates a
 *   bundle-scope slot for a function crossing a cycle.
 * @returns {string} The transformed module body.
 * @throws {EmitError} When a construct cannot be rendered correctly.
 */
function renderEsmBody({ module, graph, indexOf, hoisted, included, slotFor }) {
  const source = module.source;
  const pieces = [];
  const trailing = [];
  let cursor = 0;

  /**
   * The bundle-scope binding for a specifier this module imports.
   * @param {string} specifier - The specifier as written.
   * @returns {{name: string, target: object, cyclic: boolean}} Binding details.
   */
  const targetOf = (specifier) => {
    const id = module.resolved.get(specifier);
    const target = graph.modules.get(id);
    return {
      name: moduleBinding(indexOf.get(id)),
      target,
      id,
      cyclic: graph.isCyclicEdge(module.id, id),
      included: included.has(id),
    };
  };

  /**
   * Declares one export on the module's exports object, live.
   * @param {string} exported - The exported name.
   * @param {string} expression - An expression yielding the current value.
   */
  const declareExport = (exported, expression) => {
    trailing.push(`__avx_def(__x, ${JSON.stringify(exported)}, function () { return ${expression}; });`);
  };

  // Statement rewrites and dynamic-import rewrites are one ordered list. A
  // dynamic import lives inside an ordinary statement, which is copied
  // verbatim, so the two never overlap -- but they have to be applied in
  // source order for the cursor to stay monotonic.
  const edits = [
    ...module.record.statements
      .filter((statement) => statement.kind !== 'statement')
      .map((statement) => ({ start: statement.start, end: statement.end, statement })),
    ...module.record.dynamicImports.map((entry) => ({ start: entry.start, end: entry.end, dynamic: entry })),
  ].sort((a, b) => a.start - b.start);

  for (const edit of edits) {
    pieces.push(source.slice(cursor, edit.start));
    const original = source.slice(edit.start, edit.end);

    if (edit.dynamic) {
      const { name, target, included: present } = targetOf(edit.dynamic.specifier);
      // Everything is in one chunk, so the module is already evaluated by the
      // time anything can await it. `import()` therefore resolves immediately
      // with the namespace, which is the correct observable behaviour for an
      // unsplit build -- what is missing is a separate chunk, not the semantics.
      const namespace = target && target.format === 'cjs' ? `{ default: ${name} }` : name;
      pieces.push(padToLines(present ? `Promise.resolve(${namespace})` : 'Promise.resolve({})', original));
      cursor = edit.end;
      continue;
    }

    const statement = edit.statement;
    let replacement;

    if (statement.kind === 'import') {
      const entry = module.record.imports.find((item) => item.start === statement.start);
      const { name, target, cyclic, included: present } = targetOf(entry.specifier);

      if (!present) {
        // The dependency was shaken out because nothing this module keeps uses
        // it. Its bindings are unreachable by construction, so there is
        // nothing to declare.
        replacement = '';
      } else if (entry.sideEffectOnly) {
        // Ordering already guarantees the module ran; naming it keeps the
        // dependency visible in the output.
        replacement = `/* side-effect import: ${entry.specifier} */ void ${name};`;
      } else {
        const parts = [];
        const plain = [];

        if (entry.namespace) {
          parts.push(`var ${entry.namespace} = ${name};`);
        }
        if (entry.defaultLocal) {
          if (cyclic) {
            parts.push(cyclicBinding(entry.defaultLocal, 'default', target, module, slotFor));
          } else {
            // A CommonJS module's default export is its `module.exports`
            // object itself, which is what `__avxN` already holds.
            const value = target && target.format === 'cjs' ? name : `${name}.default`;
            parts.push(`var ${entry.defaultLocal} = ${value};`);
          }
        }

        for (const binding of entry.bindings) {
          if (hoisted.has(binding.imported)) {
            if (binding.imported === binding.local) {
              // A live binding lives at bundle scope under this exact name, so
              // the reference resolves through the scope chain and stays live.
              // Declaring anything here would shadow it with a stale copy.
              continue;
            }
            throw new EmitError(
              `"${binding.imported}" is a live binding and cannot be imported under the alias "${binding.local}". ` +
                'Import it under its own name so it keeps resolving to the one variable that holds it.',
              module.id,
              'live-binding-alias',
            );
          }
          if (cyclic) {
            parts.push(cyclicBinding(binding.local, binding.imported, target, module, slotFor));
          } else {
            plain.push(binding);
          }
        }

        if (plain.length > 0) {
          const pattern = plain
            .map((binding) => (binding.imported === binding.local ? binding.local : `${binding.imported}: ${binding.local}`))
            .join(', ');
          parts.push(`var { ${pattern} } = ${name};`);
        }
        replacement = parts.join(' ');
      }
    } else if (statement.kind === 'export-declaration') {
      const body = source.slice(statement.bodyStart, statement.end);
      const isMutable = /^\s*(let|var)\b/.test(body);
      if (isMutable) {
        // Hoisted to bundle scope: drop the declaration keyword so the
        // assignment targets the outer variable rather than a module-local
        // shadow of it.
        replacement = body.replace(/^(\s*)(let|var)\s+/, '$1');
        if (!/=/.test(replacement)) {
          replacement = '';
        }
      } else {
        replacement = body;
      }
      for (const name of statement.declares) {
        declareExport(name, name);
      }
    } else if (statement.kind === 'export-default') {
      const body = source.slice(statement.bodyStart, statement.end);
      if (statement.declares.length > 0) {
        replacement = body;
        declareExport('default', statement.declares[0]);
      } else {
        const expression = body.replace(/;\s*$/, '');
        replacement = `var __avx_default = ${expression};`;
        declareExport('default', '__avx_default');
      }
    } else if (statement.kind === 'export-list') {
      for (const entry of statement.entries || []) {
        declareExport(entry.exported, entry.local);
      }
      replacement = '';
    } else if (statement.kind === 'reexport') {
      for (const entry of statement.reExportEntries || []) {
        const { name, included: present } = targetOf(entry.specifier);
        if (!present) continue;
        // `export * as ns from 'm'` re-exports the namespace object itself.
        const value = entry.imported === '*' ? name : `${name}[${JSON.stringify(entry.imported)}]`;
        declareExport(entry.exported, value);
      }
      replacement = '';
    } else if (statement.kind === 'star-reexport') {
      const { name, target, included: present } = targetOf(statement.starSpecifier);
      if (present && target) {
        // Expanded to explicit getters rather than a runtime copy loop: the
        // names are known here, and a copy would freeze a live binding.
        for (const exported of target.exportNames) {
          if (exported === 'default' || exported === '*') continue;
          declareExport(exported, `${name}[${JSON.stringify(exported)}]`);
        }
      }
      replacement = '';
    } else {
      replacement = original;
    }

    pieces.push(padToLines(replacement, original));
    cursor = statement.end;
  }

  pieces.push(source.slice(cursor));
  if (trailing.length > 0) {
    pieces.push(`\n${trailing.join('\n')}\n`);
  }
  return pieces.join('');
}

/**
 * Builds a binding for an import that crosses a cycle.
 *
 * The dependency's *exports object* does not exist yet at this point — the
 * importing module is running inside the call that will produce it — so the
 * forwarder cannot go through it. It goes through a bundle-scope slot instead,
 * which the exporting module fills from its hoisted function declaration before
 * its own body runs. That is exactly the order ES modules use, so a cyclic call
 * that works in a browser works here and one that does not, does not.
 * @param {string} local - The local name to declare.
 * @param {string} imported - The name being imported.
 * @param {object} target - The exporting graph module.
 * @param {object} importer - The importing graph module.
 * @param {function(string, string): string} slotFor - Allocates the shared slot.
 * @returns {string} The declaration.
 * @throws {EmitError} When the binding cannot legally cross a cycle.
 */
function cyclicBinding(local, imported, target, importer, slotFor) {
  const declared = functionExportLocal(target, imported);
  if (!declared) {
    throw new EmitError(
      `"${imported}" is imported across a module cycle but is not a function declaration.\n` +
        'Only function declarations are initialised before a module body runs, so reading anything ' +
        'else across a cycle is a temporal dead zone in a browser too. Break the cycle, or move the ' +
        'value behind a function.',
      importer.id,
    );
  }
  const slot = slotFor(target.id, imported);
  return `var ${local} = function () { return ${slot}.apply(this, arguments); };`;
}

/**
 * Wraps a CommonJS module so the bundle can evaluate it.
 * @param {object} context - Emission context.
 * @param {object} context.module - The graph module.
 * @param {Map<string, number>} context.indexOf - Module id to emission index.
 * @param {Set<string>} context.included - Module ids in the bundle.
 * @returns {string} The wrapped body.
 */
function renderCjsBody({ module, indexOf, included }) {
  const cases = [];
  for (const [specifier, id] of module.resolved) {
    if (!included.has(id)) continue;
    cases.push(`if (id === ${JSON.stringify(specifier)}) return ${moduleBinding(indexOf.get(id))};`);
  }

  return [
    'var module = { exports: {} }, exports = module.exports;',
    `function require(id) { ${cases.join(' ')} throw new Error('Cannot find module ' + id); }`,
    'void require;',
    module.source,
    'return module.exports;',
  ].join('\n');
}

/**
 * The prelude every bundle carries.
 *
 * One helper, five lines. A module system that needs more machinery than this
 * at runtime has moved work out of the build that belonged in it.
 * @type {string}
 */
const PRELUDE = `var __avx_def = function (target, name, get) {
  Object.defineProperty(target, name, { enumerable: true, configurable: true, get: get });
};`;

/**
 * Renders a linked graph into a single classic script.
 * @param {object} options - Emission options.
 * @param {object} options.graph - The module graph.
 * @param {string[]} options.order - Module ids in emission order.
 * @param {Set<string>} [options.included] - Modules that survived tree shaking.
 * @param {string} [options.banner] - Text placed before the outer IIFE.
 * @param {string} [options.footer] - Text placed inside the outer IIFE, after
 *   every module, where it can read `__avx_entry`.
 * @param {string} [options.rootDir] - Root for source-map paths.
 * @param {boolean} [options.sourceMap] - Whether to build a source map.
 * @param {string} [options.file] - Output file name, for the map.
 * @returns {{code: string, map: object|null, modules: number}} The bundle.
 * @throws {EmitError} When the graph cannot be rendered correctly.
 */
export function emitBundle({
  graph,
  order,
  included = null,
  banner = '',
  footer = '',
  rootDir = process.cwd(),
  sourceMap = false,
  file = 'bundle.js',
}) {
  const present = included || new Set(order);
  const emitted = order.filter((id) => present.has(id));
  const indexOf = new Map(emitted.map((id, index) => [id, index]));

  // Every mutable exported binding in the bundle lives at bundle scope, so the
  // exporter's writes and the importers' reads are the same variable.
  const hoisted = new Set();
  const hoistedOwner = new Map();
  for (const id of emitted) {
    const module = graph.modules.get(id);
    for (const name of mutableExports(module)) {
      if (hoistedOwner.has(name) && hoistedOwner.get(name) !== id) {
        throw new EmitError(
          `two modules export a mutable binding named "${name}":\n  ${hoistedOwner.get(name)}\n  ${id}\n` +
            'A live binding is hoisted to bundle scope under its own name, so the two would collide. ' +
            'Rename one of them.',
          id,
          'live-binding-collision',
        );
      }
      hoisted.add(name);
      hoistedOwner.set(name, id);
    }
  }

  // Functions reached across a cycle are published into a bundle-scope slot by
  // the module that declares them, before its body runs. `slots` is keyed by
  // module id and export name so one function is published once however many
  // cyclic importers it has.
  /** @type {Map<string, string>} */
  const slots = new Map();
  /** @type {Map<string, Array<{slot: string, local: string}>>} */
  const slotsByModule = new Map();
  const slotFor = (moduleId, exported) => {
    const key = `${moduleId}\u0000${exported}`;
    const existing = slots.get(key);
    if (existing) return existing;
    const slot = `__avx_fn${slots.size}`;
    slots.set(key, slot);
    const declared = functionExportLocal(graph.modules.get(moduleId), exported);
    if (!slotsByModule.has(moduleId)) slotsByModule.set(moduleId, []);
    slotsByModule.get(moduleId).push({ slot, local: declared });
    return slot;
  };

  const lines = [];
  /** @type {Array<{module: string, outputLine: number, lines: number}>} */
  const segments = [];

  const push = (text) => {
    lines.push(text);
  };

  if (banner) push(banner);
  push('(function () {');
  push("'use strict';");
  push(PRELUDE);
  if (hoisted.size > 0) {
    push(`var ${[...hoisted].join(', ')};`);
  }

  const currentLine = () => lines.join('\n').split('\n').length;

  let bodies;
  try {
    bodies = emitted.map((id) => {
      const module = graph.modules.get(id);
      return {
        id,
        module,
        body:
          module.format === 'cjs'
            ? renderCjsBody({ module, indexOf, included: present })
            : renderEsmBody({ module, graph, indexOf, hoisted, included: present, slotFor }),
      };
    });
  } catch (error) {
    // The cycles travel with the error so a caller can describe the failure in
    // its own vocabulary -- Avenx reports a cycle between two bridges as a
    // bridge problem, which is what the developer was actually writing.
    if (error instanceof EmitError) {
      error.cycles = graph.cycles;
    }
    throw error;
  }

  if (slots.size > 0) {
    push(`var ${[...slots.values()].join(', ')};`);
  }

  for (const { id, module, body } of bodies) {
    const binding = moduleBinding(indexOf.get(id));
    const label = module.virtual ? id : path.relative(rootDir, id);

    push(`// ${label}`);
    push(`var ${binding} = (function () {`);
    push('var __x = {};');

    // Published before the body, mirroring the point at which ES modules
    // initialise a hoisted function declaration.
    const published = slotsByModule.get(id);
    if (published && published.length > 0) {
      push(published.map((entry) => `${entry.slot} = ${entry.local};`).join(' '));
    }

    const bodyStartLine = currentLine() + 1;
    segments.push({ module: id, outputLine: bodyStartLine, lines: lineCount(body) });

    push(body);
    push('return __x;');
    push('})();');
  }

  // The last entry's exports are published as `__avx_entry` inside the bundle
  // scope. A footer -- the one that installs `globalThis.Avenx`, for instance
  // -- needs a name for what the entry produced, and inventing one per caller
  // would make the contract implicit.
  const liveEntries = graph.entries.filter((entry) => present.has(entry));
  for (const entry of liveEntries) {
    push(`void ${moduleBinding(indexOf.get(entry))};`);
  }
  if (liveEntries.length > 0) {
    push(`var __avx_entry = ${moduleBinding(indexOf.get(liveEntries[liveEntries.length - 1]))};`);
    push('void __avx_entry;');
  }

  if (footer) push(footer);
  push('})();');

  const code = lines.join('\n') + '\n';
  const map = sourceMap ? buildSourceMap({ graph, segments, rootDir, file }) : null;

  return { code, map, modules: emitted.length };
}

/**
 * Builds a line-level source map for an emitted bundle.
 *
 * Line-level rather than column-level, and exact rather than approximate: every
 * rewritten declaration was padded back to the line count it replaced, so
 * output line N of a module's body is source line N of that module. A stack
 * trace from a production bundle therefore names a file and a line the
 * developer wrote.
 * @param {object} options - Map options.
 * @param {object} options.graph - The module graph.
 * @param {Array<object>} options.segments - Where each module's body landed.
 * @param {string} options.rootDir - Root for relative source paths.
 * @param {string} options.file - The generated file name.
 * @returns {object} A source map, version 3.
 */
function buildSourceMap({ graph, segments, rootDir, file }) {
  const sources = [];
  const sourcesContent = [];
  const indexOfSource = new Map();

  const sourceIndex = (id) => {
    if (indexOfSource.has(id)) return indexOfSource.get(id);
    const module = graph.modules.get(id);
    const name = module.virtual ? id.replace(/^\s*/, '') : path.relative(rootDir, id).split(path.sep).join('/');
    const index = sources.length;
    sources.push(name);
    sourcesContent.push(module.source);
    indexOfSource.set(id, index);
    return index;
  };

  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const encode = (value) => {
    let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
    let out = '';
    do {
      let digit = vlq & 31;
      vlq >>>= 5;
      if (vlq > 0) digit |= 32;
      out += BASE64[digit];
    } while (vlq > 0);
    return out;
  };

  /** @type {Array<string>} */
  const mappingLines = [];
  let previousSource = 0;
  let previousSourceLine = 0;

  for (const segment of segments) {
    const index = sourceIndex(segment.module);
    for (let line = 0; line < segment.lines; line += 1) {
      const outputLine = segment.outputLine + line - 1;
      while (mappingLines.length <= outputLine) {
        mappingLines.push('');
      }
      mappingLines[outputLine] =
        encode(0) + encode(index - previousSource) + encode(line - previousSourceLine) + encode(0);
      previousSource = index;
      previousSourceLine = line;
    }
  }

  return {
    version: 3,
    file,
    sources,
    sourcesContent,
    names: [],
    mappings: mappingLines.join(';'),
  };
}
