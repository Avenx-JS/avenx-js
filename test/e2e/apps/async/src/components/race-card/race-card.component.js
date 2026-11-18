<state query="'initial'" />

<resource name="search">
  return fetch('/api/search?q=' + query + '&delay=' + (query === 'slow' ? 300 : 50)).then(res => res.json());
</resource>

<action name="searchSlow">
  query = 'slow';
</action>

<action name="searchFast">
  query = 'fast';
</action>

<div data-testid="race-card">
  <@suspense>
    <@fallback><span data-testid="race-loading">Searching...</span></@fallback>
    <div data-testid="race-result">{{ search.result }}</div>
  </@suspense>
  <button data-testid="slow-search-btn" @click="searchSlow()">Slow Search</button>
  <button data-testid="fast-search-btn" @click="searchFast()">Fast Search</button>
</div>
