import { BrowserNavigationDelegate } from './BrowserNavigationDelegate.js';
import { MemoryNavigationDelegate } from './MemoryNavigationDelegate.js';

export { NavigationDelegate } from './NavigationDelegate.js';
export { BrowserNavigationDelegate } from './BrowserNavigationDelegate.js';
export { MemoryNavigationDelegate } from './MemoryNavigationDelegate.js';

/**
 * Creates an appropriate navigation delegate based on configuration options and environment.
 * @param {object} [options]
 * @returns {import('./NavigationDelegate.js').NavigationDelegate}
 */
export function createNavigationDelegate(options = {}) {
  if (options.delegate) {
    return options.delegate;
  }
  if (options.mode === 'memory' || typeof window === 'undefined') {
    return new MemoryNavigationDelegate(options.initialHash || '#/');
  }
  return new BrowserNavigationDelegate();
}
