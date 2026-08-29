/**
 * @file diagnostics.js
 * @description The findings Atlas can safely derive from the model.
 *
 * Both diagnostics here are **absence** claims — "nothing reads this", "nothing
 * invokes this" — and an absence claim is only as good as the completeness of
 * the search behind it. Atlas knows exactly where its search was incomplete,
 * because it recorded every relationship it could not resolve, so each rule
 * checks that record before concluding anything.
 *
 * The rule this file exists to enforce: **a diagnostic must never conclude
 * "never read" from a body the analyser could not follow.** A false AVX_W40 on
 * a state key that is read through a computed member would teach a developer
 * to stop trusting the whole feature, which costs far more than the warnings
 * it suppresses.
 * @module lib/compiler/atlas/diagnostics
 */

import { AtlasEdgeKind, AtlasNodeKind, UnresolvedReason } from './AppModel.js';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
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
export const RUNTIME_INVOKED_ACTIONS = new Set([
  'onBeforeMount',
  'onMount',
  'onBeforeUpdate',
  'onUpdate',
  'onUnmount',
  'onActivate',
  'onDeactivate',
  'onErrorCaptured',
  'setup',
]);

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
 * @returns {{unreadState: number, unreachableActions: number}} What was reported.
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

  return { unreadState: unread.length, unreachableActions: unreachable.length };
}

export default { reportAtlasDiagnostics, findUnreadState, findUnreachableActions, analysisIsComplete };
