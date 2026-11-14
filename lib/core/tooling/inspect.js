/**
 * Recursively clones an object and strips non-cloneable elements
 * (like functions, circular references, and DOM nodes).
 * @param {*} val - The value to sanitize.
 * @param {WeakSet<object>} [seen] - WeakSet tracking visited objects to prevent circular loops.
 * @returns {*} The safe clone.
 */
export function serializeSafe(val, seen = new WeakSet()) {
  if (val === null || typeof val !== 'object') {
    if (typeof val === 'function') {
      return '[Function]';
    }
    return val;
  }

  // Handle DOM elements and window references
  if (typeof window !== 'undefined' && ((typeof Node !== 'undefined' && val instanceof Node) || val === window)) {
    return `[DOM Element: ${val.nodeName || 'Window'}]`;
  }

  if (seen.has(val)) {
    return '[Circular]';
  }

  if (Array.isArray(val)) {
    seen.add(val);
    const res = val.map(item => serializeSafe(item, seen));
    seen.delete(val);
    return res;
  }

  // Use toJSON if available
  if (typeof val.toJSON === 'function') {
    try {
      return val.toJSON();
    } catch {
      // Ignored fallback
    }
  }

  seen.add(val);
  const res = {};
  for (const [key, value] of Object.entries(val)) {
    if (typeof value === 'function') {
      res[key] = '[Function]';
    } else if (key.startsWith('__')) {
      res[key] = '[Internal]';
    } else {
      res[key] = serializeSafe(value, seen);
    }
  }
  seen.delete(val);
  return res;
}

/**
 * Bounded update timeline log.
 * @type {Array<object>}
 */
const timeline = [];
let timelineCounter = 0;
export const DEFAULT_MAX_TIMELINE_SIZE = 100;

/**
 * Records an update lifecycle event to the bounded timeline ring buffer.
 * Serializes snapshots rather than retaining live component references.
 * @param {'mount'|'update'|'unmount'} type - The lifecycle event type.
 * @param {object} comp - The component instance.
 * @param {object} [extra] - Additional metadata (mutated key, causation trace).
 * @returns {object|null} The recorded timeline entry.
 */
export function recordTimelineEntry(type, comp, extra = {}) {
  if (!comp) return null;

  const maxTimelineSize =
    (typeof window !== 'undefined' && window.__avenx_inspect_max_timeline) ||
    DEFAULT_MAX_TIMELINE_SIZE;

  const entry = {
    id: `tl-${++timelineCounter}`,
    timestamp: Date.now(),
    type,
    componentId: comp.$id || null,
    componentName: comp.constructor?.name || 'AnonymousComponent',
    key: extra.key !== undefined ? extra.key : (comp.__lastMutatedKey || null),
    causationTrace: extra.causationTrace || (comp.__lastCausationTrace ? [...comp.__lastCausationTrace] : []),
    state: serializeSafe(comp.state || {}),
    props: serializeSafe(comp.props || {}),
  };

  // Clean up transient fields on comp to avoid lingering memory references
  comp.__lastMutatedKey = null;
  comp.__lastCausationTrace = null;

  timeline.push(entry);
  while (timeline.length > maxTimelineSize) {
    timeline.shift();
  }

  return entry;
}

/**
 * Returns a shallow copy of the current update timeline.
 * @returns {Array<object>}
 */
export function getTimeline() {
  return [...timeline];
}

/**
 * Clears the update timeline history.
 */
export function clearTimeline() {
  timeline.length = 0;
  timelineCounter = 0;
}

let activeHighlightElement = null;

/**
 * Highlights a component in the DOM by instance ID.
 * @param {string} componentId - The component $id.
 */
export function highlightComponent(componentId) {
  clearComponentHighlight();
  if (typeof document === 'undefined') return;

  let targetEl = null;
  const elements = document.querySelectorAll('[data-avenx-comp], [data-avenx-comp-dynamic]');
  for (const el of elements) {
    if (el.__avenx_comp_instance && el.__avenx_comp_instance.$id === componentId) {
      targetEl = el;
      break;
    }
  }

  if (!targetEl && typeof window !== 'undefined' && window.__avenx_app_instance) {
    const app = window.__avenx_app_instance;
    const topComps = app.activeComponents || (app.activePage ? [app.activePage] : []);
    for (const comp of topComps) {
      if (comp && comp.$id === componentId && typeof comp._getElement === 'function') {
        targetEl = comp._getElement();
        break;
      }
    }
  }

  if (!targetEl || typeof targetEl.getBoundingClientRect !== 'function') return;

  const rect = targetEl.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.id = '__avenx_inspect_highlight';
  overlay.style.position = 'fixed';
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '999999';
  overlay.style.border = '2px solid #3b82f6';
  overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
  overlay.style.boxSizing = 'border-box';
  overlay.style.borderRadius = '4px';

  document.body.appendChild(overlay);
  activeHighlightElement = overlay;
}

/**
 * Clears the active component DOM highlight.
 */
export function clearComponentHighlight() {
  if (activeHighlightElement && activeHighlightElement.parentNode) {
    activeHighlightElement.parentNode.removeChild(activeHighlightElement);
  }
  activeHighlightElement = null;
}

/**
 * Collects active component instances from the DOM and application root.
 * @param {object} app - The AvenxApp instance.
 * @returns {Array<{comp: object, hostEl: Element|null}>}
 */
function collectActiveComponents(app) {
  const components = [];
  const seenInstances = new Set();

  function addInstance(comp, hostEl) {
    if (!comp || seenInstances.has(comp)) return;
    seenInstances.add(comp);
    components.push({ comp, hostEl });
  }

  if (app) {
    const topComps = app.activeComponents || (app.activePage ? [app.activePage] : []);
    for (const comp of topComps) {
      if (comp) {
        const el = typeof comp._getElement === 'function' ? comp._getElement() : null;
        addInstance(comp, el);
      }
    }
  }

  if (typeof document !== 'undefined') {
    const elements = document.querySelectorAll('[data-avenx-comp], [data-avenx-comp-dynamic]');
    elements.forEach((el) => {
      if (el.__avenx_comp_instance) {
        addInstance(el.__avenx_comp_instance, el);
      }
    });
  }

  return components;
}

/**
 * Constructs a nested component tree from flat component nodes.
 * @param {Array<object>} flatNodes - Component nodes.
 * @returns {Array<object>} Root component tree nodes.
 */
export function buildComponentTree(flatNodes) {
  const nodeMap = new Map();
  const roots = [];

  for (const node of flatNodes) {
    nodeMap.set(node.id, {
      ...node,
      children: [],
    });
  }

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Collects all active component instances, component tree, timeline, and application metadata.
 * @param {object} app - The AvenxApp instance.
 * @returns {object} Inspector data payload.
 */
export function getInspectorData(app) {
  const rawComponents = collectActiveComponents(app);
  const siblingCounts = new Map();

  const flatNodes = rawComponents.map(({ comp, hostEl }) => {
    const id = comp.$id || `comp-${comp.constructor?.name || 'Anonymous'}`;
    const name = comp.constructor?.name || 'AnonymousComponent';
    const parentComp = comp.$parentComponent;
    const parentId = parentComp && parentComp !== comp ? (parentComp.$id || null) : null;

    let key = null;
    if (comp.props && comp.props.key !== undefined) {
      key = comp.props.key;
    } else if (comp.props && comp.props.id !== undefined) {
      key = comp.props.id;
    } else if (hostEl) {
      if (typeof hostEl.getAttribute === 'function') {
        if (hostEl.hasAttribute('data-ax-key-val')) {
          key = hostEl.getAttribute('data-ax-key-val');
        } else if (hostEl.hasAttribute('key')) {
          key = hostEl.getAttribute('key');
        } else if (hostEl.hasAttribute('data-key')) {
          key = hostEl.getAttribute('data-key');
        } else {
          const parentWithKey = hostEl.closest && hostEl.closest('[data-ax-key-val]');
          if (parentWithKey && parentWithKey !== hostEl) {
            key = parentWithKey.getAttribute('data-ax-key-val');
          }
        }
      }
    }

    const siblingKey = `${parentId || 'root'}:${name}`;
    const index = siblingCounts.get(siblingKey) || 0;
    siblingCounts.set(siblingKey, index + 1);

    return {
      id,
      name,
      parentId,
      key,
      index,
      state: comp.state || {},
      props: comp.props || {},
    };
  });

  const componentTree = buildComponentTree(flatNodes);

  const registeredBridges = {};
  for (const [name, bridge] of Object.entries(app?.bridges || {})) {
    registeredBridges[name] = bridge;
  }

  const registeredComponents = app?.components ? Array.from(app.components.keys()) : [];
  const registeredPages = app?.pages ? Array.from(app.pages.keys()) : [];

  const routes = app?.router ? app.router.routes : {};
  const currentRoute = app?.router ? app.router.currentRoute : null;

  return serializeSafe({
    version: 2,
    componentTree,
    activeComponents: flatNodes,
    timeline,
    registeredBridges,
    registeredComponents,
    registeredPages,
    routes,
    currentRoute,
  });
}

/**
 * Initializes the inspector for an AvenxApp.
 * @param {object} app - The AvenxApp instance.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.maxTimelineSize] - Maximum number of timeline entries to retain.
 */
export function initInspector(app, options = {}) {
  if (typeof window === 'undefined' || !window.__avenx_inspect_enabled || typeof globalThis.BroadcastChannel === 'undefined') {
    return;
  }

  if (options.maxTimelineSize) {
    window.__avenx_inspect_max_timeline = options.maxTimelineSize;
  }

  // Retain global app instance for locator lookups in dev mode
  window.__avenx_app_instance = app;

  const channel = new globalThis.BroadcastChannel('avenx-inspector-channel');

  const broadcast = () => {
    try {
      channel.postMessage({
        type: 'inspect-data',
        data: getInspectorData(app),
      });
    } catch (err) {
      // Gracefully catch any remaining clone/postMessage errors
      console.warn('[Avenx Inspector] Failed to broadcast state:', err);
    }
  };

  let broadcastScheduled = false;
  const scheduleBroadcast = () => {
    if (broadcastScheduled) return;
    broadcastScheduled = true;
    const defer = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => setTimeout(fn, 0);
    defer(() => {
      broadcastScheduled = false;
      broadcast();
    });
  };

  channel.onmessage = (event) => {
    const msg = event.data;
    if (msg === 'request-inspect-data' || msg?.type === 'request-inspect-data') {
      broadcast();
    } else if (msg?.type === 'highlight-component') {
      highlightComponent(msg.id);
    } else if (msg?.type === 'clear-highlight') {
      clearComponentHighlight();
    }
  };

  // Automatically broadcast on page transitions or component lifecycles/updates.
  const originalUpdateAll = app.updateAll;
  if (typeof originalUpdateAll === 'function') {
    app.updateAll = function (...args) {
      const res = originalUpdateAll.apply(this, args);
      scheduleBroadcast();
      return res;
    };
  }

  const originalMountPage = app.mountPage;
  if (typeof originalMountPage === 'function') {
    app.mountPage = function (...args) {
      const res = originalMountPage.apply(this, args);
      scheduleBroadcast();
      return res;
    };
  }

  // Intercept component lifecycles using capturing phase listeners (since they don't bubble)
  window.addEventListener(
    'avenx:update',
    (event) => {
      const comp = event.detail?.component || event.target?.__avenx_comp_instance;
      recordTimelineEntry('update', comp);
      scheduleBroadcast();
    },
    true
  );

  window.addEventListener(
    'avenx:mount',
    (event) => {
      const comp = event.detail?.component || event.target?.__avenx_comp_instance;
      recordTimelineEntry('mount', comp);
      scheduleBroadcast();
    },
    true
  );

  window.addEventListener(
    'avenx:unmount',
    (event) => {
      const comp = event.detail?.component || event.target?.__avenx_comp_instance;
      recordTimelineEntry('unmount', comp);
      scheduleBroadcast();
    },
    true
  );
}
