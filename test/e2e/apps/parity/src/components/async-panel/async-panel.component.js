<!--
  <resource>, <@suspense> and <@deadlock> inside a component, which is the
  arrangement the documentation shows. <@errorBoundary> is in <ErrorPanel>;
  see the note there for why it is not here.
-->
<state label="'boundary'" />

<resource name="quote">
  return fetch('/api/delay?ms=150&val=parity-quote').then(res => res.json());
</resource>

<div data-testid="async-panel">
  <!-- In a template the resource's name resolves to its value, so the status
       is read through $resources. (resources.md writes `name.status`, which
       renders nothing in either build.) -->
  <section data-construct="resource">
    <p data-testid="status">{{ $resources.quote.status }}</p>
  </section>

  <section data-construct="suspense">
    <@suspense>
      <@fallback><p data-testid="pending">pending</p></@fallback>
      <p data-testid="resolved">{{ quote.data }}</p>
    </@suspense>
  </section>

  <section data-construct="deadlock">
    <@deadlock name="parity-boundary">
      <p data-testid="inside">inside {{ label }}</p>
      <@fallback as="err"><p data-testid="tripped">tripped {{ err.message }}</p></@fallback>
    </@deadlock>
  </section>
</div>
