<h1>Combined defer triggers</h1>
<div style="height: 200vh"></div>
<section>
  <@defer when="visible; interaction">
    <@placeholder><button data-testid="multi-placeholder">Load the panel</button></@placeholder>
    <p data-testid="multi-content">Loaded by the first trigger</p>
  </@defer>
</section>
