import lifecycleLog from '../bridges/lifecycle-log.bridge.js';

<state count="0" />

<action name="increment"> state.count += 1; </action>
<action name="onBeforeMount"> lifecycleLog.recordCached('onBeforeMount'); </action>
<action name="onMount"> lifecycleLog.recordCached('onMount'); </action>
<action name="onActivate"> lifecycleLog.recordCached('onActivate'); </action>
<action name="onDeactivate"> lifecycleLog.recordCached('onDeactivate'); </action>
<action name="onUnmount"> lifecycleLog.recordCached('onUnmount'); </action>

<main data-testid="page-cached">
  <SiteNav />
  <h1>Cached page</h1>
  <label>Draft <input data-testid="cached-input" /></label>
  <button data-testid="cached-increment" @click="increment()">Increment</button>
  <p data-testid="cached-count">{{ count }}</p>
</main>
