/**
 * @file nodes.js
 * @description Node start/finish bookkeeping and speculative state save/restore.
 * @module lib/compiler/parser/js/nodes
 */

/**
 * Starts a node at the current token.
 * @param {object} p - The parser instance.
 * @returns {object} A bare node.
 */
export function startNode(p) {
  return p.startNodeAt(p.tok.start);
}

/**
 * Starts a node at a given offset.
 * @param {object} p - The parser instance.
 * @param {number} pos - The offset.
 * @returns {object} A bare node.
 */
export function startNodeAt(p, pos) {
  /** @type {any} */
  const node = { type: '', start: pos, end: 0 };
  if (p.locations) node.loc = { start: p.tz.locate(pos), end: null };
  return node;
}

/**
 * Finishes a node at the end of the previous token.
 * @param {object} p - The parser instance.
 * @param {object} node - The node.
 * @param {string} type - Its ESTree type.
 * @returns {object} The node.
 */
export function finishNode(p, node, type) {
  return p.finishNodeAt(node, type, p.tz.lastEnd);
}

/**
 * Finishes a node at an explicit offset.
 * @param {object} p - The parser instance.
 * @param {object} node - The node.
 * @param {string} type - Its ESTree type.
 * @param {number} end - The end offset.
 * @returns {object} The node.
 */
export function finishNodeAt(p, node, type, end) {
  /** @type {any} */
  const target = node;
  target.type = type;
  target.end = end;
  if (p.locations) target.loc.end = p.tz.locate(end);
  return target;
}

/**
 * Captures parser and tokenizer state for a speculative parse.
 * @param {object} p - The parser instance.
 * @returns {object} The state.
 */
export function saveState(p) {
  return {
    tz: p.tz.save(),
    tok: p.tok,
    inFunction: p.inFunction,
    inAsync: p.inAsync,
    inGenerator: p.inGenerator,
    inMethod: p.inMethod,
    inDerivedConstructor: p.inDerivedConstructor,
    inNewTargetScope: p.inNewTargetScope,
    strict: p.strict,
    labels: p.labels.slice(),
    breakDepth: p.breakDepth,
    continueDepth: p.continueDepth,
    scopeDepth: p.scopeStack.length,
    privateDepth: p.privateNameStack.length,
    bindings: p.bindingLog.length,
    shorthandDefaults: p.pendingShorthandDefaults.length,
  };
}

/**
 * Restores state captured by {@link saveState}.
 * @param {object} p - The parser instance.
 * @param {object} state - The state.
 */
export function restoreState(p, state) {
  p.tz.restore(state.tz);
  p.tok = state.tok;
  p.inFunction = state.inFunction;
  p.inAsync = state.inAsync;
  p.inGenerator = state.inGenerator;
  p.inMethod = state.inMethod;
  p.inDerivedConstructor = state.inDerivedConstructor;
  p.inNewTargetScope = state.inNewTargetScope;
  p.strict = state.strict;
  p.labels = state.labels;
  p.breakDepth = state.breakDepth;
  p.continueDepth = state.continueDepth;
  p.scopeStack.length = state.scopeDepth;
  p.privateNameStack.length = state.privateDepth;
  while (p.bindingLog.length > state.bindings) {
    const entry = p.bindingLog.pop();
    entry.set.delete(entry.name);
  }
  p.pendingShorthandDefaults.length = state.shorthandDefaults;
}
