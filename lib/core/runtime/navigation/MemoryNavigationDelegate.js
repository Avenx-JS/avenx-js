import { NavigationDelegate } from './NavigationDelegate.js';

/**
 * In-memory navigation delegate for Node.js / SSR / headless environments.
 * Manages route location state without DOM or window dependencies.
 * @augments NavigationDelegate
 */
export class MemoryNavigationDelegate extends NavigationDelegate {
  /**
   * @param {string} [initialHash] - Initial location hash string.
   */
  constructor(initialHash = '#/') {
    super();
    this.currentHash = initialHash || '#/';
    this.title = '';
    this.hashListeners = new Set();
    this.linkClickListeners = new Set();
    this.activeRouters = new Set();
  }

  /** @override */
  getHash() {
    return this.currentHash;
  }

  /** @override */
  setHash(hash) {
    this.currentHash = hash;
    for (const listener of this.hashListeners) {
      listener(this.currentHash);
    }
  }

  /** @override */
  onHashChange(callback) {
    this.hashListeners.add(callback);
    return () => this.hashListeners.delete(callback);
  }

  /** @override */
  onLinkClick(callback) {
    this.linkClickListeners.add(callback);
    return () => this.linkClickListeners.delete(callback);
  }

  /** @override */
  setTitle(title) {
    this.title = title;
  }

  /** @override */
  registerRouter(router) {
    this.activeRouters.add(router);
  }

  /** @override */
  unregisterRouter(router) {
    this.activeRouters.delete(router);
  }

  /** @override */
  getActiveRouters() {
    return this.activeRouters;
  }

  /** @override */
  destroy() {
    this.hashListeners.clear();
    this.linkClickListeners.clear();
    this.activeRouters.clear();
  }
}
