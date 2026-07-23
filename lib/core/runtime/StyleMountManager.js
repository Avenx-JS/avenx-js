/**
 * Manages runtime style injection for component classes.
 * Ensures only one <style> element per component class is ever present
 * in the document <head>, using reference counting to safely remove
 * styles only when all instances of that class have been unmounted.
 */
export class StyleMountManager {
  /**
   * Maps a component class style identifier to its metadata.
   * @type {Map<string, { element: Element, refCount: number }>}
   * @private
   */
  #registry = new Map();

  /**
   * Mounts runtime styles for a component class into the document <head>.
   * If the styles for this class are already mounted, increments the
   * reference count without creating a duplicate <style> element.
   * @param {typeof AvenxComponent} componentClass - The component class (constructor).
   */
  mount(componentClass) {
    const styles = componentClass.styles;
    if (!styles || typeof styles !== 'string' || !styles.trim()) return;

    const styleId = this.#getStyleId(componentClass);

    if (this.#registry.has(styleId)) {
      this.#registry.get(styleId).refCount++;
      return;
    }

    // Check if a style element with this ID already exists in the DOM
    // (e.g. from a previous app lifecycle or SSR hydration)
    if (typeof document !== 'undefined' && document.head) {
      const existing = document.head.querySelector(`[data-avenx-style="${styleId}"]`);
      if (existing) {
        this.#registry.set(styleId, { element: existing, refCount: 1 });
        return;
      }
    }

    // Create and append a new <style> element
    if (typeof document !== 'undefined' && document.head) {
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-avenx-style', styleId);
      styleEl.textContent = styles;
      document.head.appendChild(styleEl);
      this.#registry.set(styleId, { element: styleEl, refCount: 1 });
    }
  }

  /**
   * Decrements the reference count for a component class's styles.
   * Removes the <style> element from the DOM only when no more
   * instances of that class are active.
   * @param {typeof AvenxComponent} componentClass - The component class (constructor).
   */
  unmount(componentClass) {
    const styles = componentClass.styles;
    if (!styles || typeof styles !== 'string' || !styles.trim()) return;

    const styleId = this.#getStyleId(componentClass);
    const entry = this.#registry.get(styleId);

    if (entry) {
      entry.refCount--;
    }

    const refCount = entry ? entry.refCount : 0;
    const hasActiveDOM = this.#hasActiveInstancesInDOM(componentClass);

    if (refCount <= 0 || !hasActiveDOM) {
      this.#removeStyleElements(styleId, entry ? entry.element : null);
      this.#registry.delete(styleId);
    }
  }

  /**
   * Cleans up all style elements matching a style ID from document head.
   * @param {string} styleId
   * @param {Element|null} [fallbackElement]
   * @private
   */
  #removeStyleElements(styleId, fallbackElement) {
    if (typeof document !== 'undefined' && document.head) {
      let removedAny = false;

      if (document.head.querySelectorAll) {
        const matching = document.head.querySelectorAll(`[data-avenx-style="${styleId}"]`);
        if (matching && matching.length > 0) {
          Array.from(matching).forEach((el) => {
            if (el && el.parentNode) {
              el.parentNode.removeChild(el);
              removedAny = true;
            }
          });
        }
      } else if (document.head.querySelector) {
        let matching = document.head.querySelector(`[data-avenx-style="${styleId}"]`);
        while (matching) {
          if (matching.parentNode) {
            matching.parentNode.removeChild(matching);
            removedAny = true;
          } else {
            break;
          }
          matching = document.head.querySelector(`[data-avenx-style="${styleId}"]`);
        }
      }

      if (!removedAny && fallbackElement && fallbackElement.parentNode) {
        fallbackElement.parentNode.removeChild(fallbackElement);
      }
    }
  }

  /**
   * Checks if any active instances of the component class currently exist in the DOM tree.
   * @param {typeof AvenxComponent} componentClass
   * @returns {boolean}
   * @private
   */
  #hasActiveInstancesInDOM(componentClass) {
    if (typeof document === 'undefined' || (!document.body && !document.documentElement)) {
      return true;
    }

    const targetName = componentClass.name;
    const isMatchingInstance = (el) => {
      if (!el || !el.__avenx_comp_instance) return false;
      const inst = el.__avenx_comp_instance;
      return inst.constructor === componentClass || (targetName && inst.constructor.name === targetName);
    };

    const traverse = (root) => {
      if (!root) return false;
      if (isMatchingInstance(root)) return true;
      if (root.children) {
        for (let i = 0; i < root.children.length; i++) {
          if (traverse(root.children[i])) return true;
        }
      }
      return false;
    };

    return traverse(document.body) || traverse(document.documentElement);
  }

  /**
   * Generates a unique style identifier for a component class.
   * Uses the class name as the key.
   * @param {typeof AvenxComponent} componentClass - The component class.
   * @returns {string} The style identifier.
   * @private
   */
  #getStyleId(componentClass) {
    return `avenx-style-${componentClass.name}`;
  }

  /**
   * Returns the current reference count for a component class's styles.
   * Useful for testing purposes.
   * @param {typeof AvenxComponent} componentClass - The component class.
   * @returns {number} The reference count, or 0 if not mounted.
   */
  getRefCount(componentClass) {
    const styleId = this.#getStyleId(componentClass);
    const entry = this.#registry.get(styleId);
    return entry ? entry.refCount : 0;
  }
}

/**
 * The singleton instance used by all components.
 * @type {StyleMountManager}
 */
export const styleMountManager = new StyleMountManager();
