<resource name="delayedItem">
  return fetch('/api/delay?ms=150&val=AsyncSuccess').then(res => res.json());
</resource>

<div data-testid="suspense-card">
  <@suspense>
    <@fallback>
      <div data-testid="suspense-fallback">Loading suspense data...</div>
    </@fallback>
    <div data-testid="suspense-resolved">{{ delayedItem.data }}</div>
  </@suspense>
</div>

