const queue = [];
const flushCallbacks = [];
let isPending = false;
let isFlushing = false;
import { logger } from '../runtime/AvenxLogger.js';

/**
 * Queues a job (update callback) to be executed in the next microtask.
 * Deduplicates multiple calls to the same job.
 * @param {Function} job - The callback to run.
 */
export function queueJob(job) {
  if (!queue.includes(job)) {
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
 * Flushes all queued jobs in a loop until the queue is completely empty.
 * Jobs are strictly ordered by their `id` property ascending (e.g. component uid)
 * to ensure parent components update before their child components.
 * After jobs are flushed, all queued flush callbacks (e.g. nextTick) are executed.
 */
function flushJobs() {
  isPending = false;
  isFlushing = true;
  try {
    // 1. Flush jobs first
    while (queue.length > 0) {
      // Sort jobs by their id ascending (e.g. parent uid < child uid)
      queue.sort((a, b) => (a.id || 0) - (b.id || 0));
      const job = queue.shift();
      try {
        job();
      } catch (error) {
        logger.error('Error executing scheduled job:', error);
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

    // 3. Re-flush if executing callbacks or jobs queued more jobs or callbacks
    if (queue.length > 0 || flushCallbacks.length > 0) {
      flushJobs();
    }
  } finally {
    isFlushing = false;
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
