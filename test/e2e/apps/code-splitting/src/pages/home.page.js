<!--
  A split page with template expressions. The interpolation, the computed
  value and the action all compile to closures that call the runtime's
  expression helpers (axGet, axRead, ...). In a split build those helpers are
  not imported by the chunk: the chunk has to find them at load time, which is
  what specs/build/code-splitting.spec.js verifies in a real browser.
-->
<state title="Split home" count="0" />

<computed name="doubled" value="count * 2" />

<action name="increment"> count = count + 1; </action>

<main>
  <h1 data-testid="title">{{ title }}</h1>
  <p data-testid="count">{{ count }}</p>
  <p data-testid="doubled">{{ doubled }}</p>
  <button data-testid="increment" @click="increment()">Increment</button>
  <a data-testid="nav-about" href="#/about">About</a>
</main>
