<!--
  Exists to pin a bug, not to demonstrate good practice.

  A <@defer> block only survives while its host component never re-renders.
  Any unrelated state change patches the host, and the deferred container is
  discarded along with its placeholder and its content templates -- so the
  block can never load afterwards, and an already-loaded one disappears.

  That makes <@defer> effectively unusable in any component that holds state,
  which is most of them. The other defer fixtures avoid reactive state entirely
  for this reason.

  Driven under test.fail() from specs/performance/defer.spec.js.
-->
<state ticks="0" />

<action name="tick"> state.ticks = state.ticks + 1; </action>

<main>
  <p data-testid="ticks">{{ ticks }}</p>
  <button data-testid="tick" @click="tick()">Tick</button>

  <@defer when="interaction">
    <@placeholder>
      <button data-testid="stateful-placeholder">Load</button>
    </@placeholder>
    <div data-testid="stateful-content">Loaded</div>
  </@defer>
</main>
