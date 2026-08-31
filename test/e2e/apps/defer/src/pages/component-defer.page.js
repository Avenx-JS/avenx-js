<!--
  Exists to pin a bug, not to demonstrate good practice.

  Deferring a heavy component is the headline use of <@defer> -- it is the
  example the feature documentation opens with. The trigger fires and the
  compiled component marker is inserted into the DOM, but nothing mounts it:
  the <div data-avenx-comp="HeavyPanel"> stays empty forever, so the deferred
  component never appears.

  Driven under test.fail() from specs/performance/defer.spec.js.
-->
<h1 data-testid="heading">Component defer</h1>

<@defer when="interaction">
  <@placeholder>
    <button data-testid="component-placeholder">Load the panel</button>
  </@placeholder>
  <HeavyPanel label="loaded on interaction" />
</@defer>
