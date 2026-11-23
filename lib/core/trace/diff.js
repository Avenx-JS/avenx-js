import { groupByInput } from './inputs.js';
import { formatNode } from './format.js';
import { Redactor } from './redact.js';
import { REDACTED, TraceNodeType, validateTrace } from './schema.js';
import { AvenxError, AvenxErrorCodes } from '../runtime/AvenxError.js';

const NOISE = new Set(['id', 'parent', 'seq', 't', 'timestamp', 'createdAt', 'duration', 'loc', 'uid', 'traceId']);

/**
 * Sorts object keys while retaining array order and application value fields.
 * @param {any} value - A JSON-compatible captured value.
 * @returns {any} Canonical data.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/**
 * Applies the union of both recordings' write redaction policies.
 * @param {any} value - A captured value.
 * @param {string} path - Its application property path.
 * @param {Redactor} redactor - Shared policy.
 * @returns {any} A copy safe to include in either side of the report.
 */
function redactValue(value, path, redactor) {
  if (redactor.matches(path)) return REDACTED;
  if (Array.isArray(value)) return value.map((item, index) => redactValue(item, `${path}.${index}`, redactor));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, `${path}.${key}`, redactor)]),
    );
  }
  return value;
}

/**
 * Removes recording metadata without removing similarly named application keys.
 * @param {object} node - A recorded node.
 * @param {Redactor} redactor - Shared redaction policy.
 * @returns {object} Comparable, displayable node data.
 */
function normalize(node, redactor) {
  const value = Object.fromEntries(Object.entries(node).filter(([key]) => !NOISE.has(key)));
  if (value.target) {
    value.target = { selector: value.target.selector, nth: value.target.nth || 0 };
  }
  if (node.type === TraceNodeType.ACTION || node.type === TraceNodeType.BRIDGE_ACTION) delete value.source;
  if (node.type === TraceNodeType.WRITE) {
    for (const key of ['from', 'to']) {
      if (Object.hasOwn(value, key)) value[key] = redactValue(value[key], node.path, redactor);
    }
  }
  return canonical(value);
}

/**
 * Withheld values only establish presence, even if the other side is public.
 * @param {any} before - Left data.
 * @param {any} after - Right data.
 * @returns {any[]} Copies with matching withheld positions masked on both sides.
 */
function maskPair(before, after) {
  if (before === REDACTED || after === REDACTED) {
    return [before === undefined ? undefined : REDACTED, after === undefined ? undefined : REDACTED];
  }
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    const left = Array.isArray(before) ? [...before] : { ...before };
    const right = Array.isArray(after) ? [...after] : { ...after };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const pair = maskPair(before[key], after[key]);
      if (Object.hasOwn(before, key)) left[key] = pair[0];
      if (Object.hasOwn(after, key)) right[key] = pair[1];
    }
    return [left, right];
  }
  return [before, after];
}

/**
 * Identifies the externally supplied interaction, excluding the handler's code.
 * @param {object} node - A root input.
 * @returns {object} Input fields that must match before comparison is meaningful.
 */
function inputIdentity(node) {
  if (node.type === TraceNodeType.EVENT) {
    return canonical(
      Object.fromEntries(
        ['type', 'eventType', 'target', 'key', 'value', 'checked']
          .filter((key) => Object.hasOwn(node, key))
          .map((key) => [key, node[key]]),
      ),
    );
  }
  if (node.type === TraceNodeType.NAVIGATION) return { type: node.type, to: node.to };
  return { type: node.type, name: node.name, component: node.component, phase: node.phase };
}

/**
 * Names a node within its causal parent's child sequence.
 * @param {object} node - Normalized data.
 * @returns {string} A stable identity, excluding values that can change.
 */
function identity(node) {
  const keys = ['type', 'component', 'bridge', 'name', 'path', 'op', 'target', 'kind', 'event', 'contract', 'action'];
  if (node.type === TraceNodeType.GLOBAL) keys.push('source');
  if (node.type === TraceNodeType.RESOURCE) keys.push('phase');
  return JSON.stringify(keys.map((key) => node[key]));
}

/**
 * Aligns sibling identities using an LCS with linear auxiliary memory.
 * Equal prefixes/suffixes make ordinary small changes linear in practice.
 * @param {object[]} before - Left sibling nodes.
 * @param {object[]} after - Right sibling nodes.
 * @returns {Array<object[]>} Left/right pairs; an absent side denotes an edit.
 */
function align(before, after) {
  const leftKeys = before.map((node) => node.key);
  const rightKeys = after.map((node) => node.key);
  const anchors = [];
  const lengths = (a, b, c, d, reverse) => {
    const row = new Uint32Array(d - c + 1);
    for (let offset = 0; offset < b - a; offset++) {
      const i = reverse ? b - 1 - offset : a + offset;
      let diagonal = 0;
      for (let k = 1; k <= d - c; k++) {
        const j = reverse ? d - k : c + k - 1;
        const old = row[k];
        row[k] = leftKeys[i] === rightKeys[j] ? diagonal + 1 : Math.max(row[k], row[k - 1]);
        diagonal = old;
      }
    }
    return row;
  };
  const findSplit = (a, middle, b, c, d) => {
    // Keep the DP rows in this call, so recursive frames retain only indices.
    const left = lengths(a, middle, c, d, false);
    const right = lengths(middle, b, c, d, true);
    let best = -1;
    let split = c;
    for (let k = 0; k <= d - c; k++) {
      const score = left[k] + right[d - c - k];
      if (score > best) {
        best = score;
        split = c + k;
      }
    }
    return split;
  };
  const match = (a, b, c, d) => {
    while (a < b && c < d && leftKeys[a] === rightKeys[c]) anchors.push([a++, c++]);
    let suffix = 0;
    while (a < b && c < d && leftKeys[b - 1] === rightKeys[d - 1]) {
      b--;
      d--;
      suffix++;
    }
    if (b - a === 1) {
      for (let j = c; j < d; j++) {
        if (leftKeys[a] === rightKeys[j]) {
          anchors.push([a, j]);
          break;
        }
      }
    } else if (a < b && c < d) {
      const middle = Math.floor((a + b) / 2);
      const split = findSplit(a, middle, b, c, d);
      match(a, middle, c, split);
      match(middle, b, split, d);
    }
    for (let k = 0; k < suffix; k++) anchors.push([b + k, d + k]);
  };
  match(0, before.length, 0, after.length);
  const result = [];
  let i = 0;
  let j = 0;
  for (const [a, b] of [...anchors, [before.length, after.length]]) {
    while (i < a) result.push([before[i++], null]);
    while (j < b) result.push([null, after[j++]]);
    if (a < before.length) {
      result.push([before[a], after[b]]);
      i++;
      j++;
    }
  }
  return result;
}

/**
 * Builds a forest for one input. Parent links are retained only for alignment.
 * @param {object[]} nodes - Nodes assigned to a step (or to the orphan group).
 * @param {Redactor} redactor - Shared redaction policy.
 * @returns {object[]} Roots with normalized values and ordered children.
 */
function forest(nodes, redactor) {
  const indexed = new Map(
    nodes.map((node) => {
      const value = normalize(node, redactor);
      return [node.id, { value, key: identity(value), children: [] }];
    }),
  );
  const roots = [];
  for (const node of nodes) {
    const current = indexed.get(node.id);
    if (indexed.has(node.parent)) indexed.get(node.parent).children.push(current);
    else roots.push(current);
  }
  return roots;
}

/**
 * Compares complete causal subtrees, including additions below changed parents.
 * @param {object[]} before - Left roots.
 * @param {object[]} after - Right roots.
 * @returns {object[]} A depth-first sequence of changes.
 */
function compareForest(before, after) {
  const pending = align(before, after)
    .reverse()
    .map(([left, right]) => ({ left, right, depth: 0 }));
  const nodes = [];
  while (pending.length) {
    const { left, right, depth } = pending.pop();
    const [a, b] = maskPair(left?.value, right?.value);
    const status = !left
      ? 'added'
      : !right
        ? 'removed'
        : JSON.stringify(a) === JSON.stringify(b)
          ? 'unchanged'
          : 'changed';
    nodes.push({ status, depth, before: a ?? null, after: b ?? null });
    const children = align(left?.children || [], right?.children || []);
    for (let i = children.length - 1; i >= 0; i--) {
      pending.push({ left: children[i][0], right: children[i][1], depth: depth + 1 });
    }
  }
  return nodes;
}

/**
 * Counts nodes and DOM patches without conflating changed nodes with add/remove.
 * @param {object[]} nodes - Comparison rows.
 * @returns {object} Summary counts.
 */
function summarize(nodes) {
  const result = { before: 0, after: 0, added: 0, removed: 0, changed: 0, unchanged: 0, domBefore: 0, domAfter: 0 };
  for (const node of nodes) {
    result[node.status]++;
    if (node.before) result.before++;
    if (node.after) result.after++;
    if (node.before?.type === TraceNodeType.DOM) result.domBefore++;
    if (node.after?.type === TraceNodeType.DOM) result.domAfter++;
  }
  return result;
}

/**
 * Rejects malformed parent graphs before they can lose nodes in a tree walk.
 * @param {object} trace - Candidate recording.
 * @throws {AvenxError} For unreadable envelopes, duplicate ids or parent cycles.
 */
function checkTrace(trace) {
  const valid = validateTrace(trace);
  if (!valid.ok) throw new AvenxError(AvenxErrorCodes.TRACE_UNREADABLE, valid.error);
  const parents = new Map();
  for (const node of trace.nodes) {
    if (!node || typeof node.type !== 'string' || node.id == null || parents.has(node.id)) {
      throw new AvenxError(AvenxErrorCodes.TRACE_UNREADABLE, 'Trace nodes need unique ids and a type.');
    }
    parents.set(node.id, node.parent);
  }
  const visited = new Set();
  for (const id of parents.keys()) {
    const trail = new Set();
    let current = id;
    while (parents.has(current) && !visited.has(current)) {
      if (trail.has(current)) throw new AvenxError(AvenxErrorCodes.TRACE_UNREADABLE, 'Trace contains a parent cycle.');
      trail.add(current);
      current = parents.get(current);
    }
    for (const item of trail) visited.add(item);
  }
}

/**
 * Compares recordings of the same interaction, independently of recording ids.
 * @param {object} before - Baseline trace.
 * @param {object} after - New trace.
 * @returns {object} A structured comparison, or a reason the inputs differ.
 */
export function diffTraces(before, after) {
  checkTrace(before);
  checkTrace(after);
  const redactor = new Redactor([...(before.redactions || []), ...(after.redactions || [])]);
  const left = groupByInput(before);
  const right = groupByInput(after);
  const partial = Boolean(
    before.redacted ||
    after.redacted ||
    before.dropped ||
    after.dropped ||
    before.determinism?.status === 'best-effort' ||
    after.determinism?.status === 'best-effort',
  );
  const result = { comparable: true, partial, steps: [] };
  if (left.steps.length !== right.steps.length) {
    return {
      ...result,
      comparable: false,
      reason: `Different interactions: ${left.steps.length} and ${right.steps.length} recorded inputs.`,
    };
  }
  for (let i = 0; i < left.steps.length; i++) {
    const [a, b] = maskPair(
      inputIdentity(normalize(left.steps[i].input, redactor)),
      inputIdentity(normalize(right.steps[i].input, redactor)),
    );
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      return { ...result, steps: [], comparable: false, reason: `Different interactions at input ${i + 1}.` };
    }
    const nodes = compareForest(
      forest(left.steps[i].observations, redactor),
      forest(right.steps[i].observations, redactor),
    );
    result.steps.push({ index: i, input: a, nodes, summary: summarize(nodes) });
  }
  const orphanNodes = compareForest(forest(left.orphans, redactor), forest(right.orphans, redactor));
  result.orphans = { nodes: orphanNodes, summary: summarize(orphanNodes) };
  result.summary = summarize([...result.steps.flatMap((step) => step.nodes), ...orphanNodes]);
  result.changed = result.summary.added + result.summary.removed + result.summary.changed > 0;
  return result;
}

/**
 * Renders the same comparison exposed by the JSON CLI output.
 * @param {object} result - A result from diffTraces.
 * @returns {string} A readable report.
 */
export function formatTraceDiff(result) {
  if (!result.comparable) return result.reason;
  const lines = [];
  const append = (nodes) => {
    for (const node of nodes) {
      const prefix = `${'  '.repeat(Math.min(node.depth, 30) + 1)}${{ added: '+', removed: '-', changed: '~', unchanged: '=' }[node.status]}`;
      lines.push(`${prefix} ${formatNode(node.after || node.before)}`);
      if (node.status === 'changed') {
        const keys = new Set([...Object.keys(node.before), ...Object.keys(node.after)]);
        for (const key of keys) {
          if (JSON.stringify(node.before[key]) !== JSON.stringify(node.after[key])) {
            lines.push(
              `${' '.repeat(prefix.length + 2)}${key}: ${JSON.stringify(node.before[key])} -> ${JSON.stringify(node.after[key])}`,
            );
          }
        }
      }
    }
  };
  for (const step of result.steps) {
    lines.push(`Step ${step.index + 1}  ${formatNode(step.input)}`);
    append(step.nodes);
    lines.push('');
  }
  if (result.orphans.nodes.length) {
    lines.push('Unattributed nodes');
    append(result.orphans.nodes);
    lines.push('');
  }
  const summary = result.summary;
  if (!result.changed) lines.push('No recorded behaviour changes.');
  lines.push(
    `Summary: ${result.steps.length} step(s) compared; ${summary.added} nodes added; ${summary.removed} removed; ${summary.changed} changed; ${summary.before} -> ${summary.after} nodes`,
  );
  lines.push(`DOM patches: ${summary.domBefore} -> ${summary.domAfter}`);
  if (result.partial)
    lines.push(
      'Partial comparison: withheld values establish presence only; best-effort or truncated recordings cannot prove equivalence.',
    );
  return lines.join('\n');
}
