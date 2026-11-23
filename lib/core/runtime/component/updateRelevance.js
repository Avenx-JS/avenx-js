const TEMPLATE_EXCLUDED_IDENTIFIERS = new Set([
  'state',
  'props',
  'styles',
  'event',
  'args',
  'Math',
  'console',
  'JSON',
  'window',
  'document',
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
  'true',
  'false',
  'null',
  'undefined',
]);

/**
 * Whether this component unconditionally renders on any state mutation.
 * @param {Set<string>} contracts - Declared contracts.
 * @param {object} options - Component options.
 * @param {Set<string>|null} templateDeps - Statically known dependencies.
 * @returns {boolean}
 */
export function isUnconditional(contracts, options, templateDeps) {
  return (
    contracts.has('unconditional') ||
    contracts.has('always-render') ||
    Boolean(options?.unconditional) ||
    Boolean(options?.alwaysRender) ||
    templateDeps === null
  );
}

/**
 * Determines whether an update should be skipped because the mutated key
 * touches no dependency of the template or rendered computed properties.
 * @param {object} context - Explicit dependency collections and property-path resolver.
 * @param {string|symbol|Array<string|symbol>} [key] - Mutated property key.
 * @param {object} [target] - Target object that changed.
 * @returns {boolean} True if the update should be skipped.
 */
export function shouldSkipUpdate(context, key, target) {
  if (!context.hasRenderedOnce) {
    return false;
  }

  if (isUnconditional(context.contracts, context.options, context.templateDeps)) {
    return false;
  }

  if (key === undefined || key === null) {
    return false;
  }

  const rawState = context.rawState;
  const keys = Array.isArray(key) ? key : [key];
  let isRelevant = false;

  for (const k of keys) {
    if (typeof k === 'symbol') {
      return false;
    }

    let rootKey = String(k);
    if (target && target !== rawState) {
      const propPath = context.getPropertyPath(target, k);
      if (propPath) {
        rootKey = propPath.split('.')[0];
      }
    }

    if (isKeyTemplateRelevant(context, rootKey)) {
      isRelevant = true;
      break;
    }
  }

  if (!isRelevant) {
    return true;
  }

  return false;
}

/**
 * Checks whether a given state root key is relevant to the template
 * (referenced directly or via a computed property rendered by the template).
 * @param {object} context - Explicit dependency collections and property-path resolver.
 * @param {string} rootKey - Root property key on state.
 * @returns {boolean}
 */
export function isKeyTemplateRelevant(context, rootKey) {
  if (context.templateDeps instanceof Set) {
    if (context.templateDeps.has(rootKey) || context.templateDeps.has('state')) {
      return true;
    }
    for (const compKey of context.templateDeps) {
      if (context.computed.has(compKey) && computedDependsOn(context, compKey, rootKey)) {
        return true;
      }
    }
    return false;
  }

  if (context.renderWatcher?.deps) {
    for (const dep of context.renderWatcher.deps.values()) {
      const depRoot = context.getPropertyPath(dep.target, dep.key).split('.')[0];
      if (depRoot === rootKey) {
        return true;
      }
    }
  }

  if (context.bindings) {
    for (const binding of context.bindings) {
      if (binding.watcher?.deps) {
        for (const dep of binding.watcher.deps.values()) {
          const depRoot = context.getPropertyPath(dep.target, dep.key).split('.')[0];
          if (depRoot === rootKey) {
            return true;
          }
        }
      }
    }
  }

  for (const compKey of context.computed.keys()) {
    if (computedDependsOn(context, compKey, rootKey)) {
      if (isComputedObservedByTemplate(context, compKey)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether a computed property depends on rootKey.
 * @param {object} context - Explicit dependency collections and property-path resolver.
 * @param {string} compKey
 * @param {string} rootKey
 * @param {Set<string>} [visited]
 * @returns {boolean}
 */
export function computedDependsOn(context, compKey, rootKey, visited = new Set()) {
  if (visited.has(compKey)) return false;
  visited.add(compKey);

  const watcher = context.computedWatchers?.get(compKey);
  if (watcher?.deps) {
    for (const dep of watcher.deps.values()) {
      const depRoot = context.getPropertyPath(dep.target, dep.key).split('.')[0];
      if (depRoot === rootKey) return true;
      if (context.computed.has(depRoot) && computedDependsOn(context, depRoot, rootKey, visited)) {
        return true;
      }
    }
  }

  const def = context.computed.get(compKey);
  if (typeof def === 'string') {
    const ids = extractIdentifiers(def);
    if (ids.has(rootKey)) return true;
    for (const id of ids) {
      if (context.computed.has(id) && computedDependsOn(context, id, rootKey, visited)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a computed property is observed by the template.
 * @param {object} context - Explicit dependency collections and property-path resolver.
 * @param {string} compKey
 * @returns {boolean}
 */
export function isComputedObservedByTemplate(context, compKey) {
  if (context.templateDeps instanceof Set) {
    return context.templateDeps.has(compKey);
  }
  const keysMap = context.observedComputed;
  const watchers = keysMap?.get(compKey);
  if (watchers) {
    if (context.renderWatcher && watchers.has(context.renderWatcher)) return true;
    if (context.bindings) {
      for (const binding of context.bindings) {
        if (binding.watcher && watchers.has(binding.watcher)) return true;
      }
    }
  }
  return false;
}

/**
 * Extracts template dependencies from template source string for uncompiled components.
 * Returns null if dynamic/defeating constructs are detected.
 * @param {string} template
 * @returns {Set<string>|null}
 */
export function extractTemplateDeps(template) {
  if (typeof template !== 'string' || !template.trim()) {
    return new Set();
  }
  if (
    /:\[[^\]]+\]/.test(template) ||
    /data-ax-html\s*=\s*["'][^"']+["']/.test(template) ||
    /state\s*\[/.test(template)
  ) {
    return null;
  }
  const deps = new Set();
  const interpRegex = /\{\{([\s\S]*?)\}\}/g;
  let match;
  while ((match = interpRegex.exec(template)) !== null) {
    const ids = extractIdentifiers(match[1]);
    for (const id of ids) deps.add(id);
  }
  const dirRegex = /:([a-zA-Z0-9_-]+)="([^"]*)"/g;
  while ((match = dirRegex.exec(template)) !== null) {
    const ids = extractIdentifiers(match[2]);
    for (const id of ids) deps.add(id);
  }
  return deps;
}

/**
 * Extracts root identifiers from an expression string.
 * @param {string} code
 * @returns {Set<string>}
 */
export function extractIdentifiers(code) {
  const ids = new Set();
  if (typeof code !== 'string') return ids;
  const regex = /\b([A-Za-z_$][\w$]*)\b/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    const id = match[1];
    if (!TEMPLATE_EXCLUDED_IDENTIFIERS.has(id)) {
      ids.add(id);
    }
  }
  const statePropRegex = /state\.([A-Za-z_$][\w$]*)/g;
  while ((match = statePropRegex.exec(code)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}
