/**
 * @file query.js
 * @description Resolving a symbol a developer typed, and walking the graph
 * from it.
 *
 * `avenx impact` and `avenx why` are the same traversal in opposite
 * directions, because Atlas edges point the way dependencies point. Impact
 * follows edges *into* a node — everything that would be affected if it
 * changed. Why follows edges *out of* it — everything it is derived from.
 * Keeping them one function is what guarantees the two answers stay
 * consistent with each other.
 * @module lib/compiler/atlas/query
 */

import { AtlasEdgeKind, AtlasNodeKind } from './AppModel.js';

/**
 * Edge kinds that carry containment rather than data flow.
 *
 * A traversal follows them once, to name the component a binding lives in, but
 * never uses them to travel further — otherwise every query would flood with
 * every sibling declaration of everything it touched.
 * @type {Set<string>}
 */
const CONTAINMENT = new Set([AtlasEdgeKind.DECLARES]);

/**
 * How consequential each edge kind is, lowest first.
 *
 * Used only to choose which edge represents a node that several edges reach;
 * it does not affect which nodes are reached.
 * @type {Object<string, number>}
 */
const EDGE_PRIORITY = {
  [AtlasEdgeKind.WRITES]: 0,
  [AtlasEdgeKind.INVOKES]: 1,
  [AtlasEdgeKind.READS]: 2,
  [AtlasEdgeKind.SUBSCRIBES]: 3,
  [AtlasEdgeKind.EMITS]: 4,
  [AtlasEdgeKind.ROUTES_TO]: 5,
  [AtlasEdgeKind.GUARDED_BY]: 6,
  [AtlasEdgeKind.RENDERS]: 7,
  [AtlasEdgeKind.IMPORTS]: 8,
  [AtlasEdgeKind.DECLARES]: 9,
};

/**
 * The priority of an edge kind.
 * @param {string} kind - The edge kind.
 * @returns {number} Its priority, lowest first.
 */
function edgePriority(kind) {
  return EDGE_PRIORITY[kind] === undefined ? 99 : EDGE_PRIORITY[kind];
}

/**
 * Human-readable labels for node kinds.
 * @type {Object<string, string>}
 */
export const KIND_LABELS = {
  [AtlasNodeKind.COMPONENT]: 'component',
  [AtlasNodeKind.PAGE]: 'page',
  [AtlasNodeKind.BRIDGE]: 'bridge',
  [AtlasNodeKind.STATE]: 'state',
  [AtlasNodeKind.COMPUTED]: 'computed',
  [AtlasNodeKind.ACTION]: 'action',
  [AtlasNodeKind.RESOURCE]: 'resource',
  [AtlasNodeKind.GETTER]: 'getter',
  [AtlasNodeKind.EVENT]: 'event',
  [AtlasNodeKind.BINDING]: 'binding',
  [AtlasNodeKind.HANDLER]: 'handler',
  [AtlasNodeKind.ROUTE]: 'route',
  [AtlasNodeKind.GUARD]: 'guard',
};

/**
 * A display name for a node.
 * @param {object} model - The model.
 * @param {object} node - The node.
 * @returns {string} Something a developer can search for.
 */
export function displayName(model, node) {
  if (!node) return '<unknown>';
  if (node.kind === AtlasNodeKind.BINDING) {
    const owner = model.getNode(node.owner);
    const label = node.binding === 'for' ? '<@for>' : node.binding === 'text' ? '{{ }}' : node.binding;
    return `${owner ? owner.name : ''} ${label} ${node.expression ? `"${node.expression}"` : ''}`.trim();
  }
  if (node.kind === AtlasNodeKind.HANDLER) {
    const owner = model.getNode(node.owner);
    return `${owner ? owner.name : ''} @${node.event}="${node.expression}"`.trim();
  }
  if (node.owner) {
    const owner = model.getNode(node.owner);
    return `${owner ? owner.name : node.owner}.${node.name}`;
  }
  return node.name;
}

/**
 * A short `file:line` for a node, when it has one.
 * @param {object} node - The node.
 * @returns {string} The location, or an empty string.
 */
export function locationOf(node) {
  const loc = node && (node.loc || (node.file ? { file: node.file } : null));
  if (!loc || !loc.file) return '';
  return loc.line ? `${loc.file}:${loc.line}` : loc.file;
}

/**
 * Finds the nodes a typed symbol could mean.
 *
 * Accepts, in order of precision: a full node id, `Owner.member`, a bare owner
 * name, and a bare member name. Ambiguity is returned rather than guessed at —
 * `avenx impact items` on a project with three `items` should list them, not
 * pick one.
 * @param {object} model - The model.
 * @param {string} query - What the developer typed.
 * @returns {object[]} Matching nodes, most precise first.
 */
export function resolveSymbol(model, query) {
  const raw = String(query || '').trim();
  if (!raw) return [];

  if (model.hasNode(raw)) return [model.getNode(raw)];

  const lower = raw.toLowerCase();
  const nodes = [...model.nodes.values()];

  /** @type {object[]} */
  const qualified = [];
  /** @type {object[]} */
  const owners = [];
  /** @type {object[]} */
  const members = [];

  const dot = raw.lastIndexOf('.');
  const ownerPart = dot > 0 ? raw.slice(0, dot) : null;
  const memberPart = dot > 0 ? raw.slice(dot + 1) : null;

  for (const node of nodes) {
    if (node.kind === AtlasNodeKind.BINDING || node.kind === AtlasNodeKind.HANDLER) continue;

    if (ownerPart && memberPart && node.owner) {
      const owner = model.getNode(node.owner);
      if (
        owner &&
        owner.name.toLowerCase() === ownerPart.toLowerCase() &&
        String(node.name).toLowerCase() === memberPart.toLowerCase()
      ) {
        qualified.push(node);
        continue;
      }
    }

    if (!node.owner && String(node.name).toLowerCase() === lower) {
      owners.push(node);
      continue;
    }

    if (node.owner && String(node.name).toLowerCase() === lower) {
      members.push(node);
    }
  }

  // A route is named by its path, which contains no dot to split on.
  if (qualified.length === 0 && owners.length === 0) {
    for (const node of nodes) {
      if (node.kind !== AtlasNodeKind.ROUTE) continue;
      if (String(node.name).toLowerCase() === lower || String(node.pattern).toLowerCase() === lower) {
        owners.push(node);
      }
    }
  }

  const ordered = [...qualified, ...owners, ...members];
  const seen = new Set();
  return ordered.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

/**
 * Walks the graph from a node, producing a tree of paths.
 *
 * Breadth-first with a visited set, so a node appears once, at its shortest
 * distance from the root. A dependency graph has diamonds all over it — two
 * components reading one bridge getter — and printing every path through them
 * would turn a useful answer into a wall.
 * @param {object} model - The model.
 * @param {string} rootId - Where to start.
 * @param {object} [options] - Traversal options.
 * @param {'in'|'out'} [options.direction] - `in` for impact, `out` for why.
 * @param {number} [options.depth] - Maximum hops. Defaults to 12.
 * @returns {{root: object, children: object[], truncated: boolean}} The tree.
 */
export function walk(model, rootId, options = {}) {
  const direction = options.direction === 'out' ? 'out' : 'in';
  const maxDepth = Number.isFinite(options.depth) ? options.depth : 12;

  const root = model.getNode(rootId);
  if (!root) return { root: null, children: [], truncated: false };

  const visited = new Set([rootId]);
  /** @type {Map<string, object>} */
  const byId = new Map();
  const rootEntry = { node: root, edge: null, children: [], depth: 0 };
  byId.set(rootId, rootEntry);

  let truncated = false;
  const queue = [rootEntry];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      truncated = true;
      continue;
    }

    const edges = direction === 'in' ? model.incoming(current.node.id) : model.outgoing(current.node.id);

    // A node is visited once, so when several edges reach it the one that gets
    // shown should be the most consequential. `cart.addQty` both reads
    // `cart.items` (to find an entry) and writes it; reporting only the read
    // would hide the single most important fact in an impact query.
    const ordered = [...edges].sort((a, b) => edgePriority(a.kind) - edgePriority(b.kind));

    for (const edge of ordered) {
      const nextId = direction === 'in' ? edge.from : edge.to;

      // Containment is followed only to name the component a binding or
      // handler lives in. Following it from anywhere else would turn every
      // query into a listing of the whole owner: an impact query on
      // `cart.items` would report every component that merely imports `cart`,
      // which is a different and much weaker claim than the one being made.
      const isContainment = CONTAINMENT.has(edge.kind);
      if (isContainment && direction === 'out') continue;
      if (
        isContainment &&
        current.node.kind !== AtlasNodeKind.BINDING &&
        current.node.kind !== AtlasNodeKind.HANDLER
      ) {
        continue;
      }

      if (visited.has(nextId)) continue;
      const next = model.getNode(nextId);
      if (!next) continue;

      visited.add(nextId);
      const entry = { node: next, edge, children: [], depth: current.depth + 1 };
      byId.set(nextId, entry);
      current.children.push(entry);
      queue.push(entry);
    }
  }

  sortTree(rootEntry);
  return { root: rootEntry, children: rootEntry.children, truncated, size: visited.size - 1 };
}

/**
 * Orders a tree so two runs print identically.
 * @param {object} entry - A tree entry.
 * @returns {void}
 */
function sortTree(entry) {
  entry.children.sort((a, b) => {
    if (a.edge.kind !== b.edge.kind) return a.edge.kind < b.edge.kind ? -1 : 1;
    const fileA = (a.edge.loc && a.edge.loc.file) || '';
    const fileB = (b.edge.loc && b.edge.loc.file) || '';
    if (fileA !== fileB) return fileA < fileB ? -1 : 1;
    const lineA = (a.edge.loc && a.edge.loc.line) || 0;
    const lineB = (b.edge.loc && b.edge.loc.line) || 0;
    if (lineA !== lineB) return lineA - lineB;
    return a.node.id < b.node.id ? -1 : 1;
  });
  for (const child of entry.children) sortTree(child);
}

/**
 * Flattens a walk into a serializable list.
 * @param {object} entry - The tree root from {@link walk}.
 * @returns {object[]} One record per reached node.
 */
export function flatten(entry) {
  const out = [];
  const visit = (current, path) => {
    for (const child of current.children) {
      out.push({
        id: child.node.id,
        kind: child.node.kind,
        name: child.node.name,
        via: child.edge.kind,
        confidence: child.edge.confidence,
        depth: child.depth,
        path: [...path, child.node.id],
        ...(child.edge.loc ? { loc: child.edge.loc } : {}),
        ...(child.edge.path ? { member: child.edge.path } : {}),
      });
      visit(child, [...path, child.node.id]);
    }
  };
  visit(entry, [entry.node.id]);
  return out;
}

/**
 * Collects the unresolved entries relevant to a set of reached nodes.
 *
 * A query's answer is incomplete exactly where analysis was, so the two are
 * reported together rather than leaving the reader to guess.
 * @param {object} model - The model.
 * @param {object[]} reached - Records from {@link flatten}.
 * @param {string} rootId - The queried node id.
 * @returns {object[]} The relevant unresolved entries.
 */
export function relevantUnresolved(model, reached, rootId) {
  const owners = new Set([rootId]);
  const rootNode = model.getNode(rootId);
  if (rootNode && rootNode.owner) owners.add(rootNode.owner);
  for (const record of reached) {
    owners.add(record.id);
    const node = model.getNode(record.id);
    if (node && node.owner) owners.add(node.owner);
  }
  return model.unresolved.filter((entry) => entry.owner && owners.has(entry.owner));
}

export default { resolveSymbol, walk, flatten, displayName, locationOf, relevantUnresolved };
