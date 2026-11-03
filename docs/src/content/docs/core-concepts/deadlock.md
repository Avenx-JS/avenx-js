---
title: '<@deadlock> Reactive Boundary'
description: 'Understand reactive deadlock diagnostics, active boundary controls (maxDepth, action, isolated), and automatic or manual fallback recovery in Avenx-JS applications.'
---

## Overview

Avenx-JS provides reactive deadlock detection and recovery facilities:

1. The reactive scheduler and watcher guards detect runaway update chains, log `AVX_R18`, and stop the affected work.
2. The `<@deadlock>` compiler directive creates a named DOM boundary with active runtime controls (`maxDepth`, `action`, `isolated`) and optional fallback UI rendering. When `action="fallback"` is specified, the boundary automatically trips upon detection without manual intervention.
3. Boundary fallback UI can also be triggered manually by calling `$tripDeadlockBoundary()` on the component instance.

---

## Define a Boundary

Configure active boundary behavior using `maxDepth`, `action`, and `isolated`:

```html
<@deadlock name="metrics-panel" maxDepth="50" action="fallback" isolated="true">
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

The compiler converts this into a `data-ax-deadlock` container, emits active attribute markers (`data-ax-deadlock-depth`, `data-ax-deadlock-action`, `data-ax-deadlock-isolated`), and stores the fallback in a `<template>` element.

---

## Active Boundary Attributes

| Attribute  | Behavior                                                                                                                                                                                                                                                                                                                                                                  |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`     | Identifies the boundary. Exposed as `name` in fallback template interpolation and used by `$tripDeadlockBoundary(name, error)`. Defaults to `"anonymous"`.                                                                                                                                                                                                                |
| `maxDepth` | A per-boundary flush-depth budget consulted by the scheduler when runaway work is attributable to a component inside this boundary, overriding the global `maxFlushCount` for that region. Compiled to `data-ax-deadlock-depth`. Emits compiler warning `AVX_W35` if not a positive integer.                                                                              |
| `action`   | What happens on detection: `abort` (default: stop the flush and log `AVX_R18`), `fallback` (automatically trip this boundary, rendering its `<@fallback>`), or `throw` (propagate the deadlock error to the nearest error boundary). Compiled to `data-ax-deadlock-action`. Emits compiler warning `AVX_W35` if invalid.                                                  |
| `isolated` | When set to `"true"`, a cycle detected inside this boundary is contained: jobs belonging to components inside the boundary are suppressed, but scheduler work belonging to components outside the boundary is not aborted. When `"false"`, detection halts the pending flush queue. Compiled to `data-ax-deadlock-isolated`. Emits compiler warning `AVX_W35` if invalid. |

---

## Automatic Recovery with `action="fallback"`

When `action="fallback"` is configured, you do not need to call `$tripDeadlockBoundary()`. On scheduler deadlock detection:

1. `AVX_R18` is logged to describe the causal cycle.
2. The scheduler attributes the cycle to the nearest enclosing `<@deadlock>` boundary.
3. The boundary automatically trips: child component instances inside the boundary are unmounted and the `<@fallback>` template content is rendered into the boundary container.
4. Offending jobs within the boundary are quarantined. When `isolated="true"` is set, updates for components outside the boundary continue without interruption.

---

## Trip a Boundary Manually

From code running on the component that owns the boundary, you can also trigger recovery manually:

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

`onSchedulerDeadlock()` is a global subscription that receives deadlock event details (`cyclePath`, `triggeringJobId`, `executionHistory`, `boundary`, `boundaryName`, `action`, `isolated`). If a component needs custom recovery or diagnostics outside the built-in `action` options:

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
