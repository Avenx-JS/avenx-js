const queue = [];

/**
 * Membership index for {@link queue}.
 *
 * Deduplication used to be `queue.includes(job)`, a linear scan on every
 * enqueue. That was unnoticeable when a queue held one job per updating
 * component. Fine-grained rendering puts one job per *binding* in it, so a
 * component with 500 bound values turned a flush into 125,000 comparisons
 * before running a single job. The set is kept exactly in step with the array:
 * anything that removes from one removes from the other.
 * @type {Set<Function>}
 */
const queued = new Set();

const flushCallbacks = [];
let isPending = false;
let isFlushing = false;

import { logger } from '../runtime/AvenxLogger.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { tracer } from '../trace/tracer.js';
import { tripBoundary, findOwningComponent } from '../renderer/deadlockManager.js';

/**
 * Maximum recursive flush depth allowed before triggering reactive deadlock abort.
 * Defaults to 25 to accommodate deep legitimate multi-pass updates while stopping infinite cycles.
 * @type {number}
 */
let maxFlushCount = 25;

/**
 * Recursion depth of the currently executing flush.
 *
 * Incremented once per {@link flushJobs} invocation, not once per job: a flush
 * pass legitimately drains arbitrarily many jobs (one per updating component),
 * so only *re-entry* — a pass whose jobs queued yet more work — indicates a
 * potential runaway update chain.
 * @type {number}
 */
let flushDepth = 0;

/**
 * Execution count of individual jobs in the current flush cycle.
 * Keyed by job or job.id.
 * @type {Map<any, number>}
 */
const jobExecutionCounts = new Map();
/**
 * Jobs quarantined for the rest of the current top-level flush.
 *
 * A job that re-queues itself past the frequency limit is a reactive cycle. It
 * is dropped, and only it: the queue holds pending updates for unrelated
 * components, and clearing them left parts of the page showing stale state with
 * nothing logged about them.
 * @type {Set<Function>}
 */
const suppressedJobs = new Set();

/**
 * Ordered log of jobs executed during the current flush for deadlock cycle diagnosis.
 * @type {Array<{id: any, name: string, job: Function}>}
 */
const executionHistory = [];

/**
 * Registered deadlock event callbacks.
 * @type {Set<Function>}
 */
const deadlockHandlers = new Set();

/**
 * Configures the maximum allowed flush cycle count.
 * @param {number} count - Maximum flush iterations.
 */
export function setSchedulerMaxFlushCount(count) {
  if (typeof count === 'number' && count > 0) {
    maxFlushCount = count;
  }
}

/**
 * Returns the currently configured maximum flush cycle count.
 * @returns {number}
 */
export function getSchedulerMaxFlushCount() {
  return maxFlushCount;
}

/**
 * Registers a global callback for scheduler deadlock events.
 * @param {function({cyclePath: string, jobs: Function[], boundary: any}): void} handler
 * @returns {Function} Unsubscribe function.
 */
export function onSchedulerDeadlock(handler) {
  if (typeof handler === 'function') {
    deadlockHandlers.add(handler);
    return () => deadlockHandlers.delete(handler);
  }
  return () => {};
}

/**
 * Reports a synchronous watcher cycle (a watcher re-entered while it is still
 * updating). The cycle is attributed to the deadlock boundary enclosing the
 * watcher's owning component, and that boundary's `action`/`isolated` apply.
 * @param {{ name?: string, component?: any }} watcher - The watcher found in the cycle.
 * @param {string} cycleStr - Human-readable cycle path.
 */
export function reportWatcherCycle(watcher, cycleStr) {
  const boundary = getBoundaryForJob({ component: watcher?.component });
  if (!boundary) {
    // Outside any boundary the cycle is only logged, as it always was: no
    // handler notification and no discarding of pending scheduler work.
    logger.error(
      formatMessage(
        AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
        ' (synchronous watcher cycle)',
        `  ${cycleStr}\n\nSynchronous watcher cycle detected. Execution aborted to prevent stack overflow.`,
      ),
    );
    return;
  }
  handleDeadlock(watcher?.name || 'anonymous', [], boundary, cycleStr);
}

/**
 * Resets the scheduler state (primarily used in testing).
 */
export function resetScheduler() {
  queue.length = 0;
  queued.clear();
  flushCallbacks.length = 0;
  isPending = false;
  isFlushing = false;
  flushDepth = 0;
  jobExecutionCounts.clear();
  suppressedJobs.clear();
  executionHistory.length = 0;
}

/**
 * Queues a job (update callback) to be executed in the next microtask.
 * Deduplicates multiple calls to the same job.
 * @param {Function} job - The callback to run.
 */
export function queueJob(job) {
  if (!queued.has(job)) {
    if (tracer.on) {
      // Component updates are batched into a microtask, so by the time this job
      // runs the causal stack is empty and the resulting DOM patch would look
      // like an unexplained root. Stamping the job with whatever queued it lets
      // the flush below resume that scope. A job already in the queue keeps its
      // first cause: that is the mutation that actually scheduled the work.
      job.__avenxTraceCause = tracer.current();
    }
    queue.push(job);
    queued.add(job);
    queueFlush();
  }
}

/**
 * Queues a callback to run after the current flush cycle has finished.
 * @param {Function} cb - The callback to run.
 */
export function queueFlushCallback(cb) {
  if (!flushCallbacks.includes(cb)) {
    flushCallbacks.push(cb);
    queueFlush();
  }
}

/**
 * Schedules a flush cycle in a deferred microtask.
 */
function queueFlush() {
  if (!isPending && !isFlushing) {
    isPending = true;
    Promise.resolve().then(() => {
      Promise.resolve().then(flushJobs);
    });
  }
}

/**
 * Orders jobs by their `id` ascending so parent components (lower uid) update
 * before their children.
 * @param {Function} a
 * @param {Function} b
 * @returns {number}
 */
function byJobId(a, b) {
  return (a.id || 0) - (b.id || 0);
}

/**
 * Reconstructs the circular dependency chain from the execution history.
 * @param {any} recurringId - The job ID that repeated excessively.
 * @returns {string} Formatted cycle string (e.g. "Counter -> Stats -> Counter").
 */
function extractCycleChain(recurringId) {
  const ids = executionHistory.map((item) => String(item.name || item.id || 'anonymous'));
  const targetName = String(recurringId);
  const firstIdx = ids.indexOf(targetName);

  if (firstIdx !== -1) {
    const cycleSub = ids.slice(firstIdx);
    if (!cycleSub.endsWith || cycleSub[cycleSub.length - 1] !== targetName) {
      cycleSub.push(targetName);
    }
    return cycleSub.join(' -> ');
  }

  // Fallback: take last 4 execution steps
  const recent = ids.slice(-4);
  if (recent.length > 0) {
    return recent.join(' -> ');
  }
  return String(recurringId);
}

/**
 * Resolves the nearest enclosing deadlock boundary for a scheduled job.
 * @param {Function} job
 * @returns {Element|null}
 */
export function getBoundaryForJob(job) {
  if (!job) return null;

  if (job.boundary) {
    return job.boundary;
  }

  if (job.node) {
    let curr = job.node.nodeType === 1 ? job.node : job.node.parentElement || job.node.parentNode;
    while (curr) {
      if (curr.hasAttribute && curr.hasAttribute('data-ax-deadlock')) {
        return curr;
      }
      curr = curr.parentElement || curr.parentNode;
    }
  }

  const comp = job.component;
  if (comp) {
    const el = comp.$element || comp.element;
    if (el) {
      let curr = el;
      while (curr) {
        if (curr.hasAttribute && curr.hasAttribute('data-ax-deadlock')) {
          return curr;
        }
        curr = curr.parentElement || curr.parentNode;
      }
      if (typeof el.querySelector === 'function') {
        const inner = el.querySelector('[data-ax-deadlock]');
        if (inner) return inner;
      }
    }
  }

  return null;
}

/**
 * Extracts maxDepth attribute from a deadlock boundary element.
 * @param {Element|null} boundary
 * @returns {number|null}
 */
function getBoundaryMaxDepth(boundary) {
  if (!boundary) return null;
  const depthStr =
    boundary.getAttribute('data-ax-deadlock-depth') || boundary.getAttribute('data-ax-deadlock-maxdepth');
  if (depthStr) {
    const parsed = parseInt(depthStr, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Finds the boundary attributable to the current runaway flush recursion.
 * @returns {Element|null}
 */
function findRunawayBoundary() {
  const recurring = [];
  for (const [job, count] of jobExecutionCounts.entries()) {
    if (count > 1) {
      recurring.push(job);
    }
  }
  if (recurring.length > 0) {
    for (const job of recurring) {
      const b = getBoundaryForJob(job);
      if (b) return b;
    }
  }
  if (executionHistory.length > 0) {
    for (let i = executionHistory.length - 1; i >= 0; i--) {
      const b = getBoundaryForJob(executionHistory[i]?.job);
      if (b) return b;
    }
  }
  return null;
}

/**
 * Propagates a deadlock error to the nearest error boundary.
 * @param {Element} boundary
 * @param {Error} error
 */
function propagateToErrorBoundary(boundary, error) {
  const owner = findOwningComponent(boundary);
  if (owner && typeof owner.__handleError === 'function') {
    owner.__handleError(error);
    return;
  }
  logger.error('Unhandled deadlock error propagation:', error);
}

/**
 * Handles a detected reactive deadlock: logs diagnostics, notifies handlers, and
 * quarantines the jobs that were looping.
 * @param {any} [triggeringJobId] - The job ID that triggered the cycle.
 * @param {Function[]} [offendingJobs] - The jobs to quarantine for this flush.
 * @param {Element|null} [boundary] - The associated deadlock boundary container, if any.
 * @param {string|null} [watcherCycle] - Cycle path for a synchronous watcher cycle, if this is one.
 */
function handleDeadlock(triggeringJobId, offendingJobs = [], boundary = null, watcherCycle = null) {
  if (!boundary && offendingJobs.length > 0) {
    for (const job of offendingJobs) {
      const b = getBoundaryForJob(job);
      if (b) {
        boundary = b;
        break;
      }
    }
  }

  let boundaryName = '';
  let action = 'abort';
  let isIsolated = false;

  if (boundary) {
    boundaryName = boundary.getAttribute('data-ax-deadlock-name') || 'anonymous';
    action = (boundary.getAttribute('data-ax-deadlock-action') || 'abort').toLowerCase();
    isIsolated = (boundary.getAttribute('data-ax-deadlock-isolated') || '').toLowerCase() === 'true';
  }

  const cycleStr = watcherCycle ?? extractCycleChain(triggeringJobId || 'reactive-loop');
  const boundaryInfo = boundaryName ? ` in boundary <${boundaryName}>` : '';

  let diagnosticMsg;
  if (watcherCycle) {
    diagnosticMsg = formatMessage(
      AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
      ` (synchronous watcher cycle)${boundaryInfo}`,
      `  ${cycleStr}\n\nSynchronous watcher cycle detected. Execution aborted to prevent stack overflow.`,
    );
  } else {
    diagnosticMsg = formatMessage(
      AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
      boundaryInfo,
      `  ${cycleStr}\n\nExecution aborted to prevent browser freeze.`,
    );
  }

  logger.error(diagnosticMsg);

  // Notify any registered deadlock handlers
  const eventPayload = {
    cyclePath: cycleStr,
    triggeringJobId,
    executionHistory: [...executionHistory],
    boundary,
    boundaryName: boundaryName || null,
    action,
    isolated: isIsolated,
  };

  for (const handler of deadlockHandlers) {
    try {
      handler(eventPayload);
    } catch (e) {
      logger.error('Error executing deadlock handler:', e);
    }
  }

  // Quarantine only what is looping.
  for (const job of offendingJobs) {
    if (typeof job !== 'function') continue;
    suppressedJobs.add(job);
    if (queued.has(job)) {
      queued.delete(job);
      const at = queue.indexOf(job);
      if (at !== -1) {
        queue.splice(at, 1);
      }
    }
  }

  // Also quarantine any jobs in the queue belonging to this boundary
  if (boundary) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const qJob = queue[i];
      if (getBoundaryForJob(qJob) === boundary) {
        suppressedJobs.add(qJob);
        queued.delete(qJob);
        queue.splice(i, 1);
      }
    }
  }

  // Handle action
  if (boundary && action === 'fallback') {
    const errorObj = {
      message: `Deadlock detected${boundaryInfo}: ${cycleStr}`,
      code: AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
      cyclePath: cycleStr,
    };
    tripBoundary(boundary, errorObj);
  } else if (boundary && action === 'throw') {
    const deadlockError = new AvenxError(
      AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
      boundaryInfo,
      `  ${cycleStr}\n\nExecution aborted to prevent browser freeze.`,
    );
    propagateToErrorBoundary(boundary, deadlockError);
  }

  // Handle isolated attribute
  if (!isIsolated && boundary) {
    // Non-isolated cycle aborts all scheduler work in the current queue
    queue.length = 0;
    queued.clear();
  }
}

/**
 * Flushes all queued jobs in a loop until the queue is completely empty.
 * Jobs are strictly ordered by their `id` property ascending (e.g. component uid)
 * to ensure parent components update before their child components.
 * After jobs are flushed, all queued flush callbacks (e.g. nextTick) are executed.
 */
function flushJobs() {
  isPending = false;
  isFlushing = true;

  if (flushDepth === 0) {
    jobExecutionCounts.clear();
    executionHistory.length = 0;
  }

  flushDepth++;

  try {
    // Guard 1: Overall flush recursion ceiling. Only re-entry is counted here —
    // draining many jobs in a single pass is normal for an application with
    // many components reacting to the same tick and must never be aborted.
    const activeBoundary = findRunawayBoundary();
    const boundaryBudget = getBoundaryMaxDepth(activeBoundary);
    const effectiveCeiling = boundaryBudget !== null ? boundaryBudget : maxFlushCount;

    if (flushDepth > effectiveCeiling) {
      // Mutual recursion across several jobs. Quarantine the ones that took
      // part, not the whole queue.
      handleDeadlock(
        'MAX_FLUSH_COUNT_EXCEEDED',
        executionHistory.map((entry) => entry.job),
        activeBoundary,
      );
      return;
    }

    // 1. Flush jobs first.
    // Sort jobs by their id ascending (e.g. parent uid < child uid).
    queue.sort(byJobId);

    while (queue.length > 0) {
      const job = queue.shift();
      queued.delete(job);
      if (suppressedJobs.has(job)) {
        // Quarantined earlier in this flush; it re-queued itself again.
        continue;
      }
      const jobId = job.id !== undefined ? job.id : job;
      const jobName =
        job.name || (typeof jobId === 'string' || typeof jobId === 'number' ? `Job#${jobId}` : 'anonymous');

      // Frequency is counted per job *function*, not per `job.id`.
      //
      // `id` orders a flush so a parent component updates before its children,
      // and every binding job in one component shares that component's id. If
      // the counter were keyed by id, a component with more than ten bound
      // values would trip the cycle guard on its very first render -- ten
      // unrelated bindings doing their one job each would look identical to one
      // job running ten times. Identity is what the guard actually means.
      const currentCount = (jobExecutionCounts.get(job) || 0) + 1;
      jobExecutionCounts.set(job, currentCount);
      executionHistory.push({ id: jobId, name: jobName, job });

      // Guard 2: Single job frequency limit. A job re-entering the queue many
      // times within one flush session is the real signature of a circular
      // update chain (e.g. component A updates B which updates A again).
      const boundary = getBoundaryForJob(job);
      const boundaryLimit = getBoundaryMaxDepth(boundary);
      const perJobLimit = boundaryLimit !== null ? boundaryLimit : Math.min(10, maxFlushCount);
      if (currentCount > perJobLimit) {
        // Stop this job, then carry on draining the rest of the queue: the
        // other jobs in it belong to unrelated components.
        handleDeadlock(jobName, [job], boundary);
        continue;
      }

      const pendingBefore = queue.length;

      // Jobs are stable per-component function objects, so the stamp is read
      // and cleared rather than left behind, where it would mis-attribute a
      // later run to a cause that has nothing to do with it.
      let causeToken = -1;
      if (tracer.on && job.__avenxTraceCause !== undefined) {
        causeToken = tracer.continueFrom(job.__avenxTraceCause);
        job.__avenxTraceCause = undefined;
      }

      try {
        job();
      } catch (error) {
        logger.error('Error executing scheduled job:', error);
      } finally {
        if (causeToken >= 0) {
          tracer.leave(causeToken);
        }
      }

      // Jobs queued while this one ran must be ordered into the remaining drain
      // so parents still update before their children.
      if (queue.length > pendingBefore) {
        queue.sort(byJobId);
      }
    }

    // 2. Flush callbacks
    const callbacks = flushCallbacks.slice();
    flushCallbacks.length = 0;
    for (const cb of callbacks) {
      try {
        cb();
      } catch (error) {
        logger.error('Error executing flush callback:', error);
      }
    }

    // 3. Re-flush if executing callbacks or jobs queued more jobs or callbacks.
    // The recursion ceiling above stops a runaway chain on re-entry.
    if (queue.length > 0 || flushCallbacks.length > 0) {
      flushJobs();
    }
  } finally {
    flushDepth--;

    if (flushDepth === 0) {
      isFlushing = false;
      jobExecutionCounts.clear();
      suppressedJobs.clear();
      executionHistory.length = 0;

      // Work left over after an aborted chain still deserves a fresh flush
      // rather than sitting in the queue until the next unrelated mutation.
      if (queue.length > 0 || flushCallbacks.length > 0) {
        queueFlush();
      }
    }
  }
}

/**
 * Executes a callback (or resolves a Promise) after all currently queued
 * jobs in the scheduler queue have finished flushing.
 * @param {Function} [callback] - Optional callback to invoke after the flush.
 * @returns {Promise<void>|void} A promise resolving after the flush, if no callback was given.
 */
export function nextTick(callback) {
  if (callback) {
    queueFlushCallback(callback);
    return;
  }

  return new Promise((resolve) => {
    queueFlushCallback(resolve);
  });
}
