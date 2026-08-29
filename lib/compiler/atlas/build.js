/**
 * @file build.js
 * @description Turns what the compiler already knows into Atlas nodes and edges.
 *
 * Nothing in this module re-reads or re-parses a file the compiler has already
 * handled. `addComponentUnit` is handed the exact objects `ComponentParser.parse`
 * produced on its way to generating a class; `addBridgeUnit` is handed the
 * descriptor `analyzeBridge` produced on its way to emitting a bridge. That is
 * the whole design intent: Atlas is retention, not a second analysis pass.
 *
 * The one thing it does read for itself is the template — and only because the
 * template the compiler validates has already been rewritten past the point
 * where offsets mean anything. See `source.js`.
 * @module lib/compiler/atlas/build
 */

import path from 'path';
import collectTemplateEvents from '../templateEvents.js';
import { extractSubscriptions } from '../BridgeParser.js';
import { AtlasEdgeKind, AtlasNodeKind, Confidence, UnresolvedReason, nodeId } from './AppModel.js';
import { COLLECTION_METHODS, ELEMENT_METHODS, formatPath, patternBindings, resolveReference, scanReferences } from './resolve.js';
import { escapeName, lineIndex, lineOf, maskDeclarations, positionAt, stateKeyLine } from './source.js';

/**
 * Node kinds that own members.
 * @type {Set<string>}
 */
const OWNER_KINDS = new Set([AtlasNodeKind.COMPONENT, AtlasNodeKind.PAGE, AtlasNodeKind.BRIDGE]);

/**
 * Maps a resolved target descriptor to a node id.
 * @param {object} target - `{kind, owner, name}` from resolveReference.
 * @returns {string} The node id.
 */
function targetId(target) {
  if (target.kind === AtlasNodeKind.BRIDGE) {
    return nodeId(AtlasNodeKind.BRIDGE, null, target.name);
  }
  return nodeId(target.kind, target.owner, target.name);
}

/**
 * Converts a project-absolute path to the form Atlas reports.
 * @param {string} filePath - An absolute path.
 * @param {string} rootDir - The project root.
 * @returns {string} A root-relative, forward-slashed path.
 */
export function relativePath(filePath, rootDir) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

/**
 * Records the edges one scanned expression implies.
 *
 * Shared by every expression site — computed, action, resource, template
 * binding, event handler, bridge member — so that a read means the same thing
 * wherever it was written.
 * @param {object} model - The AppModel being built.
 * @param {object} options - The analysis site.
 * @param {string} options.from - The node id the expression belongs to.
 * @param {string} options.code - The expression source.
 * @param {object} options.scope - The resolution scope.
 * @param {object} options.loc - `{file, line, column}` of the site.
 * @param {boolean} [options.writeBack] - Treat reads as read-and-write, for
 *   two-way bindings.
 * @returns {void}
 */
export function analyzeExpression(model, options) {
  const { from, code, loc, writeBack } = options;
  if (!code || !code.trim()) return;

  const { references, aliases, localAliases, locals, notes } = scanReferences(code);

  // The names this body binds are only known after scanning it, so the scope
  // used for resolution is the caller's scope plus those. Without this every
  // parameter and `const` would be reported as an unknown identifier.
  // `extraLocals` carries bindings declared outside the scanned text, which is
  // how a bridge action's parameter list reaches the analysis of its body.
  const bound = new Set(locals);
  for (const name of options.extraLocals || []) bound.add(name);
  const scope = { ...options.scope, locals: bound, aliases: new Map() };

  for (const alias of localAliases || []) {
    const resolution = resolveReference(
      { kind: 'read', root: alias.root, segments: alias.segments, dynamic: false, text: alias.name },
      scope,
    );
    if (!resolution.target) continue;
    // `items.find(...)` yields an element; `items.filter(...)` yields a
    // collection. Either way the trailing method is not part of the path.
    const path = [...resolution.path];
    const last = path[path.length - 1];
    if (ELEMENT_METHODS.has(last)) {
      path.pop();
      path.push('[]');
    } else if (COLLECTION_METHODS.has(last)) {
      path.pop();
    }
    scope.aliases.set(alias.name, { target: resolution.target, path });
  }

  for (const note of notes) {
    model.addUnresolved({ reason: note.reason, expr: note.expr, owner: from, loc });
  }

  /**
   * Records one resolved relationship.
   * @param {object} ref - The scanned reference.
   * @param {string} kind - The edge kind.
   * @returns {void}
   */
  const record = (ref, kind) => {
    const resolution = resolveReference(ref, scope);

    if (resolution.unresolved) {
      // A built-in method that resolved to nothing is not a finding: `push`
      // was already recorded as a write to its receiver.
      if (!ref.builtinMethod) {
        model.addUnresolved({
          reason: resolution.unresolved.reason,
          expr: resolution.unresolved.expr,
          name: resolution.unresolved.name,
          owner: from,
          loc,
        });
      }
      return;
    }

    if (!resolution.target) return;

    if (ref.dynamic) {
      model.addUnresolved({
        reason: UnresolvedReason.DYNAMIC_MEMBER,
        expr: ref.text,
        owner: from,
        loc,
      });
    }

    const to = targetId(resolution.target);
    const node = model.getNode(to);

    // Only a callable target can be invoked. A chain that ends on state and is
    // called is something Atlas cannot follow, and says so.
    let edgeKind = kind;
    if (kind === AtlasEdgeKind.INVOKES && node && node.kind !== AtlasNodeKind.ACTION) {
      if (ref.builtinMethod) return;
      edgeKind = AtlasEdgeKind.READS;
    }

    model.addEdge({
      from,
      to,
      kind: edgeKind,
      confidence: resolution.confidence,
      loc,
      ...(resolution.path.length > 0 ? { path: formatPath(resolution.path) } : {}),
    });
  };

  for (const ref of references) {
    if (ref.kind === 'invoke') {
      record(ref, AtlasEdgeKind.INVOKES);
    } else if (ref.kind === 'write') {
      record(ref, AtlasEdgeKind.WRITES);
      if (ref.alsoReads) record({ ...ref, kind: 'read' }, AtlasEdgeKind.READS);
    } else {
      record(ref, AtlasEdgeKind.READS);
      if (writeBack) record({ ...ref, kind: 'write' }, AtlasEdgeKind.WRITES);
    }
  }

  // `const { items } = cart` reads cart.items as surely as `cart.items` does.
  for (const alias of aliases) {
    record(
      { kind: 'read', root: alias.root, segments: [...alias.segments, alias.member], dynamic: false, text: `${alias.root}.${alias.member}` },
      AtlasEdgeKind.READS,
    );
  }
}

/**
 * Adds a bridge and everything it declares to the model.
 * @param {object} model - The AppModel being built.
 * @param {object} descriptor - A descriptor from `analyzeBridge`.
 * @param {object} context - `{rootDir, source, bridges}`.
 * @returns {string} The bridge's node id.
 */
export function addBridgeUnit(model, descriptor, context) {
  const { rootDir, source, bridges } = context;
  const file = relativePath(descriptor.filePath, rootDir);
  const ownerId = nodeId(AtlasNodeKind.BRIDGE, null, descriptor.name);
  const starts = source ? lineIndex(source) : [0];

  model.addNode({ id: ownerId, kind: AtlasNodeKind.BRIDGE, name: descriptor.name, file });

  /**
   * Declares one member of the bridge.
   * @param {string} kind - The node kind.
   * @param {string} name - The member name.
   * @param {number|null} line - Its line, when known.
   * @returns {string} The member's node id.
   */
  const declare = (kind, name, line) => {
    const id = nodeId(kind, ownerId, name);
    model.addNode({ id, kind, name, owner: ownerId, loc: { file, ...(line ? { line } : {}) } });
    model.addEdge({ from: ownerId, to: id, kind: AtlasEdgeKind.DECLARES, confidence: Confidence.CERTAIN });
    return id;
  };

  const memberLine = (name) => {
    const member = (descriptor.members || []).find((entry) => entry.name === name);
    if (member && source) return positionAt(starts, member.valueStart).line;
    return null;
  };

  for (const key of descriptor.stateKeys) declare(AtlasNodeKind.STATE, key, memberLine(key));
  for (const getter of descriptor.getters) declare(AtlasNodeKind.GETTER, getter, memberLine(getter));
  for (const action of descriptor.actions) declare(AtlasNodeKind.ACTION, action, memberLine(action));
  for (const event of descriptor.events || []) declare(AtlasNodeKind.EVENT, event, null);

  // A bridge that imports another bridge sees it under its local name.
  /** @type {Map<string, object>} */
  const imported = new Map();
  for (const entry of descriptor.bridgeImports || []) {
    const target = bridges && bridges.get(path.resolve(entry.resolved));
    if (!target) continue;
    imported.set(entry.local, { descriptor: target });
    const targetNode = nodeId(AtlasNodeKind.BRIDGE, null, target.name);
    model.addNode({ id: targetNode, kind: AtlasNodeKind.BRIDGE, name: target.name });
    model.addEdge({
      from: ownerId,
      to: targetNode,
      kind: AtlasEdgeKind.IMPORTS,
      confidence: Confidence.CERTAIN,
      loc: { file },
    });
  }

  if (!source) return ownerId;

  const scopeFor = (locals) => ({
    ownerId,
    ownerKind: AtlasNodeKind.BRIDGE,
    selfBridge: descriptor,
    bridges: imported,
    locals,
    state: new Set(descriptor.stateKeys),
    computed: new Set(descriptor.getters),
    actions: new Set(descriptor.actions),
  });

  for (const member of descriptor.members || []) {
    if (!member.body) continue;
    const body = source.slice(member.body.start, member.body.end);
    const line = positionAt(starts, member.valueStart).line;

    let from;
    if (member.kind === 'getter') from = nodeId(AtlasNodeKind.GETTER, ownerId, member.name);
    else if (member.kind === 'action') from = nodeId(AtlasNodeKind.ACTION, ownerId, member.name);
    else continue;

    // A member's parameters are declared in its signature, which sits outside
    // the body span. Without them every parameter reads as an unknown
    // identifier, and every unknown identifier blocks a diagnostic.
    const signature = source.slice(member.valueStart, member.body.start);
    const params = signature.slice(signature.indexOf('(') + 1, signature.lastIndexOf(')'));
    const paramNames = params.trim() ? patternBindings(`[${params}]`).names : [];

    analyzeExpression(model, {
      from,
      code: body,
      scope: scopeFor(undefined),
      extraLocals: paramNames,
      loc: { file, line },
    });

    // `this.emit('changed', …)` inside an action is the action emitting.
    const emitRegex = /\bemit\s*\(\s*['"]([^'"]+)['"]/g;
    let emitMatch;
    while ((emitMatch = emitRegex.exec(body)) !== null) {
      const eventNode = nodeId(AtlasNodeKind.EVENT, ownerId, emitMatch[1]);
      if (model.hasNode(eventNode)) {
        model.addEdge({
          from,
          to: eventNode,
          kind: AtlasEdgeKind.EMITS,
          confidence: Confidence.CERTAIN,
          loc: { file, line: positionAt(starts, member.body.start + emitMatch.index).line },
        });
      }
    }
  }

  return ownerId;
}

/**
 * Adds a component or page and everything it declares to the model.
 * @param {object} model - The AppModel being built.
 * @param {object} unit - Everything ComponentParser already extracted.
 * @param {string} unit.name - The class name.
 * @param {string} unit.kind - `component` or `page`.
 * @param {string} unit.filePath - Absolute path to the source file.
 * @param {string} unit.rootDir - The project root.
 * @param {string} unit.content - The original source, before any transformation.
 * @param {object} unit.state - Declared state.
 * @param {object} unit.computed - Computed expressions by name.
 * @param {object} unit.methods - Action bodies by name.
 * @param {object} unit.resources - Resource declarations by name.
 * @param {Set<string>} [unit.contracts] - Declared contracts.
 * @param {Array<object>} [unit.bridgeBindings] - Imported bridges.
 * @param {Map<string, object>} [unit.bridges] - Every bridge, by absolute path.
 * @returns {string} The unit's node id.
 */
export function addComponentUnit(model, unit) {
  const { name, filePath, rootDir, content } = unit;
  const kind = unit.kind === AtlasNodeKind.PAGE ? AtlasNodeKind.PAGE : AtlasNodeKind.COMPONENT;
  const file = relativePath(filePath, rootDir);
  const ownerId = nodeId(kind, null, name);
  const starts = lineIndex(content);

  model.addNode({
    id: ownerId,
    kind,
    name,
    file,
    ...(unit.contracts && unit.contracts.size > 0 ? { contracts: [...unit.contracts].sort() } : {}),
  });

  const state = unit.state || {};
  const computed = unit.computed || {};
  const methods = unit.methods || {};
  const resources = unit.resources || {};

  /**
   * Declares one member of the component.
   * @param {string} memberKind - The node kind.
   * @param {string} memberName - The member name.
   * @param {number|null} line - Its line.
   * @param {object} [extra] - Extra node fields.
   * @returns {string} The member's node id.
   */
  const declare = (memberKind, memberName, line, extra = {}) => {
    const id = nodeId(memberKind, ownerId, memberName);
    model.addNode({
      id,
      kind: memberKind,
      name: memberName,
      owner: ownerId,
      loc: { file, ...(line ? { line } : {}) },
      ...extra,
    });
    model.addEdge({ from: ownerId, to: id, kind: AtlasEdgeKind.DECLARES, confidence: Confidence.CERTAIN });
    return id;
  };

  for (const key of Object.keys(state)) {
    declare(AtlasNodeKind.STATE, key, stateKeyLine(content, key), { initial: state[key] });
  }
  for (const [computedName, expression] of Object.entries(computed)) {
    declare(
      AtlasNodeKind.COMPUTED,
      computedName,
      lineOf(content, new RegExp(`<computed\\s+[^>]*name\\s*=\\s*["']${escapeName(computedName)}["']`)),
      { expression },
    );
  }
  for (const actionName of Object.keys(methods)) {
    declare(
      AtlasNodeKind.ACTION,
      actionName,
      lineOf(content, new RegExp(`<action\\s+[^>]*name\\s*=\\s*["']${escapeName(actionName)}["']`)),
    );
  }
  for (const resourceName of Object.keys(resources)) {
    declare(
      AtlasNodeKind.RESOURCE,
      resourceName,
      lineOf(content, new RegExp(`<resource\\s+[^>]*name\\s*=\\s*["']${escapeName(resourceName)}["']`)),
    );
  }

  /** @type {Map<string, object>} */
  const importedBridges = new Map();
  for (const binding of unit.bridgeBindings || []) {
    const descriptor = findBridgeDescriptor(unit.bridges, binding.bridge);
    if (!descriptor) continue;
    importedBridges.set(binding.local, { descriptor });
    const bridgeNode = nodeId(AtlasNodeKind.BRIDGE, null, descriptor.name);
    model.addNode({ id: bridgeNode, kind: AtlasNodeKind.BRIDGE, name: descriptor.name });
    model.addEdge({
      from: ownerId,
      to: bridgeNode,
      kind: AtlasEdgeKind.IMPORTS,
      confidence: Confidence.CERTAIN,
      loc: { file, line: lineOf(content, new RegExp(`import\\s+${escapeName(binding.local)}\\b`)) || 1 },
    });
  }

  const baseScope = {
    ownerId,
    ownerKind: kind,
    state: new Set(Object.keys(state)),
    computed: new Set(Object.keys(computed)),
    actions: new Set(Object.keys(methods)),
    resources: new Set(Object.keys(resources)),
    bridges: importedBridges,
    slotProps: new Set(),
    loopVars: new Map(),
  };

  for (const [computedName, expression] of Object.entries(computed)) {
    analyzeExpression(model, {
      from: nodeId(AtlasNodeKind.COMPUTED, ownerId, computedName),
      code: expression,
      scope: baseScope,
      loc: {
        file,
        line: lineOf(content, new RegExp(`<computed\\s+[^>]*name\\s*=\\s*["']${escapeName(computedName)}["']`)) || 1,
      },
    });
  }

  for (const [actionName, body] of Object.entries(methods)) {
    analyzeExpression(model, {
      from: nodeId(AtlasNodeKind.ACTION, ownerId, actionName),
      code: body,
      scope: baseScope,
      loc: {
        file,
        line: lineOf(content, new RegExp(`<action\\s+[^>]*name\\s*=\\s*["']${escapeName(actionName)}["']`)) || 1,
      },
    });
    recordSubscriptions(model, {
      from: nodeId(AtlasNodeKind.ACTION, ownerId, actionName),
      body,
      importedBridges,
      file,
      line: lineOf(content, new RegExp(`<action\\s+[^>]*name\\s*=\\s*["']${escapeName(actionName)}["']`)) || 1,
    });
  }

  for (const [resourceName, declaration] of Object.entries(resources)) {
    const handler = typeof declaration === 'string' ? declaration : declaration && declaration.handler;
    analyzeExpression(model, {
      from: nodeId(AtlasNodeKind.RESOURCE, ownerId, resourceName),
      code: handler,
      scope: baseScope,
      loc: {
        file,
        line: lineOf(content, new RegExp(`<resource\\s+[^>]*name\\s*=\\s*["']${escapeName(resourceName)}["']`)) || 1,
      },
    });
  }

  addTemplateRelationships(model, { ...unit, ownerId, kind, file, starts, baseScope });

  return ownerId;
}

/**
 * Records `bridge.on('event', …)` subscriptions.
 *
 * The compiler already extracts these to warn about events a bridge never
 * emits (AVX_W38). Atlas keeps the relationship rather than only the warning.
 * @param {object} model - The AppModel being built.
 * @param {object} options - `{from, body, importedBridges, file, line}`.
 * @returns {void}
 */
function recordSubscriptions(model, options) {
  const { from, body, importedBridges, file, line } = options;
  for (const { target, event } of extractSubscriptions(body)) {
    const bridge = importedBridges.get(target);
    if (!bridge) continue;
    const eventNode = nodeId(
      AtlasNodeKind.EVENT,
      nodeId(AtlasNodeKind.BRIDGE, null, bridge.descriptor.name),
      event,
    );
    if (!model.hasNode(eventNode)) {
      model.addUnresolved({
        reason: UnresolvedReason.UNKNOWN_BRIDGE_MEMBER,
        expr: `${target}.on('${event}')`,
        name: `${bridge.descriptor.name}:${event}`,
        owner: from,
        loc: { file, line },
      });
      continue;
    }
    model.addEdge({
      from,
      to: eventNode,
      kind: AtlasEdgeKind.SUBSCRIBES,
      confidence: Confidence.CERTAIN,
      loc: { file, line },
    });
  }
}

/**
 * Finds a bridge descriptor by declared name.
 * @param {Map<string, object>|undefined} bridges - Descriptors by absolute path.
 * @param {string} name - The bridge's declared name.
 * @returns {object|null} The descriptor.
 */
function findBridgeDescriptor(bridges, name) {
  if (!bridges) return null;
  for (const descriptor of bridges.values()) {
    if (descriptor && descriptor.name === name) return descriptor;
  }
  return null;
}

/**
 * Walks a component's template and records what each construct relates to.
 *
 * Runs over the **masked original source**, so every node's location is the
 * line and column the developer wrote, not an offset into a rewritten string.
 * @param {object} model - The AppModel being built.
 * @param {object} unit - The component context.
 * @returns {void}
 */
function addTemplateRelationships(model, unit) {
  const { ownerId, content, file, starts, baseScope } = unit;
  const masked = maskDeclarations(content);
  const events = collectTemplateEvents(masked);

  // Scoped-slot variables come from whichever parent fills the slot, so they
  // are named here only to keep them out of the unknown-identifier bucket.
  const slotPropsRegex = /data-slot-props\s*=\s*"([^"]*)"/gi;
  let slotMatch;
  while ((slotMatch = slotPropsRegex.exec(masked)) !== null) {
    for (const part of slotMatch[1].split(/[\s,]+/)) {
      if (part.trim()) baseScope.slotProps.add(part.trim());
    }
  }

  /** @type {Array<{name: string, previous: object|undefined}>} */
  const loopStack = [];

  for (const event of events) {
    const position = positionAt(starts, event.index);
    const loc = { file, line: position.line, column: position.column };

    if (event.type === 'loop_start') {
      const bindingId = `${AtlasNodeKind.BINDING}:${ownerId}@${position.line}:${position.column}`;
      model.addNode({
        id: bindingId,
        kind: AtlasNodeKind.BINDING,
        owner: ownerId,
        binding: 'for',
        expression: String(event.list).trim(),
        loc,
      });
      model.addEdge({ from: ownerId, to: bindingId, kind: AtlasEdgeKind.DECLARES, confidence: Confidence.CERTAIN });

      analyzeExpression(model, { from: bindingId, code: event.list, scope: baseScope, loc });
      if (event.key) {
        analyzeExpression(model, { from: bindingId, code: event.key, scope: baseScope, loc });
      }

      // The item binding stands for an element of the list, so a later read of
      // `item.qty` resolves back to the state key the list came from.
      const listRefs = scanReferences(String(event.list));
      const first = listRefs.references.find((ref) => ref.kind === 'read');
      const resolved = first ? resolveReference(first, baseScope) : null;
      loopStack.push({ name: event.item, previous: baseScope.loopVars.get(event.item) });
      baseScope.loopVars.set(event.item, {
        resolved: resolved && resolved.target ? resolved : null,
      });
      continue;
    }

    if (event.type === 'loop_end') {
      const frame = loopStack.pop();
      if (frame) {
        if (frame.previous) baseScope.loopVars.set(frame.name, frame.previous);
        else baseScope.loopVars.delete(frame.name);
      }
      continue;
    }

    if (event.type === 'interpolation' || event.type === 'directive') {
      const bindingId = `${AtlasNodeKind.BINDING}:${ownerId}@${position.line}:${position.column}`;
      model.addNode({
        id: bindingId,
        kind: AtlasNodeKind.BINDING,
        owner: ownerId,
        binding: event.type === 'directive' ? event.name : 'text',
        expression: String(event.expr).trim(),
        loc,
      });
      model.addEdge({ from: ownerId, to: bindingId, kind: AtlasEdgeKind.DECLARES, confidence: Confidence.CERTAIN });
      analyzeExpression(model, {
        from: bindingId,
        code: event.expr,
        scope: baseScope,
        loc,
        // data-ax-bind is two-way: it renders the value and writes it back.
        writeBack: event.name === 'data-ax-bind',
      });
      continue;
    }

    if (event.type === 'event') {
      const handlerId = `${AtlasNodeKind.HANDLER}:${ownerId}@${position.line}:${position.column}`;
      model.addNode({
        id: handlerId,
        kind: AtlasNodeKind.HANDLER,
        owner: ownerId,
        event: event.name,
        expression: String(event.expr).trim(),
        loc,
      });
      model.addEdge({ from: ownerId, to: handlerId, kind: AtlasEdgeKind.DECLARES, confidence: Confidence.CERTAIN });
      analyzeExpression(model, { from: handlerId, code: event.expr, scope: baseScope, loc });
    }
  }
}

/**
 * Records which components a template renders.
 *
 * Kept separate from the expression walk because the compiler resolves child
 * components by class name after every component has been discovered, so this
 * runs once the model knows what exists.
 * @param {object} model - The AppModel being built.
 * @param {object} unit - `{ownerId, content, file, known}` where `known` maps a
 *   class name to its node id.
 * @returns {void}
 */
export function addRenderEdges(model, unit) {
  const { ownerId, content, file, known } = unit;
  const masked = maskDeclarations(content);
  const starts = lineIndex(content);
  const tagRegex = /<([A-Z][A-Za-z0-9]*)\b/g;
  let match;
  while ((match = tagRegex.exec(masked)) !== null) {
    const target = known.get(match[1]);
    if (!target) {
      model.addUnresolved({
        reason: UnresolvedReason.DYNAMIC_COMPONENT,
        expr: `<${match[1]}>`,
        owner: ownerId,
        loc: { file, line: positionAt(starts, match.index).line },
      });
      continue;
    }
    if (target === ownerId) continue;
    model.addEdge({
      from: ownerId,
      to: target,
      kind: AtlasEdgeKind.RENDERS,
      confidence: Confidence.CERTAIN,
      loc: { file, line: positionAt(starts, match.index).line },
    });
  }
}

/**
 * Whether a node kind owns members.
 * @param {string} kind - A node kind.
 * @returns {boolean} True for components, pages and bridges.
 */
export function isOwnerKind(kind) {
  return OWNER_KINDS.has(kind);
}

export default { addComponentUnit, addBridgeUnit, addRenderEdges, analyzeExpression };
