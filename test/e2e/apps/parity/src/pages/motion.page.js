<!--
  <transition> and <VirtualList>.

  `transition` wraps a keyed list row, so a new row passes through the enter
  classes; the class prefix is the evaluated `name`. `transition-on-show` pins
  a gap rather than demonstrating practice: the documented pairing with
  data-ax-show applies no transition classes at all, in either build, and
  specs/build/construct-parity.spec.js drives it under test.fail().
-->
<state open="false" rows="[]" items="[{ id: 1, label: 'first' }]" />

<action name="onMount">
  const generated = [];
  for (let i = 0; i < 1000; i++) {
    generated.push({ label: 'row ' + i });
  }
  rows = generated;
</action>

<action name="toggle">open = !open;</action>
<action name="addItem">items = items.concat([{ id: items.length + 1, label: 'added' }]);</action>

<main>
  <h1 data-testid="heading">Motion</h1>

  <section data-construct="transition">
    <button data-testid="add-item" @click="addItem()">add</button>
    <ul>
      <@for item in items key="item.id">
        <transition name="fade">
          <li data-testid="row" data-row="{{ item.id }}">{{ item.label }}</li>
        </transition>
      </@for>
    </ul>
  </section>

  <section data-construct="transition-on-show">
    <button data-testid="toggle" @click="toggle()">toggle</button>
    <transition name="fade">
      <div data-testid="panel" data-ax-show="open">transitioned panel</div>
    </transition>
  </section>

  <section data-construct="virtual-list">
    <div data-testid="viewport" style="height: 200px; width: 300px;">
      <VirtualList :item-height="40" :items="rows">
        <template data-ax-as="row">
          <div data-testid="virtual-row" style="box-sizing: border-box; height: 40px;">{{ row.label }}</div>
        </template>
      </VirtualList>
    </div>
  </section>
</main>
