const queue = [];
const flushCallbacks = [];
let isPending = false;
let isFlushing = false;

import { logger } from '../runtime/AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { tracer } from '../trace/tracer.js';

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
 * Resets the scheduler state (primarily used in testing).
 */
export function resetScheduler() {
  queue.length = 0;
  flushCallbacks.length = 0;
  isPending = false;
  isFlushing = false;
  flushDepth = 0;
  jobExecutionCounts.clear();
  executionHistory.length = 0;
}

/**
 * Queues a job (update callback) to be executed in the next microtask.
 * Deduplicates multiple calls to the same job.
 * @param {Function} job - The callback to run.
 */
export function queueJob(job) {
  if (!queue.includes(job)) {
    if (tracer.on) {
      // Component updates are batched into a microtask, so by the time this job
      // runs the causal stack is empty and the resulting DOM patch would look
      // like an unexplained root. Stamping the job with whatever queued it lets
      // the flush below resume that scope. A job already in the queue keeps its
      // first cause: that is the mutation that actually scheduled the work.
      job.__avenxTraceCause = tracer.current();
    }
    queue.push(job);
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
 * Handles a detected reactive deadlock: logs diagnostics, notifies handlers, and purges the queue.
 * @param {any} [triggeringJobId] - The job ID that triggered the cycle.
 */
function handleDeadlock(triggeringJobId) {
  const cycleStr = extractCycleChain(triggeringJobId || 'reactive-loop');
  const boundaryInfo = '';

  const diagnosticMsg = formatMessage(
    AvenxErrorCodes.REACTIVE_DEADLOCK_DETECTED,
    boundaryInfo,
    `  ${cycleStr}\n\nExecution aborted to prevent browser freeze.`
  );

  logger.error(diagnosticMsg);

  // Notify any registered deadlock handlers
  const eventPayload = {
    cyclePath: cycleStr,
    triggeringJobId,
    executionHistory: [...executionHistory],
  };

  for (const handler of deadlockHandlers) {
    try {
      handler(eventPayload);
    } catch (e) {
      logger.error('Error executing deadlock handler:', e);
    }
  }

  // Clear queued jobs to prevent runaway loop
  queue.length = 0;
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
    if (flushDepth > maxFlushCount) {
      handleDeadlock('MAX_FLUSH_COUNT_EXCEEDED');
      return;
    }

    // 1. Flush jobs first.
    // Sort jobs by their id ascending (e.g. parent uid < child uid).
    queue.sort(byJobId);

    while (queue.length > 0) {
      const job = queue.shift();
      const jobId = job.id !== undefined ? job.id : job;
      const jobName = job.name || (typeof jobId === 'string' || typeof jobId === 'number' ? `Job#${jobId}` : 'anonymous');

      // Track execution frequency per job
      const currentCount = (jobExecutionCounts.get(jobId) || 0) + 1;
      jobExecutionCounts.set(jobId, currentCount);
      executionHistory.push({ id: jobId, name: jobName, job });

      // Guard 2: Single job frequency limit. A job re-entering the queue many
      // times within one flush session is the real signature of a circular
      // update chain (e.g. component A updates B which updates A again).
      const perJobLimit = Math.min(10, maxFlushCount);
      if (currentCount > perJobLimit) {
        handleDeadlock(jobName);
        break;
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
