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
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { BuildError } from '../errors/index.js';
import { reportWarning } from '../utils/warningReporter.js';

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
 * Joins a router's `prefix` onto a normalized route pattern, giving the hash
 * the route actually matches.
 *
 * A prefixed router strips its prefix from the hash before matching its own
 * table (`RouteMatcher.normalizeHash`), so a `/home` route under `/widget`
 * answers `#/widget/home`, and a `*` fallback under `/widget` answers any
 * hash under `/widget`. Without a prefix the pattern matches as declared.
 * @param {string} pattern - A route pattern as declared.
 * @param {string|null} [prefix] - The router's literal `prefix` option, if any.
 * @returns {string} The pattern as a hash path.
 */
export function effectiveRoutePattern(pattern, prefix = null) {
  const normalized = normalizeRoute(pattern);
  if (!prefix) return normalized;
  const base = String(prefix).replace(/\/$/, '');
  if (!base) return normalized;
  if (normalized === '*') return `${base}/*`;
  return base + (normalized.startsWith('/') ? normalized : `/${normalized}`);
}

/**
 * Reads every `initRouter({...})` declaration in a source file.
 *
 * Handles both accepted forms of a route target: a bare page name, and an
 * object carrying `page` and `guards`. Each route also records which
 * `initRouter` call declared it, the receiver it was called on, and the
 * call's literal `prefix` option, so callers can tell two routers' routes
 * apart: routes from different routers live in different namespaces even
 * when their declared patterns are identical.
 * @param {string} source - The file contents.
 * @returns {Array<object>} Route declarations with their offsets.
 */
export function parseRouteTable(source) {
  const routes = [];
  const callRegex = /(?:([A-Za-z_$][\w$]*)\s*\.\s*)?initRouter\s*\(\s*\{/g;
  let call;
  let router = 0;

  while ((call = callRegex.exec(source)) !== null) {
    const open = source.indexOf('{', call.index);
    const close = matchBrace(source, open);
    if (close === -1) continue;
    const bodyOffset = open + 1;
    const body = source.slice(bodyOffset, close);

    // The options object follows the route table: `initRouter({...}, {...})`.
    // Only a literal string prefix is statically known; any other shape
    // leaves the prefix unknown rather than guessed.
    let prefix = null;
    let prefixDynamic = false;
    const rest = source.slice(close + 1);
    const optionsMatch = rest.match(/^\s*,\s*\{/);
    if (optionsMatch) {
      const optionsOpen = close + 1 + rest.indexOf('{');
      const optionsClose = matchBrace(source, optionsOpen);
      if (optionsClose !== -1) {
        const optionsBody = source.slice(optionsOpen + 1, optionsClose);
        const prefixMatch = optionsBody.match(/\bprefix\s*:\s*(['"])((?:\\.|[^'"])*)\1/);
        if (prefixMatch) {
          prefix = prefixMatch[2];
        } else if (/\bprefix\s*:/.test(optionsBody)) {
          prefixDynamic = true;
        }
      } else {
        prefixDynamic = true;
      }
    } else if (/^\s*,/.test(rest)) {
      // A second argument that is not an object literal: its prefix, if any,
      // is not statically known.
      prefixDynamic = true;
    }

    for (const entry of splitEntries(body)) {
      const keyMatch = entry.text.match(/^\s*(?:(['"])([^'"]*)\1|([A-Za-z0-9_$]+))\s*:/);
      if (!keyMatch) continue;
      const pattern = keyMatch[2] !== undefined ? keyMatch[2] : keyMatch[3];
      const valueText = entry.text.slice(keyMatch[0].length).trim();
      const offset = bodyOffset + entry.offset + entry.text.indexOf(keyMatch[0].trimStart());
      const where = { router, receiver: call[1] || null, prefix, prefixDynamic };

      const literal = valueText.match(/^(['"])([A-Za-z0-9_$]+)\1/);
      if (literal) {
        routes.push({ pattern, page: literal[2], guards: [], offset, dynamic: false, ...where });
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
          ...where,
        });
        continue;
      }

      routes.push({ pattern, page: null, guards: [], offset, dynamic: true, expr: valueText.slice(0, 80), ...where });
    }
    router++;
  }

  return routes;
}

/**
 * Collects the guard classes a project declares.
 *
 * A guard is named by the class its module exports. The filename is only a
 * fallback for a file that exports no class.
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
      const filePath = path.join(dir, entry);
      const source = fs.readFileSync(filePath, 'utf-8');
      const exported = source.match(/export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/);
      guards.push({
        name: exported ? exported[1] : `${toClassName(path.basename(entry, '.guard.js'))}Guard`,
        filePath,
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
  const { srcDir, rootDir, config } = context;

  /** @type {Map<string, string>} */
  const guardNodes = new Map();
  /** @type {Map<string, string>} guard file path -> node id */
  const guardByFile = new Map();
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
    guardByFile.set(guard.filePath, id);
  }

  const mainFile = path.join(srcDir, 'main.app.js');
  if (!fs.existsSync(mainFile)) return;

  const source = fs.readFileSync(mainFile, 'utf-8');

  // A guard may be referenced by the local binding it is imported under.
  for (const imp of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.guard\.js)['"]/g)) {
    const target = path.resolve(path.dirname(mainFile), imp[2]);
    const id = guardByFile.get(target);
    if (id) guardNodes.set(imp[1], id);
  }
  const file = relativePath(mainFile, rootDir);
  const starts = lineIndex(source);

  // An application may mount a page directly instead of declaring a route
  // table. Recorded rather than inferred later, because this is the one place
  // that reads the entry point.
  //
  // Component registrations are read here too. Pages are registered by the
  // compiler, components are not: an application must call `app.register()` for
  // each one, and a component a template uses but nothing registers renders
  // nothing at all. Knowing which names the entry point registers is what lets
  // that be reported instead of discovered in a browser.
  const registered = new Set();
  let dynamicRegistration = false;
  for (const match of source.matchAll(/\.register\s*\(\s*([^,)]*)/g)) {
    const argument = match[1].trim();
    const literal = argument.match(/^(['"`])([A-Za-z_$][\w$]*)\1$/);
    if (literal) {
      registered.add(literal[2]);
    } else {
      // A name computed at run time could be any component, so no absence
      // claim about registration is safe anywhere in this application.
      dynamicRegistration = true;
    }
  }

  model.entry = {
    file,
    mountsDirectly: /\bmountPage\s*\(/.test(source),
    registeredComponents: registered,
    dynamicRegistration,
  };

  /** @type {Map<string, {page: string|null, expr: string|null}>} */
  const seenRoutes = new Map();

  for (const route of parseRouteTable(source)) {
    const normalized = normalizeRoute(route.pattern);
    const routeId = nodeId(AtlasNodeKind.ROUTE, null, normalized);
    const loc = { file, line: positionAt(starts, route.offset).line };

    // Duplicate check: applies "last-wins" semantics and issues AVX_W59.
    //
    // Patterns are compared by the hash they actually match, so a route
    // under a `prefix` only collides with the same prefixed pattern: two
    // routers may each declare a `*` fallback, and a `/home` under
    // `/widget` is not the host's `/home`. When the prefix is not
    // statically known, routes are scoped to their own `initRouter` call,
    // so only a pattern repeated in one call can report.
    const effective = effectiveRoutePattern(route.pattern, route.prefix);
    const dedupeKey = route.prefixDynamic ? `\0call${route.router}:${normalized}` : effective;
    if (seenRoutes.has(dedupeKey)) {
      const previous = seenRoutes.get(dedupeKey);
      const newTarget = route.page || route.expr || 'unknown';
      const previousTarget = previous.page || previous.expr || 'unknown';

      // 1. Reports AVX_W59 through the same path as every other compiler warning,
      // so the `warnings` setting can silence or escalate it.
      reportWarning(
        AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN,
        new BuildError(
          AvenxErrorCodes.COMPILER_DUPLICATE_ROUTE_PATTERN,
          route.prefixDynamic ? normalized : effective,
          newTarget,
          previousTarget,
        ),
        config,
        loc,
      );

      // 2. Last-wins: drop the earlier target's ROUTES_TO edge, as AvenxRouter does.
      model.removeEdges(routeId, AtlasEdgeKind.ROUTES_TO);
    }

    // Updates the record to the current standard.
    seenRoutes.set(dedupeKey, { page: route.page, expr: route.expr });

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

export default { addRoutesAndGuards, parseRouteTable, findGuards, normalizeRoute, effectiveRoutePattern, toClassName };
