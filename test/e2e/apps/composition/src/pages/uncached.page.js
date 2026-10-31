import lifecycleLog from '../bridges/lifecycle-log.bridge.js';

<state count="0" />

<action name="increment"> state.count += 1; </action>
<action name="onBeforeMount"> lifecycleLog.recordUncached('onBeforeMount'); </action>
<action name="onMount"> lifecycleLog.recordUncached('onMount'); </action>
<action name="onActivate"> lifecycleLog.recordUncached('onActivate'); </action>
<action name="onUnmount"> lifecycleLog.recordUncached('onUnmount'); </action>

<main data-testid="page-uncached">
  <SiteNav />
  <h1>Uncached page</h1>
  <label>Draft <input data-testid="uncached-input" /></label>
  <button data-testid="uncached-increment" @click="increment()">Increment</button>
  <p data-testid="uncached-count">{{ count }}</p>
</main>
