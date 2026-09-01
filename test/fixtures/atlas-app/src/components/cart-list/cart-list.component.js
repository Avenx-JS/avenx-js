import cart from '../../bridges/cart.bridge.js';

<action name="seed">
  cart.addItem('a', 12);
</action>

<div @css list>
  <button @css seed @click="seed()">add</button>
  <@for item in cart.items>
    <p @css line>{{ item.qty }} x {{ item.price }}</p>
  </@for>
  <CartItem />
  <CartSummary />
</div>
