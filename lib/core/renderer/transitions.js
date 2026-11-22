/**
 * Helper to compute transition/animation duration from element computed styles.
 * @param {Element} el
 * @returns {number} duration in ms
 */
function getTransitionDuration(el) {
  if (!el || typeof window === 'undefined' || !window.getComputedStyle) return 0;
  const styles = window.getComputedStyle(el);
  const transitionDelay = styles.transitionDelay || '';
  const transitionDuration = styles.transitionDuration || '';
  const animationDelay = styles.animationDelay || '';
  const animationDuration = styles.animationDuration || '';

  const parseTime = (timeStr) => {
    if (!timeStr) return 0;
    const times = timeStr.split(',').map((t) => {
      const match = t.trim().match(/^([0-9.]+)(s|ms)$/i);
      if (!match) return 0;
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      return unit === 'ms' ? val : val * 1000;
    });
    return Math.max(...times, 0);
  };

  const tDuration = parseTime(transitionDuration);
  const tDelay = parseTime(transitionDelay);
  const aDuration = parseTime(animationDuration);
  const aDelay = parseTime(animationDelay);

  return Math.max(tDuration + tDelay, aDuration + aDelay);
}


/**
 * Applies the enter transition classes and triggers animation/transition.
 * @param {Element} el - The element to animate.
 * @param {string} transitionName - The transition name (e.g. 'fade').
 */
export function enter(el, transitionName) {
  if (el.nodeType !== Node.ELEMENT_NODE) return;
  const name = transitionName || 'ax';
  const enterClass = `${name}-enter`;
  const enterActiveClass = `${name}-enter-active`;
  const enterToClass = `${name}-enter-to`;

  if (el._cleanupTransition) {
    el._cleanupTransition();
  }

  el.classList.add(enterClass);
  el.classList.add(enterActiveClass);

  let resolved = false;
  let timeoutId = null;

  const done = () => {
    if (resolved) return;
    resolved = true;
    el.classList.remove(enterActiveClass);
    el.classList.remove(enterToClass);
    el.removeEventListener('transitionend', done);
    el.removeEventListener('animationend', done);
    if (timeoutId) clearTimeout(timeoutId);
    delete el._cleanupTransition;
  };

  el._cleanupTransition = done;

  el.addEventListener('transitionend', done);
  el.addEventListener('animationend', done);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (resolved) return;
      el.classList.remove(enterClass);
      el.classList.add(enterToClass);

      const duration = getTransitionDuration(el);
      if (duration === 0) {
        done();
      } else {
        timeoutId = setTimeout(done, duration + 50);
      }
    });
  });
}

/**
 * Applies the leave transition classes, triggers animation, and cleans up when complete.
 * @param {Element} el - The element to animate.
 * @param {string} transitionName - The transition name (e.g. 'fade').
 * @param {function(): void} removeCallback - Callback invoked when the leave transition completes.
 */
export function leave(el, transitionName, removeCallback) {
  if (el.nodeType !== Node.ELEMENT_NODE) {
    if (removeCallback) removeCallback();
    return;
  }
  const name = transitionName || 'ax';
  const leaveClass = `${name}-leave`;
  const leaveActiveClass = `${name}-leave-active`;
  const leaveToClass = `${name}-leave-to`;

  if (el._cleanupTransition) {
    el._cleanupTransition();
  }

  el._isLeaving = true;

  el.classList.add(leaveClass);
  el.classList.add(leaveActiveClass);

  let resolved = false;
  let timeoutId = null;

  const done = () => {
    if (resolved) return;
    resolved = true;
    el.classList.remove(leaveActiveClass);
    el.classList.remove(leaveToClass);
    el.removeEventListener('transitionend', done);
    el.removeEventListener('animationend', done);
    if (timeoutId) clearTimeout(timeoutId);
    delete el._cleanupTransition;
    delete el._isLeaving;
    if (removeCallback) removeCallback();
  };

  el._cleanupTransition = done;

  el.addEventListener('transitionend', done);
  el.addEventListener('animationend', done);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (resolved) return;
      el.classList.remove(leaveClass);
      el.classList.add(leaveToClass);

      const duration = getTransitionDuration(el);
      if (duration === 0) {
        done();
      } else {
        timeoutId = setTimeout(done, duration + 50);
      }
    });
  });
}

