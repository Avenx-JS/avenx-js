<!--
  Writes its computed expression the way the documentation does: bare
  identifiers, with no `state.` prefix. This used to render correctly once and
  never recompute; specs/reactivity/state-drives-dom.spec.js pins that it now
  stays in step with the state it reads.
-->
<state count="0" />

<computed name="doubled" value="count * 2" />

<main>
  <p data-testid="count">{{ count }}</p>
  <p data-testid="doubled">{{ doubled }}</p>
  <button data-testid="increment" @click="count++">Increment</button>
</main>
