/**
 * @file references.js
 * @description Semantic resolution of scanned references onto declarations in scope.
 *
 * Maps member chains produced by `scanReferences` onto declared symbols
 * (state, computed, actions, resources, bridges, injected values, loop vars)
 * and reports unresolved reasons rather than guessing.
 * @module lib/compiler/atlas/resolve/references
 */

import { AtlasNodeKind, Confidence, UnresolvedReason } from '../AppModel.js';
import { BARE_DOLLAR_HELPERS } from '../../../core/runtime/componentHelpers.js';

/**
 * Identifiers that resolve to something outside the application's own model.
 *
 * The first group mirrors the sandbox's allowlist in
 * `lib/core/security/sandbox.js` — an expression may legitimately name these
 * and they are not application state. The second group is the scope the
 * runtime injects around a template expression or an action body.
 * @type {Set<string>}
 */
export const AMBIENT_ROOTS = new Set([
  // Sandbox-allowed globals.
  'Math',
  'JSON',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Date',
  'Error',
  'Map',
  'Set',
  'Promise',
  'console',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'undefined',
  'NaN',
  'Infinity',
  // Language keywords the scanner may still hand back as identifiers.
  'true',
  'false',
  'null',
  'typeof',
  'instanceof',
  'new',
  'delete',
  'void',
  'in',
  'of',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'await',
  'async',
  'function',
  'class',
  'extends',
  'let',
  'const',
  'var',
  'yield',
  'this',
  'super',
  'default',
  'debugger',
  'with',
  'static',
  // Runtime-injected scope that is not application state.
  'props',
  'styles',
  'event',
  'args',
  'arguments',
  'window',
  'document',
  'fetch',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'localStorage',
  'sessionStorage',
  'location',
  'navigator',
  'history',
  // Component helpers injected in ComponentScope.js (expression / action scope).
  ...BARE_DOLLAR_HELPERS,
]);

/**
 * Members every bridge exposes as protocol rather than declaring.
 *
 * `declaredMembers()` in BridgeParser appends the same three, so accessing one
 * is not an unknown member.
 * @type {Set<string>}
 */
export const BRIDGE_BUILTINS = new Set(['on', 'emit', '$dispose', '$name']);

/**
 * Collection methods that yield one element rather than another collection.
 *
 * `const item = this.items.find(...)` binds an element of `items`, so a later
 * `item.qty = n` is a write to `items`. Which element is not knowable, which
 * is why an alias resolved this way is only ever `possible`.
 * @type {Set<string>}
 */
export const ELEMENT_METHODS = new Set(['find', 'at', 'pop', 'shift']);

/**
 * Collection methods that yield another collection of the same elements.
 * @type {Set<string>}
 */
export const COLLECTION_METHODS = new Set(['filter', 'slice', 'concat', 'sort', 'reverse', 'flat']);

/**
 * Formats a member path for display, with `[]` for element access.
 * @param {string[]} segments - The path segments.
 * @returns {string} A dotted path, e.g. `items[].qty`.
 */
export function formatPath(segments) {
  let out = '';
  for (const segment of segments) {
    if (segment === '[]') out += '[]';
    else out += out === '' ? segment : `.${segment}`;
  }
  return out;
}

/**
 * Maps a scanned reference onto a declaration in scope.
 *
 * The result names a **declared symbol**, not a property path: a read of
 * `cart.items[2].qty` resolves to the state key `cart.items`, and the rest of
 * the path travels alongside as metadata. Modelling it the other way — a node
 * per observed path — would invent entities the application never declared.
 * @param {object} ref - A reference from `scanReferences`.
 * @param {object} scope - The resolution scope.
 * @param {string} scope.ownerId - The owning node's id.
 * @param {string} scope.ownerKind - `component`, `page` or `bridge`.
 * @param {Set<string>} [scope.state] - Declared state keys.
 * @param {Set<string>} [scope.computed] - Declared computed names.
 * @param {Set<string>} [scope.actions] - Declared action names.
 * @param {Set<string>} [scope.resources] - Declared resource names.
 * @param {Map<string, object>} [scope.bridges] - Imported bridges by local name.
 * @param {Map<string, object>} [scope.loopVars] - Loop variables by name.
 * @param {Set<string>} [scope.slotProps] - Scoped-slot variable names.
 * @param {Set<string>} [scope.locals] - Locally bound names.
 * @param {object} [scope.selfBridge] - The bridge descriptor when resolving inside one.
 * @returns {{target: object|null, path: string[], confidence: string, unresolved: object|null}}
 *   The declaration reached, the remaining path, how much to trust it, and the
 *   reason nothing was reached when nothing was.
 */
export function resolveReference(ref, scope) {
  const miss = (reason, extra = {}) => ({
    target: null,
    path: ref.segments,
    confidence: Confidence.POSSIBLE,
    unresolved: { reason, expr: ref.text, ...extra },
  });

  const hit = (target, path, confidence = Confidence.CERTAIN) => ({
    target,
    path: path || [],
    confidence,
    unresolved: null,
  });

  const root = ref.root;

  // A loop variable stands for an element of the list it iterates, so a read of
  // `item.qty` is a read of `cart.items` — the whole point of tracking them.
  const loopVar = scope.loopVars && scope.loopVars.get(root);
  if (loopVar) {
    if (!loopVar.resolved || !loopVar.resolved.target) {
      return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: root });
    }
    return hit(loopVar.resolved.target, [...loopVar.resolved.path, '[]', ...ref.segments], loopVar.resolved.confidence);
  }

  if (scope.slotProps && scope.slotProps.has(root)) {
    return miss(UnresolvedReason.SLOT_SCOPE, { name: root });
  }

  // A local bound from application state carries that provenance. The result
  // is never `certain`: which element `items.find(...)` returned is not
  // knowable, only that it came from `items`.
  const alias = scope.aliases && scope.aliases.get(root);
  if (alias && alias.target) {
    return hit(alias.target, [...alias.path, ...ref.segments], Confidence.POSSIBLE);
  }

  // A local binding wins over an application declaration. When it shadows one,
  // that is reported: a diagnostic that concluded "never read" from a body it
  // could not follow would be worse than no diagnostic.
  if (scope.locals && scope.locals.has(root)) {
    const shadows =
      (scope.state && scope.state.has(root)) ||
      (scope.computed && scope.computed.has(root)) ||
      (scope.actions && scope.actions.has(root)) ||
      (scope.resources && scope.resources.has(root)) ||
      (scope.injected && scope.injected.has(root));
    if (shadows) {
      return miss(UnresolvedReason.SHADOWED_IDENTIFIER, { name: root });
    }
    return { target: null, path: ref.segments, confidence: Confidence.CERTAIN, unresolved: null };
  }

  // `state.count` inside an action, and `this.state.count` inside a computed,
  // reach the same declaration a bare `count` does.
  if (root === 'state' || (root === 'this' && ref.segments[0] === 'state')) {
    const offset = root === 'state' ? 0 : 1;
    const key = ref.segments[offset];
    if (!key) {
      return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: root });
    }
    if (scope.state && scope.state.has(key)) {
      return hit({ kind: 'state', owner: scope.ownerId, name: key }, ref.segments.slice(offset + 1));
    }
    return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: key });
  }

  if (root === 'this') {
    const member = ref.segments[0];
    if (!member) {
      return { target: null, path: [], confidence: Confidence.CERTAIN, unresolved: null };
    }
    // Inside a bridge, `this` is the bridge itself.
    if (scope.selfBridge) {
      const resolved = resolveBridgeMember(scope.selfBridge, ref.segments, scope.ownerId);
      if (resolved) return hit(resolved.target, resolved.path);
      return miss(UnresolvedReason.UNKNOWN_BRIDGE_MEMBER, { name: member });
    }
    if (scope.computed && scope.computed.has(member)) {
      return hit({ kind: 'computed', owner: scope.ownerId, name: member }, ref.segments.slice(1));
    }
    if (scope.actions && scope.actions.has(member)) {
      return hit({ kind: 'action', owner: scope.ownerId, name: member }, ref.segments.slice(1));
    }
    if (scope.state && scope.state.has(member)) {
      return hit({ kind: 'state', owner: scope.ownerId, name: member }, ref.segments.slice(1));
    }
    if (scope.injected && scope.injected.has(member)) {
      return hit({ kind: AtlasNodeKind.INJECT, owner: scope.ownerId, name: member }, ref.segments.slice(1));
    }
    return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: `this.${member}` });
  }

  const bridge = scope.bridges && scope.bridges.get(root);
  if (bridge) {
    const resolved = resolveBridgeMember(bridge.descriptor, ref.segments, `bridge:${bridge.descriptor.name}`);
    if (resolved) return hit(resolved.target, resolved.path);
    if (ref.segments.length === 0) {
      return hit({ kind: 'bridge', owner: null, name: bridge.descriptor.name }, []);
    }
    return miss(UnresolvedReason.UNKNOWN_BRIDGE_MEMBER, { name: `${bridge.descriptor.name}.${ref.segments[0]}` });
  }

  if (scope.selfBridge) {
    const resolved = resolveBridgeMember(scope.selfBridge, [root, ...ref.segments], scope.ownerId);
    if (resolved) return hit(resolved.target, resolved.path);
  }

  if (scope.computed && scope.computed.has(root)) {
    return hit({ kind: 'computed', owner: scope.ownerId, name: root }, ref.segments);
  }
  if (scope.actions && scope.actions.has(root)) {
    return hit({ kind: 'action', owner: scope.ownerId, name: root }, ref.segments);
  }
  if (scope.resources && scope.resources.has(root)) {
    return hit({ kind: 'resource', owner: scope.ownerId, name: root }, ref.segments);
  }
  if (scope.state && scope.state.has(root)) {
    return hit({ kind: 'state', owner: scope.ownerId, name: root }, ref.segments);
  }
  if (scope.injected && scope.injected.has(root)) {
    return hit({ kind: AtlasNodeKind.INJECT, owner: scope.ownerId, name: root }, ref.segments);
  }

  if (AMBIENT_ROOTS.has(root)) {
    return { target: null, path: ref.segments, confidence: Confidence.CERTAIN, unresolved: null };
  }

  return miss(UnresolvedReason.UNKNOWN_IDENTIFIER, { name: root });
}

/**
 * Resolves a member access against a bridge's declared surface.
 *
 * The compiler already resolves these names once, to warn about members a
 * bridge does not declare (AVX_W37). Atlas keeps the answer instead of
 * discarding it, which is what lets a query cross a file boundary.
 * @param {object} descriptor - A bridge descriptor from BridgeParser.
 * @param {string[]} segments - The member path.
 * @param {string} ownerId - The bridge's node id.
 * @returns {{target: object, path: string[]}|null} The declaration, or null.
 */
export function resolveBridgeMember(descriptor, segments, ownerId) {
  if (!descriptor || segments.length === 0) return null;
  const member = segments[0];
  const rest = segments.slice(1);

  // `on`, `$dispose` and `$name` are the bridge protocol rather than declared
  // members. `on` in particular carries a real relationship — a subscription —
  // which the model builder records from the event name, not from this chain.
  if (BRIDGE_BUILTINS.has(member)) {
    return { target: { kind: 'bridge', owner: null, name: descriptor.name }, path: rest };
  }

  if (Array.isArray(descriptor.stateKeys) && descriptor.stateKeys.includes(member)) {
    return { target: { kind: 'state', owner: ownerId, name: member }, path: rest };
  }
  if (Array.isArray(descriptor.getters) && descriptor.getters.includes(member)) {
    return { target: { kind: 'getter', owner: ownerId, name: member }, path: rest };
  }
  if (Array.isArray(descriptor.actions) && descriptor.actions.includes(member)) {
    return { target: { kind: 'action', owner: ownerId, name: member }, path: rest };
  }
  return null;
}
