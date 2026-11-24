/**
 * @file diff.js
 * @description Comparing two Avenx Atlas application models.
 *
 * An application model is emitted beside the bundle (dist/bundle.atlas.json,
 * atlasVersion: 1) containing nodes, edges, unresolved entries and a summary.
 * Comparing a new build against a baseline artifact reveals semantic data-flow
 * changes: added or removed bindings, state keys, actions, routes, route guards,
 * or confidence degradations.
 * @module lib/compiler/atlas/diff
 */

import { ATLAS_VERSION } from './AppModel.js';

/**
 * Compares two locations for deterministic ordering or equality.
 * @param {object|null} a - First location.
 * @param {object|null} b - Second location.
 * @returns {number} Sort comparison order (-1, 0, 1).
 */
export function compareLoc(a, b) {
  const fileA = (a && a.file) || '';
  const fileB = (b && b.file) || '';
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const lineA = (a && a.line) || 0;
  const lineB = (b && b.line) || 0;
  if (lineA !== lineB) return lineA - lineB;
  return ((a && a.column) || 0) - ((b && b.column) || 0);
}

/**
 * Returns a human-readable file:line location string.
 * @param {object|null} loc - A location object.
 * @returns {string} Formatted location, or empty string.
 */
export function formatLoc(loc) {
  if (!loc || !loc.file) return '';
  return loc.line ? `${loc.file}:${loc.line}` : loc.file;
}

/**
 * Retrieves the location of a node.
 * @param {object|null} node - An Atlas node.
 * @returns {object|null} The resolved location object.
 */
function locationOfNode(node) {
  if (!node) return null;
  return node.loc || (node.file ? { file: node.file } : null);
}

/**
 * Tests whether two nodes have identical non-location properties.
 * @param {object} a - Baseline node.
 * @param {object} b - Current node.
 * @returns {boolean} True if semantic properties match.
 */
function isNodeEqual(a, b) {
  const ignore = new Set(['loc', 'file']);
  const keysA = Object.keys(a)
    .filter((k) => !ignore.has(k))
    .sort();
  const keysB = Object.keys(b)
    .filter((k) => !ignore.has(k))
    .sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (k !== keysB[i]) return false;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/**
 * Extracts route definitions and their relationships from an Atlas document.
 * @param {object} doc - Parsed Atlas artifact.
 * @returns {Map<string, object>} Route descriptor by node ID.
 */
function extractRoutes(doc) {
  const routeNodes = (doc.nodes || []).filter((n) => n.kind === 'route');
  const routeMap = new Map();
  const edges = doc.edges || [];

  const outEdges = new Map();
  for (const edge of edges) {
    if (!outEdges.has(edge.from)) outEdges.set(edge.from, []);
    outEdges.get(edge.from).push(edge);
  }

  for (const node of routeNodes) {
    const outgoing = outEdges.get(node.id) || [];
    const routeTo = outgoing.find((e) => e.kind === 'routes-to');
    const guardedBy = outgoing.filter((e) => e.kind === 'guarded-by');

    const target = routeTo ? routeTo.to.replace(/^page:/, '') : null;
    const guards = guardedBy.map((e) => e.to.replace(/^guard:/, '')).sort();

    routeMap.set(node.id, {
      id: node.id,
      name: node.name,
      pattern: node.pattern,
      prefix: node.prefix,
      router: node.router,
      loc: locationOfNode(node),
      target,
      guards,
      node,
    });
  }

  return routeMap;
}

/**
 * Computes differences between routes in baseline and current models.
 * @param {Map<string, object>} baseRoutes - Baseline routes map.
 * @param {Map<string, object>} currRoutes - Current routes map.
 * @returns {{added: object[], removed: object[], modified: object[]}}
 */
function diffRoutes(baseRoutes, currRoutes) {
  const added = [];
  const removed = [];
  const modified = [];

  for (const [id, curr] of currRoutes) {
    if (!baseRoutes.has(id)) {
      added.push(curr);
    } else {
      const base = baseRoutes.get(id);
      const changes = [];

      const targetChanged = base.target !== curr.target;
      if (targetChanged) {
        changes.push(`now routes to ${curr.target || 'unresolved'} (was ${base.target || 'unresolved'})`);
      }

      const baseGuardsStr = base.guards.join(', ');
      const currGuardsStr = curr.guards.join(', ');
      if (baseGuardsStr !== currGuardsStr) {
        if (base.guards.length === 0) {
          changes.push(`now guarded by ${currGuardsStr}`);
        } else if (curr.guards.length === 0) {
          changes.push(`no longer guarded by ${baseGuardsStr}`);
        } else {
          changes.push(`now guarded by ${currGuardsStr} (was ${baseGuardsStr})`);
        }
      }

      const locChanged = compareLoc(base.loc, curr.loc) !== 0;
      if (locChanged && changes.length === 0) {
        changes.push(`${formatLoc(curr.loc)} (was ${formatLoc(base.loc)})`);
      }

      if (changes.length > 0) {
        modified.push({
          id: curr.id,
          name: curr.name,
          before: { target: base.target, guards: base.guards, loc: base.loc },
          after: { target: curr.target, guards: curr.guards, loc: curr.loc },
          changes,
        });
      }
    }
  }

  for (const [id, base] of baseRoutes) {
    if (!currRoutes.has(id)) {
      removed.push(base);
    }
  }

  added.sort((a, b) => a.id.localeCompare(b.id));
  removed.sort((a, b) => a.id.localeCompare(b.id));
  modified.sort((a, b) => a.id.localeCompare(b.id));

  return { added, removed, modified };
}

/**
 * Computes differences between non-route nodes.
 * @param {object[]} baseNodesList - Baseline nodes.
 * @param {object[]} currNodesList - Current nodes.
 * @returns {{added: object[], removed: object[], modified: object[]}}
 */
function diffNodes(baseNodesList, currNodesList) {
  const baseMap = new Map();
  for (const node of baseNodesList) {
    if (node.kind !== 'route') baseMap.set(node.id, node);
  }

  const currMap = new Map();
  for (const node of currNodesList) {
    if (node.kind !== 'route') currMap.set(node.id, node);
  }

  const added = [];
  const removed = [];
  const modified = [];

  for (const [id, curr] of currMap) {
    if (!baseMap.has(id)) {
      added.push(curr);
    } else {
      const base = baseMap.get(id);
      const locA = locationOfNode(base);
      const locB = locationOfNode(curr);
      const locDiff = compareLoc(locA, locB) !== 0;
      const otherDiff = !isNodeEqual(base, curr);

      if (locDiff || otherDiff) {
        modified.push({
          id: curr.id,
          kind: curr.kind,
          before: base,
          after: curr,
          loc: locB,
          wasLoc: locA,
        });
      }
    }
  }

  for (const [id, base] of baseMap) {
    if (!currMap.has(id)) {
      removed.push(base);
    }
  }

  added.sort((a, b) => a.id.localeCompare(b.id));
  removed.sort((a, b) => a.id.localeCompare(b.id));
  modified.sort((a, b) => a.id.localeCompare(b.id));

  return { added, removed, modified };
}

/**
 * Computes differences between non-route edges.
 * @param {object[]} baseEdgesList - Baseline edges.
 * @param {object[]} currEdgesList - Current edges.
 * @returns {{added: object[], removed: object[], modified: object[]}}
 */
function diffEdges(baseEdgesList, currEdgesList) {
  const edgeKey = (edge) => `${edge.from}|${edge.to}|${edge.kind}`;
  const isRouteEdge = (edge) =>
    edge.from.startsWith('route:') || edge.kind === 'routes-to' || edge.kind === 'guarded-by';

  const baseMap = new Map();
  for (const edge of baseEdgesList || []) {
    if (!isRouteEdge(edge)) {
      baseMap.set(edgeKey(edge), edge);
    }
  }

  const currMap = new Map();
  for (const edge of currEdgesList || []) {
    if (!isRouteEdge(edge)) {
      currMap.set(edgeKey(edge), edge);
    }
  }

  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, curr] of currMap) {
    if (!baseMap.has(key)) {
      added.push(curr);
    } else {
      const base = baseMap.get(key);
      if (base.confidence !== curr.confidence) {
        modified.push({
          from: curr.from,
          to: curr.to,
          kind: curr.kind,
          before: base,
          after: curr,
          confidence: curr.confidence,
          wasConfidence: base.confidence,
        });
      }
    }
  }

  for (const [key, base] of baseMap) {
    if (!currMap.has(key)) {
      removed.push(base);
    }
  }

  added.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  removed.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  modified.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));

  return { added, removed, modified };
}

/**
 * Computes differences between unresolved relationships.
 * @param {object[]} baseList - Baseline unresolved entries.
 * @param {object[]} currList - Current unresolved entries.
 * @returns {{added: object[], removed: object[], modified: object[]}}
 */
function diffUnresolved(baseList, currList) {
  const keyOf = (entry) => `${entry.reason}|${entry.expr || ''}|${entry.name || ''}|${entry.owner || ''}`;

  const baseMap = new Map();
  for (const entry of baseList || []) {
    baseMap.set(keyOf(entry), entry);
  }

  const currMap = new Map();
  for (const entry of currList || []) {
    currMap.set(keyOf(entry), entry);
  }

  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, curr] of currMap) {
    if (!baseMap.has(key)) {
      added.push(curr);
    } else {
      const base = baseMap.get(key);
      if (compareLoc(base.loc, curr.loc) !== 0) {
        modified.push({
          before: base,
          after: curr,
          ...curr,
        });
      }
    }
  }

  for (const [key, base] of baseMap) {
    if (!currMap.has(key)) {
      removed.push(base);
    }
  }

  added.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  removed.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  modified.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

  return { added, removed, modified };
}

/**
 * Compares two Atlas documents and returns a structured difference record.
 * @param {object} baseline - The baseline Atlas artifact.
 * @param {object} current - The current Atlas artifact.
 * @param {object} [options] - Options, such as baseline file path.
 * @returns {object} The difference record.
 * @throws {Error} If document formats or versions are invalid.
 */
export function diffAtlas(baseline, current, options = {}) {
  if (!baseline || typeof baseline !== 'object' || !Array.isArray(baseline.nodes)) {
    throw new Error('Not an Avenx Atlas document.');
  }
  if (!current || typeof current !== 'object' || !Array.isArray(current.nodes)) {
    throw new Error('Not an Avenx Atlas document.');
  }

  const baselineVersion = baseline.atlasVersion;
  const currentVersion = current.atlasVersion ?? ATLAS_VERSION;
  if (typeof baselineVersion !== 'number' || baselineVersion !== currentVersion) {
    throw new Error(
      `Baseline atlasVersion (${baselineVersion}) does not match current version (${currentVersion}). Please regenerate the baseline artifact.`,
    );
  }

  const baseRoutes = extractRoutes(baseline);
  const currRoutes = extractRoutes(current);

  const routes = diffRoutes(baseRoutes, currRoutes);
  const nodes = diffNodes(baseline.nodes || [], current.nodes || []);
  const edges = diffEdges(baseline.edges || [], current.edges || []);
  const unresolved = diffUnresolved(baseline.unresolved || [], current.unresolved || []);

  const nodeCount = nodes.added.length + nodes.removed.length + nodes.modified.length;
  const edgeCount = edges.added.length + edges.removed.length + edges.modified.length;
  const routeCount = routes.added.length + routes.removed.length + routes.modified.length;
  const unresolvedCount = unresolved.added.length + unresolved.removed.length + unresolved.modified.length;
  const total = nodeCount + edgeCount + routeCount + unresolvedCount;

  return {
    ...(options.baselinePath ? { baseline: options.baselinePath } : {}),
    differences: total,
    summary: {
      total,
      nodes: nodeCount,
      edges: edgeCount,
      routes: routeCount,
      unresolved: unresolvedCount,
    },
    nodes,
    edges,
    routes,
    unresolved,
  };
}

/**
 * Formats a difference record as a human-readable terminal report.
 * @param {object} diff - Result from diffAtlas.
 * @param {object} [options] - Formatting options, such as color helpers.
 * @returns {string} The formatted report.
 */
export function formatAtlasDiff(diff, options = {}) {
  const { colors = {} } = options;
  const bold = colors.bold || ((s) => s);
  const green = colors.green || ((s) => s);
  const red = colors.red || ((s) => s);
  const yellow = colors.yellow || ((s) => s);
  const gray = colors.gray || ((s) => s);

  if (diff.differences === 0) {
    return 'No differences.';
  }

  const lines = [];

  // 1. Nodes
  const { nodes, edges, routes, unresolved } = diff;
  const hasNodes = nodes.added.length + nodes.removed.length + nodes.modified.length > 0;
  if (hasNodes) {
    lines.push(bold('Nodes'));
    for (const node of nodes.added) {
      const loc = formatLoc(locationOfNode(node));
      lines.push(`  ${green('+')} ${node.id}${loc ? gray(` ${loc}`) : ''}`);
    }
    for (const node of nodes.removed) {
      const loc = formatLoc(locationOfNode(node));
      lines.push(`  ${red('-')} ${node.id}${loc ? gray(` (was ${loc})`) : ''}`);
    }
    for (const item of nodes.modified) {
      const currLoc = formatLoc(item.loc);
      const wasLoc = formatLoc(item.wasLoc);
      const locChange = wasLoc && wasLoc !== currLoc ? ` (was ${wasLoc})` : '';
      lines.push(`  ${yellow('~')} ${item.id}${currLoc ? gray(` ${currLoc}`) : ''}${locChange ? gray(locChange) : ''}`);
    }
  }

  // 2. Edges
  const hasEdges = edges.added.length + edges.removed.length + edges.modified.length > 0;
  if (hasEdges) {
    if (lines.length > 0) lines.push('');
    lines.push(bold('Edges'));
    for (const edge of edges.added) {
      const loc = !edge.from.includes('@') && edge.loc ? gray(` ${formatLoc(edge.loc)}`) : '';
      lines.push(`  ${green('+')} ${edge.from} ${edge.kind} ${edge.to} ${edge.confidence}${loc}`);
    }
    for (const edge of edges.removed) {
      const loc = !edge.from.includes('@') && edge.loc ? gray(` (was ${formatLoc(edge.loc)})`) : '';
      lines.push(`  ${red('-')} ${edge.from} ${edge.kind} ${edge.to} ${edge.confidence}${loc}`);
    }
    for (const item of edges.modified) {
      lines.push(
        `  ${yellow('~')} ${item.from} ${item.kind} ${item.to} now ${item.confidence} (was ${item.wasConfidence})`,
      );
    }
  }

  // 3. Routes
  const hasRoutes = routes.added.length + routes.removed.length + routes.modified.length > 0;
  if (hasRoutes) {
    if (lines.length > 0) lines.push('');
    lines.push(bold('Routes'));
    for (const route of routes.added) {
      const targetStr = route.target ? ` → ${route.target}` : '';
      const guardStr = route.guards.length ? ` guarded by ${route.guards.join(', ')}` : '';
      const locStr = route.loc ? ` ${formatLoc(route.loc)}` : '';
      lines.push(
        `  ${green('+')} '${route.name}'${targetStr}${guardStr ? gray(guardStr) : ''}${locStr ? gray(locStr) : ''}`,
      );
    }
    for (const route of routes.removed) {
      const targetStr = route.target ? ` → ${route.target}` : '';
      const guardStr = route.guards.length ? ` guarded by ${route.guards.join(', ')}` : '';
      const locStr = route.loc ? ` (was ${formatLoc(route.loc)})` : '';
      lines.push(
        `  ${red('-')} '${route.name}'${targetStr}${guardStr ? gray(guardStr) : ''}${locStr ? gray(locStr) : ''}`,
      );
    }
    for (const item of routes.modified) {
      lines.push(`  ${yellow('~')} '${item.name}' ${item.changes.join(', ')}`);
    }
  }

  // 4. Unresolved
  const hasUnresolved = unresolved.added.length + unresolved.removed.length + unresolved.modified.length > 0;
  if (hasUnresolved) {
    if (lines.length > 0) lines.push('');
    lines.push(bold('Unresolved'));
    for (const entry of unresolved.added) {
      const subject = entry.expr || entry.name || '';
      const owner = entry.owner ? ` in ${entry.owner}` : '';
      const loc = entry.loc ? gray(` ${formatLoc(entry.loc)}`) : '';
      lines.push(`  ${green('+')} ${entry.reason}${subject ? ` ${subject}` : ''}${owner}${loc}`);
    }
    for (const entry of unresolved.removed) {
      const subject = entry.expr || entry.name || '';
      const owner = entry.owner ? ` in ${entry.owner}` : '';
      const loc = entry.loc ? gray(` (was ${formatLoc(entry.loc)})`) : '';
      lines.push(`  ${red('-')} ${entry.reason}${subject ? ` ${subject}` : ''}${owner}${loc}`);
    }
    for (const item of unresolved.modified) {
      const subject = item.expr || item.name || '';
      const owner = item.owner ? ` in ${item.owner}` : '';
      const currLoc = formatLoc(item.after?.loc || item.loc);
      const wasLoc = formatLoc(item.before?.loc);
      const locChange = wasLoc && wasLoc !== currLoc ? ` (was ${wasLoc})` : '';
      lines.push(
        `  ${yellow('~')} ${item.reason}${subject ? ` ${subject}` : ''}${owner}${currLoc ? gray(` ${currLoc}`) : ''}${locChange ? gray(locChange) : ''}`,
      );
    }
  }

  // Summary breakdown
  const parts = [];
  if (diff.summary.nodes > 0) {
    parts.push(`${diff.summary.nodes} node${diff.summary.nodes === 1 ? '' : 's'}`);
  }
  if (diff.summary.edges > 0) {
    parts.push(`${diff.summary.edges} edge${diff.summary.edges === 1 ? '' : 's'}`);
  }
  if (diff.summary.routes > 0) {
    parts.push(`${diff.summary.routes} route${diff.summary.routes === 1 ? '' : 's'}`);
  }
  if (diff.summary.unresolved > 0) {
    parts.push(`${diff.summary.unresolved} unresolved`);
  }

  const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const summaryLine = `${diff.differences} difference${diff.differences === 1 ? '' : 's'}${breakdown}`;

  if (lines.length > 0) lines.push('');
  lines.push(summaryLine);

  return lines.join('\n');
}

export default { diffAtlas, formatAtlasDiff, compareLoc, formatLoc };
