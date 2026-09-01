<!--
  Exists to pin a known framework gap, not to demonstrate good practice.

  This page writes its computed expression the way README.md and
  docs/core-concepts/components.md document it: bare identifiers, with no
  `state.` prefix. The initial render is correct, but the value never
  recomputes, because the bare form registers no reactive dependency.

  specs/reactivity/state-drives-dom.spec.js drives this page under test.fail(),
  so the day the compiler starts tracking bare identifiers the suite says so
  instead of quietly carrying a stale expectation.
-->
<state count="0" />

<computed name="doubled" value="count * 2" />

<main>
  <p data-testid="count">{{ count }}</p>
  <p data-testid="doubled">{{ doubled }}</p>
  <button data-testid="increment" @click="count++">Increment</button>
</main>
