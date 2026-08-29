import cart from '../../bridges/cart.bridge.js';

<div @css list>
  <@for item in cart.items>
    <p @css line>{{ item.qty }} x {{ item.price }}</p>
  </@for>
  <CartItem />
  <CartSummary />
</div>
