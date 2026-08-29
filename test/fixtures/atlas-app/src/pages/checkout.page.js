import cart from '../bridges/cart.bridge.js';

<state note="" />

<div @css page>
  <h1>Checkout</h1>
  <p @css payable>{{ cart.total }}</p>
  <input data-ax-bind="note" />
</div>
