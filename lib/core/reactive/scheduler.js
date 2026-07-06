const queue = new Set();
let isPending = false;
let isFlushing = false;

import { logger } from '../runtime/AvenxLogger.js';

/**
 * Queues a job (update callback) to be executed in the next microtask.
 * Deduplicates multiple calls to the same job.
 * @param {Function} job - The callback to run.
 */
export function queueJob(job) {
  if (!queue.has(job)) {
    queue.add(job);
    if (!isPending && !isFlushing) {
      isPending = true;
      Promise.resolve().then(flushJobs);
    }
  }
}

/**
 * Flushes all queued jobs in a loop until the queue is completely empty.
 */
function flushJobs() {
  isPending = false;
  isFlushing = true;
  try {
    while (queue.size > 0) {
      const jobs = Array.from(queue);
      queue.clear();
      for (const job of jobs) {
        try {
          job();
        } catch (error) {
          logger.error('Error executing scheduled job:', error);
        }
      }
    }
  } finally {
    isFlushing = false;
  }
}
