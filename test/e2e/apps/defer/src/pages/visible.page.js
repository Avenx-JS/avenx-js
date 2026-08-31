<h1 data-testid="heading">Visible</h1>

<div data-testid="spacer" style="height: 250vh">Scroll down</div>

<@defer when="visible">
  <@placeholder>
    <p data-testid="visible-placeholder">Not in the viewport yet</p>
  </@placeholder>
  <p data-testid="visible-content">Loaded once it scrolled into view</p>
</@defer>
