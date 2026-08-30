/**
 * @file diagnostics.js
 * @description What the compiler can tell a developer about a transaction
 * before the application ships.
 *
 * Three findings, and all three are about the *gap* between what an atomic
 * action promises and what a rewind can actually deliver:
 *
 * - **AVX_W42** — the write set could not be resolved completely, so the two
 *   reports below are incomplete for this action.
 * - **AVX_W43** — the action does something a rewind cannot undo, and here is
 *   each one with its line.
 * - **AVX_W44** — two atomic actions write the same state, so one may rewind
 *   over the other's value.
 *
 * The house rule inherited from `atlas/diagnostics.js` applies with full
 * force: **a finding derived from an incomplete analysis is worse than no
 * finding.** AVX_W44 compares two write sets and is therefore skipped whenever
 * either one is unbounded — an overlap warning computed from a partial set is
 * a false positive and a false negative at the same time. AVX_W42 is the one
 * that reports the incompleteness itself, so it is the only one that does not
 * gate on it.
 *
 * None of this affects the rewind. The journal watches the reactive proxies,
 * not this analysis, so an action nothing here understood is still journaled
 * completely. What is at stake is only whether the developer was told the
 * truth about it in advance.
 * @module lib/compiler/rewind/diagnostics
 */

import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { BuildError } from '../errors/index.js';
import { reportWarning } from '../utils/warningReporter.js';
import { collectAtomicActions, invokes, MAX_INVOKE_DEPTH } from './writeSet.js';

/**
 * Renders a node's declaration site.
 * @param {object} node - An Atlas node.
 * @returns {string} `file:line`, or a placeholder.
 */
function where(node) {
  if (!node || !node.loc || !node.loc.file) return 'unknown location';
  return node.loc.line ? `${node.loc.file}:${node.loc.line}` : node.loc.file;
}

/**
 * Renders an unresolved entry as one report line.
 * @param {object} entry - An unresolved entry.
 * @returns {string} An indented line.
 */
function unresolvedLine(entry) {
  const site = entry.loc && entry.loc.file
    ? `${entry.loc.file}${entry.loc.line ? `:${entry.loc.line}` : ''}`
    : '';
  const subject = entry.expr || entry.name || '';
  return `  ${entry.reason}${subject ? ` "${subject}"` : ''}${site ? `  ${site}` : ''}`;
}

/**
 * Finds atomic actions whose write set is incomplete.
 * @param {object} model - The finished AppModel.
 * @returns {Array<object>} Findings, each with its action and the reasons.
 */
export function findUnboundedTransactions(model) {
  const findings = [];
  for (const action of collectAtomicActions(model)) {
    if (action.bounded) continue;

    const lines = action.reasons.map(unresolvedLine);
    if (action.depthExceeded) {
      lines.push(`  invoke chain deeper than ${MAX_INVOKE_DEPTH} hops  ${where(action.node)}`);
    }
    for (const entry of action.node.deferred || []) {
      lines.push(
        `  a write inside ${entry.text} runs after the transaction has closed  ` +
          `${action.node.loc && action.node.loc.file ? action.node.loc.file : ''}:${entry.line}`,
      );
    }
    if (lines.length === 0) continue;

    findings.push({ action, lines });
  }
  return findings;
}

/**
 * Finds atomic actions with effects a rewind cannot undo.
 * @param {object} model - The finished AppModel.
 * @returns {Array<object>} Findings, each with its action and the effects.
 */
export function findIrreversibleTransactions(model) {
  const findings = [];
  for (const action of collectAtomicActions(model)) {
    const effects = action.node.irreversible || [];
    if (effects.length === 0) continue;

    const file = action.node.loc && action.node.loc.file ? action.node.loc.file : '';
    const lines = effects.map((effect) => `  ${effect.kind} ${effect.text}  ${file}:${effect.line}`);
    findings.push({ action, effects, lines });
  }
  return findings;
}

/**
 * Finds pairs of atomic actions that write the same state.
 *
 * Only bounded write sets are compared. An unbounded one is already reported
 * as AVX_W42, and intersecting it with anything would answer a question the
 * analysis was not able to ask.
 *
 * A caller and its callee are skipped as well. Their sets overlap by
 * construction, and the runtime joins a nested transaction to the enclosing
 * frame, so the pair cannot produce the conflict this code warns about.
 * @param {object} model - The finished AppModel.
 * @returns {Array<object>} Findings, each with the pair and what they share.
 */
export function findOverlappingTransactions(model) {
  const actions = collectAtomicActions(model).filter(
    (action) => action.bounded && action.writes.length > 0,
  );
  const findings = [];

  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const left = actions[i];
      const right = actions[j];
      if (invokes(model, left.node.id, right.node.id) || invokes(model, right.node.id, left.node.id)) {
        continue;
      }
      const rightWrites = new Set(right.writes);
      const shared = left.writes.filter((target) => rightWrites.has(target));
      if (shared.length === 0) continue;
      findings.push({ left, right, shared });
    }
  }

  return findings;
}

/**
 * Reports every Rewind finding through the compiler's warning machinery.
 *
 * Routed through `reportWarning` so all three codes honour the `warnings`
 * setting in avenx.config.json — including escalation to a build failure —
 * and appear in `avenx check --json` like every other diagnostic.
 * @param {object} model - The finished AppModel.
 * @param {object} [config] - The project configuration.
 * @returns {{unbounded: number, irreversible: number, overlapping: number}} What was reported.
 */
export function reportRewindDiagnostics(model, config = {}) {
  const unbounded = findUnboundedTransactions(model);
  for (const finding of unbounded) {
    reportWarning(
      AvenxErrorCodes.COMPILER_TRANSACTION_UNBOUNDED,
      new BuildError(
        AvenxErrorCodes.COMPILER_TRANSACTION_UNBOUNDED,
        finding.action.label,
        where(finding.action.node),
        finding.lines.join('\n'),
      ),
      config,
    );
  }

  const irreversible = findIrreversibleTransactions(model);
  for (const finding of irreversible) {
    reportWarning(
      AvenxErrorCodes.COMPILER_TRANSACTION_IRREVERSIBLE,
      new BuildError(
        AvenxErrorCodes.COMPILER_TRANSACTION_IRREVERSIBLE,
        finding.action.label,
        finding.effects.length,
        finding.lines.join('\n'),
      ),
      config,
    );
  }

  const overlapping = findOverlappingTransactions(model);
  for (const finding of overlapping) {
    reportWarning(
      AvenxErrorCodes.COMPILER_TRANSACTION_OVERLAP,
      new BuildError(
        AvenxErrorCodes.COMPILER_TRANSACTION_OVERLAP,
        finding.left.label,
        finding.right.label,
        finding.shared.join(', '),
        where(finding.left.node),
      ),
      config,
    );
  }

  return {
    unbounded: unbounded.length,
    irreversible: irreversible.length,
    overlapping: overlapping.length,
  };
}

export default {
  reportRewindDiagnostics,
  findUnboundedTransactions,
  findIrreversibleTransactions,
  findOverlappingTransactions,
};
