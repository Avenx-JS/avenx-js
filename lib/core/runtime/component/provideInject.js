/**
 * Finds the nearest ancestor component that provides the specified key.
 * @param {Element|null} el - Receiving component host.
 * @param {string} key - The provided key to search for.
 * @param {Function} provides - Tests an encountered provider for the key.
 * @returns {AvenxComponent|null} The ancestor component instance, or null.
 */
export function findAncestorProviding(el, key, provides) {
  if (!el) return null;
  let parentEl = el.parentNode;
  while (parentEl) {
    if (parentEl.__avenx_comp_instance) {
      const comp = parentEl.__avenx_comp_instance;
      if (provides(comp, key)) {
        return comp;
      }
    }
    parentEl = parentEl.parentNode;
  }
  return null;
}

/**
 * Checks if a component provides the specified key.
 * @param {Function} resolve - Resolves the provider option in its owner scope.
 * @param {string} key - The provided key.
 * @returns {boolean} True if the component provides the key.
 */
export function providerHasKey(resolve, key) {
  const resolved = resolve();

  if (Array.isArray(resolved)) {
    return resolved.includes(key);
  } else if (resolved && typeof resolved === 'object') {
    return key in resolved;
  }
  return false;
}

/**
 * Retrieves the provided value for a key from an ancestor component.
 * @param {object|undefined} providedState - Reactive provided values, if initialized.
 * @param {string} key - The provided key.
 * @param {Function} resolve - Resolves the provider option in its owner scope.
 * @param {Function} readScope - Reads an array-declared key from its owner scope.
 * @param {Function} bindValue - Binds an unproxied provided function to its owner.
 * @returns {any} The value.
 */
export function readProvidedValue(providedState, key, resolve, readScope, bindValue) {
  if (providedState && key in providedState) {
    const val = providedState[key];
    if (typeof val === 'function') {
      return val;
    }
    return val;
  }

  const resolved = resolve();

  if (Array.isArray(resolved)) {
    return readScope(key);
  } else if (resolved && typeof resolved === 'object') {
    const val = resolved[key];
    if (typeof val === 'function') {
      return bindValue(val);
    }
    return val;
  }
  return undefined;
}
