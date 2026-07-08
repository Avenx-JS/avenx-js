/**
 * Registry for computed property definitions.
 */
export class ComputedRegistry {
  /**
   * @param {object} [computed] - An object containing computed property definitions (expressions).
   */
  constructor(computed = {}) {
    /** @type {object} */
    this.computed = computed || {};
  }

  /**
   * Returns the keys of all registered computed properties.
   * @returns {string[]}
   */
  keys() {
    return Object.keys(this.computed);
  }

  /**
   * Checks if a computed property with the given key exists.
   * @param {string} key - The key to check.
   * @returns {boolean}
   */
  has(key) {
    return Object.prototype.hasOwnProperty.call(this.computed, key);
  }

  /**
   * Returns the expression for a given computed property key.
   * @param {string} key - The key to retrieve.
   * @returns {string|undefined}
   */
  get(key) {
    return this.computed[key];
  }

  /**
   * Returns all registered computed property definitions.
   * @returns {object}
   */
  all() {
    return this.computed;
  }
}
