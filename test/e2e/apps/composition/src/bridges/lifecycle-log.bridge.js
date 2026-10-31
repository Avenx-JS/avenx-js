import { bridge } from 'avenx-core/runtime';

/** Keeps hook history visible after the page that recorded it is detached. */
export default bridge({
  state: {
    cachedEvents: [],
    uncachedEvents: [],
  },

  recordCached(hook) {
    this.cachedEvents = this.cachedEvents.concat(hook);
  },

  recordUncached(hook) {
    this.uncachedEvents = this.uncachedEvents.concat(hook);
  },
});
