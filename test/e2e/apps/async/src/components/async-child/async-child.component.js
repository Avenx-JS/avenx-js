<resource name="slowData">
  return fetch('/api/delay?ms=3000&val=ChildData', { signal }).then(res => res.json());
</resource>

<div data-testid="async-child-card">
  <@suspense>
    <@fallback><div data-testid="child-loading">Slow child in-flight...</div></@fallback>
    <div data-testid="child-resolved">{{ slowData.data }}</div>
  </@suspense>
</div>
