<!--
  Control flow: the <@if> chain, and keyed <@for> over every documented
  source -- array, object, Map, Set and numeric range -- with <@empty>.
-->
<state count="0" items="[{ id: 1, label: 'one' }, { id: 2, label: 'two' }]" settings="{ theme: 'dark', size: 'large' }" pairs="null" tags="null" range="3" />

<action name="onMount">
  pairs = new Map([['alpha', 1], ['beta', 2]]);
  tags = new Set(['red', 'green']);
</action>

<action name="inc">count = count + 1;</action>
<action name="reorder">
  items = [{ id: 2, label: 'two' }, { id: 3, label: 'three' }, { id: 1, label: 'one' }];
  settings = { theme: 'light', size: 'large', density: 'compact' };
  pairs = new Map([['beta', 20], ['gamma', 3]]);
  tags = new Set(['green', 'blue', 'red']);
  range = 5;
</action>
<action name="empty">
  items = [];
  settings = {};
  pairs = new Map();
  tags = new Set();
  range = 0;
</action>

<main>
  <h1 data-testid="heading">Control flow</h1>
  <button data-testid="inc" @click="inc()">+1</button>
  <button data-testid="reorder" @click="reorder()">reorder</button>
  <button data-testid="empty" @click="empty()">empty</button>

  <section data-construct="if-chain">
    <@if (count > 1)>
      <strong data-testid="branch">many {{ count }}</strong>
    <@elseif (count > 0)>
      <em data-testid="branch">one</em>
    <@else>
      <span data-testid="branch">none</span>
    </@if>
    <p data-testid="after-if">after the chain</p>
  </section>

  <section data-construct="for-array">
    <ul>
      <@for item in items key="item.id">
        <li data-testid="row">{{ index }}:{{ item.label }}</li>
      <@empty>
        <li data-testid="row-empty">no items</li>
      </@for>
    </ul>
  </section>

  <section data-construct="for-object">
    <ul>
      <@for [key, value] in settings key="key">
        <li data-testid="row">{{ key }}={{ value }}</li>
      <@empty>
        <li data-testid="row-empty">no settings</li>
      </@for>
    </ul>
  </section>

  <section data-construct="for-map">
    <ul>
      <@for [key, value] in pairs key="key">
        <li data-testid="row">{{ key }}={{ value }}</li>
      <@empty>
        <li data-testid="row-empty">no pairs</li>
      </@for>
    </ul>
  </section>

  <section data-construct="for-set">
    <ul>
      <@for tag in tags key="tag">
        <li data-testid="row">{{ tag }}</li>
      <@empty>
        <li data-testid="row-empty">no tags</li>
      </@for>
    </ul>
  </section>

  <section data-construct="for-range">
    <ul>
      <@for n in range key="n">
        <li data-testid="row">#{{ n }}</li>
      <@empty>
        <li data-testid="row-empty">no range</li>
      </@for>
    </ul>
  </section>
</main>
