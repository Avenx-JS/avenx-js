/**
 * Lifecycle actions invoked by the runtime rather than by application code.
 * Shared with compiler reachability analysis so supported hooks do not warn.
 * @type {string[]}
 */
export const LIFECYCLE_HOOK_KEYS = [
  'onBeforeMount',
  'onMount',
  'onBeforeUpdate',
  'onUpdate',
  'onUnmount',
  'onActivate',
  'onDeactivate',
  'onErrorCaptured',
  'onEnter',
  'onBeforeLeave',
  'onLeave',
];
