/**
 * Accessibility helper for managing focus and route announcements during SPA navigation.
 */

const LIVE_REGION_ID = '__avenx_a11y_announcer__';

/**
 * Creates or retrieves the singleton visually hidden aria-live region.
 * @returns {HTMLElement|null}
 */
export function getOrCreateLiveRegion() {
  if (typeof document === 'undefined') return null;

  let region = document.getElementById(LIVE_REGION_ID);
  if (!region) {
    region = document.createElement('div');
    region.id = LIVE_REGION_ID;
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');

    // Standard accessible visually-hidden CSS (clip-rect pattern)
    Object.assign(region.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });

    document.body.appendChild(region);
  }
  return region;
}

/**
 * Announces a message to screen readers via the live region.
 * Clears and updates after a microtask/frame to ensure assistive tech detects changes.
 * @param {string} message
 */
export function announce(message) {
  if (typeof document === 'undefined' || !message) return;

  const region = getOrCreateLiveRegion();
  if (!region) return;

  // Clear first so identical consecutive titles are re-announced
  region.textContent = '';

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      region.textContent = message;
    });
  } else {
    setTimeout(() => {
      region.textContent = message;
    }, 0);
  }
}

/**
 * Moves focus to the new page container or configured target.
 * Applies tabindex="-1" if needed so non-focusable elements can receive focus.
 * @param {HTMLElement|null} container - The mounted page root element.
 * @param {string} [focusTargetSelector] - Optional custom selector.
 */
export function manageFocus(container, focusTargetSelector) {
  if (typeof document === 'undefined' || !container) return;

  let target = null;

  if (focusTargetSelector && typeof focusTargetSelector === 'string') {
    target = container.querySelector(focusTargetSelector);
  }

  // Fallback to data-ax-page-heading if present, else page container
  if (!target) {
    target = container.querySelector('[data-ax-page-heading]') || container;
  }

  if (target && typeof target.focus === 'function') {
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: true });
  }
}