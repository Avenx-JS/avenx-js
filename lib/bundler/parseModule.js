/**
 * @file parseModule.js
 * @description Reads an ES module's shape: what it imports, what it exports,
 * and where its top-level statements sit.
 *
 * ## Scope, stated up front
 *
 * This is a *module-structure* reader, not an ECMAScript parser. It answers
 * exactly the questions the bundler asks:
 *
 * - which specifiers does this module depend on, and under what local names?
 * - which names does it export, and where does each one come from?
 * - where does each top-level statement begin and end, and what does it declare?
 *
 * Everything between those declarations is opaque text that the emitter copies
 * verbatim. That is deliberate: the less of JavaScript the bundler claims to
 * understand, the fewer ways it can silently miscompile a module. Where a
 * construct is outside what the reader can describe, it says so
 * ({@link ModuleParseError}) and the build fails with a location — the same
 * house rule the compiler follows everywhere else.
 *
 * Import and export declarations are only legal at the top level of a module,
 * so scanning for them at bracket depth zero, skipping every string, template,
 * regex and comment via {@link module:lib/bundler/scanner}, finds all of them
 * and nothing else.
 * @module lib/bundler/parseModule
 */

import { CodeMask, statementEnd, matchBracket } from './scanner.js';
import { LruCache } from '../core/utils/LruCache.js';

/**
 * Module records by source text.
 *
 * Reading a module is a pure function of its source -- the file name is used
 * only in diagnostics -- so the same text always yields the same record. That
 * matters because the runtime's modules are re-read on every build, and
 * `avenx watch` rebuilds on every keystroke: without this, a watch rebuild
 * re-parsed seventy modules that had not changed. Bounded, because a long
 * watch session should not accumulate every version of every file a developer
 * has typed.
 * @type {LruCache}
 */
const recordCache = new LruCache(400);

/**
 * Raised when a module contains structure the reader cannot describe.
 */
export class ModuleParseError extends Error {
  /**
   * @param {string} message - What could not be read.
   * @param {string} file - The module's path or virtual id.
   * @param {number} [index] - Character offset in the module.
   */
  constructor(message, file, index = -1) {
    super(message);
    this.name = 'ModuleParseError';
    /** @type {string} */
    this.file = file;
    /** @type {number} */
    this.index = index;
  }
}

/**
 * Declaration keywords that introduce a binding at the top level.
 * @type {Set<string>}
 */
const BINDING_KEYWORDS = new Set(['const', 'let', 'var', 'function', 'class', 'async']);

/**
 * Splits a `{ a, b as c }` clause into binding pairs.
 * @param {string} inner - The text between the braces.
 * @returns {Array<{imported: string, local: string}>} The bindings, in order.
 */
function parseNamedClause(inner) {
  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const aliased = part.split(/\s+as\s+/);
      const imported = aliased[0].trim().replace(/^["']|["']$/g, '');
      const local = (aliased[1] || aliased[0]).trim();
      return { imported, local };
    });
}

/**
 * Reads the names a top-level declaration introduces.
 *
 * Handles `const`/`let`/`var` (including object and array destructuring
 * patterns), `function`, `async function`, `function*` and `class`. Anything
 * else — an expression statement, a bare call — declares nothing, which is the
 * correct answer rather than a failure.
 * @param {string} text - The statement source.
 * @returns {string[]} Declared binding names.
 */
export function declaredNames(text) {
  const trimmed = text.replace(/^\s*export\s+default\s+/, '').replace(/^\s*export\s+/, '').trimStart();

  const fn = trimmed.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/);
  if (fn) return [fn[1]];

  const cls = trimmed.match(/^class\s+([A-Za-z_$][\w$]*)/);
  if (cls) return [cls[1]];

  const decl = trimmed.match(/^(const|let|var)\s+/);
  if (!decl) return [];

  const names = [];
  const body = trimmed.slice(decl[0].length);
  const mask = new CodeMask(body);
  let i = 0;
  let expectName = true;

  while (i < body.length) {
    if (!mask.isCode(i)) {
      i += 1;
      continue;
    }
    const char = body[i];

    if (char === '{' || char === '[') {
      // A destructuring pattern. Every identifier that is not a property key
      // and not a default value is a binding; taking the identifier after each
      // `:` (and each bare identifier otherwise) covers the shapes that appear
      // in practice.
      const end = matchBracket(body, mask, i);
      const pattern = body.slice(i + 1, end - 1);
      const patternMask = new CodeMask(pattern);
      let inner = 0;
      let assigned = false;
      let token = '';
      let pendingKey = false;
      const push = (name) => {
        if (name && /^[A-Za-z_$][\w$]*$/.test(name) && !names.includes(name)) names.push(name);
      };
      for (let k = 0; k <= pattern.length; k += 1) {
        const ch = k < pattern.length ? pattern[k] : ',';
        const isCode = k < pattern.length ? patternMask.isCode(k) : true;
        if (!isCode) continue;
        if (ch === '{' || ch === '[' || ch === '(') inner += 1;
        else if (ch === '}' || ch === ']' || ch === ')') inner -= 1;

        if (inner === 0 && ch === ':') {
          token = '';
          pendingKey = true;
          continue;
        }
        if (inner === 0 && ch === '=') {
          assigned = true;
          continue;
        }
        if (inner === 0 && ch === ',') {
          if (!assigned || pendingKey || token) push(token.trim());
          token = '';
          assigned = false;
          pendingKey = false;
          continue;
        }
        if (!assigned) token += ch;
      }
      i = end;
      expectName = false;
      continue;
    }

    if (char === '(') {
      i = matchBracket(body, mask, i);
      continue;
    }

    if (char === '=' && body[i + 1] !== '=') {
      // Skip the initialiser: everything up to the next top-level comma.
      let j = i + 1;
      let d = 0;
      while (j < body.length) {
        if (!mask.isCode(j)) {
          j += 1;
          continue;
        }
        const c = body[j];
        if (c === '(' || c === '[' || c === '{') d += 1;
        else if (c === ')' || c === ']' || c === '}') d -= 1;
        else if (c === ',' && d === 0) break;
        else if (c === ';' && d === 0) break;
        j += 1;
      }
      i = j;
      continue;
    }

    if (char === ',') {
      expectName = true;
      i += 1;
      continue;
    }

    if (expectName && /[A-Za-z_$]/.test(char)) {
      let j = i;
      while (j < body.length && /[\w$]/.test(body[j])) j += 1;
      const name = body.slice(i, j);
      if (!names.includes(name)) names.push(name);
      expectName = false;
      i = j;
      continue;
    }

    if (char === ';') break;
    i += 1;
  }

  return names;
}

/**
 * The structure of one ES module.
 * @typedef {object} ModuleRecord
 * @property {string} source - The original source text.
 * @property {string} file - Path or virtual id, for diagnostics.
 * @property {Array<object>} imports - Import declarations, in source order.
 * @property {Array<object>} exports - Names this module exports from its own scope.
 * @property {Array<object>} reExports - `export { x } from 'm'` entries.
 * @property {Array<object>} starReExports - `export * from 'm'` entries.
 * @property {Array<object>} statements - Top-level statements with their spans.
 * @property {string[]} dependencies - Distinct specifiers this module needs.
 */

/**
 * Reads a module's import/export structure.
 * @param {string} source - The module source.
 * @param {string} file - Path or virtual id, used in diagnostics.
 * @returns {ModuleRecord} The module's structure.
 * @throws {ModuleParseError} When a declaration cannot be read.
 */
export function parseModule(source, file) {
  const cached = recordCache.get(source);
  if (cached) {
    // The record is read-only to every consumer; only `file` differs, and it is
    // wanted for diagnostics about *this* module.
    return cached.file === file ? cached : { ...cached, file };
  }

  const record = readModule(source, file);
  recordCache.set(source, record);
  return record;
}

/**
 * Reads a module's structure, without the memo.
 * @param {string} source - The module source.
 * @param {string} file - Path or virtual id, used in diagnostics.
 * @returns {ModuleRecord} The module's structure.
 * @throws {ModuleParseError} When a declaration cannot be read.
 */
function readModule(source, file) {
  const mask = new CodeMask(source);
  const text = mask.withoutComments();

  /** @type {ModuleRecord} */
  const record = {
    source,
    file,
    imports: [],
    exports: [],
    reExports: [],
    starReExports: [],
    statements: [],
    dependencies: [],
  };

  const addDependency = (specifier) => {
    if (!record.dependencies.includes(specifier)) {
      record.dependencies.push(specifier);
    }
  };

  /**
   * Reads the `from '...'` tail of a declaration.
   * @param {number} from - Offset to start looking at.
   * @returns {{specifier: string, end: number}|null} The specifier and where it ends.
   */
  const readSpecifier = (from) => {
    const rest = text.slice(from);
    const match = rest.match(/^\s*from\s*(['"])([^'"]*)\1/);
    if (!match) return null;
    return { specifier: match[2], end: from + match[0].length };
  };

  let i = 0;
  let depth = 0;

  while (i < source.length) {
    if (!mask.isCode(i)) {
      i += 1;
      continue;
    }
    const char = source[i];

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth !== 0 || /\s/.test(char) || char === ';') {
      i += 1;
      continue;
    }

    // A statement starts here. Identify it, record its span, and move past it.
    const word = (text.slice(i).match(/^[A-Za-z_$][\w$]*/) || [''])[0];

    if (word === 'import') {
      const parsed = readImport(text, mask, i, file);
      if (parsed) {
        record.imports.push(parsed);
        addDependency(parsed.specifier);
        record.statements.push({ start: i, end: parsed.end, declares: parsed.locals, kind: 'import' });
        i = parsed.end;
        continue;
      }
      // `import(` — a dynamic import expression, not a declaration.
    }

    if (word === 'export') {
      const parsed = readExport(text, mask, i, file, readSpecifier);
      for (const entry of parsed.exports) record.exports.push(entry);
      for (const entry of parsed.reExports) {
        record.reExports.push(entry);
        addDependency(entry.specifier);
      }
      for (const entry of parsed.starReExports) {
        record.starReExports.push(entry);
        addDependency(entry.specifier);
      }
      record.statements.push({
        start: i,
        end: parsed.end,
        declares: parsed.declares,
        kind: parsed.kind,
        exported: parsed.exports.map((entry) => entry.exported),
        bodyStart: parsed.bodyStart,
        // The entries this particular statement produced. The emitter needs
        // them per statement, not per module: two `export { … } from` lines
        // naming the same specifier are two separate rewrites.
        entries: parsed.exports,
        reExportEntries: parsed.reExports,
        starSpecifier: parsed.starReExports.length > 0 ? parsed.starReExports[0].specifier : null,
      });
      i = parsed.end;
      continue;
    }

    const end = statementEnd(source, mask, i);
    const statementText = text.slice(i, end);
    record.statements.push({
      start: i,
      end,
      declares: BINDING_KEYWORDS.has(word) ? declaredNames(statementText) : [],
      kind: 'statement',
    });
    i = Math.max(end, i + 1);
  }

  return record;
}

/**
 * Reads one `import` declaration.
 * @param {string} text - Comment-blanked source.
 * @param {CodeMask} mask - Mask for the source.
 * @param {number} start - Offset of the `import` keyword.
 * @param {string} file - Module path, for diagnostics.
 * @returns {object|null} The import record, or null when this is `import(`.
 * @throws {ModuleParseError} When the declaration is malformed.
 */
function readImport(text, mask, start, file) {
  const rest = text.slice(start);

  // `import(` and `import.meta` are expressions, not declarations.
  if (/^import\s*[(.]/.test(rest)) {
    return null;
  }

  const bare = rest.match(/^import\s*(['"])([^'"]*)\1\s*;?/);
  if (bare) {
    return {
      specifier: bare[2],
      bindings: [],
      namespace: null,
      defaultLocal: null,
      locals: [],
      sideEffectOnly: true,
      start,
      end: start + bare[0].length,
    };
  }

  const clauseMatch = rest.match(/^import\s+([\s\S]*?)\s+from\s*(['"])([^'"]*)\2\s*;?/);
  if (!clauseMatch) {
    throw new ModuleParseError('could not read this import declaration', file, start);
  }

  const clause = clauseMatch[1].trim();
  const specifier = clauseMatch[3];
  const bindings = [];
  let namespace = null;
  let defaultLocal = null;

  const namedIndex = clause.indexOf('{');
  const head = (namedIndex === -1 ? clause : clause.slice(0, namedIndex)).replace(/,\s*$/, '').trim();

  if (head) {
    const starMatch = head.match(/^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (starMatch) {
      if (starMatch[1]) defaultLocal = starMatch[1];
      namespace = starMatch[2];
    } else {
      const defaultMatch = head.match(/^([A-Za-z_$][\w$]*)$/);
      if (!defaultMatch) {
        throw new ModuleParseError(`could not read the import clause "${clause}"`, file, start);
      }
      defaultLocal = defaultMatch[1];
    }
  }

  if (namedIndex !== -1) {
    const close = clause.indexOf('}', namedIndex);
    if (close === -1) {
      throw new ModuleParseError(`could not read the import clause "${clause}"`, file, start);
    }
    bindings.push(...parseNamedClause(clause.slice(namedIndex + 1, close)));
  }

  const locals = bindings.map((entry) => entry.local);
  if (namespace) locals.push(namespace);
  if (defaultLocal) locals.push(defaultLocal);

  return {
    specifier,
    bindings,
    namespace,
    defaultLocal,
    locals,
    sideEffectOnly: false,
    start,
    end: start + clauseMatch[0].length,
  };
}

/**
 * Reads one `export` declaration.
 * @param {string} text - Comment-blanked source.
 * @param {CodeMask} mask - Mask for the source.
 * @param {number} start - Offset of the `export` keyword.
 * @param {string} file - Module path, for diagnostics.
 * @param {function(number): ({specifier: string, end: number}|null)} readSpecifier - Reads a `from` tail.
 * @returns {object} What the declaration exports and where it ends.
 * @throws {ModuleParseError} When the declaration is malformed.
 */
function readExport(text, mask, start, file, readSpecifier) {
  const rest = text.slice(start);
  const result = { exports: [], reExports: [], starReExports: [], declares: [], end: start, kind: 'export', bodyStart: start };

  // export * from 'm'   |   export * as ns from 'm'
  const star = rest.match(/^export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?/);
  if (star) {
    const tail = readSpecifier(start + star[0].length);
    if (!tail) {
      throw new ModuleParseError('an `export *` declaration needs a `from` clause', file, start);
    }
    if (star[1]) {
      result.reExports.push({ specifier: tail.specifier, imported: '*', exported: star[1] });
    } else {
      result.starReExports.push({ specifier: tail.specifier });
    }
    result.kind = 'star-reexport';
    result.end = text[tail.end] === ';' ? tail.end + 1 : tail.end;
    return result;
  }

  // export { ... }  |  export { ... } from 'm'
  const braceMatch = rest.match(/^export\s*\{/);
  if (braceMatch) {
    const open = start + braceMatch[0].length - 1;
    const close = matchBracket(text, mask, open);
    const clause = parseNamedClause(text.slice(open + 1, close - 1));
    const tail = readSpecifier(close);

    if (tail) {
      for (const entry of clause) {
        result.reExports.push({ specifier: tail.specifier, imported: entry.imported, exported: entry.local });
      }
      result.kind = 'reexport';
      result.end = text[tail.end] === ';' ? tail.end + 1 : tail.end;
      return result;
    }

    for (const entry of clause) {
      result.exports.push({ exported: entry.local, local: entry.imported, kind: 'binding' });
    }
    result.kind = 'export-list';
    result.end = text[close] === ';' ? close + 1 : close;
    return result;
  }

  // export default ...
  const defaultMatch = rest.match(/^export\s+default\s+/);
  if (defaultMatch) {
    const bodyStart = start + defaultMatch[0].length;
    const end = statementEnd(text, mask, bodyStart);
    const declared = declaredNames(text.slice(bodyStart, end));
    result.exports.push({
      exported: 'default',
      local: declared[0] || null,
      kind: declared.length > 0 ? 'declaration' : 'expression',
    });
    result.declares = declared;
    result.kind = 'export-default';
    result.bodyStart = bodyStart;
    result.end = end;
    return result;
  }

  // export <declaration>
  const declMatch = rest.match(/^export\s+(?=(const|let|var|function|class|async)\b)/);
  if (declMatch) {
    const bodyStart = start + declMatch[0].length;
    const end = statementEnd(text, mask, bodyStart);
    const declared = declaredNames(text.slice(bodyStart, end));
    if (declared.length === 0) {
      throw new ModuleParseError('could not read the names this export declares', file, start);
    }
    for (const name of declared) {
      result.exports.push({ exported: name, local: name, kind: 'declaration' });
    }
    result.declares = declared;
    result.kind = 'export-declaration';
    result.bodyStart = bodyStart;
    result.end = end;
    return result;
  }

  throw new ModuleParseError('could not read this export declaration', file, start);
}
