import cart from '../../bridges/cart.bridge.js';
import session from '../../bridges/session.bridge.js';

<state id="a" busy="false" error="" />

<computed name="lineTotal" value="cart.total" />

<action name="incQty" atomic>
  busy = true;
  cart.addQty(id, 1);
  session.save(cart.total);
</action>

<action name="decQty" atomic onConflict="force">
  cart.addQty(id, -1);
</action>

<action name="rename" atomic>
  cart.setField(id, 'label', 'renamed');
</action>

<div @css row>
  <span @css line>{{ lineTotal }}</span>
  <span @css err>{{ error }}</span>
  <span @css busy>{{ busy }}</span>
  <span @css saved>{{ session.lastSaved }} {{ session.dirty }}</span>
  <button @css inc @click="incQty()">+</button>
  <button @css dec @click="decQty()">-</button>
  <button @css ren @click="rename()">rename</button>
</div>
