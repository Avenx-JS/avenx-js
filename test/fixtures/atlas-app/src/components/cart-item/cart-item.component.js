import cart from '../../bridges/cart.bridge.js';

<state id="a" qty="1" price="12" label="Item" draft="" />

<computed name="lineTotal" value="qty * price" />

<action name="incQty">
  cart.addQty(id, 1);
</action>

<action name="reset">
  state.qty = 1;
</action>

<div @css row>
  <span @css label>{{ label }}</span>
  <span @css qty>{{ qty }}</span>
  <span @css line>{{ lineTotal }}</span>
  <button @css inc @click="incQty()">+</button>
  <button @css rst @click="reset()">reset</button>
</div>
