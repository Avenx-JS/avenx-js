<state revenue="100" title="Revenue" />

<action name="raiseRevenue"> state.revenue = state.revenue + 50; </action>

<action name="renameTitle"> state.title = 'Net revenue'; </action>

<main>
  <h1 data-testid="heading">Composition</h1>

  <button data-testid="raise" @click="raiseRevenue()">Raise revenue</button>
  <button data-testid="rename" @click="renameTitle()">Rename</button>

  <!-- Props from parent state, plus content projected into both slots. -->
  <section data-testid="filled">
    <StatCard label="{{ title }}" value="{{ revenue }}">
      <span data-testid="projected-body">Quarterly total</span>
      <span slot="footer" data-testid="projected-footer">Updated just now</span>
    </StatCard>
  </section>

  <!-- Nothing projected, so both slots fall back to their own content. -->
  <section data-testid="bare">
    <StatCard label="Headcount" value="12" />
  </section>
</main>
