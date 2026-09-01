/**
 * @file routes.js
 * @description Route and guard discovery, as part of the compiler's model.
 *
 * Routing is declared, not inferred: `initRouter` takes an object literal
 * mapping patterns to pages, and guards are classes in known directories. Both
 * are therefore compiler knowledge — but until now the only code that read
 * them was `bin/commands/inspect.js`, with a regex, at CLI time.
 *
 * Moving the reading here gives Atlas, `inspect` and `stats` one source of
 * truth instead of three scanners that agree by coincidence.
 * @module lib/compiler/atlas/routes
 */

import fs from 'fs';
import path from 'path';
import { AtlasEdgeKind, AtlasNodeKind, Confidence, UnresolvedReason, nodeId } from './AppModel.js';
import { lineIndex, positionAt } from './source.js';
import { relativePath } from './build.js';

/**
 * Converts a file base name to the class name the compiler generates.
 * @param {string} base - A file base name, e.g. `user-profile`.
 * @returns {string} The PascalCase class name.
 */
export function toClassName(base) {
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Finds the offset of the bracket closing the one at `open`.
 * @param {string} source - The source text.
 * @param {number} open - Offset of the opening bracket.
 * @returns {number} Offset of the match, or -1.
 */
function matchBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Splits an object literal's body into its top-level entries.
 * @param {string} body - The text between the outer braces.
 * @returns {Array<{text: string, offset: number}>} The entries.
 */
function splitEntries(body) {
  const entries = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      entries.push({ text: body.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (body.slice(start).trim()) {
    entries.push({ text: body.slice(start), offset: start });
  }
  return entries;
}

/**
 * Normalizes a route pattern to the form the router matches.
 *
 * `''`, `'#'` and `'#/'` all mean the root; a leading `#` is display syntax
 * rather than part of the path.
 * @param {string} pattern - The declared pattern.
 * @returns {string} The normalized path.
 */
export function normalizeRoute(pattern) {
  let route = String(pattern).trim();
  if (route.startsWith('#')) route = route.slice(1);
  if (route === '' || route === '/') return '/';
  return route;
}

/**
 * Reads every `initRouter({...})` declaration in a source file.
 *
 * Handles both accepted forms of a route target: a bare page name, and an
 * object carrying `page` and `guards`.
 * @param {string} source - The file contents.
 * @returns {Array<object>} Route declarations with their offsets.
 */
export function parseRouteTable(source) {
  const routes = [];
  const callRegex = /initRouter\s*\(\s*\{/g;
  let call;

  while ((call = callRegex.exec(source)) !== null) {
    const open = source.indexOf('{', call.index);
    const close = matchBrace(source, open);
    if (close === -1) continue;
    const bodyOffset = open + 1;
    const body = source.slice(bodyOffset, close);

    for (const entry of splitEntries(body)) {
      const keyMatch = entry.text.match(/^\s*(?:(['"])([^'"]*)\1|([A-Za-z0-9_$]+))\s*:/);
      if (!keyMatch) continue;
      const pattern = keyMatch[2] !== undefined ? keyMatch[2] : keyMatch[3];
      const valueText = entry.text.slice(keyMatch[0].length).trim();
      const offset = bodyOffset + entry.offset + entry.text.indexOf(keyMatch[0].trimStart());

      const literal = valueText.match(/^(['"])([A-Za-z0-9_$]+)\1/);
      if (literal) {
        routes.push({ pattern, page: literal[2], guards: [], offset, dynamic: false });
        continue;
      }

      if (valueText.startsWith('{')) {
        const pageMatch = valueText.match(/\bpage\s*:\s*(['"])([A-Za-z0-9_$]+)\1/);
        const guardsMatch = valueText.match(/\bguards\s*:\s*\[([^\]]*)\]/);
        const guards = guardsMatch
          ? guardsMatch[1]
            .split(',')
            .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
            .filter((item) => /^[A-Za-z_$][\w$]*$/.test(item))
          : [];
        routes.push({
          pattern,
          page: pageMatch ? pageMatch[2] : null,
          guards,
          offset,
          dynamic: !pageMatch,
          expr: valueText.slice(0, 80),
        });
        continue;
      }

      routes.push({ pattern, page: null, guards: [], offset, dynamic: true, expr: valueText.slice(0, 80) });
    }
  }

  return routes;
}

/**
 * Collects the guard classes a project declares.
 * @param {string} srcDir - The project source directory.
 * @returns {Array<{name: string, filePath: string}>} Declared guards.
 */
export function findGuards(srcDir) {
  const guards = [];
  for (const dirName of ['guards', 'global']) {
    const dir = path.join(srcDir, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.guard.js')) continue;
      guards.push({
        name: `${toClassName(path.basename(entry, '.guard.js'))}Guard`,
        filePath: path.join(dir, entry),
      });
    }
  }
  return guards;
}

/**
 * Adds routes, guards and the relationships between them to the model.
 *
 * Route nodes are keyed by their normalized pattern rather than by the page
 * they resolve to: two patterns can reach the same page, and `avenx impact`
 * should list both.
 * @param {object} model - The AppModel being built.
 * @param {object} context - `{srcDir, rootDir}`.
 * @returns {void}
 */
export function addRoutesAndGuards(model, context) {
  const { srcDir, rootDir } = context;

  /** @type {Map<string, string>} */
  const guardNodes = new Map();
  for (const guard of findGuards(srcDir)) {
    const id = nodeId(AtlasNodeKind.GUARD, null, guard.name);
    model.addNode({
      id,
      kind: AtlasNodeKind.GUARD,
      name: guard.name,
      file: relativePath(guard.filePath, rootDir),
      loc: { file: relativePath(guard.filePath, rootDir) },
    });
    guardNodes.set(guard.name, id);
  }

  const mainFile = path.join(srcDir, 'main.app.js');
  if (!fs.existsSync(mainFile)) return;

  const source = fs.readFileSync(mainFile, 'utf-8');
  const file = relativePath(mainFile, rootDir);
  const starts = lineIndex(source);

  for (const route of parseRouteTable(source)) {
    const normalized = normalizeRoute(route.pattern);
    const routeId = nodeId(AtlasNodeKind.ROUTE, null, normalized);
    const loc = { file, line: positionAt(starts, route.offset).line };

    model.addNode({
      id: routeId,
      kind: AtlasNodeKind.ROUTE,
      name: normalized,
      pattern: route.pattern,
      file,
      loc,
    });

    if (route.page) {
      const pageId = nodeId(AtlasNodeKind.PAGE, null, route.page);
      if (model.hasNode(pageId)) {
        model.addEdge({
          from: routeId,
          to: pageId,
          kind: AtlasEdgeKind.ROUTES_TO,
          confidence: Confidence.CERTAIN,
          loc,
        });
      } else {
        // A named page the compiler never compiled is a real finding, not a
        // silent gap: it is the shape of a typo or a deleted file.
        model.addUnresolved({
          reason: UnresolvedReason.DYNAMIC_ROUTE,
          expr: `${route.pattern} -> ${route.page}`,
          name: route.page,
          owner: routeId,
          loc,
        });
      }
    } else if (route.dynamic) {
      model.addUnresolved({
        reason: UnresolvedReason.DYNAMIC_ROUTE,
        expr: route.expr || route.pattern,
        owner: routeId,
        loc,
      });
    }

    for (const guardName of route.guards) {
      const guardId = guardNodes.get(guardName);
      if (!guardId) {
        model.addUnresolved({
          reason: UnresolvedReason.UNKNOWN_IDENTIFIER,
          expr: guardName,
          name: guardName,
          owner: routeId,
          loc,
        });
        continue;
      }
      model.addEdge({
        from: routeId,
        to: guardId,
        kind: AtlasEdgeKind.GUARDED_BY,
        confidence: Confidence.CERTAIN,
        loc,
      });
    }
  }
}

export default { addRoutesAndGuards, parseRouteTable, findGuards, normalizeRoute, toClassName };
