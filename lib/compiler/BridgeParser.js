/**
 * @file BridgeParser.js
 * @description Static analysis of Avenx bridge modules.
 *
 * A bridge is a normal ES module whose default export is a `bridge({...})`
 * call. Because consumers reach it through an `import`, the compiler can read
 * the whole picture from source alone: which bridges exist, what each one
 * declares, which events it emits, and who imports it.
 *
 * This module answers those questions without a full JavaScript parser. It
 * scans the `bridge({...})` argument with a brace/string-aware walker and reads
 * only the top level of the object literal, which is all the declaration
 * surface a bridge has.
 */

import fs from 'fs';
import path from 'path';
import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { BuildError } from './errors/index.js';

/**
 * Module specifiers that resolve to the Avenx runtime.
 * @type {RegExp}
 */
const RUNTIME_SPECIFIER = /^(avenx-core(\/(runtime|core))?|.*\/lib\/core(\/index\.js)?)$/;

/**
 * Derives a bridge's name from its file name.
 * `user-prefs.bridge.js` becomes `userPrefs`.
 * @param {string} filePath - Path to the bridge module.
 * @returns {string} The bridge name.
 */
export function bridgeNameFromFile(filePath) {
  const base = path.basename(filePath).replace(/\.bridge\.js$/i, '');
  return base
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/**
 * Returns the identifier the compiled bundle uses for a bridge instance.
 * @param {string} name - The bridge name.
 * @returns {string} A valid JavaScript identifier.
 */
export function bridgeBindingName(name) {
  return `__avx_bridge_${String(name).replace(/[^\w$]/g, '_')}`;
}

/**
 * Walks source from an opening brace to its match, ignoring braces that appear
 * inside strings, template literals or comments.
 * @param {string} source - The source text.
 * @param {number} openIndex - Index of the opening `{`.
 * @returns {{ end: number, topLevelCommas: number[] }} The index of the matching
 *   `}` (or -1) and the offsets of commas at depth 1.
 */
function scanObjectLiteral(source, openIndex) {
  let depth = 0;
  let index = openIndex;
  const topLevelCommas = [];

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    // Comments
    if (char === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', index);
      index = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }
    if (char === '/' && next === '*') {
      const blockEnd = source.indexOf('*/', index + 2);
      index = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }

    // Quoted strings
    if (char === '"' || char === "'") {
      index++;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === char) break;
        index++;
      }
      index++;
      continue;
    }

    // Template literals, including ${...} substitutions
    if (char === '`') {
      index++;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === '`') break;
        if (source[index] === '$' && source[index + 1] === '{') {
          let inner = 1;
          index += 2;
          while (index < source.length && inner > 0) {
            if (source[index] === '{') inner++;
            else if (source[index] === '}') inner--;
            index++;
          }
          continue;
        }
        index++;
      }
      index++;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      depth++;
    } else if (char === '}' || char === ']' || char === ')') {
      depth--;
      if (depth === 0) {
        return { end: index, topLevelCommas };
      }
    } else if (char === ',' && depth === 1) {
      topLevelCommas.push(index);
    }

    index++;
  }

  return { end: -1, topLevelCommas };
}

/**
 * Reads the member name that starts a top-level object-literal entry.
 * @param {string} segment - Source of one entry, starting after `{` or `,`.
 * @returns {{ name: string, kind: 'getter'|'action'|'property' }|null} The parsed
 *   member, or null when the segment is not a recognisable declaration.
 */
function parseMember(segment) {
  const match = segment.match(
    /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*(?:(get|set)\s+)?(?:async\s+)?\*?\s*(?:(['"])([^'"]+)\2|([A-Za-z_$][\w$]*))\s*([:(])/,
  );
  if (!match) {
    return null;
  }
  const accessor = match[1];
  const name = match[3] !== undefined ? match[3] : match[4];
  const delimiter = match[5];

  if (accessor === 'get') {
    return { name, kind: 'getter' };
  }
  if (accessor === 'set') {
    // Setters are not part of the Bridge surface; report them as properties so
    // the caller can reject them with a clear message.
    return { name, kind: 'property' };
  }
  if (delimiter === '(') {
    return { name, kind: 'action' };
  }
  return { name, kind: 'property' };
}

/**
 * Splits the top level of an object literal into member declarations.
 * @param {string} source - The full source text.
 * @param {number} openIndex - Index of the literal's opening `{`.
 * @returns {{ members: Array<{name: string, kind: string, valueStart: number}>, end: number }}
 *   The declared members and the index of the closing brace.
 */
function parseObjectMembers(source, openIndex) {
  const { end, topLevelCommas } = scanObjectLiteral(source, openIndex);
  if (end === -1) {
    return { members: [], end };
  }

  const boundaries = [openIndex, ...topLevelCommas];
  const members = [];

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i] + 1;
    const stop = i + 1 < boundaries.length ? boundaries[i + 1] : end;
    const segment = source.slice(start, stop);
    const member = parseMember(segment);
    if (member) {
      members.push({ ...member, valueStart: start + segment.indexOf(member.name) });
    }
  }

  return { members, end };
}

/**
 * Finds the `bridge(` call that produces the module's default export.
 * @param {string} source - The module source.
 * @returns {number} Index of the `{` opening the definition object, or -1.
 */
function findDefinitionBrace(source) {
  const callRegex = /(^|[^\w$.])bridge\s*\(/g;
  let match;
  while ((match = callRegex.exec(source)) !== null) {
    const parenIndex = source.indexOf('(', match.index + match[0].length - 1);
    let cursor = parenIndex + 1;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    if (source[cursor] === '{') {
      return cursor;
    }
  }
  return -1;
}

/**
 * Extracts every event name emitted with a literal string, e.g. `this.emit('login')`.
 * @param {string} source - The module source.
 * @returns {string[]} Unique event names in source order.
 */
export function extractEmittedEvents(source) {
  const events = new Set();
  const regex = /\bemit\s*\(\s*(['"`])([^'"`\\]+)\1/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    events.add(match[2]);
  }
  return [...events];
}

/**
 * Extracts `<identifier>.on('event', ...)` subscriptions from source.
 * @param {string} source - The source to scan.
 * @returns {Array<{ target: string, event: string }>} The subscriptions found.
 */
export function extractSubscriptions(source) {
  const found = [];
  const regex = /\b([A-Za-z_$][\w$]*)\s*\.\s*on\s*\(\s*(['"`])([^'"`\\]+)\2/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    found.push({ target: match[1], event: match[3] });
  }
  return found;
}

/**
 * Parses the import statements of a module.
 * @param {string} source - The module source.
 * @returns {Array<{ statement: string, specifier: string, defaultName: string|null, named: string[] }>}
 *   One entry per import statement.
 */
export function parseImports(source) {
  const imports = [];
  const regex = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];?/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const clause = (match[1] || '').trim();
    const specifier = match[2];
    let defaultName = null;
    const named = [];

    if (clause) {
      const namedMatch = clause.match(/\{([\s\S]*?)\}/);
      if (namedMatch) {
        for (const part of namedMatch[1].split(',')) {
          const cleaned = part.trim();
          if (cleaned) {
            named.push(cleaned.split(/\s+as\s+/)[0].trim());
          }
        }
      }
      const beforeBrace = clause.split('{')[0].replace(/,\s*$/, '').trim();
      if (beforeBrace && !beforeBrace.startsWith('*')) {
        defaultName = beforeBrace;
      }
    }

    imports.push({ statement: match[0], specifier, defaultName, named });
  }
  return imports;
}

/**
 * Resolves a relative import specifier to a bridge module path, if it is one.
 * @param {string} fromFile - The importing file.
 * @param {string} specifier - The import specifier.
 * @returns {string|null} Absolute path to the `.bridge.js` file, or null.
 */
export function resolveBridgeSpecifier(fromFile, specifier) {
  if (!specifier || !specifier.startsWith('.')) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = base.endsWith('.bridge.js') ? [base] : [`${base}.bridge.js`, `${base}.js`];
  for (const candidate of candidates) {
    if (candidate.endsWith('.bridge.js')) {
      return candidate;
    }
  }
  return null;
}

/**
 * Collects the bridge imports of any module (component, page, bridge or main).
 * @param {string} filePath - Absolute path to the importing file.
 * @param {string} source - Its source text.
 * @returns {Array<{ local: string, specifier: string, resolved: string }>} One entry
 *   per default-imported bridge.
 */
export function findBridgeImports(filePath, source) {
  const results = [];
  for (const entry of parseImports(source)) {
    const resolved = resolveBridgeSpecifier(filePath, entry.specifier);
    if (resolved && entry.defaultName) {
      results.push({ local: entry.defaultName, specifier: entry.specifier, resolved });
    }
  }
  return results;
}

/**
 * Analyses a bridge module.
 *
 * Legacy `class X extends AvenxBridge` modules are recognised but reported as
 * `modern: false`, so the compiler can keep compiling them the old way.
 * @param {string} filePath - Absolute path to the `.bridge.js` file.
 * @param {string} source - The module source.
 * @returns {object} A descriptor of the bridge.
 */
export function analyzeBridge(filePath, source) {
  const name = bridgeNameFromFile(filePath);
  const imports = parseImports(source);

  const importsFactory = imports.some(
    (entry) => entry.named.includes('bridge') && RUNTIME_SPECIFIER.test(entry.specifier),
  );
  const braceIndex = findDefinitionBrace(source);
  const modern = importsFactory && braceIndex !== -1;

  const descriptor = {
    filePath,
    name,
    binding: bridgeBindingName(name),
    modern,
    stateKeys: [],
    actions: [],
    getters: [],
    hasSetup: false,
    events: [],
    bridgeImports: [],
    unsupportedImports: [],
  };

  if (!modern) {
    return descriptor;
  }

  const { members } = parseObjectMembers(source, braceIndex);
  for (const member of members) {
    if (member.kind === 'getter') {
      descriptor.getters.push(member.name);
      continue;
    }
    if (member.name === 'setup') {
      descriptor.hasSetup = true;
      continue;
    }
    if (member.name === 'state' && member.kind === 'property') {
      const stateBrace = source.indexOf('{', member.valueStart + 'state'.length);
      if (stateBrace !== -1) {
        const { members: stateMembers } = parseObjectMembers(source, stateBrace);
        descriptor.stateKeys = stateMembers.map((entry) => entry.name);
      }
      continue;
    }
    if (member.kind === 'action') {
      descriptor.actions.push(member.name);
    }
  }

  descriptor.events = extractEmittedEvents(source);

  for (const entry of imports) {
    if (RUNTIME_SPECIFIER.test(entry.specifier)) {
      continue;
    }
    const resolved = resolveBridgeSpecifier(filePath, entry.specifier);
    if (resolved && entry.defaultName) {
      descriptor.bridgeImports.push({ local: entry.defaultName, specifier: entry.specifier, resolved });
    } else {
      descriptor.unsupportedImports.push(entry.specifier);
    }
  }

  return descriptor;
}

/**
 * Reads and analyses a bridge module from disk.
 * @param {string} filePath - Absolute path to the `.bridge.js` file.
 * @param {(source: string) => string} [transform] - Optional source transform, used
 *   by the compiler to substitute environment variables.
 * @returns {object|null} The descriptor, or null when the file cannot be read.
 */
export function analyzeBridgeFile(filePath, transform = (value) => value) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return analyzeBridge(filePath, transform(fs.readFileSync(filePath, 'utf-8')));
}

/**
 * Every member a consumer may legitimately read from a bridge instance.
 * @param {object} descriptor - A bridge descriptor.
 * @returns {string[]} The declared member names.
 */
export function declaredMembers(descriptor) {
  return [...descriptor.stateKeys, ...descriptor.getters, ...descriptor.actions, 'on', '$dispose', '$name'];
}

/**
 * Compiles a modern bridge module into a bundle-ready declaration.
 *
 * The whole module body is preserved inside an IIFE, so constants and helper
 * functions declared above `export default` keep working and cannot collide
 * with other modules. Imported bridges are re-bound to their canonical
 * identifiers at the top of the IIFE rather than rewritten in place.
 * @param {object} descriptor - The bridge descriptor.
 * @param {string} source - The module source.
 * @param {Map<string, object>} registry - All discovered bridges, keyed by absolute path.
 * @returns {string} The emitted declaration.
 */
export function emitBridge(descriptor, source, registry) {
  let body = source;

  for (const entry of parseImports(source)) {
    body = body.replace(entry.statement, '');
  }

  const aliases = descriptor.bridgeImports
    .map((entry) => {
      const target = registry.get(entry.resolved);
      if (!target) {
        throw new BuildError(
          AvenxErrorCodes.COMPILER_BRIDGE_NOT_FOUND,
          entry.specifier,
          path.basename(descriptor.filePath),
          entry.resolved,
          [...registry.values()].map((item) => item.name).join(', ') || 'none',
        );
      }
      return `  const ${entry.local} = ${target.binding};`;
    })
    .join('\n');

  // `export default <expr>` becomes the IIFE's return value; any other export
  // keyword is simply dropped, since the IIFE is the module boundary.
  body = body.replace(/export\s+default\s+/, 'return ');
  body = body.replace(/^\s*export\s+(?=(const|let|var|function|class|async)\b)/gm, '');

  return [
    `const ${descriptor.binding} = (() => {`,
    aliases,
    body.trim(),
    '})();',
    `defineBridgeName(${JSON.stringify(descriptor.name)}, ${descriptor.binding});`,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
