<resource name="ticker" pollInterval="150">
  return fetch('/api/poll').then(res => res.json());
</resource>

<div data-testid="poll-card">
  <@suspense>
    <@fallback><span data-testid="poll-loading">Polling...</span></@fallback>
    <span data-testid="poll-count">{{ ticker.count }}</span>
  </@suspense>
</div>
