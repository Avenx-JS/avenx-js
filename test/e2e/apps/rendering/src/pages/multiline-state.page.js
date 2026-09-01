<!--
  Exists to pin a compiler bug, not to demonstrate good practice.

  ComponentParser strips the state declaration from the template with
  /<state.*? \/>/g. `.` does not match a newline, so a <state> tag written
  across several lines -- which is the natural way to write one with more than
  a couple of keys -- is never removed. The values still parse correctly, but
  the tag leaks into the compiled template as a stray element and reactivity
  stops working for the whole component: the initial render is right and
  nothing ever updates again.

  Every other fixture keeps <state> on one line. This page keeps the broken
  form under test.fail() so the bug stays visible.
-->
<state
  count="0"
/>

<action name="increment"> state.count = state.count + 1; </action>

<main>
  <p data-testid="count">{{ count }}</p>
  <button data-testid="increment" @click="increment()">Increment</button>
</main>
