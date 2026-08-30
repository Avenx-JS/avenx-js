/**
 * @file format.js
 * @description Renders a trace as a readable causal tree.
 *
 * The output is deliberately a text tree rather than a graphical inspector.
 * A causal trace is a tree of short lines — that is its natural shape — and a
 * tree in a terminal is diffable, pasteable into an issue, greppable, and
 * available the moment a developer wants it.
 *
 * Reading order follows causality, not time: each node is printed under the
 * thing that caused it, so the answer to "why did this DOM node change" is
 * always the line above it.
 * @module lib/core/trace/format
 */

import { formatCaptured } from './capture.js';
import { formatNodeRef } from './dom.js';
import { findContractViolations, formatViolation } from './contracts.js';
import {
  TraceNodeType,
  Determinism,
  NonDeterminismReason,
  groupChildren,
  rootNodes,
} from './schema.js';

/**
 * Human-readable explanations for each {@link NonDeterminismReason}.
 *
 * These live here rather than in `schema.js` because they are presentation,
 * not structure — and because `schema.js` is in the runtime's import graph,
 * where a block of prose no application will ever render would be dead weight
 * in every bundle.
 * @type {Object<string, string>}
 */
export const REASON_DESCRIPTIONS = {
  [NonDeterminismReason.UNATTRIBUTED_WRITE]:
    'State changed with no recorded input to explain it. A timer, an outside event listener or async code outside a <resource> mutated state.',
  [NonDeterminismReason.POLLING_RESOURCE]:
    'A <resource> declares a pollInterval, so how many times it settled depends on wall-clock time.',
  [NonDeterminismReason.UNSERIALIZABLE_VALUE]:
    'A recorded value could not be represented in JSON (a DOM node, a class instance or a cycle), so replay cannot restore it exactly.',
  [NonDeterminismReason.REDACTED_INPUT]:
    'A redaction rule removed a value replay would have to feed back in. The trace is safe to share but cannot be replayed faithfully.',
  [NonDeterminismReason.TRUNCATED]:
    'The recording buffer filled up and dropped its oldest nodes, so the trace does not start at the beginning of the session.',
  [NonDeterminismReason.UNSANDBOXED_GLOBAL]:
    'Code outside a template expression read a non-deterministic global (Date, Math.random, crypto). Bridge and imported module code is not sandboxed, so this value was not recorded.',
};


/**
 * Renders one node as a single line, without its children.
 * @param {object} node - The node.
 * @returns {string} The line.
 */
export function formatNode(node) {
  switch (node.type) {
    case TraceNodeType.EVENT: {
      const target = formatNodeRef(node.target);
      const where = node.component ? ` ${node.component}` : '';
      const value = node.value !== undefined ? ` value=${JSON.stringify(node.value)}` : '';
      return `${node.eventType} ${target}${where}${value}`;
    }
    case TraceNodeType.ACTION: {
      // The source location comes from the build's sidecar, when one exists.
      // A trace records the action's source text; only the compiler knows the
      // file and line it came from.
      const where = node.loc && node.loc.line ? `  ${node.loc.file}:${node.loc.line}` : '';
      return `action ${node.component ? `${node.component}.` : ''}${node.name}()${where}`;
    }
    case TraceNodeType.BRIDGE_ACTION: {
      const args = Array.isArray(node.args) ? node.args.map(formatCaptured).join(', ') : '';
      return `bridge ${node.bridge} · ${node.name}(${args})`;
    }
    case TraceNodeType.BRIDGE_EMIT:
      return `emit ${node.bridge}:${node.event} → ${node.listeners} listener${node.listeners === 1 ? '' : 's'}`;
    case TraceNodeType.WRITE: {
      if (node.op && node.to === undefined && node.from === undefined) {
        return `write ${node.path} (${node.op}, size ${node.size})`;
      }
      const suffix = node.op ? ` (${node.op})` : '';
      return `write ${node.path} ${formatCaptured(node.from)} → ${formatCaptured(node.to)}${suffix}`;
    }
    case TraceNodeType.WATCHER:
      return `woke ${node.name}`;
    case TraceNodeType.COMPUTED: {
      const ownerName = node.kind === 'getter' ? node.bridge : node.component;
      const owner = ownerName ? `${ownerName}.` : '';
      const expr = node.expression ? `  [${node.expression}]` : '';
      return `${node.kind === 'getter' ? 'getter' : 'computed'} ${owner}${node.name} ${formatCaptured(
        node.from,
      )} → ${formatCaptured(node.to)}${expr}`;
    }
    case TraceNodeType.DOM: {
      const target = formatNodeRef(node.target);
      if (node.op === 'text') {
        return `patched ${target} text ${formatCaptured(node.from)} → ${formatCaptured(node.to)}`;
      }
      if (node.op === 'attr') {
        return `patched ${target} @${node.name} ${formatCaptured(node.from)} → ${formatCaptured(node.to)}`;
      }
      if (node.op === 'remove-attr') {
        return `patched ${target} removed @${node.name}`;
      }
      return `patched ${target} ${node.op}`;
    }
    case TraceNodeType.RESOURCE:
      if (node.phase === 'pending') {
        return `resource ${node.name} requested`;
      }
      return node.status === 'rejected'
        ? `resource ${node.name} failed: ${node.error ? node.error.message : 'unknown'}`
        : `resource ${node.name} resolved ${formatCaptured(node.value)}`;
    case TraceNodeType.NAVIGATION:
      return `navigate ${node.from || '(none)'} → ${node.to}  [${node.page}]`;
    case TraceNodeType.GLOBAL:
      return `read ${node.source}`;
    case TraceNodeType.ERROR:
      return `error ${node.name}: ${node.message}`;
    case TraceNodeType.CONTRACT:
      return `contract ${node.contract}: ${node.detail}`;
    case TraceNodeType.REWIND: {
      const conflicts = node.conflicts > 0 ? `, ${node.conflicts} conflicted` : '';
      return `rewind ${node.action} — ${node.restored} restored${conflicts}  [${node.policy}]`;
    }
    default:
      return node.type;
  }
}

/**
 * Renders the subtree under a node using box-drawing connectors.
 * @param {object} node - The node to render.
 * @param {Map<number|null, object[]>} children - Children keyed by parent id.
 * @param {string} prefix - The accumulated indent.
 * @param {boolean} isLast - Whether this node is its parent's last child.
 * @param {string[]} out - Lines collected so far.
 * @param {Set<number>} seen - Guards against a malformed trace with a parent cycle.
 */
function renderSubtree(node, children, prefix, isLast, out, seen) {
  if (seen.has(node.id)) {
    return;
  }
  seen.add(node.id);

  const connector = prefix === '' ? '▸ ' : `${isLast ? '└─ ' : '├─ '}`;
  out.push(`${prefix}${connector}${formatNode(node)}`);

  const kids = children.get(node.id) || [];
  const childPrefix = prefix === '' ? '  ' : `${prefix}${isLast ? '   ' : '│  '}`;
  kids.forEach((child, index) => {
    renderSubtree(child, children, childPrefix, index === kids.length - 1, out, seen);
  });
}

/**
 * Renders a whole trace as a causal tree, with a determinism summary.
 * @param {object} trace - The trace.
 * @param {object} [options] - Rendering options.
 * @param {number} [options.maxRoots] - How many causal roots to render.
 * @returns {string} The rendered trace.
 */
export function formatTrace(trace, options = {}) {
  const out = [];
  const roots = rootNodes(trace);
  const children = groupChildren(trace);
  const seen = new Set();
  const maxRoots = options.maxRoots || roots.length;

  out.push(`Trace ${trace.id}  ·  ${trace.nodes.length} nodes  ·  recorded ${trace.createdAt || 'unknown'}`);
  if (trace.meta && trace.meta.url) {
    out.push(`  ${trace.meta.url}`);
  }
  out.push('');

  const shown = roots.slice(0, maxRoots);
  shown.forEach((root, index) => {
    renderSubtree(root, children, '', true, out, seen);
    if (index < shown.length - 1) {
      out.push('');
    }
  });

  if (roots.length > shown.length) {
    out.push('', `… ${roots.length - shown.length} more root${roots.length - shown.length === 1 ? '' : 's'} not shown`);
  }

  const violations = findContractViolations(trace);
  if (violations.length > 0) {
    out.push('', 'Contract violations observed during this trace:');
    for (const violation of violations) {
      out.push(`  ⚠ ${formatViolation(violation)}`);
    }
  }

  out.push('', formatDeterminism(trace));
  return out.join('\n');
}

/**
 * Renders a trace's determinism verdict and, when relevant, why it was
 * downgraded.
 * @param {object} trace - The trace.
 * @returns {string} The summary.
 */
export function formatDeterminism(trace) {
  const determinism = trace.determinism || { status: Determinism.DETERMINISTIC, reasons: [] };
  if (determinism.status === Determinism.DETERMINISTIC) {
    return 'Determinism: deterministic — this trace can be exported as a regression test.';
  }

  const lines = ['Determinism: best-effort — this trace cannot be replayed faithfully.'];
  for (const entry of determinism.reasons || []) {
    lines.push(`  • ${entry.reason}${entry.detail ? `: ${entry.detail}` : ''}`);
    const description = REASON_DESCRIPTIONS[entry.reason];
    if (description) {
      lines.push(`    ${description}`);
    }
  }
  if (trace.redacted) {
    lines.push(`  • redacted: ${(trace.redactions || []).join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Summarises a trace for a listing row.
 * @param {object} trace - The trace.
 * @returns {{id: string, events: number, components: number, status: string, createdAt: string}}
 */
export function summarizeTrace(trace) {
  const nodes = trace.nodes || [];
  const components = new Set();
  let events = 0;

  for (const node of nodes) {
    if (node.component) {
      components.add(node.component);
    }
    if (node.type === TraceNodeType.EVENT || node.type === TraceNodeType.NAVIGATION) {
      events++;
    }
  }

  return {
    id: trace.id,
    events,
    components: components.size,
    status: (trace.determinism && trace.determinism.status) || Determinism.DETERMINISTIC,
    createdAt: trace.createdAt,
  };
}
