/**
 * @file AppModel.js
 * @description The Avenx Atlas data model — the compiler's semantic map of an
 * application.
 *
 * The compiler already computes almost everything Atlas needs: declared state,
 * computed expressions, action bodies, resources, contracts, template ASTs,
 * bridge descriptors and the component dependency graph. Until now it threw
 * all of that away the moment it had emitted a bundle. Atlas is the retained
 * form of that knowledge.
 *
 * ## Shape
 *
 * A model is a set of **nodes** (the application's semantic entities) and a set
 * of **edges** (the relationships between them), plus an explicit list of the
 * things analysis could *not* resolve. The third list is not an afterthought:
 * an Atlas that silently dropped what it could not understand would answer
 * "nothing depends on this" with the same confidence whether that was true or
 * whether it simply failed to look. Every query surface reports it.
 *
 * ## Edge direction
 *
 * Edges always point in the **dependency direction**: `A reads B` is an edge
 * from A to B. That makes the two query verbs the two directions of the same
 * walk:
 *
 * - `avenx why X`    — follow edges *out* of X: what X depends on.
 * - `avenx impact X` — follow edges *into* X: what depends on X.
 * @module lib/compiler/atlas/AppModel
 */

/**
 * The Atlas format version.
 *
 * Bump this when the meaning of an existing field changes or a field a reader
 * depends on is removed. Adding a new optional field does not require a bump;
 * readers must tolerate unknown fields.
 * @type {number}
 */
export const ATLAS_VERSION = 1;

/**
 * The semantic entities Atlas models.
 *
 * These mirror Avenx's own declarations rather than JavaScript's constructs: a
 * developer asks about `cart.items`, not about an object property on a module
 * that happens to be a bridge.
 * @readonly
 * @enum {string}
 */
export const AtlasNodeKind = {
  /** A component class compiled from a `.component.js` file. */
  COMPONENT: 'component',
  /** A page compiled from a `.page.js` file. */
  PAGE: 'page',
  /** A bridge module. */
  BRIDGE: 'bridge',
  /** A single declared state key, on a component or a bridge. */
  STATE: 'state',
  /** A `<computed>` declaration. */
  COMPUTED: 'computed',
  /** An `<action>` body, or an action declared on a bridge. */
  ACTION: 'action',
  /** A `<resource>` declaration. */
  RESOURCE: 'resource',
  /** A bridge getter. */
  GETTER: 'getter',
  /** An event a bridge emits. */
  EVENT: 'event',
  /** A `{{ ... }}` interpolation or a directive expression in a template. */
  BINDING: 'binding',
  /** An `@event="..."` handler in a template. */
  HANDLER: 'handler',
  /** A route pattern registered with `initRouter`. */
  ROUTE: 'route',
  /** A route guard class. */
  GUARD: 'guard',
};

/**
 * The relationships Atlas models.
 * @readonly
 * @enum {string}
 */
export const AtlasEdgeKind = {
  /** The source evaluates the target's value. */
  READS: 'reads',
  /** The source mutates the target. */
  WRITES: 'writes',
  /** The source calls the target. */
  INVOKES: 'invokes',
  /** A component or page renders a child component. */
  RENDERS: 'renders',
  /** A module imports another module (component, page or bridge). */
  IMPORTS: 'imports',
  /** A route resolves to a page. */
  ROUTES_TO: 'routes-to',
  /** A route or page is protected by a guard. */
  GUARDED_BY: 'guarded-by',
  /** Containment: an owner declares one of its members. */
  DECLARES: 'declares',
  /** A bridge action emits an event. */
  EMITS: 'emits',
  /** Code subscribes to a bridge event. */
  SUBSCRIBES: 'subscribes',
};

/**
 * How much an edge can be trusted.
 *
 * There is deliberately no `certain` shortcut for "we did not look". Anything
 * analysis could not follow becomes an {@link UnresolvedReason} entry instead
 * of a confident edge or a silent omission.
 * @readonly
 * @enum {string}
 */
export const Confidence = {
  /** The relationship follows directly from a declaration. */
  CERTAIN: 'certain',
  /** The relationship is likely but analysis could not prove it. */
  POSSIBLE: 'possible',
};

/**
 * Stable reasons a relationship could not be resolved.
 * @readonly
 * @enum {string}
 */
export const UnresolvedReason = {
  /** A member was reached through a computed key: `items[key]`. */
  DYNAMIC_MEMBER: 'dynamic-member',
  /** A root identifier matched no declaration in scope. */
  UNKNOWN_IDENTIFIER: 'unknown-identifier',
  /** A bridge was accessed through a member it does not declare. */
  UNKNOWN_BRIDGE_MEMBER: 'unknown-bridge-member',
  /** A local binding shadows a declaration of the same name. */
  SHADOWED_IDENTIFIER: 'shadowed-identifier',
  /** A call whose callee is not a statically known declaration. */
  DYNAMIC_INVOCATION: 'dynamic-invocation',
  /** A spread whose contents cannot be enumerated. */
  SPREAD: 'spread',
  /** A `<Component :is>`-style tag whose identity is an expression. */
  DYNAMIC_COMPONENT: 'dynamic-component',
  /**
   * A scoped-slot variable. Its value comes from whichever parent fills the
   * slot, which is a relationship the static model does not carry.
   */
  SLOT_SCOPE: 'slot-scope',
  /** A route target that is not a literal page name. */
  DYNAMIC_ROUTE: 'dynamic-route',
};

/**
 * Builds a stable node id.
 *
 * Ids are human-readable on purpose: they show up in `--json` output, in
 * golden test fixtures and in diff review, and `state:bridge:cart.items` is
 * legible where a hash would not be.
 * @param {string} kind - One of {@link AtlasNodeKind}.
 * @param {string|null} owner - The owning node's id, or null for a top-level entity.
 * @param {string} name - The entity's declared name.
 * @returns {string} The node id.
 */
export function nodeId(kind, owner, name) {
  return owner ? `${kind}:${owner}.${name}` : `${kind}:${name}`;
}

/**
 * Compares two locations for deterministic ordering.
 * @param {object|null} a - A location.
 * @param {object|null} b - A location.
 * @returns {number} Sort order.
 */
function compareLoc(a, b) {
  const fileA = (a && a.file) || '';
  const fileB = (b && b.file) || '';
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const lineA = (a && a.line) || 0;
  const lineB = (b && b.line) || 0;
  if (lineA !== lineB) return lineA - lineB;
  return ((a && a.column) || 0) - ((b && b.column) || 0);
}

/**
 * The application's semantic model.
 *
 * Built as a by-product of compilation — nothing here re-parses a file the
 * compiler has already read — and serialized beside the bundle rather than
 * into it.
 */
export class AppModel {
  /**
   * Creates an empty model.
   */
  constructor() {
    /**
     * Nodes by id.
     * @type {Map<string, object>}
     */
    this.nodes = new Map();

    /**
     * Every edge, in insertion order. Deduplicated by {@link AppModel#edgeKey}.
     * @type {object[]}
     */
    this.edges = [];

    /** @type {Set<string>} */
    this.__edgeKeys = new Set();

    /**
     * Relationships analysis could not resolve.
     * @type {object[]}
     */
    this.unresolved = [];

    /** @type {Set<string>} */
    this.__unresolvedKeys = new Set();

    /**
     * Adjacency indexes, invalidated whenever an edge is added.
     * @type {Map<string, object[]>|null}
     */
    this.__out = null;
    /** @type {Map<string, object[]>|null} */
    this.__in = null;
  }

  /**
   * Adds a node, merging into an existing one with the same id.
   *
   * Merging matters because a node can be discovered twice from two directions
   * — a bridge is created when it is analysed and referenced again when a
   * component imports it — and the second sighting must not erase the first
   * one's location or metadata.
   * @param {object} node - The node. Must carry `id` and `kind`.
   * @returns {object} The stored node.
   */
  addNode(node) {
    if (!node || !node.id) {
      throw new TypeError('An Atlas node requires an id.');
    }
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, { ...node });
      return this.nodes.get(node.id);
    }
    for (const [key, value] of Object.entries(node)) {
      if (value !== undefined && value !== null && existing[key] === undefined) {
        existing[key] = value;
      }
    }
    return existing;
  }

  /**
   * Whether a node id is present.
   * @param {string} id - The node id.
   * @returns {boolean} True when the node exists.
   */
  hasNode(id) {
    return this.nodes.has(id);
  }

  /**
   * Looks a node up by id.
   * @param {string} id - The node id.
   * @returns {object|undefined} The node.
   */
  getNode(id) {
    return this.nodes.get(id);
  }

  /**
   * The deduplication key for an edge.
   *
   * Location is part of the key so two distinct call sites of the same action
   * stay two edges — `avenx impact` prints them as separate lines, which is
   * the point.
   * @param {object} edge - The edge.
   * @returns {string} The key.
   */
  edgeKey(edge) {
    const loc = edge.loc || {};
    return [edge.from, edge.to, edge.kind, loc.file || '', loc.line || '', loc.column || ''].join('|');
  }

  /**
   * Adds an edge between two nodes.
   *
   * An edge naming a node that does not exist is dropped rather than creating
   * a phantom: every query walks this graph, and a dangling target would print
   * as a relationship to nothing.
   * @param {object} edge - `{from, to, kind, confidence, loc?, path?, via?}`.
   * @returns {boolean} True when the edge was stored.
   */
  addEdge(edge) {
    if (!edge || !edge.from || !edge.to || !edge.kind) {
      return false;
    }
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      return false;
    }
    const key = this.edgeKey(edge);
    if (this.__edgeKeys.has(key)) {
      return false;
    }
    this.__edgeKeys.add(key);
    this.edges.push({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      confidence: edge.confidence || Confidence.CERTAIN,
      ...(edge.loc ? { loc: edge.loc } : {}),
      ...(edge.path ? { path: edge.path } : {}),
      ...(edge.via ? { via: edge.via } : {}),
    });
    this.__out = null;
    this.__in = null;
    return true;
  }

  /**
   * Records something analysis could not resolve.
   * @param {object} entry - `{reason, expr, owner?, loc?, name?}`.
   * @returns {boolean} True when the entry was stored.
   */
  addUnresolved(entry) {
    if (!entry || !entry.reason) {
      return false;
    }
    const loc = entry.loc || {};
    const key = [entry.reason, entry.expr || '', entry.owner || '', loc.file || '', loc.line || ''].join('|');
    if (this.__unresolvedKeys.has(key)) {
      return false;
    }
    this.__unresolvedKeys.add(key);
    this.unresolved.push({
      reason: entry.reason,
      ...(entry.expr !== undefined ? { expr: entry.expr } : {}),
      ...(entry.name !== undefined ? { name: entry.name } : {}),
      ...(entry.owner ? { owner: entry.owner } : {}),
      ...(entry.loc ? { loc: entry.loc } : {}),
    });
    return true;
  }

  /**
   * Builds the adjacency indexes on first use.
   * @private
   */
  #index() {
    if (this.__out && this.__in) return;
    this.__out = new Map();
    this.__in = new Map();
    for (const edge of this.edges) {
      if (!this.__out.has(edge.from)) this.__out.set(edge.from, []);
      this.__out.get(edge.from).push(edge);
      if (!this.__in.has(edge.to)) this.__in.set(edge.to, []);
      this.__in.get(edge.to).push(edge);
    }
  }

  /**
   * Edges leaving a node — what it depends on.
   * @param {string} id - The node id.
   * @returns {object[]} The edges.
   */
  outgoing(id) {
    this.#index();
    return this.__out.get(id) || [];
  }

  /**
   * Edges entering a node — what depends on it.
   * @param {string} id - The node id.
   * @returns {object[]} The edges.
   */
  incoming(id) {
    this.#index();
    return this.__in.get(id) || [];
  }

  /**
   * Every node of a given kind.
   * @param {string} kind - One of {@link AtlasNodeKind}.
   * @returns {object[]} The nodes, ordered by id.
   */
  nodesOfKind(kind) {
    return [...this.nodes.values()].filter((node) => node.kind === kind).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /**
   * The unresolved entries recorded against one owner.
   * @param {string} owner - An owner node id.
   * @returns {object[]} The entries.
   */
  unresolvedFor(owner) {
    return this.unresolved.filter((entry) => entry.owner === owner);
  }

  /**
   * A count of each node kind, for the `avenx atlas` summary.
   * @returns {Object<string, number>} Counts keyed by kind.
   */
  counts() {
    /** @type {Object<string, number>} */
    const totals = {};
    for (const kind of Object.values(AtlasNodeKind)) {
      totals[kind] = 0;
    }
    for (const node of this.nodes.values()) {
      totals[node.kind] = (totals[node.kind] || 0) + 1;
    }
    return totals;
  }

  /**
   * Serializes the model.
   *
   * Nodes, edges and unresolved entries are sorted rather than emitted in
   * discovery order, so two builds of unchanged sources produce byte-identical
   * output and the artifact can be diffed in review.
   * @returns {object} The serializable model.
   */
  toJSON() {
    const nodes = [...this.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const edges = [...this.edges].sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return compareLoc(a.loc, b.loc);
    });

    const unresolved = [...this.unresolved].sort((a, b) => {
      if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;
      const byLoc = compareLoc(a.loc, b.loc);
      if (byLoc !== 0) return byLoc;
      return String(a.expr || '') < String(b.expr || '') ? -1 : 1;
    });

    return { nodes, edges, unresolved };
  }
}

export default AppModel;
