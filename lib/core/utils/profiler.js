let markCounter = 0;

/**
 * Wraps an execution block with performance marks and measures.
 * @param {boolean} enableProfiling - Whether profiling is enabled.
 * @param {string} componentName - Name of the component.
 * @param {string} phase - The phase being profiled (e.g. 'mount', 'patch', 'render', 'onMount').
 * @param {Function} fn - The function/callback to execute.
 * @returns {any} The result of the callback.
 */
export function profile(enableProfiling, componentName, phase, fn) {
  const isProfiling =
    enableProfiling &&
    typeof performance !== 'undefined' &&
    typeof performance.mark === 'function' &&
    typeof performance.measure === 'function';

  if (!isProfiling) {
    return fn();
  }

  const id = ++markCounter;
  const startMark = `ax-start-${componentName}-${phase}-${id}`;
  const endMark = `ax-end-${componentName}-${phase}-${id}`;
  const measureName = `[Avenx] ${componentName} - ${phase}`;

  performance.mark(startMark);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then((val) => {
          performance.mark(endMark);
          try {
            performance.measure(measureName, startMark, endMark);
          } catch {
            // Ignore
          } finally {
            performance.clearMarks(startMark);
            performance.clearMarks(endMark);
          }
          return val;
        })
        .catch((err) => {
          performance.mark(endMark);
          try {
            performance.measure(measureName, startMark, endMark);
          } catch {
            // Ignore
          } finally {
            performance.clearMarks(startMark);
            performance.clearMarks(endMark);
          }
          throw err;
        });
    }
    performance.mark(endMark);
    try {
      performance.measure(measureName, startMark, endMark);
    } catch {
      // Ignore
    } finally {
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    }
    return result;
  } catch (err) {
    performance.mark(endMark);
    try {
      performance.measure(measureName, startMark, endMark);
    } catch {
      // Ignore
    } finally {
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    }
    throw err;
  }
}

/**
 * Searches the DOM tree upwards from an element to find the nearest Avenx component.
 * Returns profiling status and the component name.
 * @param {Element|null} element - The DOM element.
 * @returns {{enableProfiling: boolean, componentName: string}}
 */
export function getComponentProfilingInfo(element) {
  let cur = element;
  while (cur) {
    if (cur.__avenx_comp_instance) {
      const comp = cur.__avenx_comp_instance;
      const enableProfiling = !!(
        comp.$app?.enableProfiling ||
        (typeof window !== 'undefined' && window.__avenx_enable_profiling)
      );
      return {
        enableProfiling,
        componentName: comp.constructor.name,
      };
    }
    cur = cur.parentNode;
  }
  const globalProfiling = !!(
    typeof window !== 'undefined' && window.__avenx_enable_profiling
  );
  return {
    enableProfiling: globalProfiling,
    componentName: 'UnknownComponent',
  };
}
