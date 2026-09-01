/**
 * @file contracts.js
 * @description Checks declared compiler contracts against what a trace shows
 * the code actually did.
 *
 * Avenx's contracts (`static`, `pure`, `deterministic`, `isolated`) are
 * declared in a component and checked by the compiler with pattern matching
 * over source text. That catches the obvious cases and misses everything
 * reached indirectly: a computed that calls a helper that calls `Date.now()`
 * looks pure to a regular expression.
 *
 * A trace closes that gap without any new machinery. It already records where
 * every non-deterministic global was read and where every state write
 * happened, and every node knows its causal ancestry — so asking "did anything
 * inside a unit that declared itself `deterministic` read the clock?" is a walk
 * up the parent chain. The contract stops being a build-time assertion and
 * becomes a claim checked against the run.
 *
 * The diagnostic codes are the compiler's existing ones, deliberately: a
 * developer who has seen AVX_W33 at build time should recognise it when it
 * arrives from a recording, and `avenx explain AVX_W33` should still be the
 * right thing to type.
 * @module lib/core/trace/contracts
 */

import { AvenxErrorCodes } from '../runtime/AvenxError.js';
import { TraceNodeType, indexNodes } from './schema.js';

/**
 * Walks a node's ancestry, nearest first.
 * @param {object} node - The starting node.
 * @param {Map<number, object>} byId - Nodes keyed by id.
 * @yields {object} Each ancestor, nearest first.
 */
function* ancestors(node, byId) {
  let current = node;
  while (current && current.parent !== null && current.parent !== undefined) {
    const parent = byId.get(current.parent);
    if (!parent) {
      return;
    }
    yield parent;
    current = parent;
  }
}

/**
 * Finds the nearest ancestor that declared a given contract.
 * @param {object} node - The starting node.
 * @param {Map<number, object>} byId - Nodes keyed by id.
 * @param {string} contract - The contract name.
 * @returns {object|null} The declaring ancestor, if any.
 */
function nearestDeclaring(node, byId, contract) {
  for (const ancestor of ancestors(node, byId)) {
    if (Array.isArray(ancestor.contracts) && ancestor.contracts.includes(contract)) {
      return ancestor;
    }
  }
  return null;
}

/**
 * Describes a unit for a diagnostic message.
 * @param {object} node - An action or computed node.
 * @returns {string} A short label such as `CartItem.incQty()`.
 */
function label(node) {
  const ownerName = node.component || node.bridge;
  const owner = ownerName ? `${ownerName}.` : '';
  if (node.type === TraceNodeType.ACTION) {
    return `${owner}${node.name}()`;
  }
  if (node.type === TraceNodeType.COMPUTED) {
    return `${owner}${node.name}`;
  }
  return owner || node.type;
}

/**
 * Checks a trace's declared contracts against what it recorded.
 *
 * Two contracts are checkable from a trace:
 *
 * - `deterministic` — a unit that declared it must not have read `Date.now()`,
 *   `new Date()` or `Math.random()`. The trace records exactly where those
 *   reads happened.
 * - `pure` — a unit that declared it must not have mutated reactive state.
 *   The trace records every write and what caused it.
 *
 * `static` and `isolated` are structural claims the compiler can decide
 * completely from source, so a trace adds nothing to them and they are not
 * re-checked here.
 * @param {object} trace - The trace to check.
 * @returns {Array<{code: string, contract: string, unit: string, detail: string, nodeId: number}>}
 *   One entry per violation, in recorded order.
 */
export function findContractViolations(trace) {
  const nodes = (trace && trace.nodes) || [];
  const byId = indexNodes({ nodes });
  const violations = [];

  for (const node of nodes) {
    if (node.type === TraceNodeType.GLOBAL) {
      const declaring = nearestDeclaring(node, byId, 'deterministic');
      if (declaring) {
        violations.push({
          code: AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION,
          contract: 'deterministic',
          unit: label(declaring),
          detail: `read ${node.source} during this trace`,
          nodeId: node.id,
        });
      }
      continue;
    }

    if (node.type === TraceNodeType.WRITE) {
      const declaring = nearestDeclaring(node, byId, 'pure');
      if (declaring) {
        violations.push({
          code: AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION,
          contract: 'pure',
          unit: label(declaring),
          detail: `wrote ${node.path} during this trace`,
          nodeId: node.id,
        });
      }
    }
  }

  return violations;
}

/**
 * Renders a violation as a single diagnostic line.
 * @param {object} violation - A violation from {@link findContractViolations}.
 * @returns {string} A line suitable for `avenx trace view`.
 */
export function formatViolation(violation) {
  return `${violation.code}  ${violation.unit} is declared \`${violation.contract}\` but ${violation.detail}`;
}
