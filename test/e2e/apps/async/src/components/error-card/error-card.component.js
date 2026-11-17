<resource name="flakyData">
  return fetch('/api/flaky').then(res => {
    if (!res.ok) throw new Error('HTTP ' + res.status + ': Failed to load');
    return res.json();
  });
</resource>

<action name="retry">
  this.$resources.flakyData.refetch();
</action>

<div data-testid="error-card">
  <@errorBoundary>
    <@fallback as="err">
      <div data-testid="error-fallback">
        <span data-testid="error-message">{{ err.message }}</span>
        <button data-testid="retry-btn" @click="retry()">Retry</button>
      </div>
    </@fallback>
    <div data-testid="flaky-resolved">{{ flakyData.message }}</div>
  </@errorBoundary>
</div>
