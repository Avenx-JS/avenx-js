import { NavigationDelegate } from './NavigationDelegate.js';

/**
 * Browser navigation delegate interacting with window, location, document.title,
 * and hashchange/click events.
 * @augments NavigationDelegate
 */
export class BrowserNavigationDelegate extends NavigationDelegate {
  /**
   * Creates an instance of BrowserNavigationDelegate.
   */
  constructor() {
    super();
    this.hashListeners = new Set();
    this.linkClickListeners = new Set();

    this.onWindowHashChange = () => {
      for (const listener of this.hashListeners) {
        listener(this.getHash());
      }
    };

    this.onWindowClick = (e) => {
      if (typeof window === 'undefined' || !e || !e.target || typeof e.target.closest !== 'function') {
        return;
      }
      const target = e.target.closest('[data-ax-link]');
      if (target) {
        e.preventDefault();
        const route = target.getAttribute('data-ax-link');
        if (route) {
          for (const listener of this.linkClickListeners) {
            listener(route);
          }
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', this.onWindowHashChange);
      window.addEventListener('click', this.onWindowClick);
      if (!window.__avenx_routers) {
        window.__avenx_routers = new Set();
      }
    }
  }

  /** @override */
  getHash() {
    if (typeof window !== 'undefined' && window.location) {
      return window.location.hash || '#/';
    }
    return '#/';
  }

  /** @override */
  setHash(hash) {
    if (typeof window !== 'undefined' && window.location) {
      window.location.hash = hash;
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
    if (typeof document !== 'undefined') {
      document.title = title;
    }
  }

  /** @override */
  registerRouter(router) {
    if (typeof window !== 'undefined') {
      if (!window.__avenx_routers) {
        window.__avenx_routers = new Set();
      }
      window.__avenx_routers.add(router);
    }
  }

  /** @override */
  unregisterRouter(router) {
    if (typeof window !== 'undefined' && window.__avenx_routers) {
      window.__avenx_routers.delete(router);
    }
  }

  /** @override */
  getActiveRouters() {
    if (typeof window !== 'undefined' && window.__avenx_routers) {
      return window.__avenx_routers;
    }
    return new Set();
  }

  /** @override */
  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', this.onWindowHashChange);
      window.removeEventListener('click', this.onWindowClick);
    }
    this.hashListeners.clear();
    this.linkClickListeners.clear();
  }
}
