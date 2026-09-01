<h1 data-testid="heading">Defer</h1>

<section data-testid="interaction-section">
  <@defer when="interaction">
    <@placeholder>
      <button data-testid="interaction-placeholder">Load the panel</button>
    </@placeholder>
    <div data-testid="interaction-content">Loaded on interaction</div>
  </@defer>
</section>

<section data-testid="idle-section">
  <@defer when="idle">
    <@placeholder>
      <p data-testid="idle-placeholder">Waiting for idle time</p>
    </@placeholder>
    <p data-testid="idle-content">Loaded when the browser went idle</p>
  </@defer>
</section>
