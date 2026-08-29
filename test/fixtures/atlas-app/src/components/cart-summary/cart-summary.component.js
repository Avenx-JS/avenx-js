import cart from '../../bridges/cart.bridge.js';

<state open="false" />

<action name="toggle">
  state.open = !state.open;
</action>

<action name="neverCalled">
  state.open = false;
</action>

<div @css box>
  <strong @css total>{{ cart.total }}</strong>
  <span @css count>{{ cart.count }} items</span>
  <button @css t @click="toggle()">toggle</button>
</div>
