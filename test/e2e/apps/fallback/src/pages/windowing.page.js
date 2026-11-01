<state rows="[]" />

<action name="onMount">
  const r = [];
  for (let i = 0; i < 5000; i++) {
    r.push({ label: 'item-' + i });
  }
  state.rows = r;
</action>

<main>
  <h1 data-testid="windowing-heading">VirtualList Windowing</h1>
  <div style="height: 300px; width: 400px;" data-testid="list-container">
    <VirtualList :item-height="40" :items="rows">
      <template data-ax-as="row">
        <div class="row-item" data-testid="row-item" style="box-sizing: border-box; height: 40px;">
          #{{ index }} {{ row.label }}
        </div>
      </template>
    </VirtualList>
  </div>
</main>
