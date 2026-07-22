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
   */
  setHash() {}

  /**
   * Subscribes to location/hash change events.
   * @returns {Function} Unsubscribe function.
   */
  onHashChange() {
    return () => {};
  }

  /**
   * Subscribes to click events on links (e.g. [data-ax-link]).
   * @returns {Function} Unsubscribe function.
   */
  onLinkClick() {
    return () => {};
  }

  /**
   * Sets the document or in-memory title.
   */
  setTitle() {}

  /**
   * Registers a router instance for active router tracking.
   */
  registerRouter() {}

  /**
   * Unregisters a router instance.
   */
  unregisterRouter() {}

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
