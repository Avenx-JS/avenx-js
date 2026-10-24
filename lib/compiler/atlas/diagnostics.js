/**
 * @file diagnostics.js
 * @description The findings Atlas can safely derive from the model.
 *
 * Most diagnostics here are **absence** claims - "nothing reads this", "nothing
 * invokes this" - and an absence claim is only as good as the completeness of
 * the search behind it. Atlas knows exactly where its search was incomplete,
 * because it recorded every relationship it could not resolve, so each rule
 * checks that record before concluding anything. Circular-computed detection
 * is the opposite kind of claim: it reads edges that *are* present.
 *
 * The rule this file exists to enforce: **a diagnostic must never conclude
 * "never read" from a body the analyser could not follow.** A false AVX_W40 on
 * a state key that is read through a computed member would teach a developer
 * to stop trusting the whole feature, which costs far more than the warnings
 * it suppresses.
 * @module lib/compiler/atlas/diagnostics
 */

import { AtlasEdgeKind, AtlasNodeKind, UnresolvedReason } from './AppModel.js';
import { findUndeclaredSlotNames } from './slots.js';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { LIFECYCLE_HOOK_KEYS } from '../../core/runtime/lifecycleHooks.js';
import { BuildError } from '../errors/index.js';
import { reportWarning } from '../utils/warningReporter.js';

/**
 * Actions the runtime calls by name, so nothing in a template needs to.
 *
 * `AvenxComponent` looks each of these up in the component's own methods when
 * the corresponding lifecycle moment arrives (see `#runHooks`), which means an
 * `<action name="onMount">` is reachable even though no call site exists.
 * @type {Set<string>}
 */
export const RUNTIME_INVOKED_ACTIONS = new Set([...LIFECYCLE_HOOK_KEYS, 'setup']);

/**
 * Unresolved reasons that could be concealing the very relationship a
 * diagnostic is about to claim does not exist.
 *
 * A dynamic member could be the read. A shadowed identifier means a body was
 * not followed. A spread could carry the value out. An unknown identifier
 * could be the missing link. None of them can be ruled out, so none of them
 * may be ignored.
 * @type {Set<string>}
 */
const BLOCKING_REASONS = new Set([
  UnresolvedReason.DYNAMIC_MEMBER,
  UnresolvedReason.SHADOWED_IDENTIFIER,
  UnresolvedReason.SPREAD,
  UnresolvedReason.UNKNOWN_IDENTIFIER,
  UnresolvedReason.SLOT_SCOPE,
]);

/**
 * Whether a node belongs to a bridge that nothing imports.
 *
 * Such a bridge is already reported, once, as omitted from the bundle. Adding
 * a warning for every state key and action inside it piles noise on a fact
 * that has been stated — and it fires on a freshly scaffolded bridge, before
 * the developer has had a chance to import it, which is the worst possible
 * first impression for a diagnostic. Once something imports the bridge, its
 * members are worth checking individually again.
 * @param {object} model - The model.
 * @param {object} node - The node being reasoned about.
 * @returns {boolean} True when the owning bridge has no consumers.
 */
function inUnimportedBridge(model, node) {
  const owner = node.owner ? model.getNode(node.owner) : null;
  if (!owner || owner.kind !== AtlasNodeKind.BRIDGE) return false;
  return !model.incoming(owner.id).some((edge) => edge.kind === AtlasEdgeKind.IMPORTS);
}

/**
 * Resolves the unit an expression site belongs to.
 * @param {object} model - The model.
 * @param {string} siteId - A node id recorded as an unresolved entry's owner.
 * @returns {string|null} The owning component, page or bridge id.
 */
function unitOf(model, siteId) {
  const node = model.getNode(siteId);
  if (!node) return siteId;
  if (node.kind === AtlasNodeKind.COMPONENT || node.kind === AtlasNodeKind.PAGE || node.kind === AtlasNodeKind.BRIDGE) {
    return node.id;
  }
  return node.owner || null;
}

/**
 * The units whose incomplete analysis could hide a relationship to `target`.
 *
 * For a component's own state that is the component itself. For a bridge's
 * state or actions it is the bridge plus every unit that imports it, directly
 * or through another bridge — anywhere a consumer could be reaching the member
 * in a way the analyser could not follow.
 * @param {object} model - The model.
 * @param {object} target - The node being reasoned about.
 * @returns {Set<string>} Unit ids whose unresolved entries block a conclusion.
 */
function blockingUnits(model, target) {
  const owner = target.owner;
  const units = new Set([owner]);
  const ownerNode = model.getNode(owner);
  if (!ownerNode || ownerNode.kind !== AtlasNodeKind.BRIDGE) {
    return units;
  }

  const queue = [owner];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of model.incoming(current)) {
      if (edge.kind !== AtlasEdgeKind.IMPORTS) continue;
      if (units.has(edge.from)) continue;
      units.add(edge.from);
      queue.push(edge.from);
    }
  }
  return units;
}

/**
 * Whether analysis was complete enough to make an absence claim about a node.
 * @param {object} model - The model.
 * @param {object} target - The node being reasoned about.
 * @returns {boolean} True when nothing unresolved could be hiding the relationship.
 */
export function analysisIsComplete(model, target) {
  const units = blockingUnits(model, target);
  for (const entry of model.unresolved) {
    if (!BLOCKING_REASONS.has(entry.reason)) continue;
    if (!entry.owner) return false;
    const unit = unitOf(model, entry.owner);
    if (unit && units.has(unit)) return false;
  }
  return true;
}

/**
 * Finds computed (and bridge getter) properties that participate in a
 * circular READS cycle.
 *
 * A self-referential `<computed name="x" value="x + 1">` already leaves a
 * `reads` edge from the node to itself in the model; mutual cycles
 * (`a` reads `b`, `b` reads `a`) leave a longer path. The runtime reports
 * these as AVX_R04 only after the page has rendered `NaN`, so Atlas reports
 * them at compile time from the edges it already has.
 * @param {object} model - The model.
 * @returns {Array<{nodes: object[], cycle: string[]}>} One finding per distinct cycle.
 */
export function findCircularComputed(model) {
  const candidates = [
    ...model.nodesOfKind(AtlasNodeKind.COMPUTED),
    ...model.nodesOfKind(AtlasNodeKind.GETTER),
  ];
  if (candidates.length === 0) return [];

  const ids = new Set(candidates.map((node) => node.id));
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const node of candidates) {
    const deps = [];
    const seen = new Set();
    for (const edge of model.outgoing(node.id)) {
      if (edge.kind !== AtlasEdgeKind.READS) continue;
      if (!ids.has(edge.to) || seen.has(edge.to)) continue;
      seen.add(edge.to);
      deps.push(edge.to);
    }
    adj.set(node.id, deps);
  }

  /** @type {Map<string, number>} 0 = unseen, 1 = on stack, 2 = done */
  const color = new Map();
  /** @type {string[]} */
  const stack = [];
  /** @type {Array<{nodes: object[], cycle: string[]}>} */
  const findings = [];
  /** @type {Set<string>} */
  const reported = new Set();

  /**
   * Canonical key for a cycle so A→B→A and B→A→B are one finding.
   * @param {string[]} cycleIds - Node ids on the cycle, without the closing repeat.
   * @returns {string} Stable key.
   */
  const cycleKey = (cycleIds) => {
    if (cycleIds.length === 0) return '';
    let min = 0;
    for (let i = 1; i < cycleIds.length; i += 1) {
      if (cycleIds[i] < cycleIds[min]) min = i;
    }
    const rotated = cycleIds.slice(min).concat(cycleIds.slice(0, min));
    return rotated.join('->');
  };

  /**
   * Depth-first search that records each distinct cycle once.
   * @param {string} id - Current node id.
   * @returns {void}
   */
  const visit = (id) => {
    color.set(id, 1);
    stack.push(id);
    for (const next of adj.get(id) || []) {
      const state = color.get(next) || 0;
      if (state === 0) {
        visit(next);
      } else if (state === 1) {
        const start = stack.indexOf(next);
        if (start === -1) continue;
        const cycleIds = stack.slice(start);
        const key = cycleKey(cycleIds);
        if (reported.has(key)) continue;
        reported.add(key);
        const nodes = cycleIds.map((cycleId) => model.getNode(cycleId)).filter(Boolean);
        findings.push({ nodes, cycle: cycleIds });
      }
    }
    stack.pop();
    color.set(id, 2);
  };

  for (const node of candidates) {
    if ((color.get(node.id) || 0) === 0) visit(node.id);
  }

  findings.sort((a, b) => {
    const aName = a.nodes[0] ? a.nodes[0].id : '';
    const bName = b.nodes[0] ? b.nodes[0].id : '';
    return aName < bName ? -1 : aName > bName ? 1 : 0;
  });
  return findings;
}

/**
 * Finds state that nothing in the application reads.
 * @param {object} model - The model.
 * @returns {Array<object>} Findings, each with the node and its writers.
 */
export function findUnreadState(model) {
  const findings = [];

  for (const node of model.nodesOfKind(AtlasNodeKind.STATE)) {
    if (inUnimportedBridge(model, node)) continue;

    const incoming = model.incoming(node.id);
    const reads = incoming.filter((edge) => edge.kind === AtlasEdgeKind.READS);
    if (reads.length > 0) continue;

    if (!analysisIsComplete(model, node)) continue;

    const writers = incoming
      .filter((edge) => edge.kind === AtlasEdgeKind.WRITES)
      .map((edge) => model.getNode(edge.from))
      .filter(Boolean);

    findings.push({ node, writers });
  }

  return findings;
}

/**
 * Finds actions no supported invocation surface can reach.
 *
 * The surfaces are the ones the compiler can see: a template handler or
 * binding, another action, a computed, a resource, a guard, a bridge member,
 * and the lifecycle names the runtime calls by itself.
 * @param {object} model - The model.
 * @returns {Array<object>} Findings, each with the unreachable action node.
 */
export function findUnreachableActions(model) {
  const findings = [];

  for (const node of model.nodesOfKind(AtlasNodeKind.ACTION)) {
    if (RUNTIME_INVOKED_ACTIONS.has(node.name)) continue;
    if (inUnimportedBridge(model, node)) continue;

    const invocations = model.incoming(node.id).filter((edge) => edge.kind === AtlasEdgeKind.INVOKES);
    if (invocations.length > 0) continue;

    // A dynamic invocation anywhere in reach could be this one.
    const units = blockingUnits(model, node);
    const hidden = model.unresolved.some((entry) => {
      if (entry.reason !== UnresolvedReason.DYNAMIC_INVOCATION && entry.reason !== UnresolvedReason.UNKNOWN_IDENTIFIER) {
        return false;
      }
      if (!entry.owner) return true;
      const unit = unitOf(model, entry.owner);
      return unit ? units.has(unit) : true;
    });
    if (hidden) continue;

    findings.push({ node });
  }

  return findings;
}

/**
 * Whether the application has no way to put any page on screen.
 *
 * This is the one absence claim in this file that does not need the
 * completeness guard, because it is not reasoning about a body it might have
 * failed to follow. Routing is *declared*: a route table is an object literal
 * in `main.app.js` and `mountPage` is a call by that name in the same file.
 * Both are read straight from the source, so "no route and no mount" is a fact
 * about the text rather than an inference from analysis that might be partial.
 *
 * It is deliberately all-or-nothing. A project that routes some of its pages
 * and mounts others is doing something the compiler cannot follow, and warning
 * per unrouted page would fire on every legitimate arrangement of that kind.
 * A project with *no* route and *no* mount cannot render anything at all: the
 * container stays empty, the browser reports nothing, and the build reports
 * nothing -- which is exactly what a freshly scaffolded project plus
 * `avenx generate page` produces.
 * @param {object} model - The model.
 * @returns {{pages: object[], entryFile: string}|null} The finding, or null.
 */
export function findNoReachablePage(model) {
  const pages = model.nodesOfKind(AtlasNodeKind.PAGE);
  if (pages.length === 0) return null;

  // A project with no main.app.js is a different problem, reported elsewhere;
  // concluding "nothing is routed" from a file that was never read would be
  // exactly the inference this module exists to forbid.
  if (!model.entry || !model.entry.file) return null;
  if (model.entry.mountsDirectly) return null;
  if (model.nodesOfKind(AtlasNodeKind.ROUTE).length > 0) return null;

  const sorted = [...pages].sort((a, b) => a.name.localeCompare(b.name));
  return { pages: sorted, entryFile: model.entry.file };
}

/**
 * Finds components a template renders that the application never registers.
 *
 * Pages under `src/pages` are registered by the compiler; components are not.
 * An application has to call `app.register()` for each one, and a component a
 * template uses but nothing registers renders *nothing*: the runtime leaves the
 * host element empty and logs AVX_W13 when the page is opened. The build is
 * clean, `avenx check` passes, and the missing content is only visible in a
 * browser.
 *
 * Like the route table, registration is *declared* -- `app.register('Name', X)`
 * in the entry point -- so this reads the source rather than inferring from
 * analysis. Two guards keep the absence claim honest:
 *
 *  - a `register()` call whose name is computed at run time means any component
 *    could be registered, so nothing is reported for the whole application;
 *  - a component nothing renders is not reported, because an unused component
 *    needs no registration.
 * @param {object} model - The model.
 * @returns {Array<object>} Findings, each with the component node and its renderers.
 */
export function findUnregisteredComponents(model) {
  const entry = model.entry;
  if (!entry || !entry.file || entry.dynamicRegistration) return [];

  const registered = entry.registeredComponents || new Set();
  const findings = [];

  for (const node of model.nodesOfKind(AtlasNodeKind.COMPONENT)) {
    if (registered.has(node.name)) continue;

    const renderers = model
      .incoming(node.id)
      .filter((edge) => edge.kind === AtlasEdgeKind.RENDERS)
      .map((edge) => model.getNode(edge.from))
      .filter(Boolean);
    if (renderers.length === 0) continue;

    findings.push({ node, renderers });
  }

  return findings.sort((a, b) => a.node.name.localeCompare(b.node.name));
}

/**
 * Finds caller `slot="…"` names that the rendered component does not declare.
 *
 * Content addressed to an undeclared slot is discarded at run time with no
 * message. The sets compared here are retained on `renders` edges (addressed)
 * and on component nodes (declared) when Atlas walks the same relationship
 * AVX_W56 already uses.
 *
 * A dynamic slot name on either side suppresses the claim for that edge: the
 * static set would be incomplete, and an absence claim from an incomplete set
 * is the failure mode this module exists to forbid.
 * @param {object} model - The model.
 * @returns {Array<object>} Findings with slot, suggestion, callee, renderer, loc.
 */
export function findUndeclaredSlots(model) {
  const findings = [];

  for (const edge of model.edges) {
    if (edge.kind !== AtlasEdgeKind.RENDERS) continue;
    if (edge.dynamicSlots) continue;

    const callee = model.getNode(edge.to);
    if (!callee || callee.kind !== AtlasNodeKind.COMPONENT) continue;
    if (callee.dynamicSlots) continue;

    const addressed = edge.slots || [];
    if (addressed.length === 0) continue;

    const declared = callee.slots || [];
    const undeclared = findUndeclaredSlotNames(addressed, declared);
    if (undeclared.length === 0) continue;

    const renderer = model.getNode(edge.from);
    for (const item of undeclared) {
      findings.push({
        slot: item.slot,
        suggestion: item.suggestion,
        callee,
        renderer,
        declared,
        loc: edge.loc || null,
      });
    }
  }

  return findings.sort((a, b) => {
    const byCallee = a.callee.name.localeCompare(b.callee.name);
    if (byCallee !== 0) return byCallee;
    return a.slot.localeCompare(b.slot);
  });
}

/**
 * Formats an owner id for a message: `bridge:cart` reads as `cart`.
 * @param {object} model - The model.
 * @param {string|null|undefined} ownerId - The owner node id.
 * @returns {string} A display name.
 */
function ownerName(model, ownerId) {
  const node = ownerId ? model.getNode(ownerId) : null;
  return node ? node.name : String(ownerId || '');
}

/**
 * Reports Atlas findings through the compiler's warning machinery.
 *
 * Routed through `reportWarning` so both codes honour the `warnings` setting
 * in `avenx.config.json` — including being escalated to build failures — and
 * appear in `avenx check --json` like every other diagnostic.
 * @param {object} model - The model.
 * @param {object} [config] - The project configuration.
 * @returns {{unreadState: number, unreachableActions: number, noReachablePage: number, unregisteredComponents: number, circularComputed: number}} What was reported.
 */
export function reportAtlasDiagnostics(model, config = {}) {
  const unread = findUnreadState(model);
  for (const finding of unread) {
    const owner = ownerName(model, finding.node.owner);
    const qualified = `${owner}.${finding.node.name}`;
    const writers = finding.writers
      .map((writer) => `${ownerName(model, writer.owner)}.${writer.name}`)
      .sort();
    const where = finding.node.loc && finding.node.loc.file
      ? `${finding.node.loc.file}${finding.node.loc.line ? `:${finding.node.loc.line}` : ''}`
      : 'unknown location';

    reportWarning(
      AvenxErrorCodes.ATLAS_UNREAD_STATE,
      new BuildError(
        AvenxErrorCodes.ATLAS_UNREAD_STATE,
        qualified,
        writers.length > 0 ? `written by ${writers.join(', ')} but` : 'declared but',
        where,
        // Repeated rather than reusing {0}: message formatting substitutes
        // each placeholder once, so a second {0} would survive into the text.
        qualified,
      ),
      config,
    );
  }

  const unreachable = findUnreachableActions(model);
  for (const finding of unreachable) {
    const owner = ownerName(model, finding.node.owner);
    const where = finding.node.loc && finding.node.loc.file
      ? `${finding.node.loc.file}${finding.node.loc.line ? `:${finding.node.loc.line}` : ''}`
      : 'unknown location';

    reportWarning(
      AvenxErrorCodes.ATLAS_UNREACHABLE_ACTION,
      new BuildError(AvenxErrorCodes.ATLAS_UNREACHABLE_ACTION, `${owner}.${finding.node.name}`, where),
      config,
    );
  }

  const orphaned = findNoReachablePage(model);
  if (orphaned) {
    const names = orphaned.pages.map((page) => page.name);
    reportWarning(
      AvenxErrorCodes.ATLAS_NO_REACHABLE_PAGE,
      new BuildError(
        AvenxErrorCodes.ATLAS_NO_REACHABLE_PAGE,
        names.length,
        names.join(', '),
        names[0],
        orphaned.entryFile,
        // Repeated rather than reusing {2}: message formatting substitutes each
        // placeholder once, so a second {2} would survive into the text.
        names[0],
      ),
      config,
    );
  }

  const unregistered = findUnregisteredComponents(model);
  for (const finding of unregistered) {
    const name = finding.node.name;
    const renderers = finding.renderers.map((node) => node.name).sort().join(', ');
    const importPath = finding.node.file
      ? `./${String(finding.node.file).replace(/^src\//, '')}`
      : `./components/${name}`;

    reportWarning(
      AvenxErrorCodes.ATLAS_UNREGISTERED_COMPONENT,
      new BuildError(
        AvenxErrorCodes.ATLAS_UNREGISTERED_COMPONENT,
        renderers,
        name,
        model.entry.file,
        model.entry.file,
        importPath,
        // Repeated rather than reusing {1}: each placeholder is substituted
        // once, so a second {1} would survive into the text.
        name,
        name,
        name,
      ),
      config,
    );
  }

  const undeclaredSlots = findUndeclaredSlots(model);
  for (const finding of undeclaredSlots) {
    const where = finding.loc && finding.loc.file
      ? `${finding.loc.file}${finding.loc.line ? `:${finding.loc.line}` : ''}`
      : finding.renderer && finding.renderer.file
        ? finding.renderer.file
        : 'unknown location';
    const hint = finding.suggestion ? ` Did you mean "${finding.suggestion}"?` : '';
    const declaredList = finding.declared.length > 0 ? finding.declared.join(', ') : '(none)';

    reportWarning(
      AvenxErrorCodes.COMPILER_UNDECLARED_SLOT,
      new BuildError(
        AvenxErrorCodes.COMPILER_UNDECLARED_SLOT,
        finding.slot,
        finding.callee.name,
        where,
        hint,
        declaredList,
      ),
      config,
    );
  }

  const circular = findCircularComputed(model);
  for (const finding of circular) {
    const labels = finding.nodes.map((node) => {
      const owner = ownerName(model, node.owner);
      return `${owner}.${node.name}`;
    });
    const qualified = labels[0] || finding.cycle[0];
    const chain = labels.length === 1 ? qualified : `${labels.join(' -> ')} -> ${labels[0]}`;
    const primary = finding.nodes[0];
    const where = primary && primary.loc && primary.loc.file
      ? `${primary.loc.file}${primary.loc.line ? `:${primary.loc.line}` : ''}`
      : 'unknown location';

    reportWarning(
      AvenxErrorCodes.ATLAS_COMPUTED_CIRCULAR_DEPENDENCY,
      new BuildError(
        AvenxErrorCodes.ATLAS_COMPUTED_CIRCULAR_DEPENDENCY,
        qualified,
        chain,
        where,
        // Repeated rather than reusing {0}: message formatting substitutes
        // each placeholder once, so a second {0} would survive into the text.
        qualified,
      ),
      config,
    );
  }

  return {
    unreadState: unread.length,
    unreachableActions: unreachable.length,
    noReachablePage: orphaned ? orphaned.pages.length : 0,
    unregisteredComponents: unregistered.length,
    undeclaredSlots: undeclaredSlots.length,
    circularComputed: circular.length,
  };
}

export default {
  reportAtlasDiagnostics,
  findUnreadState,
  findUnreachableActions,
  findNoReachablePage,
  findUnregisteredComponents,
  findUndeclaredSlots,
  findCircularComputed,
  analysisIsComplete,
};
