---
title: '<@deadlock> Reactive Boundary'
description: 'Understand reactive deadlock diagnostics and manually render fallback boundaries in Avenx-JS applications.'
---

## Overview

Avenx-JS currently provides two related deadlock facilities:

1. The global reactive scheduler and watcher guards detect runaway update chains, log `AVX_R18`, and stop the affected work.
2. The `<@deadlock>` compiler directive creates a named DOM boundary whose fallback can be rendered by calling `$tripDeadlockBoundary()` on the component instance.

> [!IMPORTANT]
> Detection and boundary recovery are not connected automatically. A scheduler deadlock does not search for or trip the nearest `<@deadlock>` boundary. Call `$tripDeadlockBoundary()` directly, or explicitly connect an `onSchedulerDeadlock()` listener to the boundary you want to recover.

---

## Define a Boundary

Include a fallback when you want a manual trip to replace the active content:

```html
<@deadlock name="metrics-panel">
  <ChartWidget />
  <DataSummary />

  <@fallback as="err">
    <div class="deadlock-recovery">
      <h3>⚠️ Reactive Cycle Intercepted</h3>
      <p>Boundary: <strong>{{ name }}</strong></p>
      <p>Diagnostic: {{ err.message }}</p>
    </div>
  </@fallback>
</@deadlock>
```

The compiler converts this into a `data-ax-deadlock` container and stores the fallback in a template. The `name` becomes `data-ax-deadlock-name` and is used when a component selects a boundary.

---

## Trip a Boundary Manually

From code running on the component that owns the boundary, call:

```javascript
this.$tripDeadlockBoundary('metrics-panel', {
  message: 'A reactive cycle was detected in the metrics panel.',
});
```

When the named boundary has a `<@fallback>` template, the current non-template child content is removed, direct child component instances are unmounted when available, and the rendered fallback is inserted. Nested component instances are not recursively discovered, and the inserted fallback HTML is not mounted as a new reactive component subtree. Fallback interpolation is limited to `name`, the configured error alias's `.message`, `error.message`, and exact top-level scope keys.

Without a fallback template, a trip only marks the boundary internally and makes no visible DOM change. A repeated trip is ignored until the boundary is reset.

Calling `$tripDeadlockBoundary()` without a name selects the first boundary in the component's DOM tree:

```javascript
this.$tripDeadlockBoundary(null, new Error('Reactive work was stopped.'));
```

`$resetDeadlockBoundary(name)` only clears the internal tripped marker. It does **not** remove the fallback or reconstruct content that was removed, and normal DOM patching skips a boundary while its `.ax-deadlock-fallback` remains present. Applications that need to retry must rerender or remount that content from outside the tripped boundary.

---

## Connect Scheduler Detection Explicitly

`onSchedulerDeadlock()` is a global subscription. If a component should show a boundary fallback when the scheduler detects a cycle, retain the actual mounted component instance and clean up the listener when that owner is torn down:

```javascript
import { onSchedulerDeadlock } from 'avenx-core/runtime';
import MetricsPanel from './components/metrics-panel.component.js';

const metricsPanel = new MetricsPanel();
metricsPanel.mount('#metrics-panel-root');

const stopDeadlockListener = onSchedulerDeadlock((event) => {
  metricsPanel.$tripDeadlockBoundary('metrics-panel', {
    message: `Reactive cycle detected: ${event.cyclePath}`,
    cyclePath: event.cyclePath,
  });
});

// Call this from the code that owns the mounted instance.
function unmountMetricsPanel() {
  stopDeadlockListener();
  metricsPanel.unmount();
}
```

The listener is global, so choose the retained target component and boundary deliberately. It receives scheduler deadlock events; synchronous watcher-cycle guards currently log `AVX_R18` but do not call scheduler deadlock listeners.

---

## Current Attribute Behavior

| Attribute | Current behavior |
| :--- | :--- |
| `name` | Used by `$tripDeadlockBoundary(name, error)` and exposed to fallback interpolation. It defaults to `"anonymous"`. |
| `maxDepth` | Compiled to `data-ax-deadlock-depth`, but not read by the scheduler or `DeadlockManager`. Use `setSchedulerMaxFlushCount()` for the current global scheduler threshold. |
| `action` | Compiled to `data-ax-deadlock-action`, but not read at runtime. A manual trip renders the fallback when one exists. |
| `isolated` | Compiled to `data-ax-deadlock-isolated`, but not enforced by `DeadlockManager`. It is not the same as the separately validated `isolated` compiler contract. |

These metadata attributes are preserved for compatibility, but they should not be treated as active per-boundary controls. Their values are emitted without runtime validation.

---

## Detection and Diagnostics

The scheduler protects asynchronous update flushing in two ways:

- A recursive flush that exceeds the global `maxFlushCount` is aborted.
- A job that runs more than `min(10, maxFlushCount)` times in one flush session is treated as a cycle.

On detection, the scheduler logs `AVX_R18`, calls registered `onSchedulerDeadlock()` handlers, and clears the entire global pending job queue, including jobs unrelated to the detected chain. Pending flush callbacks are not cleared. The reported `cyclePath` is a best-effort summary of execution history, not a guaranteed component dependency graph. Separate synchronous watcher guards use a fixed depth ceiling of 50 plus active-watcher re-entry checks; they log `AVX_R18` and skip the recursive update that triggered the cycle.

Example Diagnostic Output:

```text
[Avenx Error] [AVX_R18] Circular reactive update chain detected:
  Counter -> Stats -> Counter
Execution aborted to prevent browser freeze.
```

For the full diagnostic reference — the verbatim message template, how to read the causation chain, and every recovery path — see [`AVX_R18` in the troubleshooting guide](/troubleshooting/errors/#avx_r18--reactive_deadlock_detected). A `<@deadlock>` tag that fails to compile emits [`AVX_W35`](/troubleshooting/errors/#avx_w35--compiler_deadlock_parse_failed) and is skipped entirely.

The public scheduler utilities are exported from `avenx-core/runtime`:

```javascript
import {
  setSchedulerMaxFlushCount,
  getSchedulerMaxFlushCount,
  onSchedulerDeadlock,
  resetScheduler,
} from 'avenx-core/runtime';

// Configure the global scheduler threshold, not a boundary-specific limit.
setSchedulerMaxFlushCount(20);

// Subscribe to scheduler detection events for diagnostics or explicit recovery.
const unsubscribe = onSchedulerDeadlock((event) => {
  console.warn('Scheduler deadlock detected:', event.cyclePath);
});

console.log(getSchedulerMaxFlushCount());

// Unsubscribe when the listener is no longer needed.
unsubscribe();
```

`resetScheduler()` clears scheduler queues and counters and is intended primarily for deterministic tests. It does not restore the configured maximum or remove registered deadlock listeners.

---

## Testing a Boundary

Boundary fallback tests should trip the boundary directly. This keeps the UI behavior deterministic and separate from scheduler-cycle setup:

```javascript
component.$tripDeadlockBoundary('metrics-panel', {
  message: 'Test deadlock',
});

expect(container.querySelector('.deadlock-recovery')).not.toBeNull();
```

Use dedicated scheduler tests when you need to verify cycle detection, `AVX_R18`, or `onSchedulerDeadlock()` payloads.
