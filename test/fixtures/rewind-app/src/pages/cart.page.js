import cart from '../bridges/cart.bridge.js';

<state title="Cart" />

<div @css page>
  <h1 @css heading>{{ title }} ({{ cart.total }})</h1>
  <CartItem />
  <PostCard />
</div>
