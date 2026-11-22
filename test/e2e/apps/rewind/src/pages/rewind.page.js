import cart from '../bridges/cart.bridge.js';
import api from '../bridges/api.bridge.js';

<state count="0" commits="0" details="{ nested: { qty: 1 }, removed: 'kept' }" items="['old']" pairs="null" tags="null" />

<action name="onMount">
  pairs = new Map([['kept', 1], ['removed', 2]]);
  tags = new Set(['old']);
</action>

<action name="failSync" atomic>
  count += 1;
  throw new Error('rewind sync failure');
</action>

<action name="failLater" atomic>
  count += 1;
  return api.save('fail');
</action>

<action name="succeed" atomic>
  count += 1;
  return api.save('success');
</action>

<action name="commit">
  return succeed().then(() => { commits += 1; });
</action>

<action name="failBridge" atomic>
  count += 1;
  cart.bump();
  return api.save('fail');
</action>

<action name="failCollections" atomic>
  details.nested.qty = 9;
  delete details.removed;
  details.created = 'new';
  items.splice(0, 1, 'changed');
  items.push('new');
  pairs.set('kept', 9);
  pairs.delete('removed');
  pairs.set('created', 3);
  tags.delete('old');
  tags.add('new');
  return api.save('fail');
</action>

<main>
  <h1>Rewind</h1>
  <p data-testid="count">{{ count }}</p>
  <p data-testid="commits">{{ commits }}</p>
  <p data-testid="quantity">{{ cart.quantity }}</p>
  <Observer />
  <p data-testid="nested">{{ details.nested.qty }}</p>
  <p data-testid="keys">{{ Object.keys(details).sort().join(',') }}</p>
  <p data-testid="removed">{{ details.removed || 'missing' }}</p>
  <p data-testid="items">{{ items.join(',') }}</p>
  <ul data-testid="pairs">
    <@for [key, value] in pairs key="key"><li>{{ key }}={{ value }}</li></@for>
  </ul>
  <ul data-testid="tags">
    <@for tag in tags key="tag"><li>{{ tag }}</li></@for>
  </ul>
  <button data-testid="fail-sync" @click="failSync()">Throw</button>
  <button data-testid="fail-later" @click="failLater()">Reject</button>
  <button data-testid="succeed" @click="commit()">Commit</button>
  <button data-testid="fail-bridge" @click="failBridge()">Change shared cart</button>
  <button data-testid="fail-collections" @click="failCollections()">Change collections</button>
</main>
