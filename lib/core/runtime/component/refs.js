/** Lazy template reference collection, owned by one component lifetime. */
export class TemplateRefs {
  #cache = {};
  #dirty = false;

  /** Marks the cache for collection on its next read. */
  invalidate() {
    this.#dirty = true;
  }

  /** Clears detached references at teardown. */
  clear() {
    this.#cache = {};
    this.#dirty = false;
  }

  /**
   * Returns the current references, collecting only when dirty.
   * @param {Element|null} element - Component host.
   * @returns {object} Reference cache.
   */
  resolve(element) {
    if (this.#dirty) this.collect(element);
    return this.#cache;
  }

  /**
   * Collects references within this host's component boundary.
   * @param {Element|null} element - Component host.
   * @returns {object} New reference cache.
   */
  collect(element) {
    this.clear();
    collectRefs(element, this.#cache);
    return this.#cache;
  }
}

/**
 * Collects elements marked with data-ax-ref that belong to this component.
 * Elements inside nested component boundaries are excluded.
 * @param {Element|null} element - Component host.
 * @param {object} refs - Cache to populate.
 */
function collectRefs(element, refs) {
  if (!element) return;

  const refElements = element.querySelectorAll('[data-ax-ref]');
  const root = element;

  Array.from(refElements).forEach((element) => {
    let parent = element.parentNode;

    while (parent && parent !== root) {
      if (
        parent.hasAttribute &&
        (parent.hasAttribute('data-avenx-comp') || parent.hasAttribute('data-avenx-comp-dynamic'))
      ) {
        return;
      }

      parent = parent.parentNode;
    }

    const refName = element.getAttribute('data-ax-ref');

    if (refName && refName.trim()) {
      // Prefer the mounted component instance when present (Vue-like $refs behavior)
      refs[refName.trim()] = element.__avenx_comp_instance || element;
    }
  });
}
