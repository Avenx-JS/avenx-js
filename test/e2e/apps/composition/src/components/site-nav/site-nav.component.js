import lifecycleLog from '../../bridges/lifecycle-log.bridge.js';

<nav data-testid="nav">
  <a href="#/" data-testid="nav-provider">Provider</a>
  <a href="#/cached" data-testid="nav-cached">Cached</a>
  <a href="#/uncached" data-testid="nav-uncached">Uncached</a>
</nav>
<p data-testid="cached-hook-log">{{ lifecycleLog.cachedEvents.join(' -> ') }}</p>
<p data-testid="uncached-hook-log">{{ lifecycleLog.uncachedEvents.join(' -> ') }}</p>
