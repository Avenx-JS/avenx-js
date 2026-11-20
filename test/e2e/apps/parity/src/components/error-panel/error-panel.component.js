<!--
  <@errorBoundary> catching a rejected <resource>.

  It has a component to itself, and the page wraps it in its data-construct
  section. A boundary that catches currently replaces the whole component's
  template, its siblings and root included, rather than only its own subtree.
  That happens identically in both builds, so it is not a parity defect, but
  any sibling here would disappear and hide what this fixture checks.
-->
<resource name="broken">
  return fetch('/api/delay?ms=50&val=unused').then(() => { throw new Error('parity failure'); });
</resource>

<div data-testid="error-panel">
  <@errorBoundary>
    <@fallback as="err"><p data-testid="caught">caught {{ err.message }}</p></@fallback>
    <p data-testid="unreached">{{ broken.data }}</p>
  </@errorBoundary>
</div>
