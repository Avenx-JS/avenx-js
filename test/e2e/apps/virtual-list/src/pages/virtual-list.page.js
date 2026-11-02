<state rows="[]" />

<action name="onMount">
  const generated = [];
  for (let i = 0; i < 5000; i++) {
    generated.push({ label: 'Row ' + i });
  }
  rows = generated;
</action>

<main>
  <h1 data-testid="virtual-list-heading">VirtualList Windowing</h1>
  <div data-testid="scroll-container" style="height: 400px; width: 400px;">
    <VirtualList :item-height="40" :items="rows">
      <template data-ax-as="row">
        <div data-testid="virtual-row" style="box-sizing: border-box; height: 40px;">
          {{ row.label }}
        </div>
      </template>
    </VirtualList>
  </div>
</main>
