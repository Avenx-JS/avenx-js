/**
 * Base abstract class defining the navigation delegate interface.
 * Encapsulates environment-specific URL location management, event listening,
 * and page title operations.
 */
export class NavigationDelegate {
  /**
   * Gets the current location hash string (e.g. '#/home').
   * @returns {string}
   */
  getHash() {
    return '#/';
  }

  /**
   * Navigates/sets the current location hash string.
   * @param {string} _hash
   */
  setHash(_hash) {}

  /**
   * Subscribes to location/hash change events.
   * @param {Function} _callback
   * @returns {Function} Unsubscribe function.
   */
  onHashChange(_callback) {
    return () => {};
  }

  /**
   * Subscribes to click events on links (e.g. [data-ax-link]).
   * @param {Function} _callback
   * @returns {Function} Unsubscribe function.
   */
  onLinkClick(_callback) {
    return () => {};
  }

  /**
   * Sets the document or in-memory title.
   * @param {string} _title
   */
  setTitle(_title) {}

  /**
   * Registers a router instance for active router tracking.
   * @param {object} _router
   */
  registerRouter(_router) {}

  /**
   * Unregisters a router instance.
   * @param {object} _router
   */
  unregisterRouter(_router) {}

  /**
   * Returns all active router instances.
   * @returns {Set<object>}
   */
  getActiveRouters() {
    return new Set();
  }

  /**
   * Destroys the delegate and cleans up event listeners.
   */
  destroy() {}
}
