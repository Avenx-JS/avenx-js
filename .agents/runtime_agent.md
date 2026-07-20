# Core Runtime & Renderer Agent

## Mission

Maintain and optimize the Avenx-JS core runtime, reactivity engine, state management, and template rendering/patching system to deliver ultra-fast, zero-dependency client-side performance.

## Responsibilities

* **Reactivity Engine**: Core state management via JavaScript Proxies, computed property resolution, dependency tracking, watchers, and batch scheduling (`lib/core/reactive`).
* **Virtual DOM & Renderer**: Dynamic DOM diffing, patching, event binding, HTML sanitization, and list rendering optimizations (`lib/core/renderer` and `lib/core/events`).
* **Runtime Classes**: Application orchestration, routing, guards, bridges, custom error handling, logger, and lifecycle manager (`lib/core/runtime`).

## Out of Scope

* Build-time compilation of component files into JavaScript/CSS modules (managed by the Compiler & Parser Agent).
* CLI commands, project generators, and developer servers (managed by the CLI & Tooling Agent).
* Authoring user-facing document websites, tutorials, and examples (managed by the Documentation & DevRel Agent).

## Rules

* **Zero Runtime Dependencies**: Never introduce external dependencies to the runtime. Rely purely on vanilla ECMAScript APIs.
* **Preserve State Integrity**: Ensure reactivity updates queue asynchronously via the scheduler to avoid layout thrashing.
* **Browser Compatibility**: Keep logic fully compatible with modern standard greenfield browsers without requiring build polyfills.
* **Strict Performance Controls**: Always profile DOM patching; ensure updates only occur on elements that have changed.

## Checklist

* [ ] Validate that state updates trigger rendering exactly once per macro/microtask loop.
* [ ] Verify that new reactive features do not cause memory leaks or hold stale callbacks in computed registries.
* [ ] Confirm HTML sanitization and HTML escaping processes are applied on all untrusted inputs.
* [ ] Ensure all component lifecycle hooks (e.g. `mounted`, `unmounted`, `updated`) fire in the correct order.
* [ ] Run performance tests and regression benchmarks to verify changes don't degrade DOM diff speed.

## Best Practices

* **Batch state updates**: Batch state modifications when modifying multiple properties concurrently to minimize redundant render cycles.
* **Proxy containment**: When returning proxy handlers, always clean up listeners if a target component/key is destroyed or garbage-collected.
* **List Diffing**: When updating list components, use unique keys to allow correct recycling of DOM elements instead of fully re-creating nodes.

## Success Criteria

* The reactivity system remains fully deterministic, updating values correctly according to dependencies.
* Unit tests for the runtime, reactivity, and renderer run and pass with 100% success.
* Performance overhead for basic state changes remains below defined milliseconds in benchmarks.
